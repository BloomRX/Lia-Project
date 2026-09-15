import type { ChildProcess } from 'node:child_process'

import type { RuntimeManager, RuntimeManagerDeps } from './alltalk-runtime'

import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRuntimeManager, ENVIRONMENT_MARKERS, INSTALL_MARKERS, spawnEnvFor, startCommandFor, taskkillArgs, WINDOWS_START_SCRIPT } from './alltalk-runtime'

/**
 * The runtime manager owns a real process, so these tests inject both the
 * spawner and the health probe. Nothing here touches a port or an executable.
 */

interface FakeChild {
  exit: (code: number) => void
  killImpl: ReturnType<typeof vi.fn>
  proc: ChildProcess
}

/**
 * A stand-in for a real child process.
 *
 * `obedient` models the normal case: the process exits when signalled, which is
 * what a real AllTalk server does. Pass `obedient: false` for the stubborn case
 * the SIGKILL escalation exists to handle.
 */
function fakeChild(options: { obedient?: boolean } = {}): FakeChild {
  const obedient = options.obedient ?? true
  const emitter = new EventEmitter() as EventEmitter & {
    exitCode: number | null
    killed: boolean
    kill: ReturnType<typeof vi.fn>
    pid: number
    stderr: EventEmitter
    stdout: EventEmitter
  }
  emitter.stdout = new EventEmitter()
  emitter.stderr = new EventEmitter()
  emitter.exitCode = null
  emitter.killed = false
  emitter.pid = 4242

  const killImpl = vi.fn((signal?: string) => {
    emitter.killed = true
    if (obedient) {
      // A real process tears down on SIGTERM; emit on the next tick so the
      // await inside stop() is what observes it, not this synchronous call.
      queueMicrotask(() => {
        emitter.exitCode = 0
        emitter.emit('exit', 0, signal ?? null)
      })
    }
    return true
  })
  emitter.kill = killImpl

  return {
    exit: (code: number) => {
      emitter.exitCode = code
      emitter.emit('exit', code, null)
    },
    killImpl,
    proc: emitter as unknown as ChildProcess,
  }
}

/** A folder that looks like a completed AllTalk install. */
async function installedDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lia-runtime-'))
  for (const marker of [...INSTALL_MARKERS, ...ENVIRONMENT_MARKERS]) {
    if (marker.includes('.'))
      await writeFile(join(dir, marker), '# placeholder\n')
    else
      await mkdir(join(dir, marker), { recursive: true })
  }
  await writeFile(join(dir, WINDOWS_START_SCRIPT), '@echo off\n')
  return dir
}

/**
 * `spawnFlow: true` models "I spawn and own my own server": the FIRST health
 * call (the classification read) sees nothing, so the manager spawns; every
 * later one answers, so waitForHealth succeeds and later starts reuse. Tests
 * overriding `isHealthy` themselves handle their own sequencing.
 */
function managerFor(
  overrides: Partial<RuntimeManagerDeps> & { installDir?: string, obedient?: boolean, spawnFlow?: boolean },
): { manager: RuntimeManager, spawned: ReturnType<typeof vi.fn>, child: FakeChild } {
  const { obedient, spawnFlow, ...deps } = overrides
  const child = fakeChild({ obedient })
  const spawned = vi.fn(() => child.proc)
  let healthCalls = 0
  const manager = createRuntimeManager({
    isHealthy: spawnFlow ? async () => (healthCalls += 1) > 1 : async () => false,
    installDir: '',
    platform: 'win32',
    pollIntervalMs: 1,
    // The world is an empty port unless a test says otherwise: tests worth
    // their salt name their conflicts explicitly.
    probeOccupied: async () => 'free',
    spawnImpl: spawned as never,
    startTimeoutMs: 40,
    stopGraceMs: 30,
    ...deps,
  })
  return { child, manager, spawned }
}

const tempDirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  void Promise.all(tempDirs.splice(0).map(() => undefined))
})

describe('startCommandFor', () => {
  it('never interpolates the install directory into a command string', () => {
    const { args, command, options } = startCommandFor('win32', 'C:\\Apps\\AllTalk v2')

    // The dangerous version would be `cmd /c "C:\Apps\AllTalk v2\start_alltalk.bat"`.
    // Here the path appears nowhere in the arguments: it is the cwd.
    expect(command).toBeTruthy()
    expect(args).toContain(WINDOWS_START_SCRIPT)
    for (const arg of args)
      expect(arg).not.toContain('AllTalk v2')

    expect(options.cwd).toBe('C:\\Apps\\AllTalk v2')
  })

  it('spawns without a shell and with no visible console window', () => {
    const { options } = startCommandFor('win32', 'C:\\Apps\\AllTalk')

    // shell: true would hand the arguments to a shell for re-parsing; leaving it
    // unset keeps the array literal.
    expect(options.shell).toBeUndefined()
    expect(options.windowsHide).toBe(true)
    expect(options.stdio).toEqual(['ignore', 'pipe', 'pipe'])
  })

  it('uses the ComSpec interpreter on Windows so a custom shell cannot be injected', () => {
    const { command } = startCommandFor('win32', 'C:\\Apps\\AllTalk')
    expect(command).toBe(process.env.ComSpec ?? 'cmd.exe')
  })

  it('falls back to python3 on non-Windows platforms', () => {
    const { args, command } = startCommandFor('linux', '/opt/alltalk')
    expect(command).toBe('bash')
    expect(args.join(' ')).toContain('python3 script.py')
  })
})

describe('detection', () => {
  it('reports not installed when no directory is configured', async () => {
    const { manager } = managerFor({ installDir: '' })
    expect(await manager.isInstalled()).toBe(false)
    expect((await manager.start()).phase).toBe('notInstalled')
  })

  it('reports not installed for a directory missing the install markers', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    const { manager } = managerFor({ installDir: join(dir, 'definitely-not-here') })

    expect(await manager.isInstalled()).toBe(false)
    expect((await manager.start()).phase).toBe('notInstalled')
  })

  it('recognises a complete install', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    const { manager } = managerFor({ installDir: dir })

    expect(await manager.isInstalled()).toBe(true)
  })

  it('treats an install without the generated launcher as incomplete', async () => {
    // atsetup.bat writes start_alltalk.bat as its last step, so a folder without
    // it means the user extracted something but never finished the setup.
    const dir = await installedDir()
    tempDirs.push(dir)
    const { rm } = await import('node:fs/promises')
    await rm(join(dir, WINDOWS_START_SCRIPT))
    const { manager } = managerFor({ installDir: dir })

    expect(await manager.isInstalled()).toBe(false)
  })
})

describe('start', () => {
  it('does not spawn twice when started while already starting', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    const { manager, spawned } = managerFor({ installDir: dir })

    const [first, second] = await Promise.all([manager.start(), manager.start()])

    // One child, one promise, and both callers agree on the outcome.
    expect(spawned).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
  })

  it('does not spawn again once the runtime is already ready', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    // The first health read (classification) finds nothing, so the manager
    // spawns; reads after that answer, so the second start reuses. Without
    // that sequencing the blanket-true probe would mean "an instance is
    // already running" - which the adoption tests below model on purpose.
    const { manager, spawned } = managerFor({ installDir: dir, spawnFlow: true })

    await manager.start()
    await manager.start()

    expect(spawned).toHaveBeenCalledTimes(1)
    expect(manager.state().phase).toBe('ready')
  })

  it('reaches ready and records the pid once health succeeds', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    const { manager } = managerFor({ installDir: dir, spawnFlow: true })

    const state = await manager.start()

    expect(state.phase).toBe('ready')
    expect(state.pid).toBe(4242)
    expect(manager.state().phase).toBe('ready')
  })

  it('restarts when the server disappeared behind its back', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    let serving = true
    let healthCalls = 0
    const { manager, spawned } = managerFor({
      installDir: dir,
      // First read = classification (empty world, spawn); later reads track
      // `serving`, so the .disappeared. path below is a real re-classify.
      isHealthy: async () => (healthCalls += 1) > 1 ? serving : false,
    })

    await manager.start()
    expect((await manager.start()).phase).toBe('ready')
    expect(spawned).toHaveBeenCalledTimes(1)

    // The user closed the terminal: the port is dead even though we think not.
    serving = false
    expect(manager.state().phase).toBe('ready')
    await manager.start()
    expect(spawned).toHaveBeenCalledTimes(2)
  })

  it('reports an error instead of throwing when the child dies during startup', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    const { child, manager } = managerFor({ installDir: dir })

    const start = manager.start()
    child.exit(1)
    const state = await start

    expect(state.phase).toBe('error')
    // A sentence the UI can show as-is, not a stack trace.
    expect(state.message).toBeTruthy()
    expect(state.message).not.toContain('Error:')
  })

  it('reports an error when the server never becomes healthy', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    const { manager } = managerFor({ installDir: dir, isHealthy: async () => false })

    const state = await manager.start()

    expect(state.phase).toBe('error')
    expect(state.message).toContain('took too long')
  })

  it('waits for health instead of assuming the process is up', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    let attempts = 0
    const { manager } = managerFor({
      installDir: dir,
      isHealthy: async () => {
        attempts += 1
        return attempts >= 3
      },
    })

    expect((await manager.start()).phase).toBe('ready')
    expect(attempts).toBeGreaterThanOrEqual(3)
  })

  it('treats a health probe that throws as still booting, not as failure', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    let attempts = 0
    const { manager } = managerFor({
      installDir: dir,
      isHealthy: async () => {
        attempts += 1
        if (attempts < 3)
          throw new Error('ECONNREFUSED')
        return true
      },
    })

    expect((await manager.start()).phase).toBe('ready')
  })
})

describe('stop', () => {
  it('terminates the managed child', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    const { child, manager } = managerFor({ installDir: dir, spawnFlow: true })

    await manager.start()
    expect(manager.state().phase).toBe('ready')

    const stopping = manager.stop()
    child.exit(0)
    await stopping

    expect(child.killImpl).toHaveBeenCalledWith('SIGTERM')
    expect(manager.state().phase).toBe('stopped')
  })

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    const { child, manager } = managerFor({
      installDir: dir,
      obedient: false,
      spawnFlow: true,
    })

    await manager.start()
    await manager.stop()

    // The process ignored SIGTERM, so stop() must not trust it to go away.
    expect(child.killImpl).toHaveBeenCalledWith('SIGTERM')
    expect(child.killImpl).toHaveBeenCalledWith('SIGKILL')
  })

  it('is safe to call when nothing was ever started', async () => {
    const { manager } = managerFor({ installDir: '' })
    await expect(manager.stop()).resolves.toBeUndefined()
    expect(manager.state().phase).toBe('stopped')
  })

  it('does not leave an orphan when the child exits on its own', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    const { child, manager } = managerFor({ installDir: dir, spawnFlow: true })

    await manager.start()
    child.exit(0)
    await manager.stop()

    expect(manager.state().phase).toBe('stopped')
  })
})

/**
 * Phase 6 hotfix, items A/B/J/K/L — the single runtime authority.
 *
 * The QA evidence was two AllTalk instances arguing over ports 7851/7852
 * (`Errno 10048`). These tests pin the contract that makes that shape
 * impossible: spawn only when the port is provably silent, adopt what is
 * provably AllTalk, refuse - with a sentence, not a kill - whatever is
 * provably a stranger, and on Windows kill the Lia-owned tree, never the
 * wrapper alone.
 */
describe('adoption (single instance, brief A/B)', () => {
  it('an instance that already answers is reused, never duplicated (L-4)', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    const { manager, spawned } = managerFor({
      installDir: dir,
      // An AllTalk-shaped health answer IS the external instance: reuse by
      // the health fact, no spawn. The socket stays unchecked - there is no
      // conflict to resolve.
      isHealthy: async () => true,
    })

    const state = await manager.start()

    expect(spawned).not.toHaveBeenCalled()
    expect(state).toEqual({ owned: false, phase: 'ready' })
  })

  it('an adopted instance is not killed on stop (never kill without ownership, M)', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    const { child, manager } = managerFor({
      installDir: dir,
      isHealthy: async () => true,
    })

    await manager.start()
    await manager.stop()

    expect(child.killImpl).not.toHaveBeenCalled()
    expect(manager.state().phase).toBe('stopped')
  })

  it('a stranger on the port: friendly error, nothing spawned, nothing killed (L-5)', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    const taskkill = vi.fn(async (_command: string, _args: string[], _options: { timeoutMs: number }) => ({ code: 0 }))
    const { child, manager, spawned } = managerFor({
      execImpl: taskkill,
      installDir: dir,
      // Health silent + SOMETHING listening on the port: the stranger case.
      isHealthy: async () => false,
      probeOccupied: async () => 'occupied',
    })

    const state = await manager.start()

    expect(state.phase).toBe('error')
    expect(state.message).toBe('The voice system is already being used by another process.')
    expect(spawned).not.toHaveBeenCalled()
    expect(child.killImpl).not.toHaveBeenCalled()
    expect(taskkill).not.toHaveBeenCalled()
  })

  it('a failed spawn against a race that another instance won ends in adoption, not two servers', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    // Cold port at the check, so we spawn; our child never serves, and the
    // socket re-read after failure finds the port TAKEN - by a health-true
    // AllTalk (the rival that won between our spawn and our health budget).
    // Adoption, not a second server.
    let rivalServing = false
    let occupancyCalls = 0
    const { manager, spawned } = managerFor({
      installDir: dir,
      isHealthy: async () => rivalServing,
      probeOccupied: async () => {
        occupancyCalls += 1
        if (occupancyCalls >= 2) {
          rivalServing = true
          return 'occupied'
        }
        return 'free'
      },
    })

    const state = await manager.start()

    expect(spawned).toHaveBeenCalledTimes(1)
    expect(state).toEqual({ owned: false, phase: 'ready' })
  })
})

describe('the Windows process tree (brief K)', () => {
  it('a stubborn child is removed as a tree: taskkill on the owned root pid only', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    const taskkill = vi.fn(async (_command: string, _args: string[], _options: { timeoutMs: number }) => ({ code: 0 }))
    const { manager } = managerFor({
      execImpl: taskkill,
      installDir: dir,
      obedient: false,
      spawnFlow: true,
    })

    await manager.start()
    await manager.stop()

    expect(taskkill).toHaveBeenCalledTimes(1)
    expect(taskkill.mock.calls[0][0]).toBe('taskkill')
    expect(taskkill.mock.calls[0][1]).toEqual(taskkillArgs(4242))
  })

  it('taskkill arguments are the fixed array the brief demands', () => {
    expect(taskkillArgs(1234)).toEqual(['/PID', '1234', '/T', '/F'])
  })
})

describe('the bundled espeak PATH (brief I, L-15)', () => {
  it('prepends the bundled directory on Windows when it exists - and only then', async () => {
    const bundled = join('C:\\alltalk', 'system', 'espeak-ng')
    const env = await spawnEnvFor('win32', 'C:\\alltalk', async path => path === bundled)
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
    expect(env[pathKey]?.startsWith(`${bundled};`)).toBe(true)
  })

  it('leaves the environment alone when the bundled copy is absent', async () => {
    const env = await spawnEnvFor('win32', 'C:\\alltalk', async () => false)
    expect(Object.values(env).join('\n')).not.toContain('espeak-ng')
  })

  it('does nothing off Windows', async () => {
    const env = await spawnEnvFor('linux', '/opt/alltalk', async () => true)
    expect(Object.values(env).join('\n')).not.toContain('espeak-ng')
  })
})

describe('the start timeline instrumentation (Windows QA hotfix)', () => {
  /** Collects (event, detail) pairs so order can be asserted. */
  function recorder() {
    const lines: Array<string> = []
    return {
      lines,
      onEvent: (event: string, detail?: string) => lines.push(detail ? `${event} ${detail}` : event),
    }
  }

  it('tags every start request and every spawn with its call-site source', async () => {
    const rec = recorder()
    const { manager } = managerFor({
      installDir: await installedDir(),
      onEvent: rec.onEvent,
      // This is a "spawn my own child" test, so nothing is on the port yet.
      spawnFlow: true,
    })

    await manager.start({ source: 'autostart' })

    expect(manager.state().phase).toBe('ready')
    expect(rec.lines).toContain('runtime.start-request source=autostart')
    expect(rec.lines).toContain('runtime.spawn-requested source=autostart')
    // The QA brief's example format: `spawn pid=1234 source=autostart`.
    expect(rec.lines).toContain('runtime.spawned pid=4242 source=autostart')
  })

  it('coalesces concurrent starts into one spawn, logging the second caller too', async () => {
    const rec = recorder()
    const { manager, spawned } = managerFor({
      installDir: await installedDir(),
      onEvent: rec.onEvent,
      spawnFlow: true,
    })

    const [first, second] = await Promise.all([
      manager.start({ source: 'autostart' }),
      manager.start({ source: 'bootstrap-verify-health' }),
    ])

    // One spawn, one flight, and the late caller is visible in the timeline.
    expect(spawned).toHaveBeenCalledTimes(1)
    expect(first).toEqual(second)
    expect(rec.lines).toContain('runtime.start-request source=autostart')
    expect(rec.lines).toContain('runtime.start-request source=bootstrap-verify-health')
    expect(rec.lines.some(line => line.startsWith('runtime.start-coalesced source=bootstrap-verify-health existingPid='))).toBe(true)
  })

  it('runs port-owner diagnostics BEFORE the occupied-port decision and never kills first', async () => {
    const rec = recorder()
    const diagnosis: string[] = []
    const { manager, spawned } = managerFor({
      installDir: await installedDir(),
      isHealthy: async () => false,
      onEvent: rec.onEvent,
      portOwnerDiagnostics: async ({ reason }) => {
        diagnosis.push(reason)
      },
      probeOccupied: async () => 'occupied',
    })

    const state = await manager.start({ source: 'ui-start' })

    expect(state.phase).toBe('error')
    expect(spawned).not.toHaveBeenCalled()
    expect(diagnosis).toEqual(['occupied'])
    // Evidence precedes the decision, exactly ("não matar antes da identificação" made orderable).
    const diagAt = rec.lines.indexOf('runtime.port-diagnosis-started reason=occupied')
    const decidedAt = rec.lines.indexOf('runtime.port-occupied-unknown-process')
    expect(diagAt).toBeGreaterThanOrEqual(0)
    expect(decidedAt).toBeGreaterThan(diagAt)
  })

  it('diagnoses before adopting an AllTalk-shaped port, then adopts', async () => {
    const diagnosis: string[] = []
    const { manager, spawned } = managerFor({
      installDir: await installedDir(),
      isHealthy: async () => true,
      portOwnerDiagnostics: async ({ reason }) => {
        diagnosis.push(reason)
      },
    })

    const state = await manager.start()

    expect(state).toEqual({ owned: false, phase: 'ready' })
    expect(spawned).not.toHaveBeenCalled()
    expect(diagnosis).toEqual(['alltalk-compatible'])
  })

  it('a diagnostics failure or timeout never changes the start outcome', async () => {
    const throwing = managerFor({
      installDir: await installedDir(),
      isHealthy: async () => true,
      portOwnerDiagnostics: async () => {
        throw new Error('powershell exploded')
      },
    })
    expect((await throwing.manager.start()).phase).toBe('ready')

    const rec = recorder()
    const forever = managerFor({
      installDir: await installedDir(),
      isHealthy: async () => true,
      onEvent: rec.onEvent,
      portOwnerDiagnostics: async () => await new Promise(() => {}),
      portOwnerDiagnosticsTimeoutMs: 20,
    })
    expect((await forever.manager.start()).phase).toBe('ready')
    expect(rec.lines).toContain('runtime.port-diagnosis-timeout')
  })
})

describe('the shutdown lifecycle contract (Windows QA hotfix)', () => {
  function recorder() {
    const lines: Array<string> = []
    return {
      lines,
      onEvent: (event: string, detail?: string) => lines.push(detail ? `${event} ${detail}` : event),
    }
  }

  it('refuses every start after enterShutdown, without even probing the port', async () => {
    const rec = recorder()
    const probe = vi.fn(async () => 'free' as const)
    const { manager, spawned } = managerFor({
      installDir: await installedDir(),
      isHealthy: async () => false,
      onEvent: rec.onEvent,
      probeOccupied: probe,
    })

    manager.enterShutdown()
    const state = await manager.start({ source: 'autostart' })

    expect(state).toEqual({ message: 'The application is closing.', phase: 'error' })
    expect(probe).not.toHaveBeenCalled()
    expect(spawned).not.toHaveBeenCalled()
    expect(rec.lines).toContain('runtime.shutdown-requested')
    expect(rec.lines).toContain('runtime.start-request source=autostart')
    expect(rec.lines).toContain('runtime.start-rejected reason=shutting-down source=autostart')
  })

  it('confirms the ports answer nobody after the owned kill (clause 6)', async () => {
    const rec = recorder()
    let occupancy: 'free' | 'occupied' = 'free'
    const { manager, spawned } = managerFor({
      installDir: await installedDir(),
      onEvent: rec.onEvent,
      probeOccupied: async () => occupancy,
      spawnFlow: true,
    })

    await manager.start({ source: 'ui-start' })
    expect(manager.state()).toEqual({ owned: true, phase: 'ready', pid: 4242 })
    expect(spawned).toHaveBeenCalledTimes(1)

    // While SIGTERM tears the tree down the port is still held; the probe
    // only reads 'free' after that, which is exactly the transition clause 6
    // must observe.
    occupancy = 'occupied'
    queueMicrotask(() => {
      occupancy = 'free'
    })
    await manager.stop({ confirmFreeMs: 2000 })

    expect(rec.lines).toContain('runtime.shutdown-ports-free')
    expect(rec.lines).not.toContain('runtime.shutdown-ports-still-occupied')
  })

  it('reports a still-occupied port with diagnostics when the timeout runs out', async () => {
    const rec = recorder()
    const diagnosis: string[] = []
    let occupancy: 'free' | 'occupied' = 'free'
    const { manager } = managerFor({
      installDir: await installedDir(),
      onEvent: rec.onEvent,
      portOwnerDiagnostics: async ({ reason }) => {
        diagnosis.push(reason)
      },
      probeOccupied: async () => occupancy,
      spawnFlow: true,
    })

    await manager.start({ source: 'ui-start' })
    expect(manager.state().phase).toBe('ready')
    expect(manager.state().owned).toBe(true)
    diagnosis.length = 0
    // From here on the port never lets go: the stop is treated as contested.
    occupancy = 'occupied'

    await manager.stop({ confirmFreeMs: 50 })

    expect(rec.lines).toContain('runtime.shutdown-ports-still-occupied occupancy=occupied')
    expect(rec.lines).not.toContain('runtime.shutdown-ports-free')
    expect(diagnosis).toContain('occupied')
  })

  it('never waits on ports after leaving an adopted foreign instance running', async () => {
    const rec = recorder()
    const { manager } = managerFor({
      installDir: await installedDir(),
      isHealthy: async () => true,
      onEvent: rec.onEvent,
    })

    await manager.start()
    expect(manager.state()).toEqual({ owned: false, phase: 'ready' })

    const before = Date.now()
    await manager.stop({ confirmFreeMs: 5000 })

    // No confirmation polling and no ports-free claim for a port that was
    // never ours: the flag file is short and honest, and the quit is fast.
    expect(Date.now() - before).toBeLessThan(1000)
    expect(rec.lines).toContain('runtime.left-external-instance-running')
    expect(rec.lines).not.toContain('runtime.shutdown-ports-free')
    expect(rec.lines).not.toContain('runtime.shutdown-ports-still-occupied')
  })

  it('exposes the owned child pid only while the child is alive', async () => {
    const { manager } = managerFor({
      installDir: await installedDir(),
      spawnFlow: true,
    })

    expect(manager.ownedChildPid()).toBeUndefined()
    await manager.start()
    expect(manager.ownedChildPid()).toBe(4242)
    await manager.stop()
    expect(manager.ownedChildPid()).toBeUndefined()
  })
})

describe('the clean-BOOT classification (QA evidence, brief A-C/D/H)', () => {
  function recorder() {
    const lines: Array<string> = []
    return {
      lines,
      onEvent: (event: string, detail?: string) => lines.push(detail ? `${event} ${detail}` : event),
    }
  }

  /**
   * THE QA log, as a fixture: health unreachable, listeners = none.
   *
   * The historical code answered this with `port-occupied-unknown-process`,
   * because it inferred occupancy FROM the health failure. This test is the
   * mutation guard of brief item D: any regression that maps "health down"
   * onto "unknown occupied" fails here, because the verdict must be free and
   * the flow must reach a spawn - exactly once.
   */
  it('health down + listeners=none classifies free and spawns exactly once (the real log)', async () => {
    const rec = recorder()
    const { manager, spawned } = managerFor({
      installDir: await installedDir(),
      onEvent: rec.onEvent,
      // Socket truth: nothing listens. Health truth: nothing answers. The
      // classification MUST read free, and the move MUST be a spawn.
      probeOccupied: async () => 'free',
      spawnFlow: true,
    })

    const state = await manager.start({ source: 'autostart' })

    expect(state.owned).toBe(true)
    expect(state.phase).toBe('ready')
    expect(spawned).toHaveBeenCalledTimes(1)
    expect(rec.lines).toContain('runtime.classified health=down')
    expect(rec.lines).toContain('runtime.classified health=down occupancy=free')
    expect(rec.lines).toContain('runtime.spawn-requested source=autostart')
    expect(rec.lines).toContain('runtime.health-ready')
    expect(rec.lines).not.toContain('runtime.port-occupied-unknown-process')
    expect(rec.lines).not.toContain('runtime.port-occupancy-unverifiable')
  })

  it('listeners=none can never become unknown-occupied, even when health errors', async () => {
    const rec = recorder()
    const { manager, spawned } = managerFor({
      installDir: await installedDir(),
      isHealthy: async () => {
        throw new Error('fetch failed: ECONNREFUSED')
      },
      onEvent: rec.onEvent,
      probeOccupied: async () => 'free',
    })
    // With health erroring forever this spawn will time out - and the failure
    // STILL must not be phrased as a stranger on the port, because the socket
    // keeps answering free.
    const state = await manager.start({ source: 'autostart' })

    expect(state.phase).toBe('error')
    expect(state.message).toBe('The voice system took too long to start.')
    expect(rec.lines).not.toContain('runtime.port-occupied-unknown-process')
    expect(spawned).toHaveBeenCalledTimes(1)
  })

  it('health down + a real listener: identify first, fail fast, never spawn (brief C-4)', async () => {
    const rec = recorder()
    const diagnosis: string[] = []
    const { manager, spawned } = managerFor({
      installDir: await installedDir(),
      isHealthy: async () => false,
      onEvent: rec.onEvent,
      portOwnerDiagnostics: async ({ reason }) => {
        diagnosis.push(reason)
      },
      probeOccupied: async () => 'occupied',
    })

    const state = await manager.start({ source: 'autostart' })

    expect(state.phase).toBe('error')
    expect(state.message).toBe('The voice system is already being used by another process.')
    expect(spawned).not.toHaveBeenCalled()
    expect(diagnosis).toEqual(['occupied'])
    expect(rec.lines).toContain('runtime.classified health=down occupancy=occupied')
    expect(rec.lines).toContain('runtime.port-occupied-unknown-process')
  })

  it('a socket that refuses to answer is unverifiable, not free and not occupied', async () => {
    const rec = recorder()
    const { manager, spawned } = managerFor({
      installDir: await installedDir(),
      isHealthy: async () => false,
      onEvent: rec.onEvent,
      probeOccupied: async () => 'unverifiable',
    })

    const state = await manager.start({ source: 'autostart' })

    // The conservative verdict: no blind spawn, no foreign kill, distinct log.
    expect(state.phase).toBe('error')
    expect(spawned).not.toHaveBeenCalled()
    expect(rec.lines).toContain('runtime.classified health=down occupancy=unverifiable')
    expect(rec.lines).toContain('runtime.port-occupancy-unverifiable')
  })

  it('clean boot via autostart: ask, classify free, spawn once, health-ready - no clicks', async () => {
    const rec = recorder()
    const { manager, spawned } = managerFor({
      installDir: await installedDir(),
      onEvent: rec.onEvent,
      spawnFlow: true,
    })

    await manager.start({ source: 'autostart' })

    expect(spawned).toHaveBeenCalledTimes(1)
    expect(rec.lines.indexOf('runtime.autostart-requested')).toBe(-1) // gate log lives in the service layer
    expect(rec.lines.indexOf('runtime.start-request source=autostart')).toBeLessThan(
      rec.lines.indexOf('runtime.classified health=down occupancy=free'),
    )
    expect(rec.lines.indexOf('runtime.classified health=down occupancy=free')).toBeLessThan(
      rec.lines.indexOf('runtime.spawn-requested source=autostart'),
    )
    expect(rec.lines).toContain('runtime.health-ready')
  })
})
