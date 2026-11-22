/**
 * The launcher shutdown coordinator (Phase 7.1, items 1/3).
 *
 * Lia App is the SUPERVISOR of everything it started - the stage, the
 * managed voice runtime, any future Lia-managed runtime. Closing the
 * launcher follows one ordered, single-flight contract:
 *
 *   1. declare shutdown (block every new start, supervisor-wide);
 *   2. stop the owned Stage;
 *   3. stop the owned voice runtime;
 *   4. take each answer at face value and confirm the state it claims;
 *   5. only then let the process leave.
 *
 * What the coordinator deliberately does NOT stop: a target that swears it
 * owns nothing this session (e.g. a stage the launcher never spawned, a
 * hand-started voice server adopted along the way). "Nothing of ours" is a
 * step result the user can read, never an error.
 *
 * Targets are plain functions and the whole class is electron-free: the
 * Electron entry wires before-quit/SIGINT/SIGTERM onto it, tests drive it
 * directly (contract items E/F).
 */

export interface ShutdownTarget {
  /** Human name for the log: 'stage', 'voice-runtime', ... */
  name: string
  /** True when this target owns a live process SPAWNED THIS SESSION. */
  holdsOwnedProcess: () => boolean
  /** Graceful stop; idempotent per target; resolves after real teardown. */
  stop: () => Promise<void>
}

export interface ShutdownStep {
  ms: number
  name: string
  outcome: 'failed' | 'no-owned-process' | 'stopped'
  /** Failure detail, when outcome is 'failed'. Never a secret. */
  error?: string
}

export interface ShutdownReport {
  mode: 'idle' | 'shutting-down'
  steps: ShutdownStep[]
  /** True when the global budget expired with work unfinished. */
  timedOut: boolean
  totalMs: number
}

export interface ShutdownCoordinatorDeps {
  globalTimeoutMs?: number
  now?: () => number
  onLog?: (line: string) => void
}

export class ShutdownCoordinator {
  private shuttingDownReport: Promise<ShutdownReport> | undefined
  private declaredIdle = true
  private readonly targets: ShutdownTarget[] = []

  constructor(private readonly deps: ShutdownCoordinatorDeps = {}) {}

  register(target: ShutdownTarget): void {
    this.targets.push(target)
  }

  /** True from the FIRST stopAll() call on; start paths must refuse work. */
  isShuttingDown(): boolean {
    return !this.declaredIdle
  }

  /**
   * The one graceful sequence. Concurrent triggers (a quit racing Ctrl+C,
   * two signals back to back) attach to the SAME report - targets stop
   * once, and later calls wait for that stop instead of repeating it.
   */
  async stopAll(): Promise<ShutdownReport> {
    this.declaredIdle = false
    this.shuttingDownReport ??= this.execute()
    return await this.shuttingDownReport
  }

  private async execute(): Promise<ShutdownReport> {
    const now = this.deps.now ?? (() => performance.now())
    const log = this.deps.onLog ?? (() => {})
    const budget = this.deps.globalTimeoutMs ?? 30_000
    const steps: ShutdownStep[] = []

    log('[lia:shutdown] beginning graceful shutdown')

    const t0 = now()
    const work = (async () => {
      // Serial and ordered: the stage leaves first (its children answer to
      // the voice runtime), then the runtimes. Stopping in parallel would
      // interleave their logs and any shared diagnostics.
      for (const target of this.targets) {
        const started = now()
        try {
          if (!target.holdsOwnedProcess()) {
            steps.push({ ms: Math.round(now() - started), name: target.name, outcome: 'no-owned-process' })
            log(`[lia:shutdown] ${target.name}: nothing this session started - skipped`)
            continue
          }
          await target.stop()
          steps.push({ ms: Math.round(now() - started), name: target.name, outcome: 'stopped' })
          log(`[lia:shutdown] ${target.name}: stopped in ${Math.round(now() - started)}ms`)
        }
        catch (error) {
          let message = 'unknown failure'
          if (error instanceof Error) {
            message = error.message
          }
          else if (typeof error === 'string') {
            message = error
          }
          steps.push({ error: message, ms: Math.round(now() - started), name: target.name, outcome: 'failed' })
          log(`[lia:shutdown] ${target.name}: FAILED - ${message}`)
          // A failed step never blocks the next one: supervisor shutdown is
          // best-effort-everything, never all-or-nothing.
        }
      }
    })()

    const timeout = new Promise<'timeout'>((resolve) => {
      const handle = setTimeout(resolve, budget, 'timeout')
      handle.unref?.()
    })

    const outcome = await Promise.race([work.then(() => 'done' as const), timeout])
    const report: ShutdownReport = {
      mode: 'shutting-down',
      steps,
      timedOut: outcome === 'timeout',
      totalMs: Math.round(now() - t0),
    }
    log(outcome === 'timeout'
      ? `[lia:shutdown] global timeout after ${budget}ms - process proceeds`
      : `[lia:shutdown] all targets answered - process may leave`)
    return report
  }
}

/**
 * The quit-flow wiring, electron-free by injection: routes EVERY exit
 * route through the coordinator exactly once and only then lets the
 * process end. The Electron entry passes real endProcess; tests pass
 * fakes (contract items E/F).
 */
export interface QuitFlowDeps {
  coordinator: ShutdownCoordinator
  endProcess: (code: number) => void
  log?: (line: string) => void
}

/**
 * Installs the supervisor quit contract. The first trigger runs
 * `coordinator.stopAll()` and only then ends the process; later triggers
 * (including the `before-quit` that our own `endProcess` re-fires) attach
 * to the same run. Exit codes: 0 for the quit path, 130/143 for signals.
 */
export interface SupervisorQuitFlow {
  onBeforeQuit: () => void
  onSigint: () => void
  onSigterm: () => void
}

export function createSupervisorQuitFlow(deps: QuitFlowDeps): SupervisorQuitFlow {
  let run: Promise<ShutdownReport> | undefined
  const log = deps.log ?? (() => {})

  async function initiate(trigger: string, exitCode: number): Promise<void> {
    // The first trigger owns the run AND the exit decision. Racing triggers
    // (Ctrl+C during a quit, a signal storm) join the same report instead
    // of spawning a second stop sequence - and never exit by themselves.
    if (!run) {
      run = deps.coordinator.stopAll()
      const report = await run
      log(`[lia:quit] ${trigger}: shutdown ${report.timedOut ? 'timed out' : 'finished'} - exiting ${exitCode}`)
      deps.endProcess(exitCode)
      return
    }
    log(`[lia:quit] ${trigger}: shutdown already in flight - joining`)
    await run
  }

  return {
    onBeforeQuit: () => void initiate('before-quit', 0),
    onSigint: () => void initiate('SIGINT', 130),
    onSigterm: () => void initiate('SIGTERM', 143),
  }
}
