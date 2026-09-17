import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { AiriStageManager } from './airi-stage-manager'

/**
 * Tests D, E and F of the Phase 7 contract: "Conversar" spawns the stage
 * once, repeated "Conversar" is single-flight, and an unexpected stage exit
 * is reported in state.
 */

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

// The stage workspace exists iff `<root>/apps/stage-tamagotchi` does. The
// fake spawn ignores the cwd, so the folder fixture is about availability
// checks only.
let stageWorkspace = ''
async function makeStageWorkspace(): Promise<string> {
  if (!stageWorkspace) {
    const root = await mkdtemp(join(tmpdir(), 'lia-stage-ws-'))
    await mkdir(join(root, 'apps', 'stage-tamagotchi'), { recursive: true })
    await writeFile(join(root, 'apps', 'stage-tamagotchi', 'package.json'), '{}\n')
    stageWorkspace = root
  }
  return stageWorkspace
}

describe('d. Conversar spawns the stage once', () => {
  it('start() spawns the documented command and reports running after the ready signal', async () => {
    const root = await makeStageWorkspace()
    const child = fakeChild()
    const spawnImpl = vi.fn((...args: unknown[]) => {
      void args
      return child as never
    })
    const manager = new AiriStageManager({
      platform: 'linux',
      spawnImpl: spawnImpl as never,
      workspaceRoot: root,
    })

    const started = manager.start({ env: { LIA_MANAGED: '1' } })
    expect(manager.state().phase).toBe('starting')
    expect(spawnImpl).toHaveBeenCalledTimes(1)
    expect(spawnImpl.mock.calls[0][1]).toEqual(['-rF', '@proj-airi/stage-tamagotchi', 'run', 'dev'])
    expect(spawnImpl.mock.calls[0][2]).toMatchObject({ cwd: root })
    expect((spawnImpl.mock.calls[0][2] as { env: Record<string, string> }).env.LIA_MANAGED).toBe('1')

    child.stdout.emit('data', '> dev server ready in 512 ms\n')
    const state = await started
    expect(state.phase).toBe('running')
    expect(state.pid).toBe(child.pid)
  })
})

describe('e. Repeated Conversar is single-flight', () => {
  it('concurrent starts share one spawn; starts after running do not respawn', async () => {
    const root = await makeStageWorkspace()
    const child = fakeChild()
    const spawnImpl = vi.fn((...args: unknown[]) => {
      void args
      return child as never
    })
    const manager = new AiriStageManager({
      platform: 'linux',
      spawnImpl: spawnImpl as never,
      workspaceRoot: root,
    })

    const first = manager.start()
    const second = manager.start()
    child.stdout.emit('data', 'ready in 100 ms')
    await first
    await second
    expect(spawnImpl).toHaveBeenCalledTimes(1)

    const running = await manager.start()
    expect(running.phase).toBe('running')
    expect(spawnImpl).toHaveBeenCalledTimes(1)

    // After the child went away, a fresh launch spawns again - liveness.
    child.exitCode = 1
    const next = manager.start()
    expect(spawnImpl).toHaveBeenCalledTimes(2)
    child.stdout.emit('data', 'ready in 90 ms')
    await next
  })
})

describe('f. Stage exit updates state', () => {
  it('an unexpected exit after ready flips to stopped with the exit code', async () => {
    const root = await makeStageWorkspace()
    const child = fakeChild()
    const spawnImpl = vi.fn((...args: unknown[]) => {
      void args
      return child as never
    })
    const manager = new AiriStageManager({
      platform: 'linux',
      spawnImpl: spawnImpl as never,
      workspaceRoot: root,
    })

    const started = manager.start()
    child.stdout.emit('data', 'ready in 400 ms')
    await started
    expect(manager.state().phase).toBe('running')

    child.exitCode = 1
    child.emit('exit', 1)

    const state = manager.state()
    expect(state.phase).toBe('stopped')
    expect(state.lastExitCode).toBe(1)
  })

  it('an exit DURING start is an error, not a stop', async () => {
    const root = await makeStageWorkspace()
    const child = fakeChild()
    const spawnImpl = vi.fn((...args: unknown[]) => {
      void args
      return child as never
    })
    const manager = new AiriStageManager({
      platform: 'linux',
      spawnImpl: spawnImpl as never,
      workspaceRoot: root,
    })

    const started = manager.start()
    child.exitCode = 1
    child.emit('exit', 1)
    const state = await started
    expect(state.phase).toBe('error')
    expect(state.lastExitCode).toBe(1)
  })
})

/**
 * Phase 7.1 supervisor stop contract for the STAGE: honesty about
 * 'stopping', exit-observed 'stopped', safe fallback to 'error', single-
 * flight idempotence, and the axiom that an external stage is invisible.
 */
describe('supervisor stop (Phase 7.1)', () => {
  async function startedManager(options: {
    execFileImpl?: (...args: unknown[]) => void
    platform?: NodeJS.Platform
    stopGraceMs?: number
  } = {}) {
    const root = await makeStageWorkspace()
    const child = fakeChild()
    const spawnImpl = vi.fn(() => child as never)
    const manager = new AiriStageManager({
      execFileImpl: options.execFileImpl as never,
      platform: options.platform ?? 'linux',
      spawnImpl: spawnImpl as never,
      stopGraceMs: options.stopGraceMs,
      workspaceRoot: root,
    })
    const started = manager.start()
    child.stdout.emit('data', 'ready in 50 ms')
    await started
    return { child, manager }
  }

  function giveExit(child: ReturnType<typeof fakeChild>, code: number) {
    child.exitCode = code
    child.emit('exit', code)
  }

  it('stop() passes through stopping and reports stopped only after the observed exit', async () => {
    const { child, manager } = await startedManager()
    const observed: string[] = []
    const stopping = manager.stop().then(() => observed.push('resolved'))

    expect(manager.state().phase).toBe('stopping')
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')

    await new Promise<void>(resolve => setTimeout(resolve, 5))
    expect(manager.state().phase).toBe('stopping') // No fake 'stopped'.
    giveExit(child, 0)
    await stopping
    expect(manager.state().phase).toBe('stopped')
    expect(observed).toEqual(['resolved'])
  })

  it('c. a manager that never spawned a stage stops nothing and stays honest', async () => {
    const root = await makeStageWorkspace()
    const execFileImpl = vi.fn()
    const manager = new AiriStageManager({
      execFileImpl: execFileImpl as never,
      platform: 'win32',
      workspaceRoot: root,
    })
    expect(manager.holdsOwnedStage()).toBe(false)
    await manager.stop()
    expect(manager.state().phase).toBe('stopped')
    // An external stage is invisible: no taskkill was issued by name.
    expect(execFileImpl).not.toHaveBeenCalled()
  })

  it('on Windows the tree kill targets the owned child and waits for its exit', async () => {
    const calls: string[][] = []
    const execFileImpl = vi.fn((...args: unknown[]) => {
      calls.push(args.slice(0, 2) as string[])
      const callback = args[args.length - 1] as (err: null) => void
      callback(null)
    })
    const { child, manager } = await startedManager({ execFileImpl, platform: 'win32' })

    const stopping = manager.stop()
    expect(execFileImpl).toHaveBeenCalledTimes(1)
    expect(calls[0][0]).toBe('taskkill')
    expect(calls[0][1]).toEqual(['/PID', String(child.pid), '/T', '/F'])
    expect(manager.state().phase).toBe('stopping')

    giveExit(child, 0)
    await stopping
    expect(manager.state().phase).toBe('stopped')
  })

  it('a child that never exits after both attempts turns error - never a lying stopped', async () => {
    const { manager } = await startedManager({ platform: 'linux', stopGraceMs: 10 })
    await manager.stop()
    expect(manager.state().phase).toBe('error')
    expect(manager.state().message).toContain('did not confirm')
  }, 15_000)

  it('concurrent stop() calls share one teardown', async () => {
    const execFileImpl = vi.fn((...args: unknown[]) => {
      const callback = args[args.length - 1] as (err: null) => void
      callback(null)
    })
    const { child, manager } = await startedManager({ execFileImpl, platform: 'win32' })

    const first = manager.stop()
    const second = manager.stop()
    const third = manager.stop()
    giveExit(child, 0)
    await Promise.all([first, second, third])
    expect(execFileImpl).toHaveBeenCalledTimes(1)

    // Idempotent afterwards: another stop is a no-op, not a second kill.
    await manager.stop()
    expect(execFileImpl).toHaveBeenCalledTimes(1)
  })
})
