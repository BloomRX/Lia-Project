/**
 * Archive path validation.
 *
 * ## Why this exists as a separate pure module
 *
 * A QA run on real Windows failed with "archive entry escapes the destination
 * directory" on the very first entry of a legitimate GitHub archive. Nothing was
 * attacking anything: the guard compared an un-normalised destination against a
 * normalised one, so it rejected every entry.
 *
 * The fix must not be to loosen the guard. It has to keep rejecting traversal and
 * still accept the archive GitHub actually produces. Getting both right at once is
 * fiddly enough that it belongs in a pure function with tests, not inline in a
 * streaming callback where it can only be exercised by unzipping a real file.
 *
 * ## The two distinct bugs this replaces
 *
 * 1. **Separator mismatch.** The destination was built by string concatenation
 *    (`C:\...\alltalk/app`) while the join normalised to backslashes
 *    (`C:\...\alltalk\app\x`). `startsWith` was false, so everything was rejected.
 *    The destination is now passed through `resolve` before any comparison.
 *
 * 2. **Prefix without a boundary.** `target.startsWith(root)` accepts
 *    `C:\Lia\runtime-evil\x` when the root is `C:\Lia\runtime`. The comparison is
 *    now `target === root` or `target.startsWith(root + sep)`.
 *
 * Both are visible on Windows and invisible on the POSIX machine the tests were
 * originally written on, which is exactly why the platform is injected here
 * rather than read from `process`.
 */

/** The subset of `node:path` this module needs, so either implementation fits. */
export interface PathLike {
  resolve: (...parts: string[]) => string
  sep: string
}

export type ArchiveRejectReason
  = | 'absolute'
    | 'drive-letter'
    | 'empty'
    | 'outside-root'
    | 'parent-traversal'
    | 'unc'

export type ArchiveEntryDecision
  = | {
    /** True for the archive's own root-directory marker; nothing to write. */
    isRootMarker: boolean
    ok: true
    raw: string
    relative: string
    target: string
  }
  | {
    /** Resolved path that was refused, when one could be computed. */
    computedTarget?: string
    ok: false
    /** Entry name after separator normalisation, for diagnostics. */
    normalised: string
    raw: string
    reason: ArchiveRejectReason
  }

/**
 * Rejects the entry, with enough context to diagnose it.
 *
 * Only the first rejection is ever logged by the caller - a 700-entry archive
 * would otherwise produce 700 identical lines.
 */
function refuse(
  raw: string,
  normalised: string,
  reason: ArchiveRejectReason,
  computedTarget?: string,
): ArchiveEntryDecision {
  return { computedTarget, normalised, ok: false, raw, reason }
}

/**
 * Whether `target` lies within `root`, comparing with a real separator boundary.
 *
 * A bare `target.startsWith(root)` is wrong, and wrong in the direction that
 * matters: `C:\runtime` is a string prefix of `C:\runtime-evil\x`, so the naive
 * form reports a sibling directory as being inside the root. Appending the
 * separator closes that, and the equality case keeps the root itself valid.
 *
 * Exported and tested directly rather than only through `resolveArchiveEntry`,
 * because with `..` refused a resolved entry can no longer leave the root - which
 * makes this comparison unreachable through the entry name alone. Left untested it
 * could be silently weakened to the naive form and every test would still pass.
 */
export function isInsideRoot(target: string, root: string, pathImpl: PathLike): boolean {
  return target === root || target.startsWith(`${root}${pathImpl.sep}`)
}

/**
 * Validates one archive entry and resolves where it would land.
 *
 * Validation happens **before** resolution, not after. Resolving first and then
 * inspecting the result is the classic way this goes wrong: `resolve` happily
 * collapses `..`, so by the time you look, the evidence of the attempt is gone and
 * you are left reasoning about a path that may already be outside the root.
 */
export function resolveArchiveEntry(params: {
  entryName: string
  pathImpl: PathLike
  /** Resolved destination root. */
  rootDir: string
  /** Wrapper directory to strip, when the archive has one. */
  stripRoot?: string
}): ArchiveEntryDecision {
  const { entryName, pathImpl: p, stripRoot } = params
  const raw = entryName

  // Normalise the root too. This is the actual Windows fix: a root assembled with
  // forward slashes would otherwise never match a backslash-normalised target.
  const root = p.resolve(params.rootDir)

  if (!raw)
    return refuse(raw, raw, 'empty')

  // On Windows a backslash is a separator, so `..\evil` is traversal. On POSIX it
  // is an ordinary filename character, so it is left alone rather than rewritten -
  // turning it into a separator there would change what file gets created.
  const normalised = p.sep === '\\' ? raw.replace(/\\/g, '/') : raw

  // UNC must be tested before the single-slash case: `//server/share` also starts
  // with `/`, so checking that first would report every UNC path as merely
  // absolute and lose the distinction in the log.
  if (normalised.startsWith('//'))
    return refuse(raw, normalised, 'unc')

  if (normalised.startsWith('/'))
    return refuse(raw, normalised, 'absolute')

  if (/^[a-z]:/i.test(normalised))
    return refuse(raw, normalised, 'drive-letter')

  const parts = normalised.split('/').filter(Boolean)
  if (parts.length === 0)
    return refuse(raw, normalised, 'empty')

  // Any `..` segment is refused outright rather than resolved away. A legitimate
  // archive has no reason to contain one, and refusing keeps the intent visible in
  // the log instead of silently normalising an escape into something harmless.
  if (parts.includes('..'))
    return refuse(raw, normalised, 'parent-traversal')

  const effective = stripRoot && parts[0] === stripRoot ? parts.slice(1) : parts

  // The wrapper directory's own marker, e.g. `alltalk_tts-<sha>/`.
  if (effective.length === 0) {
    return { isRootMarker: true, ok: true, raw, relative: '', target: root }
  }

  const target = p.resolve(root, ...effective)

  if (!isInsideRoot(target, root, p))
    return refuse(raw, normalised, 'outside-root', target)

  return { isRootMarker: false, ok: true, raw, relative: effective.join('/'), target }
}

/**
 * Decides whether the archive has a wrapper directory to strip.
 *
 * GitHub wraps everything in `<repo>-<sha>/`. Stripping it is what lets the tree
 * land directly in the destination - but stripping the first component blindly
 * would silently eat a real directory from an archive that has no wrapper, which
 * is why the condition is checked rather than assumed.
 *
 * Returns `undefined` when there is no wrapper to strip. That is not an error: an
 * archive whose entries already sit at the top level is perfectly legitimate and
 * simply needs no stripping. What is *not* done is guessing.
 */
export function detectStripRoot(entryNames: string[], pathImpl: PathLike): string | undefined {
  if (entryNames.length === 0)
    return undefined

  const roots = new Set<string>()
  let hasNested = false

  for (const name of entryNames) {
    const normalised = pathImpl.sep === '\\' ? name.replace(/\\/g, '/') : name
    const parts = normalised.split('/').filter(Boolean)
    if (parts.length === 0)
      continue
    roots.add(parts[0])
    if (parts.length > 1)
      hasNested = true
  }

  // More than one first component means there is no single wrapper to remove.
  if (roots.size !== 1)
    return undefined

  // Nothing nested means the single component is a top-level file, not a wrapper.
  if (!hasNested)
    return undefined

  const [root] = [...roots]

  // The wrapper must itself be an ordinary name. If it is not, stripping it would
  // be laundering something odd, so it is left in place for the entry check to
  // reject on its own terms.
  if (root === '..' || root === '.' || /^[a-z]:/i.test(root) || root.startsWith('/'))
    return undefined

  return root
}

/**
 * Whether an entry is a symbolic link.
 *
 * yauzl exposes no helper for this, so it is read from the ZIP's external file
 * attributes: for entries made by a Unix tool the high 16 bits hold the mode, and
 * `S_IFLNK` marks a symlink.
 *
 * This matters because filename validation does not protect against it. A symlink
 * with a perfectly innocent name can point anywhere, and the traversal check above
 * only ever sees the link's own path - never its target.
 */
export function isSymlinkEntry(entry: {
  externalFileAttributes: number
  versionMadeBy: number
}): boolean {
  const S_IFLNK = 0o120_000
  const S_IFMT = 0o170_000
  const MADE_BY_UNIX = 3

  // Attributes are only meaningful for Unix-made entries. An MS-DOS entry carries
  // a different layout there, and reading a mode out of it would be guesswork.
  if ((entry.versionMadeBy >>> 8) !== MADE_BY_UNIX)
    return false

  return ((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK
}
