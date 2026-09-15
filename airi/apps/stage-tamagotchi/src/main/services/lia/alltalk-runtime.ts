import type { Buffer } from 'node:buffer'
import type { ChildProcess, SpawnOptions } from 'node:child_process'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The speech runtime as a process the Lia owns.
 *
 * Before this, using a custom voice meant the user had to open a terminal,
 * `cd` somewhere, and run a `.bat` file - and remember to do it every time.
 * This module is what removes that: the Lia detects the install, starts it
 * hidden, waits until it actually answers, and shuts it down when the app
 * closes.
 *
 * ## What it deliberately does NOT do
 *
 * **It never installs.** AllTalk's `atsetup.bat` is interactive (it asks the
 * user to pick "Standalone Installation" then option 1) and its prerequisites -
 * Git, Microsoft C++ Build Tools with the Windows SDK, and espeak-ng - are
 * separate multi-gigabyte installs that need an administrator. There is no
 * versioned, checksummed artifact to fetch. Automating that would mean building
 * a fragile downloader around an installer that was never designed to be driven,
 * so installation stays a guided wizard and this module starts from "already
 * installed".
 *
 * ## Process safety
 *
 * - Arguments are an explicit array and `shell` is left `false`. On Windows a
 *   `.bat` still needs an interpreter, so `cmd.exe` is invoked *as the program*
 *   with `/c` and the script name as a separate argument - the install directory
 *   is passed as `cwd`, never interpolated into a command string.
 * - `windowsHide: true`, so no console window flashes on the user's desktop.
 * - One child at a time: `start()` while starting or running is a no-op, so a
 *   double click cannot leave two servers fighting over port 7851.
 * - `stop()` on app quit, and the child is unref'd from nothing - we keep the
 *   handle so an orphan cannot outlive us.
 */

/** Files that must exist for a folder to count as an AllTalk install. */
export const INSTALL_MARKERS = ['script.py', 'system', 'voices'] as const

/**
 * The Python environment `atsetup.bat` builds, without which the folder is source
 * code rather than a working runtime.
 *
 * Checked by the runtime manager and by the bootstrap's verify step alike. Two
 * separate lists drift: the manager would call an install usable that the bootstrap
 * still considers missing, and the user gets a started-but-broken state with no
 * explanation.
 */
export const ENVIRONMENT_MARKERS = ['alltalk_environment/conda', 'alltalk_environment/env'] as const

/** The launcher `atsetup.bat` generates. Windows only. */
export const WINDOWS_START_SCRIPT = 'start_alltalk.bat'

/** How long to wait for the server to answer after spawning it. */
export const DEFAULT_START_TIMEOUT_MS = 180_000

export interface RuntimeStateSnapshot {
  phase: 'error' | 'notInstalled' | 'ready' | 'starting' | 'stopped'
  /** Only set when `phase` is `error`. A short sentence, never a stack trace. */
  message?: string
  /** Process id of the managed child, when we started one. */
  pid?: number
  /**
   * Whether the ready instance (if any) is a child this manager spawned.
   *
   * `false` means the server was already answering when asked - a manually
   * started AllTalk or a Lia orphan that survived an earlier crash. Such an
   * instance is *used* (restarting it would break the same contract in the
   * other direction) but never *killed* (item B of the hotfix brief: a PID is
   * only ever killed while its ownership is proven).
   */
  owned?: boolean
}

/**
 * Who answers on the runtime's port, as far as we can prove.
 *
 * - `alltalk`: the API answered the way AllTalk answers - whatever owns it, it
 *   serves the documented endpoints and can be reused.
 * - `unknown`: something is listening but is not an AllTalk API (item D of the
 *   hotfix brief: another program holding the port).
 * - `none`: nothing answered.
 */
export type RuntimeProbeIdentity = 'alltalk' | 'none' | 'unknown'

/**
 * The one supervised entry point of the voice runtime (hotfix brief, item A):
 * every path that could start AllTalk - autostart, bootstrap completion,
 * retry, prepare, manual button - funnels through `start()` of this single
 * manager, and `start()` only spawns when no healthy instance answers. The
 * four contract clauses of the brief map onto `doStart` below.
 */
export interface RuntimeManagerDeps {
  /** Where AllTalk is installed, or undefined when the user has not pointed at one. */
  installDir?: string
  /** Health probe: true when the server answers. Injected so tests need no server. */
  isHealthy: () => Promise<boolean>
  /**
   * Who is on the port right now. Defaults to a healthy/none reading of
   * `isHealthy` - the service layer injects the real API + TCP distinction,
   * so the manager itself carries no socket code.
   */
  probeIdentity?: () => Promise<RuntimeProbeIdentity>
  platform?: NodeJS.Platform
  spawnImpl?: typeof spawn
  /** How often to poll health while waiting for startup. */
  pollIntervalMs?: number
  startTimeoutMs?: number
  /**
   * Existence probe for the bundled espeak-ng directory (item I). Defaults to
   * a real `fs.access`; tests inject a table.
   */
  existsImpl?: (path: string) => Promise<boolean>
  /**
   * Runs an external program with an argument array, never a shell string.
   * Used for the Windows process-tree kill; injected in tests.
   */
  execImpl?: (command: string, args: string[], options: { timeoutMs: number }) => Promise<{ code: number | null }>
  /** Structured lifecycle events for the `[LIA-VOICE-RUNTIME]` log. */
  onEvent?: (event: string, detail?: string) => void
  /** How long to wait for SIGTERM before escalating. Bounded, so app quit cannot hang. */
  stopGraceMs?: number
  /** Receives stdout/stderr lines. Diagnostics only; never surfaced raw. */
  onOutput?: (chunk: string) => void
}

export interface RuntimeManager {
  state: () => RuntimeStateSnapshot
  /** True when the folder looks like a real AllTalk install. */
  isInstalled: () => Promise<boolean>
  /** Starts if needed and waits for health. Idempotent. */
  start: () => Promise<RuntimeStateSnapshot>
  /** Stops the managed child, if any. Safe to call repeatedly. */
  stop: () => Promise<void>
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

/**
 * Builds the spawn arguments for the platform.
 *
 * Exported because it is the part with security consequences: it must never
 * produce a shell-interpolated string containing a user-chosen path.
 *
 * `extras.env` is an already-computed environment: the existence-checked
 * espeak prepend (item I) happens async in `doStart`, so the env arrives here
 * ready rather than this sync function doing I/O.
 */
export function startCommandFor(
  platform: NodeJS.Platform,
  installDir: string,
  extras: { env?: NodeJS.ProcessEnv } = {},
): { args: string[], command: string, options: SpawnOptions } {
  const options: SpawnOptions = {
    cwd: installDir,
    // No console window on the user's desktop.
    windowsHide: true,
    // Inherit nothing: stdout/stderr are piped and read here.
    stdio: ['ignore', 'pipe', 'pipe'],
    env: extras.env ?? { ...process.env },
  }

  if (platform === 'win32') {
    // A .bat needs cmd.exe, but as the program with the script as an argument -
    // not as a string handed to a shell.
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', WINDOWS_START_SCRIPT],
      options,
    }
  }

  return {
    command: 'bash',
    args: ['-lc', 'python3 script.py'],
    options,
  }
}

/**
 * The child's environment (hotfix brief, item I).
 *
 * The QA log warned `Espeak-ng for Windows WAS NOT FOUND` while the pin ships
 * a bundled copy under `system/espeak-ng`. Suppressing the warning is a PATH
 * prepend of exactly that bundled directory - and only of it, only on
 * Windows, and only when the directory actually exists. Nothing is installed
 * globally, and the change lives in the child's environment, never in the
 * user's.
 */
export async function spawnEnvFor(
  platform: NodeJS.Platform,
  installDir: string,
  existsImpl: (path: string) => Promise<boolean>,
): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (platform !== 'win32')
    return env

  const bundled = join(installDir, 'system', 'espeak-ng')
  if (!await existsImpl(bundled))
    return env

  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
  env[pathKey] = `${bundled};${env[pathKey] ?? ''}`
  return env
}

/**
 * The Windows process-tree kill (hotfix brief, item K).
 *
 * `start_alltalk.bat` makes cmd.exe the parent and python.exe the worker, so
 * signalling the wrapper alone orphans the worker - which then holds on to
 * the very port the next start wants. The tree kill is `taskkill` on the
 * Lia-owned root PID with `/T`, as a fixed argument array with no shell.
 */
export function taskkillArgs(pid: number): string[] {
  return ['/PID', String(pid), '/T', '/F']
}

export function createRuntimeManager(deps: RuntimeManagerDeps): RuntimeManager {
  const platform = deps.platform ?? process.platform
  const spawnImpl = deps.spawnImpl ?? spawn
  const startTimeoutMs = deps.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS
  const pollIntervalMs = deps.pollIntervalMs ?? 1000
  const stopGraceMs = deps.stopGraceMs ?? 5000
  const existsImpl = deps.existsImpl ?? exists
  const probeIdentity = deps.probeIdentity ?? (async (): Promise<RuntimeProbeIdentity> => {
    try {
      return await deps.isHealthy() ? 'alltalk' : 'none'
    }
    catch {
      return 'none'
    }
  })
  const emit = (event: string, detail?: string): void => {
    try {
      deps.onEvent?.(event, detail)
    }
    catch {
      // A logger must never change what the runtime state machine does.
    }
  }

  let snapshot: RuntimeStateSnapshot = { phase: 'stopped' }
  let child: ChildProcess | undefined
  /** Guards against two concurrent starts racing into two children. */
  let starting: Promise<RuntimeStateSnapshot> | undefined

  function set(next: RuntimeStateSnapshot): RuntimeStateSnapshot {
    snapshot = next
    return next
  }

  async function isInstalled(): Promise<boolean> {
    const dir = deps.installDir?.trim()
    if (!dir)
      return false

    for (const marker of [...INSTALL_MARKERS, ...ENVIRONMENT_MARKERS]) {
      if (!await exists(join(dir, marker)))
        return false
    }
    // The launcher only exists once the user has actually run the setup script,
    // so it is the difference between "extracted the zip" and "installed".
    return platform === 'win32' ? exists(join(dir, WINDOWS_START_SCRIPT)) : true
  }

  async function waitForHealth(deadline: number): Promise<boolean> {
    for (;;) {
      try {
        if (await deps.isHealthy())
          return true
      }
      catch {
        // A server that is still booting refuses connections; that is not an
        // error yet, only a reason to keep waiting.
      }

      if (Date.now() >= deadline)
        return false

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }
  }

  async function killProcessTree(pid: number): Promise<void> {
    if (platform !== 'win32' || !deps.execImpl)
      return
    // Fixed arguments, no shell, Lia-owned root PID only (item K).
    const args = taskkillArgs(pid)
    emit('runtime.kill-tree', `pid=${pid}`)
    try {
      await deps.execImpl('taskkill', args, { timeoutMs: stopGraceMs })
    }
    catch {
      // The tree may already be gone; a kill that finds nothing is not a failure.
    }
  }

  async function stop(): Promise<void> {
    const current = child
    child = undefined
    if (starting)
      starting = undefined

    // An adopted instance is not ours to kill (item B): a manually started
    // AllTalk, or an orphan from an earlier crash. Stop using it - but leave
    // the process breathing for whoever started it.
    if (!current && snapshot.phase === 'ready' && snapshot.owned === false) {
      emit('runtime.left-external-instance-running')
      set({ phase: 'stopped' })
      return
    }

    if (!current || current.exitCode !== null) {
    // Nothing to kill. A previous failure is kept so the UI still explains
    // why the voice is unavailable instead of silently reading "stopped".
      set(snapshot.phase === 'error' ? snapshot : { phase: 'stopped' })
      return
    }

    const exited = new Promise<void>((resolve) => {
      current.once('exit', () => resolve())
      // Never hang the app's shutdown on a stubborn child.
      setTimeout(resolve, stopGraceMs).unref?.()
    })

    current.kill('SIGTERM')
    await exited

    if (current.exitCode === null) {
    // Did not take the hint: make sure it cannot outlive us.
    // On Windows the bat wrapper dies alone and orphans its python worker, so
    // the escalation there is the process-tree kill first.
      if (platform === 'win32' && current.pid !== undefined) {
        await killProcessTree(current.pid)
        await new Promise<void>((resolve) => {
          current.once('exit', () => resolve())
          setTimeout(resolve, stopGraceMs).unref?.()
        })
      }
      if (current.exitCode === null)
        current.kill('SIGKILL')
    }

    emit('runtime.stopped')
    set({ phase: 'stopped' })
  }

  async function doStart(): Promise<RuntimeStateSnapshot> {
    try {
      if (snapshot.phase === 'ready') {
        // Contract A-1/A-2: a live child, or any healthy API at all, is reused -
        // never joined by a second spawn.
        try {
          if (await deps.isHealthy()) {
            emit('runtime.reuse-running-instance')
            return snapshot
          }
        }
        catch {
          // fall through and start again
        }
        set({ phase: 'stopped' })
      }

      if (!(await isInstalled()))
        return set({ phase: 'notInstalled' })

      const installDir = deps.installDir!.trim()

      // Contract A-4 vs items B/D: before spawning, find out who is already on
      // the port. An AllTalk is adopted (used, never killed, never duplicated);
      // an unknown listener is a friendly error and nothing is killed.
      const identity = await probeIdentity()
      if (identity === 'alltalk') {
        emit('runtime.adopted-existing-instance')
        return set({ owned: false, phase: 'ready' })
      }
      if (identity === 'unknown') {
        emit('runtime.port-occupied-unknown-process')
        return set({
          message: 'The voice system is already being used by another process.',
          phase: 'error',
        })
      }

      set({ phase: 'starting' })
      emit('runtime.spawn-requested')

      const env = await spawnEnvFor(platform, installDir, existsImpl)
      const { command, args, options } = startCommandFor(platform, installDir, { env })
      const spawned = spawnImpl(command, args, options)
      child = spawned
      emit('runtime.spawned', spawned.pid !== undefined ? `pid=${spawned.pid}` : undefined)

      const record = (chunk: Buffer | string) => {
        deps.onOutput?.(String(chunk))
      }
      spawned.stdout?.on('data', record)
      spawned.stderr?.on('data', record)

      const exited = new Promise<number | null>((resolve) => {
        spawned.once('exit', code => resolve(code))
        spawned.once('error', () => resolve(null))
      })

      const healthy = await Promise.race([
        waitForHealth(Date.now() + startTimeoutMs),
        exited.then(() => false),
      ])

      if (!healthy) {
        // The spawn failed to serve. Before admitting defeat, re-read the port:
        // a racing Lia instance may have won it in the meantime - that is an
        // adopt, not an error; and an unknown holder means our child died
        // fighting for the port, which is the friendly message, not a crash.
        const after = await probeIdentity()
        if (after === 'alltalk') {
          await stop()
          emit('runtime.adopted-existing-instance')
          return set({ owned: false, phase: 'ready' })
        }
        if (after === 'unknown') {
          await stop()
          emit('runtime.port-occupied-unknown-process')
          return set({
            message: 'The voice system is already being used by another process.',
            phase: 'error',
          })
        }

        // Read the exit code *before* killing anything: stop() would otherwise
        // fill it in and make a timeout look like a crash.
        const died = spawned.exitCode !== null
        await stop()
        emit('runtime.start-failed', died ? 'exited-during-startup' : 'health-timeout')
        return set({
          phase: 'error',
          message: died
            ? 'The voice system closed while starting.'
            : 'The voice system took too long to start.',
        })
      }

      emit('runtime.health-ready')
      return set({ owned: true, phase: 'ready', pid: spawned.pid })
    }
    catch {
      await stop()
      return set({ phase: 'error', message: 'The voice system could not be started.' })
    }
    finally {
      starting = undefined
    }
  }

  return {
    state: () => snapshot,

    isInstalled,

    start() {
      // Single-instance guard. `starting` must be assigned *synchronously*: an
      // async function suspends at its first await, and every await before this
      // assignment was a window in which a second caller could spawn its own
      // child and leave two servers fighting over the same port.
      if (starting)
        return starting

      starting = doStart()
      return starting
    },

    stop: () => stop(),
  }
}
