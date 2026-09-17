/**
 * Restarting the runtime when the prepared engine differs from the running
 * one (Phase 6 hotfix, item F).
 *
 * Preparing XTTS is a disk + config operation (item D: it never starts a
 * server). But the *running* server keeps whichever engine it booted with -
 * the QA evidence showed a Piper instance still answering after the config
 * said xtts. This function closes that gap, deliberately small:
 *
 * - Not running: nothing to do. The prepare did its job on disk; the next
 *   start picks the fresh config up. **The prepare must never start a server
 *   just to prove itself** - so "not running" is a quiet success.
 * - Running and Lia-owned: stop, wait for the port to actually fall silent,
 *   start, wait for health, and only then claim the engine live. Claiming
 *   `config=XTTS + process=Piper + UI=Ready` is the failure this prevents.
 * - Running but foreign (adopted manual AllTalk or another program): the Lia
 *   may not stop it, so it may not claim the switch either. The user gets a
 *   sentence asking them to close the other server, and the log names it.
 *
 * Every hop is one `[LIA-VOICE-RUNTIME]` log line, sequenced so the log can
 * never claim the service before the service answers (item H).
 */

export interface EngineRestartDeps {
  /** The renderer-facing runtime state word ('ready' | 'starting' | ...). */
  runtimeState: () => string
  /**
   * Ownership of the running instance. Absent means "unknown", which is
   * treated as foreign - the conservative reading: never stop what we cannot
   * prove we started.
   */
  isOwnedInstance?: () => boolean
  stop: () => Promise<void>
  start: () => Promise<{ state: string }>
  /** True while the API keeps answering; false means the port fell silent. */
  isHealthy: () => Promise<boolean>
  log: (event: string, detail?: string) => void
  sleep?: (ms: number) => Promise<void>
  /** How long to wait for the port to stop answering after stop. */
  portFreeTimeoutMs?: number
  pollIntervalMs?: number
}

export type EngineRestartOutcome
  = | { ok: true, restarted: boolean }
    | { detail: string, ok: false }

const DEFAULT_PORT_FREE_TIMEOUT_MS = 15_000

export async function restartForEngineChangeIfNeeded(
  deps: EngineRestartDeps,
): Promise<EngineRestartOutcome> {
  const sleep = deps.sleep ?? (async (ms: number) => await new Promise(resolve => setTimeout(resolve, ms)))
  const portFreeTimeoutMs = deps.portFreeTimeoutMs ?? DEFAULT_PORT_FREE_TIMEOUT_MS
  const pollIntervalMs = deps.pollIntervalMs ?? 250

  if (deps.runtimeState() !== 'ready') {
    // Item D: prepare != start. Nothing running means nothing to restart.
    return { ok: true, restarted: false }
  }

  if (deps.isOwnedInstance?.() !== true) {
    deps.log('runtime.restart-blocked-foreign-instance')
    return {
      detail: 'A voice server that the Lia did not start is still running. Close it, then prepare again.',
      ok: false,
    }
  }

  deps.log('runtime.restart-for-engine-change')
  await deps.stop()
  deps.log('runtime.stopped')

  // The stop awaited the child exit, not the socket release. A new spawn that
  // binds while the old one still answers would adopt the dying instance, so
  // start waits for genuine silence (item F3).
  const deadline = Date.now() + portFreeTimeoutMs
  for (;;) {
    const healthy = await deps.isHealthy().catch(() => false)
    if (!healthy)
      break
    if (Date.now() >= deadline) {
      deps.log('runtime.port-free-timeout')
      return {
        detail: 'The voice system did not release its port after stopping. Retry the preparation.',
        ok: false,
      }
    }
    await sleep(pollIntervalMs)
  }

  const started = await deps.start()
  if (started.state !== 'ready') {
    deps.log('runtime.restart-failed')
    return {
      detail: 'The voice system did not come back after the engine change. Use "Try again".',
      ok: false,
    }
  }
  deps.log('runtime.health-ready')
  deps.log('runtime.engine-verified', 'xtts')
  return { ok: true, restarted: true }
}
