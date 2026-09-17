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
