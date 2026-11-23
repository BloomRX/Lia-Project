import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { NativeStageManager } from './native-stage-manager'

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

const nativeTarget = () => ({ command: 'LiaStage.exe', args: ['native-entry'], cwd: 'native-stage' })

describe('phase 7.2: ownership retained, spawn without shell (tests C/D/G)', () => {
  it('starts the packaged Stage without Node or package tools and waits for its visible renderer', async () => {
    const child = fakeChild()
    const spawnImpl = vi.fn(() => child as never)
    const manager = new NativeStageManager({
      packagedStage: () => ({ command: 'C:\\Lia\\resources\\stage\\LiaStage.exe', args: [], cwd: 'C:\\Lia\\resources\\stage' }),
      spawnImpl: spawnImpl as never,
    })
    const started = manager.start()
    expect(spawnImpl).toHaveBeenCalledWith('C:\\Lia\\resources\\stage\\LiaStage.exe', [], expect.objectContaining({ cwd: 'C:\\Lia\\resources\\stage' }))
    child.stdout.emit('data', 'ready in 1ms')
    expect(manager.state().phase).toBe('starting')
    child.stdout.emit('data', '[lia-stage] window-ready')
    expect((await started).phase).toBe('running')
    child.exitCode = 0
    child.emit('exit', 0)
  })

  it('reports a missing native target and retries when it becomes available', async () => {
    const child = fakeChild()
    const spawnImpl = vi.fn(() => child as never)
    const resolveTarget = vi.fn<typeof nativeTarget>(() => { throw new Error('missing') })
    const manager = new NativeStageManager({
      packagedStage: resolveTarget,
      spawnImpl: spawnImpl as never,
    })
    expect(manager.isAvailable()).toBe(false)
    expect((await manager.start()).phase).toBe('error')
    expect(spawnImpl).not.toHaveBeenCalled()

    resolveTarget.mockImplementation(nativeTarget)
    const retried = manager.start()
    child.stdout.emit('data', '[lia-stage] window-ready')
    expect((await retried).phase).toBe('running')
    expect(spawnImpl).toHaveBeenCalledTimes(1)
    child.emit('exit', 0)
  })

  it('g: the Windows spawn path carries NO shell option - the DEP0190 route is eliminated', async () => {
    const child = fakeChild()
    const spawnImpl = vi.fn((..._args: unknown[]) => child as never)
    for (const platform of ['win32', 'linux'] as const) {
      const manager = new NativeStageManager({
        platform,
        spawnImpl: spawnImpl as never,
        packagedStage: nativeTarget,
      })
      void manager.start()
      const options = spawnImpl.mock.calls.at(-1)?.[2] as { shell?: unknown } | undefined
      expect(options?.shell, `${platform} must not request a shell`).toBeUndefined()
      // oxlint-disable-next-line no-unsafe-optional-chaining -- test mock exists
      const [entrypoint] = spawnImpl.mock.calls.at(-1)?.[1] as string[]
      expect(entrypoint).toBe('native-entry')
    }
  })

  it('h: the stage child NEVER carries ELECTRON_RUN_AS_NODE - it would leak into the window', async () => {
    const child = fakeChild()
    const spawnImpl = vi.fn((..._args: unknown[]) => child as never)
    for (const platform of ['win32', 'linux'] as const) {
      const manager = new NativeStageManager({
        childEnv: { ELECTRON_RUN_AS_NODE: '1' },
        platform,
        spawnImpl: spawnImpl as never,
        packagedStage: nativeTarget,
      })
      void manager.start({ env: { ELECTRON_RUN_AS_NODE: '1' } })
      const options = spawnImpl.mock.calls.at(-1)?.[2] as
        | { env?: Record<string, string | undefined> }
        | undefined
      expect(
        options?.env?.ELECTRON_RUN_AS_NODE,
        `${platform} must not leak ELECTRON_RUN_AS_NODE into the stage child`,
      ).toBeUndefined()
    }
  })

  it('c: a session spawn retains truthful ownership while the Stage lives', async () => {
    const child = fakeChild({ pid: 4242 })
    const manager = new NativeStageManager({
      platform: 'linux',
      spawnImpl: vi.fn(() => child as never) as never,
      packagedStage: nativeTarget,
    })
    const started = manager.start()
    child.stdout.emit('data', '[lia-stage] window-ready')
    await started

    expect(manager.holdsOwnedStage()).toBe(true)
    expect(manager.state().pid).toBe(4242)
    expect(manager.state().phase).toBe('running')
    expect(manager.command()).not.toContain('pnpm')
    expect(manager.command()).toBe('LiaStage.exe')
  })

  it('d: ownership is a live-process fact, not a wrapper fact - exit after running flips to stopped, stop() then stops attempting', async () => {
    const child = fakeChild({ pid: 4243 })
    const manager = new NativeStageManager({
      platform: 'linux',
      spawnImpl: vi.fn(() => child as never) as never,
      packagedStage: nativeTarget,
    })
    const started = manager.start()
    child.stdout.emit('data', '[lia-stage] window-ready')
    await started
    expect(manager.holdsOwnedStage()).toBe(true)

    child.emit('exit', 0, null)
    expect(manager.holdsOwnedStage()).toBe(false)
    expect(manager.state().phase).toBe('stopped')
    expect(manager.state().lastExitCode).toBe(0)

    await manager.stop() // nothing live: stops are no-ops, not kills
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('e: shutdown after a session start ALWAYS attempts the stop - never "nothing this session started" (win32 taskkill path)', async () => {
    const child = fakeChild({ pid: 7890 })
    const execFileImpl = vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: () => void) => {
      setTimeout(() => child.emit('exit', null, 'SIGTERM'), 5)
      cb()
      return {} as never
    })
    const manager = new NativeStageManager({
      execFileImpl: execFileImpl as never,
      platform: 'win32',
      spawnImpl: vi.fn(() => child as never) as never,
      packagedStage: nativeTarget,
    })
    const started = manager.start()
    child.stdout.emit('data', '[lia-stage] window-ready')
    await started

    await manager.stop()
    expect(execFileImpl).toHaveBeenCalledWith(
      'taskkill',
      ['/PID', '7890', '/T', '/F'],
      expect.objectContaining({ timeout: 30_000 }),
      expect.any(Function),
    )
    expect(manager.state().phase).toBe('stopped')
    expect(manager.holdsOwnedStage()).toBe(false)
  })
})

describe('d. Conversar spawns the stage once', () => {
  it('start() spawns the documented command and reports running after the ready signal', async () => {
    const child = fakeChild()
    const spawnImpl = vi.fn((...args: unknown[]) => {
      void args
      return child as never
    })
    const manager = new NativeStageManager({
      platform: 'linux',
      spawnImpl: spawnImpl as never,
      packagedStage: nativeTarget,
    })

    const started = manager.start({ env: { LIA_MANAGED: '1' } })
    expect(manager.state().phase).toBe('starting')
    expect(spawnImpl).toHaveBeenCalledTimes(1)
    expect(spawnImpl.mock.calls[0].slice(0, 2)).toEqual(['LiaStage.exe', ['native-entry']])
    expect(spawnImpl.mock.calls[0][2]).toMatchObject({ cwd: 'native-stage' })
    expect((spawnImpl.mock.calls[0][2] as { shell?: unknown }).shell).toBeUndefined()
    expect((spawnImpl.mock.calls[0][2] as { env: Record<string, string> }).env.LIA_MANAGED).toBe('1')

    child.stdout.emit('data', '[lia-stage] window-ready')
    const state = await started
    expect(state.phase).toBe('running')
    expect(state.pid).toBe(child.pid)
  })
})

describe('e. Repeated Conversar is single-flight', () => {
  it('concurrent starts share one spawn; starts after running do not respawn', async () => {
    const child = fakeChild()
    const spawnImpl = vi.fn((...args: unknown[]) => {
      void args
      return child as never
    })
    const manager = new NativeStageManager({
      platform: 'linux',
      spawnImpl: spawnImpl as never,
      packagedStage: nativeTarget,
    })

    const first = manager.start()
    const second = manager.start()
    child.stdout.emit('data', '[lia-stage] window-ready')
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
    child.stdout.emit('data', '[lia-stage] window-ready')
    await next
  })
})

describe('f. Stage exit updates state', () => {
  it('an unexpected exit after ready flips to stopped with the exit code', async () => {
    const child = fakeChild()
    const spawnImpl = vi.fn((...args: unknown[]) => {
      void args
      return child as never
    })
    const manager = new NativeStageManager({
      platform: 'linux',
      spawnImpl: spawnImpl as never,
      packagedStage: nativeTarget,
    })

    const started = manager.start()
    child.stdout.emit('data', '[lia-stage] window-ready')
    await started
    expect(manager.state().phase).toBe('running')

    child.exitCode = 1
    child.emit('exit', 1)

    const state = manager.state()
    expect(state.phase).toBe('stopped')
    expect(state.lastExitCode).toBe(1)
  })

  it('an exit DURING start is an error, not a stop', async () => {
    const child = fakeChild()
    const spawnImpl = vi.fn((...args: unknown[]) => {
      void args
      return child as never
    })
    const manager = new NativeStageManager({
      platform: 'linux',
      spawnImpl: spawnImpl as never,
      packagedStage: nativeTarget,
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
    const child = fakeChild()
    const spawnImpl = vi.fn((..._args: unknown[]) => child as never)
    const manager = new NativeStageManager({
      execFileImpl: options.execFileImpl as never,
      platform: options.platform ?? 'linux',
      spawnImpl: spawnImpl as never,
      stopGraceMs: options.stopGraceMs,
      packagedStage: nativeTarget,
    })
    const started = manager.start()
    child.stdout.emit('data', '[lia-stage] window-ready')
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
    const execFileImpl = vi.fn()
    const manager = new NativeStageManager({
      execFileImpl: execFileImpl as never,
      platform: 'win32',
      packagedStage: nativeTarget,
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
