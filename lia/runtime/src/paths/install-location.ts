/**
 * Phase 7.4 (Part G/H/K): user-chosen HEAVY RUNTIME location validation.
 *
 * The product document may pin `voice.runtime.installDir` to a
 * non-default root (e.g. `D:\Lia\Voice Runtime`). This module is the ONE
 * place that decides whether such a path is *shaped* acceptably - before
 * it ever reaches the document. It answers exactly two questions:
 *
 * 1. `classifyInstallLocation` - pure lexical contract: absolute, not a
 *    filesystem or system root, length-bounded. Platform-aware (Windows
 *    drive letters / UNC vs POSIX), so a QA rig on Linux can exercise the
 *    Windows rules deterministically.
 * 2. `inspectInstallLocationTarget` - the one filesystem fact: a path that
 *    exists must be a DIRECTORY, never a file. Missing is fine (a future
 *    install target). "Writable" is deliberately NOT probed here: probing
 *    creation would mutate the user's disk while merely browsing, and the
 *    installer performs the real writable check at install time.
 *
 * Marker checks ("is the runtime REALLY installed here") stay where they
 * always were: the host's install-inspection seam (`inspectInstallImpl` in
 * the launcher; whatever the hosted engine declares, Phase 7.8E). Directory
 * existence never implies installed (Part I of the brief).
 */

export type InstallLocationRejectReason
  = | 'empty'
    | 'not-absolute'
    | 'filesystem-root'
    | 'system-root'
    | 'too-long'

export type InstallLocationDecision
  = | { status: 'ok', normalized: string }
    | { status: 'invalid', reason: InstallLocationRejectReason }

const MAX_LOCATION_CHARS = 260
const MIN_LOCATION_CHARS_WIN = 4 // shortest meaningful: `D:\x`
const MIN_LOCATION_CHARS_POSIX = 2 // shortest meaningful: `/x`

/** Drive roots (`C:\`, `D:/`) and the POSIX root are never a valid target. */
function segmentsOf(normalized: string): string[] {
  return normalized.split('/').filter(segment => segment.length > 0)
}

const WINDOWS_SYSTEM_PREFIXES = [
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  'recovery',
  'system volume information',
]

const POSIX_SYSTEM_PREFIXES = [
  'usr',
  'bin',
  'sbin',
  'etc',
  'boot',
  'proc',
  'sys',
  'dev',
  'var',
  'opt',
  'system',
  'library',
  'applications',
]

/**
 * Normalizes separators and duplicate slashes lexically (no `path.normalize`
 * platform bias), uppercases nothing (case folding belongs to Windows
 * compare logic, not storage), and strips trailing separators - but never
 * the ONLY separator, so `/` stays inspectable as the POSIX root.
 */
function lexicalNormalize(raw: string): string {
  const collapsed = raw.trim().replace(/[\\/]+/g, '/')
  if (collapsed.length <= 1)
    return collapsed
  const stripped = collapsed.replace(/\/+$/, '')
  // Stripping must never erase a drive letter's anchor: `C:/` keeps its
  // separator so the fs-root check sees a real drive root, not a bare `C:`.
  return stripped.endsWith(':') ? collapsed : stripped
}

export function classifyInstallLocation(raw: string, platform: string): InstallLocationDecision {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed)
    return { status: 'invalid', reason: 'empty' }

  const normalized = lexicalNormalize(trimmed)
  if (normalized.length > MAX_LOCATION_CHARS)
    return { status: 'invalid', reason: 'too-long' }

  if (platform === 'win32') {
    const driveMatch = /^[A-Z]:\//i.exec(normalized)
    // UNC (`\\server\share…`) is deliberately NOT accepted: the contract is
    // an absolute *local* filesystem path - the heavy runtime does not run
    // from a network share.
    if (!driveMatch)
      return { status: 'invalid', reason: 'not-absolute' }
    if (normalized.length < MIN_LOCATION_CHARS_WIN)
      return { status: 'invalid', reason: 'filesystem-root' }

    const segments = segmentsOf(normalized).slice(1) // after `D:`
    if (segments.length === 0)
      return { status: 'invalid', reason: 'filesystem-root' }
    const first = segments[0].toLowerCase()
    if (WINDOWS_SYSTEM_PREFIXES.includes(first))
      return { status: 'invalid', reason: 'system-root' }
    return { status: 'ok', normalized }
  }

  if (!normalized.startsWith('/'))
    return { status: 'invalid', reason: 'not-absolute' }
  if (normalized.length < MIN_LOCATION_CHARS_POSIX)
    return { status: 'invalid', reason: 'filesystem-root' }
  const first = segmentsOf(normalized)[0]?.toLowerCase() ?? ''
  if (POSIX_SYSTEM_PREFIXES.includes(first))
    return { status: 'invalid', reason: 'system-root' }
  return { status: 'ok', normalized }
}

export interface InstallLocationFsDeps {
  /** fs.exists-style check. */
  exists?: (path: string) => Promise<boolean>
  /** True when `path` is a directory (only consulted when it exists). */
  isDirectory?: (path: string) => Promise<boolean>
}

export type InstallLocationTargetDecision
  = | { status: 'ok' }
    | { status: 'invalid', reason: 'exists-as-file' }

/**
 * The single filesystem gate: existing-but-a-file is rejected; missing is a
 * valid future install root. Directory existence is NOT treated as
 * installed - that proof remains the marker set's job.
 */
export async function inspectInstallLocationTarget(path: string, deps: InstallLocationFsDeps = {}): Promise<InstallLocationTargetDecision> {
  const exists = deps.exists ?? (async () => false)
  const isDirectory = deps.isDirectory ?? (async () => true)
  return await exists(path)
    ? (await isDirectory(path) ? { status: 'ok' as const } : { reason: 'exists-as-file' as const, status: 'invalid' as const })
    : { status: 'ok' as const }
}
