/**
 * The runtime shutdown semantics, isolated so tests can drive them (Phase 6
 * hotfix round 5, items E/F/G/H/I).
 *
 * ## The bug this module exists to kill
 *
 * A Windows QA run found AllTalk's python tree alive ~4 hours after the Lia
 * that spawned it was gone. The graceful path (`before-quit`) works on a
 * packaged quit, but the dev loop (`pnpm dev:tamagotchi` → electron-vite
 * dev → Electron) has exits that never reach `before-quit`: Ctrl+C in the
 * terminal, the dev runner's kill on restart/HMR, a closed console. Node
 * only runs `process.on('exit')` listeners when the process exits *through
 * Node*; a signal-terminate with no registered signal listener on Windows
 * does not reach it, and neither does a hard kill. What we CAN cover is
 * everything up to (but not including) `kill -9` / `taskkill /F`: a
 * registered SIGINT/SIGTERM/SIGHUP listener seizes control before the
 * default terminate, runs the same graceful stop the quit path runs, and
 * only then exits.
 *
 * ## The contract, same as the quit path
 *
 * declare shutdown (no new starts, ever - the manager refuses them) →
 * graceful stop of the owned child (SIGTERM → grace → taskkill /T /F tree
 * kill on Windows → SIGKILL) → confirm the ports answer nobody → then let
 * the process end. Every trigger is single-flight: a Ctrl+C racing a quit,
 * or two signals back to back, share ONE stop; the first trigger's exit
 * decision wins.
 *
 * ## What stops at the boundary, honestly
 *
 * A kill the operating system cannot be stopped from delivering - SIGKILL,
 * `taskkill /F` on the Electron process itself, power loss - can still
 * orphan the tree. The last-resort synchronous kill on `exit` narrows that
 * window; the boot-time `port-owner` diagnostics are the record when even
 * that loses. The QA for this round validates the survivable paths.
 */

/** App-style events we listen on: injectable so tests need no Electron. */
export interface RuntimeShutdownListeners {
  beforeQuit: (listener: (event: { preventDefault: () => void }) => void) => void
  signal: (signal: string, listener: () => void) => void
  exit: (listener: () => void) => void
}

export interface RuntimeShutdownParams {
  /** The listeners to register on, once. */
  listeners: RuntimeShutdownListeners
  /** Current manager phase; 'ready'/'starting'/'error' mean there is work to stop. */
  phase: () => string
  /** Declares shutdown: every later start() is refused (lifecycle clause 1). */
  enterShutdown: () => void
  /** Graceful stop with port confirmation. */
  stop: (options: { confirmFreeMs: number }) => Promise<void>
  /** How long the stop may spend proving the ports free at shutdown. */
  confirmFreeMs: number
  /** PID of the Lia-owned root process, for the last-resort sync kill. */
  ownedRootPid: () => number | undefined
  /** Synchronous best-effort tree kill; already platform-guarded (Windows). */
  killTreeSync: (pid: number) => void
  /** Ends the process after a graceful shutdown: quit-path code or exit code. */
  endProcess: (code: number) => void
  log: (event: string, detail?: string) => void
}

export interface RuntimeShutdown {
  /**
   * Runs the graceful sequence exactly once, whichever trigger arrives first.
   * Later triggers attach to the same run; only the first trigger's exit
   * decision is honored. Returns true when this call owned the run.
   */
  run: (trigger: string, exitCode: number) => Promise<boolean>
  /** The phase-name test the quit path exempts from stopping. */
  hasWorkToStop: () => boolean
}

/**
 * The exit codes follow convention: 130 SIGINT, 143 SIGTERM, 129 SIGHUP,
 * 0 for the quit path.
 */
export function createRuntimeShutdown(params: RuntimeShutdownParams): RuntimeShutdown {
  const running: { current: Promise<void> | undefined } = { current: undefined }
  const ended: { current: boolean } = { current: false }

  function hasWorkToStop(): boolean {
    const phase = params.phase()
    return phase === 'ready' || phase === 'starting' || phase === 'error'
  }

  function endOnce(code: number): void {
    if (ended.current)
      return
    ended.current = true
    params.endProcess(code)
  }

  async function run(trigger: string, exitCode: number): Promise<boolean> {
    if (running.current) {
      // Single-flight: the second trigger waits for the first one's stop,
      // then leaves quietly - the first trigger already chose the exit.
      await running.current
      return false
    }
    let release!: () => void
    running.current = new Promise<void>((resolve) => {
      release = resolve
    })

    params.log('runtime.shutdown-begin', `trigger=${trigger}`)
    params.enterShutdown()
    try {
      await params.stop({ confirmFreeMs: params.confirmFreeMs })
    }
    catch (error) {
      params.log('runtime.shutdown-stop-error', error instanceof Error ? error.name : 'unknown')
    }
    params.log('runtime.shutdown-finished', `trigger=${trigger}`)
    release()
    endOnce(exitCode)
    return true
  }

  return { hasWorkToStop, run }
}

/**
 * Wires the three real trigger families to the graceful run: the app quit,
 * the console/process signals, and the last-resort synchronous kill when
 * only `exit` is left. Registered once at bridge registration.
 */
export function installRuntimeShutdownHooks(params: RuntimeShutdownParams): void {
  const shutdown = createRuntimeShutdown(params)

  params.listeners.beforeQuit((event) => {
    // First click wins: app.quit() re-enters before-quit after we called
    // app.exit/proces exit ourselves, and must pass through silently.
    if (!shutdown.hasWorkToStop()) {
      params.log('runtime.shutdown-nothing-to-stop', `phase=${params.phase()}`)
      return
    }
    event.preventDefault()
    void shutdown.run('before-quit', 0)
  })

  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]] as const) {
    params.listeners.signal(signal, () => {
      // No preventDefault exists here - the listener IS the seize. With no
      // stopping work the exit is immediate, but the log still records who
      // ended us, since "the process just vanished" was the round-5 mystery.
      params.log('runtime.shutdown-signal', `signal=${signal}`)
      if (!shutdown.hasWorkToStop()) {
        params.endProcess(code)
        return
      }
      void shutdown.run(`signal:${signal}`, code)
    })
  }

  params.listeners.exit(() => {
    const pid = params.ownedRootPid()
    if (pid === undefined)
      return
    params.log('runtime.exit-sync-kill', `pid=${pid}`)
    params.killTreeSync(pid)
  })
}
