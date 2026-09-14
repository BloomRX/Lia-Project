import type { ChildProcess } from 'node:child_process'

import type { RuntimeManager, RuntimeManagerDeps } from './alltalk-runtime'

import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRuntimeManager, ENVIRONMENT_MARKERS, INSTALL_MARKERS, startCommandFor, WINDOWS_START_SCRIPT } from './alltalk-runtime'

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

function managerFor(
  overrides: Partial<RuntimeManagerDeps> & { installDir?: string, obedient?: boolean },
): { manager: RuntimeManager, spawned: ReturnType<typeof vi.fn>, child: FakeChild } {
  const { obedient, ...deps } = overrides
  const child = fakeChild({ obedient })
  const spawned = vi.fn(() => child.proc)
  const manager = createRuntimeManager({
    isHealthy: async () => false,
    installDir: '',
    platform: 'win32',
    pollIntervalMs: 1,
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
    const { manager, spawned } = managerFor({ installDir: dir, isHealthy: async () => true })

    await manager.start()
    await manager.start()

    expect(spawned).toHaveBeenCalledTimes(1)
    expect(manager.state().phase).toBe('ready')
  })

  it('reaches ready and records the pid once health succeeds', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    const { manager } = managerFor({ installDir: dir, isHealthy: async () => true })

    const state = await manager.start()

    expect(state.phase).toBe('ready')
    expect(state.pid).toBe(4242)
    expect(manager.state().phase).toBe('ready')
  })

  it('restarts when the server disappeared behind its back', async () => {
    const dir = await installedDir()
    tempDirs.push(dir)
    let healthy = true
    const { manager, spawned } = managerFor({ installDir: dir, isHealthy: async () => healthy })

    await manager.start()
    expect((await manager.start()).phase).toBe('ready')
    expect(spawned).toHaveBeenCalledTimes(1)

    // The user closed the terminal: the port is dead even though we think not.
    healthy = false
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
    const { child, manager } = managerFor({ installDir: dir, isHealthy: async () => true })

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
      isHealthy: async () => true,
      obedient: false,
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
    const { child, manager } = managerFor({ installDir: dir, isHealthy: async () => true })

    await manager.start()
    child.exit(0)
    await manager.stop()

    expect(manager.state().phase).toBe('stopped')
  })
})
