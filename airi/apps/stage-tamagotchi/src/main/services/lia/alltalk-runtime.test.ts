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
    verifyGraceMs: 1,
    verifyRounds: 2,
    ...deps,
  })
  return { child, manager, spawned }
}

/** IDs of the QA round-6 tree: the launcher cmd.exe and the python below it. */
const QA_LISTENER_PID = 9002
const QA_LAUNCHER_PID = 9001
const QA_LAUNCHER_EXE = 'C:\\Windows\\System32\\cmd.exe'
const QA_LAUNCHER_CMDLINE = 'cmd.exe /d /s /c start_alltalk.bat'
const QA_CREATED = '20260915130000.000000+000'

/**
 * The round-6 QA tree, as the port diagnostics would return it: a python
 * listener under the install root whose parent is the supervised launcher,
 * whose own parent is the desktop shell. Rebuilding the root from this is
 * exactly what the ancestry walk does in production.
 */
function liaTreeRecords(dir: string): Array<{ created: string, cmdline: string, exe: string, parentPid: number, pid: number }> {
  return [{
    cmdline: 'python script.py',
    created: QA_CREATED,
    exe: `${dir}/venv/python.exe`,
    parentPid: QA_LAUNCHER_PID,
    pid: QA_LISTENER_PID,
  }]
}

/**
 * The ancestry lookup the walk asks about, for the QA tree - in the round-7
 * tri-state shape: a readable answer is a record; absence is 'gone'; noise
 * is 'unreadable' (which a lie may never hide behind).
 */
function boxedRecords<T extends { pid: number }>(records: Map<number, T>) {
  return async (pid: number) => {
    const record = records.get(pid)
    return record === undefined
      ? { kind: 'gone' as const }
      : { kind: 'record' as const, record }
  }
}

function liaTreeInspect(_dir: string) {
  const records = new Map<number, { created: string, cmdline?: string, exe: string, parentPid?: number, pid: number }>([
    [QA_LAUNCHER_PID, { cmdline: QA_LAUNCHER_CMDLINE, created: QA_CREATED, exe: QA_LAUNCHER_EXE, parentPid: 555, pid: QA_LAUNCHER_PID }],
    [555, { created: '20260915080000.000000+000', exe: 'C:\\Windows\\explorer.exe', pid: 555 }],
  ])
  return boxedRecords(records)
}

/** The attachable state the QA boot produces, for terse assertions. */
function liaAttachment(_dir: string) {
  return {
    kind: 'lia-managed' as const,
    roots: [{ created: QA_CREATED, exe: QA_LAUNCHER_EXE, pid: QA_LAUNCHER_PID }],
  }
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
  it('adopt writes the snapshot BEFORE announcing it (round-5 QA: the adopted line fired while the snapshot still said stopped)', async () => {
    // The round-5 Windows boot: the adopted line logged, the publisher
    // re-read the state that very moment, saw 'stopped', and the dedupe
    // swallowed the only ready announcement there would ever be. The
    // contract that closes it: EVERY transition event observes its own phase
    // already in place - phase before announcement, no exception.
    const dir = await installedDir()
    tempDirs.push(dir)
    const phaseAtEvent = new Map<string, string[]>()
    const note = (event: string, phase: string) =>
      phaseAtEvent.set(event, [...(phaseAtEvent.get(event) ?? []), phase])

    const built = managerFor({
      inspectProcess: liaTreeInspect(dir),
      installDir: dir,
      isHealthy: async () => true,
      onEvent: event => note(event, built.manager.state().phase),
      portOwnerDiagnostics: async () => liaTreeRecords(dir),
    })
    const { manager } = built

    const state = await manager.start()

    expect(state).toEqual({ attachment: liaAttachment(dir), phase: 'ready' })
    // The QA sequence, with the snapshot proven at each announcement.
    expect(phaseAtEvent.get('runtime.classified')).toEqual(['stopped'])
    expect(phaseAtEvent.get('runtime.adopted-lia-managed-instance')).toEqual(['ready'])
  })

  it('health-ready likewise announces AFTER the ready snapshot exists (round-5, item B audit)', async () => {
    // Same ordering bug on the spawn path: `runtime.health-ready` fired
    // before set(ready) - the publisher would have read 'starting' and the
    // dedupe would have eaten the ready the round-4 QA waited 75 s for.
    const dir = await installedDir()
    tempDirs.push(dir)
    const phaseAtEvent = new Map<string, string[]>()
    const note = (event: string, phase: string) =>
      phaseAtEvent.set(event, [...(phaseAtEvent.get(event) ?? []), phase])

    const built = managerFor({
      installDir: dir,
      onEvent: event => note(event, built.manager.state().phase),
      spawnFlow: true,
    })
    const { manager } = built

    const state = await manager.start()

    expect(state.phase).toBe('ready')
    expect(phaseAtEvent.get('runtime.spawn-requested')).toEqual(['starting'])
    expect(phaseAtEvent.get('runtime.health-ready')).toEqual(['ready'])
    expect(phaseAtEvent.get('runtime.stopped')).toBeUndefined()
  })

  it('a PROVEN lia-managed tree is reused, never duplicated (round-6: the L-4 reuse with ownership)', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    const { manager, spawned } = managerFor({
      inspectProcess: liaTreeInspect(dir),
      installDir: dir,
      // A healthy AllTalk-shaped answer gets the health fact first; the OWNERSHIP
      // fact comes from the port evidence. Proven ours -> adopt + lifecycle.
      isHealthy: async () => true,
      portOwnerDiagnostics: async () => liaTreeRecords(dir),
    })

    const state = await manager.start()

    expect(spawned).not.toHaveBeenCalled()
    expect(state).toEqual({ attachment: liaAttachment(dir), phase: 'ready' })
  })

  it('the attached lia-managed tree IS killed on stop: exactly one taskkill on the validated root (item E / case 6)', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    const taskkill = vi.fn(async (_command: string, _args: string[], _options: { timeoutMs: number }) => ({ code: 0 }))
    const rec: string[] = []
    const { child, manager } = managerFor({
      execImpl: taskkill,
      inspectProcess: liaTreeInspect(dir),
      installDir: dir,
      isHealthy: async () => true,
      onEvent: (event, detail) => rec.push(detail ? `${event} ${detail}` : event),
      portOwnerDiagnostics: async () => liaTreeRecords(dir),
      probeOccupied: async () => 'free',
    })

    await manager.start()
    await manager.stop({ confirmFreeMs: 100 })

    expect(child.killImpl).not.toHaveBeenCalled()
    // The supervisor dies once, the whole tree with it (7852's holder AND the
    // 7851 worker under it), the listener pid itself never takes a direct hit.
    const kills = taskkill.mock.calls.map(call => call[1])
    expect(kills).toEqual([['/PID', String(QA_LAUNCHER_PID), '/T', '/F']])
    expect(rec).toContain('runtime.stopping-lia-managed-existing rootPid=9001')
    expect(rec).toContain('runtime.process-tree-terminated rootPid=9001')
    expect(rec).toContain('runtime.shutdown-ports-free')
    expect(manager.state()).toEqual({ phase: 'stopped' })
  })

  it('a recycled root PID is NOT killed: identity is revalidated at stop (case 5 mutation surface)', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    const taskkill = vi.fn(async (_command: string, _args: string[], _options: { timeoutMs: number }) => ({ code: 0 }))
    const rec: string[] = []
    // Between adopt and shutdown the OS recycled the launcher PID onto a
    // NEWER process: creation date moved on, so the old death sentence
    // cannot apply. The flag flips the moment adoption lands, so the adopt
    // itself sees the tree as it was.
    let recycled = false
    const { manager } = managerFor({
      execImpl: taskkill,
      inspectProcess: async (pid: number) => {
        const looked = await liaTreeInspect(dir)(pid)
        if (recycled && looked.kind === 'record' && pid === QA_LAUNCHER_PID)
          return { kind: 'record' as const, record: { ...looked.record, created: '20260915210000.000000+000' } }
        return looked
      },
      installDir: dir,
      isHealthy: async () => true,
      onEvent: (event, detail) => rec.push(detail ? `${event} ${detail}` : event),
      portOwnerDiagnostics: async () => liaTreeRecords(dir),
    })

    await manager.start()
    recycled = true
    await manager.stop()

    expect(taskkill).not.toHaveBeenCalled()
    expect(rec).toContain('runtime.root-revalidate-rejected pid=9001 reason=created-mismatch')
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
    expect(state.message).toBe('The voice system could not identify who is using its port.')
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
    // The 7851 answer that arrived a breath after the race closed is our own
    // child's - adoption is for trees we did NOT spawn (round-6 design note).
    expect(state).toEqual({ phase: 'ready', pid: 4242 })
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

  it('diagnoses before adopting an AllTalk-shaped port, then adopts as lia-managed', async () => {
    const diagnosis: string[] = []
    const dir = await installedDir()
    const { manager, spawned } = managerFor({
      inspectProcess: liaTreeInspect(dir),
      installDir: dir,
      isHealthy: async () => true,
      portOwnerDiagnostics: async ({ reason }) => {
        diagnosis.push(reason)
        return liaTreeRecords(dir)
      },
    })

    const state = await manager.start()

    expect(state).toEqual({ attachment: liaAttachment(dir), phase: 'ready' })
    expect(spawned).not.toHaveBeenCalled()
    expect(diagnosis).toEqual(['alltalk-compatible'])
  })

  it('a diagnostics failure or timeout lands on the SAFE side: unknown conflict, never a blind adopt', async () => {
    // Round-6 rule of thumb: ownership unproven never becomes ownership
    // granted. A diagnostics crash used to be swallowed into a ready adopt;
    // it is now the unknown verdict - a friendly conflict, and nobody dies.
    const rec = recorder()
    const throwing = managerFor({
      installDir: await installedDir(),
      isHealthy: async () => true,
      onEvent: rec.onEvent,
      portOwnerDiagnostics: async () => {
        throw new Error('powershell exploded')
      },
    })
    const thrownState = await throwing.manager.start()
    expect(thrownState.phase).toBe('error')
    expect(rec.lines).toContain('runtime.port-occupied-unknown-process')

    const rec2 = recorder()
    const forever = managerFor({
      installDir: await installedDir(),
      isHealthy: async () => true,
      onEvent: rec2.onEvent,
      portOwnerDiagnostics: async () => await new Promise(() => {}),
      portOwnerDiagnosticsTimeoutMs: 20,
    })
    const timeoutState = await forever.manager.start()
    expect(timeoutState.phase).toBe('error')
    expect(rec2.lines).toContain('runtime.port-diagnosis-timeout')
    expect(rec2.lines).toContain('runtime.port-occupied-unknown-process')
  })
})

describe('the round-6 ownership verdicts (items A-H, cases 3/4/5/7/8/9)', () => {
  function recorder() {
    const lines: Array<string> = []
    return {
      lines,
      onEvent: (event: string, detail?: string) => lines.push(detail ? `${event} ${detail}` : event),
    }
  }

  it('unknown when the ancestry cannot be proven: under-root exe + a FOREIGN named parent is not our tree (case 5)', async () => {
    // The QA brief's scare case: a PID under Lia root is necessary, never
    // sufficient. Here the listener IS under the install root, but the
    // process holding its ancestry is a browser profile - provably not our
    // launcher. The verdict is unknown: conflict, nothing killed.
    const rec = recorder()
    const dir = await installedDir()
    const weirdRecords = [{
      created: QA_CREATED,
      cmdline: 'python script.py',
      exe: `${dir}/venv/python.exe`,
      parentPid: 777,
      pid: QA_LISTENER_PID,
    }]
    const taskkill = vi.fn(async (_command: string, _args: string[], _options: { timeoutMs: number }) => ({ code: 0 }))
    const { manager, spawned } = managerFor({
      execImpl: taskkill,
      // The parent exists, is READABLE - and is a browser. That is the
      // ancestry that breaks the proof (a dead parent would say nothing, an
      // unrelated live one says everything).
      inspectProcess: async () => ({
        kind: 'record' as const,
        record: {
          created: QA_CREATED,
          exe: 'C:\\Program Files\\Google\\Chrome\\chrome.exe',
          pid: 777,
        },
      }),
      installDir: dir,
      isHealthy: async () => true,
      onEvent: rec.onEvent,
      portOwnerDiagnostics: async () => weirdRecords,
    })

    const state = await manager.start()

    expect(state.phase).toBe('error')
    expect(rec.lines).toContain('runtime.port-occupied-unknown-process')
    expect(spawned).not.toHaveBeenCalled()
    expect(taskkill).not.toHaveBeenCalled()
  })

  it('unknown when no ancestry probe exists at all: the listener alone is not proof (case 4)', async () => {
    // A fixture honouring the honesty rule: without inspectProcess the walk
    // cannot tell a launcher parent from a stranger one, and assumption is
    // not allowed to stand in for proof.
    const rec = recorder()
    const dir = await installedDir()
    const taskkill = vi.fn(async (_command: string, _args: string[], _options: { timeoutMs: number }) => ({ code: 0 }))
    const { manager } = managerFor({
      execImpl: taskkill,
      installDir: dir,
      isHealthy: async () => true,
      onEvent: rec.onEvent,
      portOwnerDiagnostics: async () => [{
        created: QA_CREATED,
        exe: `${dir}/venv/python.exe`,
        parentPid: QA_LAUNCHER_PID,
        pid: QA_LISTENER_PID,
      }],
    })

    const state = await manager.start()

    expect(state.phase).toBe('error')
    expect(rec.lines).toContain('runtime.port-occupied-unknown-process')
    expect(taskkill).not.toHaveBeenCalled()
  })

  it('crash recovery: the dead launcher above the survivor does NOT disqualify the tree (cases 7-8)', async () => {
    // The exact round-6 QA corpse: Lia died (SIGKILL, laptop lid), the
    // cmd.exe launcher exited with it, the python pal was orphaned. The
    // ancestry lookup on the dead launcher comes back empty - and that is
    // STILL our tree: every readable link is under our root. Adopt, then
    // kill at shutdown.
    const rec = recorder()
    const dir = await installedDir()
    const taskkill = vi.fn(async (_command: string, _args: string[], _options: { timeoutMs: number }) => ({ code: 0 }))
    const orphanRoots = [{
      created: QA_CREATED,
      cmdline: 'python script.py',
      exe: `${dir}/venv/python.exe`,
      parentPid: QA_LAUNCHER_PID, // died with the old session; unreadable now
      pid: QA_LISTENER_PID,
    }]
    const { manager } = managerFor({
      execImpl: taskkill,
      // Nothing UP the chain exists anymore - but the listener itself is
      // alive and answers identity checks (that's who stop() revalidates).
      inspectProcess: async (pid: number) => pid === QA_LISTENER_PID
        ? { kind: 'record' as const, record: orphanRoots[0] }
        : { kind: 'gone' as const },
      installDir: dir,
      isHealthy: async () => true,
      onEvent: rec.onEvent,
      portOwnerDiagnostics: async () => orphanRoots,
      probeOccupied: async () => 'free',
    })

    const state = await manager.start()

    expect(state).toEqual({
      attachment: {
        kind: 'lia-managed',
        roots: [{ created: QA_CREATED, exe: `${dir}/venv/python.exe`, pid: QA_LISTENER_PID }],
      },
      phase: 'ready',
    })

    await manager.stop({ confirmFreeMs: 50 })

    expect(taskkill).toHaveBeenCalledWith('taskkill', ['/PID', String(QA_LISTENER_PID), '/T', '/F'], expect.any(Object))
    expect(rec.lines).toContain('runtime.process-tree-terminated rootPid=9002')
  })

  it('a STALE lia-managed tree (health down, port held): kill it with proof, then spawn fresh (item 8)', async () => {
    const rec = recorder()
    const dir = await installedDir()
    const taskkill = vi.fn(async (_command: string, _args: string[], _options: { timeoutMs: number }) => ({ code: 0 }))
    let portHeld = true
    const { manager, spawned } = managerFor({
      execImpl: taskkill,
      inspectProcess: liaTreeInspect(dir),
      installDir: dir,
      isHealthy: async () => !portHeld, // corpse does not answer; a fresh spawn will
      onEvent: rec.onEvent,
      portOwnerDiagnostics: async () => liaTreeRecords(dir),
      probeOccupied: async () => (portHeld ? 'occupied' : 'free'),
    })
    // The kill frees the port the moment taskkill resolves (fixture physics).
    taskkill.mockImplementation(async () => {
      portHeld = false
      return { code: 0 }
    })

    const state = await manager.start()

    expect(rec.lines).toContain('runtime.stopping-stale-lia-managed rootPid=9001')
    expect(rec.lines).toContain('runtime.process-tree-terminated rootPid=9001')
    expect(rec.lines).toContain('runtime.spawn-requested source=unknown')
    expect(state).toEqual({ phase: 'ready', pid: 4242 })
    expect(spawned).toHaveBeenCalledTimes(1)
  })

  it('engine-change style restart: stop kills ONLY the lia-managed tree, never a foreign listener (case 9)', async () => {
    const rec = recorder()
    const dir = await installedDir()
    const taskkill = vi.fn(async (_command: string, _args: string[], _options: { timeoutMs: number }) => ({ code: 0 }))
    const { manager } = managerFor({
      execImpl: taskkill,
      inspectProcess: liaTreeInspect(dir),
      installDir: dir,
      isHealthy: async () => true,
      onEvent: rec.onEvent,
      portOwnerDiagnostics: async () => liaTreeRecords(dir),
      probeOccupied: async () => 'free',
    })

    await manager.start()
    await manager.stop()

    expect(taskkill).toHaveBeenCalledTimes(1)
    expect(taskkill.mock.calls[0][1]).toEqual(['/PID', String(QA_LAUNCHER_PID), '/T', '/F'])
    expect(rec.lines).toContain('runtime.stopping-lia-managed-existing rootPid=9001')
  })

  it('single-flight shutdown across attached + spawned shapes: one stop, one sweep (case 8)', async () => {
    const rec = recorder()
    const dir = await installedDir()
    const taskkill = vi.fn(async (_command: string, _args: string[], _options: { timeoutMs: number }) => ({ code: 0 }))
    const { manager } = managerFor({
      execImpl: taskkill,
      inspectProcess: liaTreeInspect(dir),
      installDir: dir,
      isHealthy: async () => true,
      onEvent: rec.onEvent,
      portOwnerDiagnostics: async () => liaTreeRecords(dir),
      probeOccupied: async () => 'free',
    })

    await manager.start()
    await Promise.all([
      manager.stop({ confirmFreeMs: 50 }),
      manager.stop({ confirmFreeMs: 50 }),
    ])

    expect(taskkill).toHaveBeenCalledTimes(1)
  })
})

describe('the round-7 QA failures, reproduced as fixtures (items K, D, B, and the ownership safety correction)', () => {
  function recorder() {
    const lines: Array<string> = []
    return {
      lines,
      onEvent: (event: string, detail?: string) => lines.push(detail ? `${event} ${detail}` : event),
    }
  }

  it('eV1 verbatim: taskkill exit=0 kills the root wrapper but NOT the tree - the stop hunts survivors by PROOF (mutation: kill assumed by exit code)', async () => {
    // The exact QA tree: spawned cmd 22472 -> python 13900 (7852) ->
    // python 14148 (7851). taskkill "succeeds" on 22472; the pythons keep
    // listening. pre-7 code logged kill-tree + stopped and quit with the
    // port occupied. The new contract: one kill is never the fact - the
    // port answers for the tree, and only then does the state flip.
    const rec = recorder()
    const dir = await installedDir()
    const killed: string[][] = []
    // Fixture physics of the QA machine: the spawn tree ALIVE holds the
    // ports; killing the cmd wrapper leaves the pythons alive (exit 0 and
    // all), and only the taskkill that reaches THEIR root 13900 silences
    // 7852/7851. The fake child's own SIGTERM stubbornly leaves exitCode
    // null (obedient:false), so the wrapper escalation always runs.
    let treeAlive = false
    const { manager } = managerFor({
      execImpl: async (_command: string, args: string[], _options: { timeoutMs: number }) => {
        killed.push(args)
        if (args.includes(String(13900)))
          treeAlive = false // killing the python root kills its worker too
        // Killing 4242 (the wrapper) changes NOTHING about the tree:
        // the EV1 fact in one line.
        return { code: 0 }
      },
      inspectProcess: async (pid: number) => {
        if (!treeAlive)
          return { kind: 'gone' as const }
        if (pid === 13900)
          return { kind: 'record' as const, record: { created: QA_CREATED, exe: `${dir}/venv/python.exe`, parentPid: 4242, pid: 13900 } }
        if (pid === 4242)
          // The wrapper died on the way down; ancestry above the python
          // survivor is absent, never disqualifying.
          return { kind: 'gone' as const }
        return { kind: 'record' as const, record: { created: QA_CREATED, exe: `${dir}/venv/python.exe`, parentPid: 13900, pid } }
      },
      installDir: dir,
      obedient: false,
      // The tree exists once the spawn EXISTS - 'runtime.spawned' is the
      // fixture's ignition: before it, ports are free (a clean first boot),
      // after it, the python pair owns them until 13900 itself takes a
      // taskkill.
      onEvent: (event, detail) => {
        if (event === 'runtime.spawned')
          treeAlive = true
        rec.onEvent(event, detail)
      },
      portOwnerDiagnostics: async () => !treeAlive
        ? []
        : [
            { created: QA_CREATED, exe: `${dir}/venv/python.exe`, parentPid: 4242, pid: 13900 },
            { created: QA_CREATED, exe: `${dir}/venv/python.exe`, parentPid: 13900, pid: 14148 },
          ],
      probeOccupied: async () => (treeAlive ? 'occupied' : 'free'),
      spawnFlow: true,
    })

    await manager.start()

    await manager.stop({ confirmFreeMs: 50 })

    // Two kill sessions, ordered: the wrapper sweep, then the proven
    // survivor root - and 'stopped' only after the port went quiet.
    const orders = killed.map(args => Number.parseInt(args[1], 10))
    expect(orders).toEqual([4242, 13900])
    expect(rec.lines.some(line => line.startsWith('runtime.kill-tree-start pid='))).toBe(true)
    expect(rec.lines).toContain('runtime.process-tree-terminated rootPid=13900')
    expect(rec.lines).toContain('runtime.shutdown-ports-free')
    const killedIdx = rec.lines.indexOf('runtime.process-tree-terminated rootPid=13900')
    const stoppedIdx = rec.lines.indexOf('runtime.stopped')
    expect(killedIdx).toBeGreaterThanOrEqual(0)
    expect(stoppedIdx).toBeGreaterThan(killedIdx)
    expect(manager.state()).toEqual({ phase: 'stopped' })

    // THE mutation guard the brief demands: comment away the verify sweep
    // and this test dies, because the wrapper kill alone NEVER reaches 13900.
    expect(killed.filter(args => args.includes('13900'))).toHaveLength(1)
  })

  it('revalidation rejected + port still occupied: ERROR, never stopped, with the named reason', async () => {
    // The round-7 silent-skip scenario, reconstructed for keeps: the root's
    // ticks moved (PID recycled) AND the port never quiets. Old code: event
    // already sounded 'stopped'. Contract: rejected kill + occupied port =
    // error, stop-incomplete, and the reason is in the log.
    const rec = recorder()
    const dir = await installedDir()
    const taskkill = vi.fn(async (_command: string, _args: string[], _options: { timeoutMs: number }) => ({ code: 0 }))
    const { manager } = managerFor({
      execImpl: taskkill,
      inspectProcess: async (pid: number) => {
        if (pid === QA_LAUNCHER_PID) {
          return {
            kind: 'record' as const,
            record: {
              cmdline: QA_LAUNCHER_CMDLINE,
              created: '20260915210000.000000+000', // NOT the recorded creation
              exe: QA_LAUNCHER_EXE,
              pid: QA_LAUNCHER_PID,
            },
          }
        }
        const looked = await liaTreeInspect(dir)(pid)
        return looked
      },
      installDir: dir,
      isHealthy: async () => true,
      onEvent: rec.onEvent,
      portOwnerDiagnostics: async () => liaTreeRecords(dir),
      probeOccupied: async () => 'occupied', // the lie: whatever holds it, it is not free
    })
    // Adoption happens ONLY with the pre-recycle identity: gather-time
    // inspect answers the original created; the kill-time re-check answers
    // the recycled one - the fixture's two phases in one closure.
    const originalCreated = QA_CREATED
    const states: string[] = []
    const inspectProxy = async (pid: number) => {
      const looked = await liaTreeInspect(dir)(pid)
      if (states.includes('adopted') && looked.kind === 'record')
        return { kind: 'record' as const, record: { ...looked.record, created: '20260915210000.000000+000' } }
      return looked
    }
    const { manager: proxied } = managerFor({
      execImpl: taskkill,
      inspectProcess: inspectProxy,
      installDir: dir,
      isHealthy: async () => true,
      onEvent: rec.onEvent,
      portOwnerDiagnostics: async () => liaTreeRecords(dir),
      probeOccupied: async () => 'occupied',
    })

    const adopted = await proxied.start()
    expect(adopted.phase).toBe('ready')
    states.push('adopted')
    expect(originalCreated).toBe(QA_CREATED)
    void manager

    await proxied.stop({ confirmFreeMs: 20 })

    // Round 1 vetoes the kill on the identity we recorded (`created`
    // moved). The fallback sweep may kill a re-proven identical-instant
    // root - proof always travels with the kill, and OUR tree is still ours
    // - but the port QUIT never happens in this fixture, so the state can
    // only end 'error', with the reason in the log. Never 'stopped'.
    expect(rec.lines).toContain('runtime.root-revalidate-rejected pid=9001 reason=created-mismatch')
    expect(taskkill.mock.calls.length).toBeLessThanOrEqual(1)
    expect(rec.lines.some(line => line.startsWith('runtime.stop-incomplete'))).toBe(true)
    expect(proxied.state().phase).toBe('error')
    expect(proxied.state()).not.toEqual(expect.objectContaining({ phase: 'stopped' }))
  })

  it('recovered attachment, revalidation unreadable, fresh census unknown: ZERO taskkill, error, reason=revalidation-unreadable (ownership correction 1/3)', async () => {
    // The safety correction, fixture 1 of 3: 'unreadable' in a kill
    // revalidation NEVER decomposes into "still ours". PowerShell went
    // blind on every identity question, nothing about PID 9001 can be
    // proven today, and the fresh census cannot re-prove the listeners
    // either (every climb drowns too). The port is held by SOMEONE - whom,
    // we may never learn. Verdict: no kill, phase 'error', the named
    // reason in the log. MUTATION GUARD: a code path that reads unreadable
    // as "kill anyway" fires taskkill in this fixture and this test fails.
    const rec = recorder()
    const dir = await installedDir()
    const taskkill = vi.fn(async (_command: string, _args: string[], _options: { timeoutMs: number }) => ({ code: 0 }))
    let stoppingPhase = false
    const { manager } = managerFor({
      execImpl: taskkill,
      inspectProcess: async (pid: number) => {
        if (!stoppingPhase)
          return await liaTreeInspect(dir)(pid) // the adoption reads clearly
        return { kind: 'unreadable' as const } // the stop reads NOTHING
      },
      installDir: dir,
      isHealthy: async () => true,
      onEvent: rec.onEvent,
      portOwnerDiagnostics: async () => liaTreeRecords(dir),
      probeOccupied: async () => 'occupied', // held - but occupancy alone never authorizes a kill
    })

    const adopted = await manager.start()
    expect(adopted.phase).toBe('ready')
    stoppingPhase = true

    await manager.stop({ confirmFreeMs: 20 })

    expect(rec.lines).toContain('runtime.root-revalidate-inconclusive pid=9001')
    expect(taskkill).not.toHaveBeenCalled() // the mutation guard itself
    expect(rec.lines).toContain('runtime.stop-incomplete reason=revalidation-unreadable')
    expect(rec.lines.some(line => line.startsWith('runtime.shutdown-survivor-not-lia-managed'))).toBe(true)
    expect(rec.lines).not.toContain('runtime.process-tree-terminated')
    expect(rec.lines).not.toContain('runtime.stopped')
    expect(manager.state().phase).toBe('error')
  })

  it('recovered attachment, revalidation unreadable, FRESH census re-proves lia-managed: only the newly proven root dies, then ports free and stopped (ownership correction 2/3)', async () => {
    // The correction's recovery path, fixture 2 of 3: the revalidation of
    // the recovered root 9001 drowns ONCE - veto. Recovery runs the
    // evidence again (probe -> census -> ancestry) instead of trusting the
    // stale identity: the fresh census re-proves the tree under a recycled
    // python, 9031 with THIS session's ticks, inside the install venv,
    // while 9001 is not even in today's census. Only 9031 may die - the
    // kill rides the NEW proof, and the unverifiable 9001 stays untouched.
    const rec = recorder()
    const dir = await installedDir()
    const NEW_CREATED = '20260916101010.000000+000'
    const taskkill = vi.fn(async (_command: string, _args: string[], _options: { timeoutMs: number }) => ({ code: 0 }))
    let stoppingPhase = false
    let killTimeChecks = 0
    let portsHeld = true
    // The post-stop world: the listener python is the proven root (its
    // launcher 9017 is dead; ancestry above it absent, as in EV1), and
    // the once-trusted 9001 answers nothing at all.
    const censusInspect = async (pid: number) => {
      if (pid === 9031) {
        return {
          kind: 'record' as const,
          record: { cmdline: 'python script.py', created: NEW_CREATED, exe: `${dir}/venv/python.exe`, parentPid: 9017, pid: 9031 },
        }
      }
      return { kind: 'gone' as const }
    }
    const { manager } = managerFor({
      execImpl: async (command: string, args: string[], options: { timeoutMs: number }) => {
        if (args.includes(String(9031)))
          portsHeld = false // killing the proven python root quiets the ports
        return await taskkill(command, args, options)
      },
      inspectProcess: async (pid: number) => {
        if (!stoppingPhase)
          return await liaTreeInspect(dir)(pid)
        killTimeChecks += 1
        // The stop's FIRST identity question - the revalidation of the
        // recovered root - drowns. Everything after it (the fresh census
        // climbs, the revalidation of the newly proven root) reads clearly.
        if (killTimeChecks === 1)
          return { kind: 'unreadable' as const }
        return await censusInspect(pid)
      },
      installDir: dir,
      isHealthy: async () => true,
      onEvent: rec.onEvent,
      portOwnerDiagnostics: async () => {
        if (!stoppingPhase || !portsHeld)
          return liaTreeRecords(dir)
        // Today's census: the recycled python is the new listener root;
        // the tree the adoption once trusted is gone from the evidence.
        return [{ cmdline: 'python script.py', created: NEW_CREATED, exe: `${dir}/venv/python.exe`, parentPid: 9017, pid: 9031 }]
      },
      probeOccupied: async () => (portsHeld ? 'occupied' : 'free'),
    })

    const adopted = await manager.start()
    expect(adopted.phase).toBe('ready')
    stoppingPhase = true

    await manager.stop({ confirmFreeMs: 20 })

    expect(rec.lines).toContain('runtime.root-revalidate-inconclusive pid=9001')
    expect(rec.lines).toContain('runtime.root-revalidate-ok pid=9031')
    // THE assertion of the correction: exactly one kill, on the NEWLY
    // proven root - a direct kill of the unreadable 9001 (the mutation)
    // shows up here as a wrong pid or a second call.
    expect(taskkill).toHaveBeenCalledTimes(1)
    expect(taskkill.mock.calls[0][1]).toEqual(['/PID', '9031', '/T', '/F'])
    expect(rec.lines).toContain('runtime.process-tree-terminated rootPid=9031')
    expect(rec.lines).toContain('runtime.shutdown-ports-free')
    expect(rec.lines.some(line => line.startsWith('runtime.stop-incomplete'))).toBe(false)
    expect(rec.lines).toContain('runtime.stopped')
    expect(manager.state()).toEqual({ phase: 'stopped' })
  })

  it('current-session child with inspection unavailable: its own tree still dies (ownership correction 3/3, item A exemption)', async () => {
    // The exemption, fixture 3 of 3: a child SPAWNED THIS SESSION carries
    // its proof in the runtime's own hand (the ChildProcess handle) - the
    // stop never asks PowerShell who the child is. With inspectProcess
    // ABSENT ENTIRELY (WMI dead on this box), a stubborn child is still
    // tree-killed, and the verified ports flip the state to 'stopped'.
    const rec = recorder()
    const dir = await installedDir()
    const taskkill = vi.fn(async (_command: string, _args: string[], _options: { timeoutMs: number }) => ({ code: 0 }))
    let treeAlive = false
    const { manager } = managerFor({
      execImpl: async (command: string, args: string[], options: { timeoutMs: number }) => {
        treeAlive = false // the wrapper taskkill actually ends the tree here
        return await taskkill(command, args, options)
      },
      installDir: dir,
      obedient: false,
      onEvent: (event, detail) => {
        if (event === 'runtime.spawned')
          treeAlive = true
        rec.onEvent(event, detail)
      },
      probeOccupied: async () => (treeAlive ? 'occupied' : 'free'),
      spawnFlow: true,
      // NO inspectProcess at all: the exemption under oath. Had the stop
      // ever asked for a revalidation, it would have drowned - it asks none.
    })

    await manager.start()
    await manager.stop()

    expect(taskkill).toHaveBeenCalledTimes(1)
    expect(taskkill.mock.calls[0][0]).toBe('taskkill')
    expect(taskkill.mock.calls[0][1]).toEqual(taskkillArgs(4242))
    expect(rec.lines).toContain('runtime.process-tree-terminated rootPid=4242')
    // The exemption in the log: NO revalidation was ever attempted.
    expect(rec.lines.some(line => line.startsWith('runtime.root-revalidate-'))).toBe(false)
    expect(rec.lines.some(line => line.startsWith('runtime.stop-incomplete'))).toBe(false)
    expect(rec.lines).toContain('runtime.stopped')
    expect(manager.state()).toEqual({ phase: 'stopped' })
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
    expect(manager.state()).toEqual({ phase: 'ready', pid: 4242 })
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
    expect(manager.state().pid).toBe(4242)
    diagnosis.length = 0
    // From here on the port never lets go: the stop is treated as contested.
    occupancy = 'occupied'

    await manager.stop({ confirmFreeMs: 50 })

    expect(rec.lines).toContain('runtime.shutdown-ports-still-occupied occupancy=occupied')
    expect(rec.lines).not.toContain('runtime.shutdown-ports-free')
    expect(diagnosis).toContain('occupied')
  })

  it('an EXTERNAL alltalk is a friendly conflict: never adopted at start, never killed at stop (case 3)', async () => {
    const rec = recorder()
    const dir = await installedDir()
    const externalRecord = [{
      created: QA_CREATED,
      exe: 'D:\\ManualAllTalk\\python.exe',
      parentPid: QA_LAUNCHER_PID,
      pid: QA_LISTENER_PID,
    }]
    const taskkill = vi.fn(async (_command: string, _args: string[], _options: { timeoutMs: number }) => ({ code: 0 }))
    const { manager, spawned } = managerFor({
      execImpl: taskkill,
      inspectProcess: liaTreeInspect(dir),
      installDir: dir,
      isHealthy: async () => true,
      onEvent: rec.onEvent,
      portOwnerDiagnostics: async () => externalRecord,
    })

    const state = await manager.start()

    // Their AllTalk, their lifecycle: the port is theirs and the boot is a
    // conflict, not an adoption (round-6, item 2: no automatic external
    // server). Mutation check: a "kill every adopted process" regression
    // would trip the taskkill assertion the moment the adopt path changed.
    expect(state.phase).toBe('error')
    expect(state.message).toBe('The voice system is already being used by another process.')
    expect(rec.lines).toContain('runtime.port-occupied-external-process')
    expect(spawned).not.toHaveBeenCalled()

    await manager.stop({ confirmFreeMs: 50 })

    expect(taskkill).not.toHaveBeenCalled()
    expect(rec.lines).not.toContain('runtime.process-tree-terminated')
    expect(rec.lines).not.toContain('runtime.shutdown-ports-free')
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

    expect(state).toEqual({ phase: 'ready', pid: 4242 })
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
    // Round 6: an unidentified listener is an owner the proof could not
    // reach - the message says what we failed to learn, not who we assume.
    expect(state.message).toBe('The voice system could not identify who is using its port.')
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

describe('the supervisor scope (Phase 7.1): preserveAdoptedOnStop', () => {
  function recorder() {
    const lines: Array<string> = []
    return {
      lines,
      onEvent: (event: string, detail?: string) => lines.push(detail ? `${event} ${detail}` : event),
    }
  }

  it('D. an ADOPTED lia-managed tree survives the launcher close: zero kills, preserved event, session stopped', async () => {
    // The launcher NEVER owns a server the user started by hand - even when
    // the ancestry walk proves it came out of OUR install. Closing the
    // launcher leaves the hand-started tree alive; the round-6 kill clause
    // still governs the embedded path (the default flag remains false).
    const rec = recorder()
    const dir = await installedDir()
    const taskkill = vi.fn(async (_command: string, _args: string[], _options: { timeoutMs: number }) => ({ code: 0 }))
    const { manager } = managerFor({
      execImpl: taskkill,
      inspectProcess: async (pid: number) => await liaTreeInspect(dir)(pid),
      installDir: dir,
      isHealthy: async () => true,
      onEvent: rec.onEvent,
      portOwnerDiagnostics: async () => liaTreeRecords(dir),
      preserveAdoptedOnStop: true,
      probeOccupied: async () => 'occupied',
    })

    const started = await manager.start()
    expect(started.phase).toBe('ready')

    await manager.stop()

    expect(taskkill).not.toHaveBeenCalled() // the actual ownership assertion
    expect(rec.lines.some(line => line.startsWith('runtime.attachment-preserved'))).toBe(true)
    expect(rec.lines).not.toContain('runtime.process-tree-terminated')
    expect(rec.lines).toContain('runtime.stopped')
    expect(manager.state()).toEqual({ phase: 'stopped' })
  })

  it('the default keep-killing-adopted contract is unchanged when the flag is absent', async () => {
    const rec = recorder()
    const dir = await installedDir()
    const taskkill = vi.fn(async (_command: string, _args: string[], _options: { timeoutMs: number }) => ({ code: 0 }))
    const { manager } = managerFor({
      execImpl: taskkill,
      inspectProcess: async (pid: number) => await liaTreeInspect(dir)(pid),
      installDir: dir,
      isHealthy: async () => true,
      onEvent: rec.onEvent,
      portOwnerDiagnostics: async () => liaTreeRecords(dir),
      probeOccupied: async () => 'occupied',
    })

    await manager.start()
    await manager.stop()

    expect(taskkill).toHaveBeenCalled() // round-6 clause, preserved by default
    expect(rec.lines.some(line => line.startsWith('runtime.attachment-preserved'))).toBe(false)
  })
})
