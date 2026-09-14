import type { BootstrapLogEntry } from './voice-runtime-bootstrap'

import nodePath from 'node:path'
import process from 'node:process'

import { errorMessageFrom } from '@moeru/std'

/**
 * Where the AllTalk runtime root lives on Windows: `%LOCALAPPDATA%\Lia`.
 *
 * Two rounds of evidence shaped this. Round 5 proved the `@` of the scoped
 * Electron product name made the Miniconda silent installer exit 2 (same
 * args, same file, same machine - only the destination differed), and the
 * pinned `atsetup.bat` itself warns that special characters in the path -
 * `@` is literally in its `findstr` blacklist - can make the installation
 * fail. Round 7 (product decision): `%APPDATA%` (Roaming) is for small
 * per-user configuration that may follow the profile; a runtime carrying
 * Conda, Python and potentially several GB of models belongs in the local,
 * non-roaming profile directory. Hence `%LOCALAPPDATA%\Lia\runtimes\alltalk`:
 * local, Lia-named, and free of every atsetup-blacklisted character.
 *
 * Off Windows the root is unchanged: `<userData>/runtimes/alltalk`.
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

/**
 * The product directory inside `%LOCALAPPDATA%`. `Lia`, not the scoped
 * package name: no `@`, nothing from the blacklist above.
 */
export const WINDOWS_RUNTIME_PRODUCT_DIR = 'Lia'

/** The `join`/`relative` pair of one `node:path` implementation. */
export interface RuntimeRootPathApi {
  join: (...segments: string[]) => string
  relative: (from: string, to: string) => string
}

export interface RuntimeRootLayout {
  /**
   * Where previous builds may already have put the tree, most recent first.
   * Empty off Windows, where the root never moved.
   */
  legacyRootDirs: string[]
  /** The root every consumer uses from round 7 on. */
  rootDir: string
}

/**
 * Resolves the effective root and every legacy candidate.
 * `appDataDir`/`localAppDataDir`/`userDataDir`/`platform` are parameters (and
 * `pathApi` is injectable) so a Node test can exercise Windows semantics on a
 * POSIX machine - the same discipline that caught several of these bugs
 * before a user did.
 */
export function resolveRuntimeRootLayout(input: {
  appDataDir: string
  localAppDataDir: string
  pathApi?: RuntimeRootPathApi
  platform?: string
  userDataDir: string
}): RuntimeRootLayout {
  const pathApi = input.pathApi ?? nodePath
  const platform = input.platform ?? process.platform
  const userDataRoot = pathApi.join(input.userDataDir, 'runtimes', 'alltalk')
  if (platform !== 'win32') {
    return { legacyRootDirs: [], rootDir: userDataRoot }
  }
  // Legacy candidates, most recent first: the round-6 root (the userData
  // relative path, sanitized of its '@', under Roaming), then the original
  // pre-round-6 userData root with the '@' still in it.
  const userDataRelative = pathApi.relative(input.appDataDir, input.userDataDir)
  const roundSixRoot = pathApi.join(input.appDataDir, sanitizeWindowsRuntimeRelativePath(userDataRelative), 'runtimes', 'alltalk')
  return {
    legacyRootDirs: [roundSixRoot, userDataRoot],
    rootDir: pathApi.join(input.localAppDataDir, WINDOWS_RUNTIME_PRODUCT_DIR, 'runtimes', 'alltalk'),
  }
}

export interface RuntimeRootMigrationFacts {
  from?: string
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
 * One-shot move of a tree created by an older build.
 *
 * A rename, not a copy: every root under `%APPDATA%`/`%LOCALAPPDATA%` lives
 * on the same volume by construction, so it is an O(1) metadata operation
 * even for a multi-GB tree, and the installer/state files move together - no
 * re-download. Already-migrated (`root-present`) and fresh-install
 * (`legacy-absent`) runs are no-ops, and an existing destination is never
 * overwritten. A failed rename propagates: falling back to a legacy path
 * would silently resurrect the bugs it carried.
 */
export function migrateLegacyRuntimeRootsSync(
  layout: RuntimeRootLayout,
  deps: RuntimeRootMigrationDeps,
): RuntimeRootMigrationFacts {
  const { legacyRootDirs, rootDir } = layout
  if (legacyRootDirs.length === 0 || legacyRootDirs.includes(rootDir)) {
    return { migrated: false, reason: 'same-path', to: rootDir }
  }
  if (deps.existsSync(rootDir)) {
    return { migrated: false, reason: 'root-present', to: rootDir }
  }
  const source = legacyRootDirs.find(dir => deps.existsSync(dir))
  if (source === undefined) {
    return { migrated: false, reason: 'legacy-absent', to: rootDir }
  }
  // rename does not create intermediate parents; separator-agnostic so a
  // POSIX test with a win32 string still computes the same parent.
  deps.mkdirSync(rootDir.replace(/[\\/][^\\/]+$/, ''))
  deps.renameSync(source, rootDir)
  deps.log?.({
    detail: `from=${source} to=${rootDir}`,
    event: 'migrated',
    step: 'runtime-root',
  })
  return { from: source, migrated: true, to: rootDir }
}

/** How the adoption of a runtime root ended, for logs and for tests. */
export interface RuntimeRootDecision {
  adopted: 'migrated' | 'root-present' | 'legacy-absent' | 'same-path' | 'fallback-legacy' | 'fallback-fresh-root'
  /**
   * Why the migration could not run, when a fallback fired. Kept for the log:
   * the panel keeps working, the technical reason belongs to support.
   */
  error?: string
  rootDir: string
}

/** Matches exactly one forbidden character, for candidate vetting. */
const ATSETUP_FORBIDDEN_PATH_CHARS_SINGLE = /[!#$%&()*+,;<=>?@[\]^`{|}~]/

/**
 * Picks the runtime root this session, migrating when possible, WITHOUT EVER
 * THROWING the app out of shape (round-7 addendum: a failed rename killed
 * the install panel on machines where something in the old tree was locked -
 * a leftover voice server, AV, a OneDrive sync handle - because the throw
 * never stopped, the runtime probe IPC rejected forever and the card with
 * the Install button never mounted).
 *
 * Contract:
 * - Migration succeeds (or is a no-op): the new root wins, as designed.
 * - Migration throws: adopt the most recent legacy root that could still host
 *   the official continuation - i.e. free of the installers' forbidden
 *   characters. For the tree as shipped, that is exactly the round-6 root;
 *   the original `@proj-airi` path is never chosen again.
 * - No usable legacy: adopt the new root un-migrated. Nothing is deleted and
 *   nothing is copied; the fallback is session-local, so the next process
 *   start retries the rename (the lock was probably temporary).
 */
export function adoptRuntimeRootSync(
  layout: RuntimeRootLayout,
  deps: RuntimeRootMigrationDeps,
): RuntimeRootDecision {
  try {
    const migration = migrateLegacyRuntimeRootsSync(layout, deps)
    if (migration.migrated)
      return { adopted: 'migrated', rootDir: migration.to }
    return { adopted: migration.reason as RuntimeRootDecision['adopted'] ?? 'root-present', rootDir: migration.to }
  }
  catch (error) {
    const message = errorMessageFrom(error)
    const fallback = layout.legacyRootDirs.find(dir =>
      dir !== layout.rootDir
      && !ATSETUP_FORBIDDEN_PATH_CHARS_SINGLE.test(dir)
      && deps.existsSync(dir))
    if (fallback !== undefined) {
      deps.log?.({
        detail: `adopted=${fallback} error=${message}`,
        event: 'migration-failed-fallback-legacy',
        step: 'runtime-root',
      })
      return { adopted: 'fallback-legacy', error: message, rootDir: fallback }
    }
    deps.log?.({
      detail: `adopted=${layout.rootDir} (nothing migrated, nothing deleted) error=${message}`,
      event: 'migration-failed-fallback-fresh-root',
      step: 'runtime-root',
    })
    return { adopted: 'fallback-fresh-root', error: message, rootDir: layout.rootDir }
  }
}
