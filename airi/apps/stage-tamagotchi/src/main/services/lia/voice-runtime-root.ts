import type { BootstrapLogEntry } from './voice-runtime-bootstrap'

import nodePath from 'node:path'
import process from 'node:process'

/**
 * Where the AllTalk runtime root lives, moved off `@proj-airi` on Windows.
 *
 * Round 5 proved this empirically (see
 * `docs/product/M1-PHASE5-R5-EXIT2-INTEGRIDADE-E-PATH.md`): with the official
 * silent switches, an integrity-verified installer and a clean win32 `/D`, the
 * Miniconda installer still exited 2 - until the probe installed into the same
 * arguments with a destination that did not contain `@`, where it exited 0 and
 * produced `_conda.exe`. The character comes from the scoped Electron product
 * name (`%APPDATA%\@proj-airi\...` is `app.getPath('userData')`), and the
 * pinned `atsetup.bat` itself warns that special characters in the path - `@`
 * is literally in its `findstr` blacklist - can make the installation fail.
 *
 * The fix is not to move only the conda prefix: the whole tree matters,
 * because atsetup's cwd, the conda env, pip and the runtime scripts all
 * inherit the same path. So on Windows the runtime root becomes a sibling
 * directory built from the userData-relative path with every blacklisted
 * character stripped (`@proj-airi\stage-tamagotchi` becomes
 * `proj-airi\stage-tamagotchi`), and everything else keeps using the two
 * functions in `voice-runtime-bootstrap-electron`, unchanged.
 */

/**
 * The exact special-character set from the pinned `atsetup.bat`
 * (`f16117e9...`), copied rather than approximated:
 *
 * ```
 * findstr /R /C:"[!#\$%&()\*+,;<=>?@\[\]\^`{|}~]"
 * ```
 *
 * Run together so one pass collapses `@@` into a single `-`.
 */
export const ATSETUP_FORBIDDEN_PATH_CHARS = /[!#$%&()*+,;<=>?@[\]^`{|}~]+/g

/** Strips the atsetup-blacklisted characters from one path segment. */
export function sanitizeWindowsRuntimeSegment(segment: string): string {
  return segment
    .replace(ATSETUP_FORBIDDEN_PATH_CHARS, '-')
    .replace(/^-+|-+$/g, '')
}

/** Applies the same rule to every segment of a relative path. */
export function sanitizeWindowsRuntimeRelativePath(relativePath: string): string {
  return relativePath
    .split(/[\\/]+/)
    .map(sanitizeWindowsRuntimeSegment)
    .filter(segment => segment.length > 0)
    .join('/')
}

/** The `join`/`relative` pair of one `node:path` implementation. */
export interface RuntimeRootPathApi {
  join: (...segments: string[]) => string
  relative: (from: string, to: string) => string
}

export interface RuntimeRootLayout {
  /** Where pre-round-6 builds put the tree. Equals `rootDir` off Windows. */
  legacyRootDir: string
  /** The root every consumer uses from round 6 on. */
  rootDir: string
}

/**
 * Resolves both roots. `appDataDir`/`userDataDir`/`platform` are parameters
 * (and `pathApi` is injectable) so a Node test can exercise Windows semantics
 * on a POSIX machine - the same discipline that caught separator bugs before a
 * user did.
 */
export function resolveRuntimeRootLayout(input: {
  appDataDir: string
  userDataDir: string
  pathApi?: RuntimeRootPathApi
  platform?: string
}): RuntimeRootLayout {
  const pathApi = input.pathApi ?? nodePath
  const platform = input.platform ?? process.platform
  const legacyRootDir = pathApi.join(input.userDataDir, 'runtimes', 'alltalk')
  if (platform !== 'win32') {
    return { legacyRootDir, rootDir: legacyRootDir }
  }
  const userDataRelative = pathApi.relative(input.appDataDir, input.userDataDir)
  const sanitizedRelative = sanitizeWindowsRuntimeRelativePath(userDataRelative)
  return {
    legacyRootDir,
    rootDir: pathApi.join(input.appDataDir, sanitizedRelative, 'runtimes', 'alltalk'),
  }
}

export interface RuntimeRootMigrationFacts {
  from: string
  migrated: boolean
  reason?: string
  to: string
}

export interface RuntimeRootMigrationDeps {
  existsSync: (path: string) => boolean
  mkdirSync: (path: string) => void
  renameSync: (from: string, to: string) => void
  log?: (entry: BootstrapLogEntry) => void
}

/**
 * One-shot move of a tree created by a pre-round-6 build.
 *
 * A rename, not a copy: same volume by construction (both roots live under
 * `%APPDATA%`), so it is an O(1) metadata operation even for a multi-GB tree,
 * and the installer/state files move together - no 97 MB re-download.
 * Already-migrated (`root-present`) and fresh-install (`legacy-absent`) runs
 * are no-ops. A failed rename propagates: falling back to the old path would
 * silently resurrect the exit=2 bug.
 */
export function migrateLegacyRuntimeRootSync(
  layout: RuntimeRootLayout,
  deps: RuntimeRootMigrationDeps,
): RuntimeRootMigrationFacts {
  const { legacyRootDir, rootDir } = layout
  if (rootDir === legacyRootDir) {
    return { from: legacyRootDir, migrated: false, reason: 'same-path', to: rootDir }
  }
  if (deps.existsSync(rootDir)) {
    return { from: legacyRootDir, migrated: false, reason: 'root-present', to: rootDir }
  }
  if (!deps.existsSync(legacyRootDir)) {
    return { from: legacyRootDir, migrated: false, reason: 'legacy-absent', to: rootDir }
  }
  // rename does not create intermediate parents; separator-agnostic so a
  // POSIX test with a win32 string still computes the same parent.
  deps.mkdirSync(rootDir.replace(/[\\/][^\\/]+$/, ''))
  deps.renameSync(legacyRootDir, rootDir)
  deps.log?.({
    detail: `from=${legacyRootDir} to=${rootDir}`,
    event: 'migrated',
    step: 'runtime-root',
  })
  return { from: legacyRootDir, migrated: true, to: rootDir }
}
