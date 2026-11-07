/**
 * Continuous descendant tracking for the Electron gate.
 *
 * The problem
 * -----------
 *
 * The gate used to call `descendants(root)` at four fixed moments. A child that
 * started and exited between two of those calls never entered the set, so the
 * teardown assertion could not have complained about it. The check was real for
 * the processes it happened to see and blind to everything else.
 *
 * What is implemented
 * -------------------
 *
 * A monitor that starts **before** the Electron process is launched and polls
 * the process table until it is stopped. Every poll feeds the same accumulator,
 * so a short-lived child is captured as long as it lives longer than one
 * interval. PIDs are accumulated with their creation time, which means a
 * recycled number cannot masquerade as an old observation.
 *
 * What is NOT claimed
 * -------------------
 *
 * This is still sampling. A process that starts and exits inside one interval
 * can escape. Closing that window completely needs a kernel-level facility —
 * a Windows Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, or ETW
 * `Win32_ProcessStartTrace`. Both were considered and rejected for this gate:
 *
 *   - a Job Object cannot be created from Node without a native addon, and this
 *     project already refuses third-party native dependencies in tooling;
 *   - `Win32_ProcessStartTrace` needs an elevated session and a WMI event
 *     consumer, so the gate would stop working for a normal developer account.
 *
 * So the honest statement is: the monitor narrows the blind window from
 * "however long four snapshots are apart" to "one interval", and it reports
 * that interval. It does not promise omniscience, and the gate's report records
 * the observed interval so a reader can judge it.
 *
 * It also records what can be checked afterwards: the union of every identity
 * ever observed, grouped by the poll that first saw it, so the report can
 * distinguish "never seen" from "seen and confirmed gone".
 */

import { errorText } from './errors.mjs'
import { parseProcessTable, processTableCommand } from './process-identity.mjs'

/** Poll interval used when the caller does not choose one. */
export const DEFAULT_POLL_INTERVAL_MS = 150

/**
 * Create a monitor.
 *
 * `snapshot` is injected rather than imported so this file has no dependency on
 * PowerShell: the gate passes a function that runs `Get-CimInstance`, tests pass
 * a fake clock and a fake table. That is the difference between a unit test that
 * proves the accumulator and one that merely re-runs the gate.
 *
 * `now` is injected for the same reason.
 */
export function createProcessMonitor({
  rootPid,
  snapshot,
  asyncSnapshot,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  now = () => Date.now(),
  setInterval: schedule = globalThis.setInterval,
  clearInterval: unschedule = globalThis.clearInterval,
}) {
  if (!Number.isInteger(rootPid) || rootPid <= 0)
    throw new TypeError('createProcessMonitor requires the root PID')

  if (typeof snapshot !== 'function')
    throw new TypeError('createProcessMonitor requires a snapshot function')

  /**
   * Keyed by `${pid}:${createdAt}` so two incarnations of one PID both survive.
   * @type {Map<string, { pid: number, parentPid: number|undefined, createdAt: number|undefined, firstSeen: number }>}
   */
  const observed = new Map()
  const failures = []
  let polls = 0
  let timer
  let pending
  let startedAt
  let stoppedAt

  /**
   * Walk the parent links up to the root. Iterative with a visited set: a
   * malformed table that reports a cycle (a child claiming a descendant as its
   * parent) must not hang the gate.
   */
  function collect(table) {
    const byPid = new Map(table.map(entry => [entry.pid, entry]))
    const owned = new Set()
    for (const entry of table) {
      if (entry.pid === rootPid) {
        owned.add(entry.pid)
        continue
      }
      const visited = new Set()
      let cursor = entry
      while (cursor) {
        if (visited.has(cursor.pid))
          break
        visited.add(cursor.pid)
        if (cursor.parentPid === rootPid || owned.has(cursor.parentPid)) {
          owned.add(entry.pid)
          break
        }
        cursor = cursor.parentPid === undefined ? undefined : byPid.get(cursor.parentPid)
      }
    }
    return table.filter(entry => owned.has(entry.pid))
  }

  function record(table, stamp) {
    const owned = collect(table)
    for (const entry of owned) {
      // Keyed by PID *and* creation time: a recycled PID is a second, distinct
      // process, and both incarnations must reach the final teardown check.
      const key = `${entry.pid}:${entry.createdAt ?? 'unknown'}`
      if (!observed.has(key))
        observed.set(key, { ...entry, firstSeen: stamp })
    }
    return { ok: true, observed: owned.length }
  }

  function failed(error, stamp) {
    failures.push({ at: stamp, message: errorText(error) })
    return { ok: false, observed: 0 }
  }

  function poll() {
    polls++
    const stamp = now()
    try {
      return record(snapshot(), stamp)
    }
    catch (error) { return failed(error, stamp) }
  }

  function pollPeriodically() {
    if (!asyncSnapshot)
      return poll()
    if (pending)
      return
    polls++
    const stamp = now()
    const read = Promise.resolve().then(asyncSnapshot)
    pending = read.then(table => record(table, stamp)).catch(error => failed(error, stamp)).finally(() => {
      pending = undefined
    })
  }

  return {
    /** Take the first reading. Call this before launching, so the root is known. */
    start() {
      startedAt = now()
      poll()
      timer = schedule(pollPeriodically, intervalMs)
      if (typeof timer?.unref === 'function')
        timer.unref()
      return this
    },
    /** Stop polling. Idempotent, and safe to call from a `finally`. */
    stop() {
      if (timer !== undefined) {
        unschedule(timer)
        timer = undefined
      }
      stoppedAt = now()
    },
    async drain() {
      await pending
    },
    /** Force one more reading at a chosen moment (used right before teardown). */
    rescan() {
      return poll()
    },
    /**
     * Everything ever observed, deduplicated by PID *and* creation time.
     *
     * Two entries can share a PID; that is the point. The final teardown check
     * runs `classifyIdentity` on each, so a recycled number is reported as the
     * finished process it was instead of as a survivor.
     */
    identities() {
      return [...observed.values()]
        .map(({ firstSeen, ...identity }) => identity)
    },
    /** The same list with the poll that first saw each entry, for diagnostics. */
    observations() {
      return [...observed.values()].map(entry => ({ ...entry }))
    },
    stats() {
      return {
        intervalMs,
        polls,
        failures,
        startedAt,
        stoppedAt,
        // The blind window, stated as a number rather than implied.
        coverage: `poll requested every ${intervalMs} ms; overlapping queries are skipped and short-lived processes can be missed`,
      }
    },
  }
}

/**
 * The snapshot function the gate uses in production.
 *
 * Separated from `createProcessMonitor` so the monitor stays testable without a
 * Windows host. `execFileSync` is injected for the same reason.
 */
export function createPowerShellSnapshot({ execFileSync, processName = 'electron.exe' }) {
  return () => {
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', processTableCommand(processName)],
      { encoding: 'utf8', windowsHide: true },
    )
    return parseProcessTable(output)
  }
}
