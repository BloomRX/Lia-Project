/**
 * Process identity for the Electron gate.
 *
 * Why this exists
 * ---------------
 *
 * The gate used to answer "is that process still running?" with
 * `process.kill(pid, 0)`. That answers a different question: *is any process
 * using this number right now?* Windows recycles PIDs aggressively, and the
 * gate collects PIDs across three separate Electron lifetimes (two windows, a
 * restart and a crash), so a recycled number makes a finished process look
 * alive. The failure is loud (the gate fails), but it is not evidence: a PASS
 * only proved that no collision happened to occur that afternoon.
 *
 * An identity here is `(pid, createdAt)`:
 *
 *   - the PID, because that is what the OS hands out;
 *   - the creation time, because two processes sharing a PID necessarily have
 *     different creation times — that is the whole definition of reuse.
 *
 * The creation time is compared as an **exact instant**, never as a rounded or
 * "close enough" timestamp. Rounding would be the one thing that reintroduces
 * the collision this module exists to prevent: two incarnations of a PID a few
 * milliseconds apart are a real possibility on a busy machine, and a tolerance
 * window would call them the same process.
 *
 * Where the value comes from
 * --------------------------
 *
 * `Get-CimInstance Win32_Process` → `CreationDate`. That field arrives in a
 * different shape depending on the PowerShell host:
 *
 *   - Windows PowerShell 5.1 serializes `DateTime` as `\/Date(1730000000000)\/`
 *     (a .NET legacy format, epoch milliseconds, sometimes with escaped
 *     slashes);
 *   - PowerShell 7 writes ISO 8601 (`2026-11-06T03:22:58.9410000Z`) or an
 *     unambiguous local-offset form.
 *
 * Both are parsed here into epoch milliseconds. The comparison is done on the
 * parsed instant, so a 5.1 run and a 7 run of the same process compare equal.
 *
 * Clock source caveat, recorded deliberately: `CreationDate` is derived from
 * the kernel's process creation stamp, and the PowerShell call above returns it
 * unchanged. The gate never mixes it with `Get-Process.StartTime` or with
 * `Date.now()` on the gate's own side, because two different sources can round
 * differently and would produce false mismatches.
 *
 * Fail-closed on unknown
 * ----------------------
 *
 * A process whose creation time cannot be read gets `createdAt: undefined`. That
 * process is **never** reported as gone. It is reported as `unknown`, and the
 * gate treats `unknown` as "shutdown not confirmed" — it keeps polling and, if
 * the answer never improves, fails with a diagnostic naming the PID. Assuming
 * "gone" from a missing value would be exactly the false positive this module
 * was written to remove.
 */

import { errorText } from './errors.mjs'

/** The instant a PID was created, in epoch milliseconds. */
export const UNKNOWN_CREATED_AT = undefined

/**
 * Parse the `CreationDate` shapes PowerShell can produce.
 *
 * Returns epoch milliseconds, or `undefined` when the value is missing or not
 * understood. Never throws: a malformed value is a diagnostic, not a crash —
 * the caller decides whether an unreadable stamp is tolerable, and for this
 * gate it is not.
 */
export function parseCimDate(value) {
  if (value === null || value === undefined)
    return UNKNOWN_CREATED_AT

  // Already normalized by a caller that formatted the value in PowerShell.
  if (typeof value === 'number')
    return Number.isFinite(value) && value > 0 ? value : UNKNOWN_CREATED_AT

  if (typeof value !== 'string')
    return UNKNOWN_CREATED_AT

  const text = value.trim()
  if (text.length === 0)
    return UNKNOWN_CREATED_AT

  // 5.1 legacy: "/Date(1730000000000)/", sometimes with escaped or doubled
  // delimiters depending on the serializer and the nesting level.
  const legacy = /^\\?\/Date\((-?\d+)(?:[+-]\d{4})?\)\\?\/$/.exec(text)
  if (legacy) {
    const milliseconds = Number(legacy[1])
    return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : UNKNOWN_CREATED_AT
  }

  // PowerShell 7 ISO 8601. Fractional seconds vary in length (7 digits from
  // .NET), and the zone may be "Z" or "+HH:MM".
  //
  // `Date.parse` would silently accept a *date only* string and resolve it in
  // local time, which is exactly the kind of quiet normalization this module
  // must not do, so the shape is required to carry a time AND a zone.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text))
    return UNKNOWN_CREATED_AT

  const microseconds = /\.(\d+)/.exec(text)
  let normalized = text
  // .NET emits up to 7 fractional digits; ECMAScript reads 3 and would treat
  // the rest as garbage. Truncating (not rounding) keeps the instant stable and
  // makes two reads of the same process compare equal.
  if (microseconds && microseconds[1].length > 3)
    normalized = text.replace(`.${microseconds[1]}`, `.${microseconds[1].slice(0, 3)}`)

  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : UNKNOWN_CREATED_AT
}

/**
 * Build one identity from a `Win32_Process`-shaped row.
 *
 * Accepts the shapes this gate can produce: the raw CIM property names, the
 * ones the gate's own PowerShell projection emits (`ProcessId`, `Created`), and
 * the camelCase form used by the JS side.
 */
export function toIdentity(row) {
  if (!row || typeof row !== 'object')
    return undefined

  const rawPid = row.ProcessId ?? row.processId ?? row.pid
  const pid = typeof rawPid === 'string' ? Number(rawPid) : rawPid
  if (!Number.isInteger(pid) || pid <= 0)
    return undefined

  const rawParent = row.ParentProcessId ?? row.parentProcessId ?? row.ppid
  const parent = typeof rawParent === 'string' ? Number(rawParent) : rawParent

  const createdAt = parseCimDate(row.CreationDate ?? row.Created ?? row.createdAt ?? row.created)

  return {
    pid,
    parentPid: Number.isInteger(parent) && parent > 0 ? parent : undefined,
    createdAt,
  }
}

/**
 * Whether two identities denote the same process instance.
 *
 * Deliberately strict:
 *
 *   - different PIDs → different processes;
 *   - one of them without a creation time → **not** the same process. We cannot
 *     prove identity, so we do not claim it. A caller that wants "same PID, one
 *     side unknown" to count as a match would reintroduce the false positive.
 *   - the same instant, exactly → the same process.
 */
export function isSameProcess(left, right) {
  if (!left || !right)
    return false
  if (left.pid !== right.pid)
    return false
  if (left.createdAt === UNKNOWN_CREATED_AT || right.createdAt === UNKNOWN_CREATED_AT)
    return false
  return left.createdAt === right.createdAt
}

/** Whether an identity carries enough information to be checked at all. */
export function isVerifiable(identity) {
  return Boolean(identity) && Number.isInteger(identity.pid) && identity.createdAt !== UNKNOWN_CREATED_AT
}

/**
 * Classify a captured identity against the currently live table.
 *
 *   - `alive`   — the same instance is still running (PID **and** creation time);
 *   - `gone`    — either the PID is unused, or it is used by a different
 *                 instance (a recycled number): both mean *this* process ended;
 *   - `unknown` — identity incomplete, or the table could not be read. Never
 *                 collapsed into `gone`.
 *
 * `live` may be `undefined` to mean "the snapshot failed". That is `unknown`
 * for every entry, on purpose: a failing query is not evidence of shutdown.
 */
export function classifyIdentity(identity, live) {
  if (!identity || !Number.isInteger(identity.pid) || identity.pid <= 0)
    return { status: 'unknown', reason: 'no identity was captured' }

  if (!Array.isArray(live))
    return { status: 'unknown', reason: 'the live process table could not be read' }

  if (identity.createdAt === UNKNOWN_CREATED_AT)
    return { status: 'unknown', reason: 'the creation time of this process was never captured' }

  const candidates = live.filter(entry => entry && entry.pid === identity.pid)
  if (candidates.length === 0)
    return { status: 'gone', reason: 'no process holds this PID' }

  const same = candidates.find(entry => isSameProcess(identity, entry))
  if (same)
    return { status: 'alive', reason: 'the same process instance still holds this PID' }

  return {
    status: 'gone',
    reason: `the PID was recycled by ${candidates.length} other process(es) with a different creation time`,
  }
}

/**
 * Classify a whole captured set, preserving the four states the gate has to
 * report separately: main process, identified descendants, still alive, and
 * shutdown that could not be confirmed.
 *
 * `root` is the identity of the Electron main process. Everything else in
 * `processes` is a descendant the tracker observed.
 */
export function classifyAll({ root, processes, live }) {
  const entries = []
  if (root)
    entries.push({ role: 'main', identity: root })
  for (const identity of processes ?? []) {
    // A descendant can legitimately share the main's PID only if it IS the
    // main; skip the duplicate rather than reporting the same instance twice.
    if (root && isSameProcess(root, identity))
      continue
    entries.push({ role: 'descendant', identity })
  }

  const classified = entries.map(({ role, identity }) => ({
    role,
    pid: identity?.pid,
    createdAt: identity?.createdAt,
    ...classifyIdentity(identity, live),
  }))

  const unverifiable = entries
    .filter(({ identity }) => !isVerifiable(identity))
    .map(({ identity }) => identity?.pid)

  return {
    classified,
    alive: classified.filter(entry => entry.status === 'alive'),
    gone: classified.filter(entry => entry.status === 'gone'),
    unknown: classified.filter(entry => entry.status === 'unknown'),
    // A PID captured without a creation time can never be proven gone; name it
    // so the diagnostic says *why* rather than just "still alive".
    unverifiable,
  }
}

/**
 * The PowerShell projection this gate uses to read the process table.
 *
 * Kept here, next to the parser, so the format consumed and the format produced
 * cannot drift apart. `CreationDate` is converted to a canonical ISO string
 * **inside** PowerShell with `ToUniversalTime()`, which removes the 5.1/7
 * serialization difference at the source; `parseCimDate` still accepts the
 * legacy shape for the case where the conversion is not reached (a row whose
 * `CreationDate` is null, or an older host that ignores the projection).
 *
 * `-Depth 3` matters: `ConvertTo-Json` truncates to depth 2 by default and a
 * truncated row would silently lose the field the identity depends on.
 */
export function processTableCommand(processName = 'electron.exe') {
  const filter = `Name='${String(processName).replaceAll('\'', '\'\'')}'`
  return [
    `$rows = @(Get-CimInstance Win32_Process -Filter "${filter}"`,
    `  | Select-Object ProcessId, ParentProcessId, @{ n='Created'; e={ if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString("o") } else { $null } } })`,
    `ConvertTo-Json -InputObject $rows -Compress -Depth 3`,
  ].join(' ')
}

/**
 * Turn raw `Get-CimInstance | ConvertTo-Json` output into identities.
 *
 * PowerShell collapses a single-element array to a bare object and an empty
 * array to an empty string, so the shape is normalized here rather than at each
 * call site.
 *
 * Throws on unparseable JSON: a broken table is not "no processes". The caller
 * turns that into `unknown`, never into `gone`.
 */
export function parseProcessTable(output) {
  const text = typeof output === 'string' ? output.trim() : ''
  if (text.length === 0)
    return []

  let parsed
  try {
    parsed = JSON.parse(text)
  }
  catch (error) {
    throw new Error(`the process table could not be parsed as JSON: ${errorText(error)}`)
  }

  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows.map(toIdentity).filter(Boolean)
}
