/**
 * Single-instance guard for the Lia launcher (Phase 7.1 ownership
 * correction, item 5).
 *
 * The launcher is THE supervisor of every Lia-managed runtime it meets -
 * it stops them on shutdown. Two launchers alive at once would split that
 * authority: both would read the same recovered runtime as theirs, both
 * would stop it on close, and a user could watch "their" voice server die
 * because a window they never opened exited. There can be exactly one.
 *
 * Electron-free by injection: the entry passes `app.requestSingleInstanceLock`
 * / `app.on('second-instance')` / `app.exit`; tests pass fakes (test E).
 */

export interface SingleInstanceDeps {
  /** Surface the ALREADY-running launcher's window to the user. */
  focusPrimaryWindow: () => void
  /** End this redundant process immediately - it owns nothing yet. */
  leaveImmediately: () => void
  /** Never-secret log line for the decision. */
  log?: (line: string) => void
  /** Called on the PRIMARY when a secondary tries to rise. */
  onSecondInstance: (handler: () => void) => void
  /** Electron's lock request. */
  requestLock: () => boolean
}

export type SingleInstanceRole = 'primary' | 'secondary'

/**
 * Must run as EARLY as possible in the entry, before any host, any window,
 * any spawn. Returns the role this process will live as; a 'secondary'
 * role means the function already ended the process (synchronously by
 * contract - nothing else may run after).
 */
export function enforceSingleInstance(deps: SingleInstanceDeps): SingleInstanceRole {
  if (deps.requestLock()) {
    // We are THE supervisor. When a stray duplicate tries to open Lia,
    // surface our existing window instead of letting two coordinators
    // contest the same managed runtimes.
    deps.onSecondInstance(() => deps.focusPrimaryWindow())
    deps.log?.('[lia] single instance lock acquired - this process is the supervisor')
    return 'primary'
  }
  deps.log?.('[lia] another Lia launcher already runs - this process leaves without supervising anything')
  deps.leaveImmediately()
  return 'secondary'
}
