/**
 * Phase 8.0D-M3.0b: the MANAGED launch path is the one that has to be safe.
 *
 * The Windows runtime log settled where the fix belongs:
 *
 *   lia-app.stage-log spawn: node ...\apps\stage-tamagotchi\node_modules\electron-vite\bin\electron-vite.js dev
 *
 * "Conversar com Lia" spawns electron-vite DIRECTLY with Node. It never reads
 * `apps/stage-tamagotchi/package.json`, so the Phase 8.0D-M3.0a `dev` script
 * change does not lie on this path - it protects a manual `pnpm
 * dev:tamagotchi` and nothing else. This file pins the managed contract:
 *
 *   start() -> [build prerequisite] -> only on success -> direct spawn
 *
 * and, just as importantly, what must NOT change: the spawned Stage process
 * stays `process.execPath [electron-vite.js, dev]` with no shell, and the
 * Phase 7.2 ownership/stop semantics stay exactly as they were.
 */
import type { StageBuildPrerequisite, StagePrerequisiteOutcome } from './stage-build-prerequisite'

import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execPath } from 'node:process'

import { describe, expect, it, vi } from 'vitest'

import { AiriStageManager } from './airi-stage-manager'
import { createCoreAgentBuildPrerequisite } from './stage-build-prerequisite'

function fakeChild(options: { pid?: number } = {}) {
  const emitter = new EventEmitter() as EventEmitter & {
    exitCode: null | number
    kill: ReturnType<typeof vi.fn>
    pid: number
    stderr: EventEmitter
    stdout: EventEmitter
  }
  emitter.stdout = new EventEmitter()
  emitter.stderr = new EventEmitter()
  emitter.exitCode = null
  emitter.pid = options.pid ?? 9120
  emitter.kill = vi.fn(() => true)
  return emitter
}

async function makeStageWorkspace(options: { coreAgentSource?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lia-managed-prereq-'))
  await mkdir(join(root, 'apps', 'stage-tamagotchi'), { recursive: true })
  await writeFile(join(root, 'apps', 'stage-tamagotchi', 'package.json'), '{}\n')
  if (options.coreAgentSource) {
    await mkdir(join(root, 'packages', 'core-agent'), { recursive: true })
    await writeFile(
      join(root, 'packages', 'core-agent', 'package.json'),
      JSON.stringify({ name: '@proj-airi/core-agent', scripts: { build: 'tsdown' } }),
    )
  }
  return root
}

/**
 * A prerequisite the test drives by hand, so the ORDER of "prerequisite
 * finished" versus "stage spawned" is observable rather than inferred.
 */
function gatedPrerequisite(outcome: StagePrerequisiteOutcome = { ok: true }) {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const runCalls: number[] = []
  const impl: StageBuildPrerequisite = {
    applies: () => true,
    name: 'core-agent-build',
    async run() {
      runCalls.push(1)
      await gate
      return outcome
    },
  }
  return { impl, release, runCalls }
}

/** A prerequisite that succeeds at once, for tests that are not about order. */
function immediatePrerequisite(outcome: StagePrerequisiteOutcome = { ok: true }): StageBuildPrerequisite {
  return {
    applies: () => true,
    name: 'core-agent-build',
    async run() {
      return outcome
    },
  }
}

describe('phase 8.0D-M3.0b: managed start() is gated by the build prerequisite', () => {
  it('1+3: a successful prerequisite runs BEFORE the spawn, which then happens exactly once', async () => {
    const root = await makeStageWorkspace({ coreAgentSource: true })
    const child = fakeChild()
    const spawnImpl = vi.fn(() => child as never)
    const prerequisite = gatedPrerequisite({ ok: true, reason: 'build-succeeded' })

    const manager = new AiriStageManager({
      platform: 'linux',
      prerequisite: prerequisite.impl,
      spawnImpl: spawnImpl as never,
      workspaceRoot: root,
    })

    const started = manager.start()
    // The prerequisite is still pending: nothing may have been spawned yet.
    expect(prerequisite.runCalls).toHaveLength(1)
    expect(spawnImpl).toHaveBeenCalledTimes(0)
    expect(manager.state().phase).toBe('starting')

    prerequisite.release()
    await vi.waitFor(() => expect(spawnImpl).toHaveBeenCalledTimes(1))
    child.stdout.emit('data', 'ready in 120 ms')
    const state = await started

    expect(state.phase).toBe('running')
    expect(spawnImpl).toHaveBeenCalledTimes(1)
    expect(prerequisite.runCalls).toHaveLength(1)
  })

  it('2: a failed prerequisite means ZERO stage spawns and an honest error state', async () => {
    const root = await makeStageWorkspace({ coreAgentSource: true })
    const child = fakeChild()
    const spawnImpl = vi.fn(() => child as never)
    const prerequisite = gatedPrerequisite({ ok: false, reason: 'exit:1' })

    const manager = new AiriStageManager({
      platform: 'linux',
      prerequisite: prerequisite.impl,
      spawnImpl: spawnImpl as never,
      workspaceRoot: root,
    })

    const started = manager.start()
    prerequisite.release()
    const state = await started

    // The stale artifact must never be served: no child, no ownership, and a
    // state that says the build failed rather than inventing another cause.
    expect(spawnImpl).toHaveBeenCalledTimes(0)
    expect(state.phase).toBe('error')
    expect(state.message).toMatch(/build/i)
    expect(state.lastExitCode, 'no child ever existed, so no exit code may be claimed').toBeUndefined()
    expect(manager.holdsOwnedStage()).toBe(false)

    // And the next attempt is allowed to try again - a failure is not sticky.
    const retry = gatedPrerequisite({ ok: true })
    const retryManager = new AiriStageManager({
      platform: 'linux',
      prerequisite: retry.impl,
      spawnImpl: spawnImpl as never,
      workspaceRoot: root,
    })
    const retryStarted = retryManager.start()
    retry.release()
    await vi.waitFor(() => expect(spawnImpl).toHaveBeenCalledTimes(1))
    child.stdout.emit('data', 'ready in 90 ms')
    expect((await retryStarted).phase).toBe('running')
  })

  it('4: concurrent starts collapse into ONE prerequisite and ONE spawn', async () => {
    const root = await makeStageWorkspace({ coreAgentSource: true })
    const child = fakeChild()
    const spawnImpl = vi.fn(() => child as never)
    const prerequisite = gatedPrerequisite({ ok: true })

    const manager = new AiriStageManager({
      platform: 'linux',
      prerequisite: prerequisite.impl,
      spawnImpl: spawnImpl as never,
      workspaceRoot: root,
    })

    // A double click on "Conversar": both calls join one launch, so neither a
    // second build nor a second stage can appear.
    const first = manager.start()
    const second = manager.start()
    expect(prerequisite.runCalls).toHaveLength(1)

    prerequisite.release()
    await vi.waitFor(() => expect(spawnImpl).toHaveBeenCalledTimes(1))
    child.stdout.emit('data', 'ready in 100 ms')
    await first
    await second

    expect(prerequisite.runCalls).toHaveLength(1)
    expect(spawnImpl).toHaveBeenCalledTimes(1)
    expect(manager.holdsOwnedStage()).toBe(true)
  })

  it('5: the owned Stage process is unchanged - node, electron-vite.js dev, no shell', async () => {
    const root = await makeStageWorkspace({ coreAgentSource: true })
    const child = fakeChild({ pid: 4321 })
    // Declared with a rest parameter so `mock.calls[0]` is inspectable.
    const spawnImpl = vi.fn((..._args: unknown[]) => child as never)

    const manager = new AiriStageManager({
      platform: 'linux',
      prerequisite: immediatePrerequisite(),
      spawnImpl: spawnImpl as never,
      workspaceRoot: root,
    })

    const started = manager.start()
    await vi.waitFor(() => expect(spawnImpl).toHaveBeenCalledTimes(1))
    child.stdout.emit('data', 'ready in 100 ms')
    await started

    expect(spawnImpl.mock.calls[0][0]).toBe(execPath)
    const [entrypoint, subcommand] = spawnImpl.mock.calls[0][1] as string[]
    expect(entrypoint.replace(/\\/g, '/'))
      .toContain('apps/stage-tamagotchi/node_modules/electron-vite/bin/electron-vite.js')
    expect(subcommand).toBe('dev')
    expect((spawnImpl.mock.calls[0][2] as { shell?: unknown }).shell).toBeUndefined()
    // The prerequisite is a separate short-lived child, never the owned one.
    expect(manager.command()).not.toContain('pnpm')
    expect(manager.command()).not.toContain('tsdown')
    expect(manager.command()).toContain('electron-vite')
  })

  it('6: ownership and the Windows tree kill still hold after a prerequisite-gated start', async () => {
    const root = await makeStageWorkspace({ coreAgentSource: true })
    const child = fakeChild({ pid: 7777 })
    const execFileImpl = vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: () => void) => {
      setTimeout(() => child.emit('exit', null, 'SIGTERM'), 5)
      cb()
      return {} as never
    })

    const manager = new AiriStageManager({
      execFileImpl: execFileImpl as never,
      platform: 'win32',
      prerequisite: immediatePrerequisite(),
      spawnImpl: vi.fn(() => child as never) as never,
      workspaceRoot: root,
    })

    const started = manager.start()
    await vi.waitFor(() => expect(manager.state().pid).toBe(7777))
    child.stdout.emit('data', 'ready in 100 ms')
    await started
    expect(manager.holdsOwnedStage()).toBe(true)

    await manager.stop()
    expect(execFileImpl).toHaveBeenCalledWith(
      'taskkill',
      ['/PID', '7777', '/T', '/F'],
      expect.objectContaining({ timeout: 30_000 }),
      expect.any(Function),
    )
    expect(manager.state().phase).toBe('stopped')
    expect(manager.holdsOwnedStage()).toBe(false)
  })

  it('7: with no source workspace nothing is awaited and no prerequisite runs (packaged production)', async () => {
    const root = await makeStageWorkspace({ coreAgentSource: false })
    const child = fakeChild()
    const spawnImpl = vi.fn(() => child as never)

    // The DEFAULT prerequisite, against a workspace that has no
    // `packages/core-agent`: this is the packaged-production shape.
    const manager = new AiriStageManager({
      platform: 'linux',
      spawnImpl: spawnImpl as never,
      workspaceRoot: root,
    })
    expect(createCoreAgentBuildPrerequisite({ workspaceRoot: root }).applies()).toBe(false)

    const started = manager.start()
    // Synchronous: no await was inserted, so the Phase 7.2 launch shape the
    // existing ownership tests pin is untouched.
    expect(spawnImpl).toHaveBeenCalledTimes(1)
    child.stdout.emit('data', 'ready in 100 ms')
    expect((await started).phase).toBe('running')
  })

  it('diagnostics: metadata-only prerequisite lines, before the spawn line', async () => {
    const root = await makeStageWorkspace({ coreAgentSource: true })
    const child = fakeChild()
    const logs: string[] = []
    const spawnImpl = vi.fn(() => child as never)
    const prerequisite = gatedPrerequisite({ ok: true, reason: 'build-succeeded' })

    const manager = new AiriStageManager({
      onLog: line => logs.push(line),
      platform: 'linux',
      prerequisite: prerequisite.impl,
      spawnImpl: spawnImpl as never,
      workspaceRoot: root,
    })

    const started = manager.start()
    expect(logs).toContain('stage-prerequisite name=core-agent-build state=starting')
    prerequisite.release()
    await vi.waitFor(() => expect(spawnImpl).toHaveBeenCalledTimes(1))
    child.stdout.emit('data', 'ready in 100 ms')
    await started

    expect(logs).toContain('stage-prerequisite name=core-agent-build state=succeeded reason=build-succeeded')
    const spawnIndex = logs.findIndex(line => line.startsWith('spawn: node'))
    const succeededIndex = logs.indexOf('stage-prerequisite name=core-agent-build state=succeeded reason=build-succeeded')
    expect(spawnIndex).toBeGreaterThan(-1)
    expect(succeededIndex).toBeLessThan(spawnIndex)

    // No workspace paths, no credentials, no build output bodies.
    for (const line of logs.filter(entry => entry.startsWith('stage-prerequisite'))) {
      expect(line).not.toContain(root)
      expect(line).not.toMatch(/key|token|secret|password/i)
    }
  })

  it('diagnostics: a failed prerequisite reports its reason and stops before the spawn line', async () => {
    const root = await makeStageWorkspace({ coreAgentSource: true })
    const logs: string[] = []
    const prerequisite = gatedPrerequisite({ ok: false, reason: 'compound-build-script' })

    const manager = new AiriStageManager({
      onLog: line => logs.push(line),
      platform: 'linux',
      prerequisite: prerequisite.impl,
      spawnImpl: vi.fn(() => fakeChild() as never) as never,
      workspaceRoot: root,
    })

    const started = manager.start()
    prerequisite.release()
    expect((await started).phase).toBe('error')
    expect(logs).toContain('stage-prerequisite name=core-agent-build state=failed reason=compound-build-script')
    expect(logs.some(line => line.startsWith('spawn: node'))).toBe(false)
  })
})
