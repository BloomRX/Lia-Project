import nodePath from 'node:path'
import process from 'node:process'

import { errorMessageFrom } from '@moeru/std'

/**
 * One structured, metadata-only line the resolver emits for diagnostics.
 * Owned locally by this module (Phase 7.8C): the old `./bootstrap` module
 * that used to define this shape was removed with the AllTalk bootstrap;
 * the runtime-root machinery is engine-neutral and keeps its own type.
 */
export interface RuntimeRootLogEntry {
  /** Machine-readable context (paths, ids), never secrets. */
  detail?: string
  /** What happened, e.g. 'migrated'. */
  event: string
  /** Which pipeline step produced it, e.g. 'runtime-root'. */
  step: string
}

/**
 * Where the canonical voice runtime root lives on Windows: `%LOCALAPPDATA%\Lia`.
 *
 * Two rounds of evidence shaped this. Round 5 proved the `@` of the scoped
 * Electron product name made the Miniconda silent installer exit 2 (same
 * args, same file, same machine - only the destination differed), and the
 * historical `atsetup.bat` installer script warned that special characters
 * in the path - `@` was literally in its `findstr` blacklist - can make an
 * installation fail. Round 7 (product decision): `%APPDATA%` (Roaming) is
 * for small per-user configuration that may follow the profile; a runtime
 * carrying Conda, Python and potentially several GB of models belongs in the
 * local, non-roaming profile directory. Hence `%LOCALAPPDATA%\Lia\runtimes`:
 * local, Lia-named, and free of every installer-blacklisted character.
 *
 * Off Windows the root is unchanged: `<userData>/runtimes`.
 *
 * The root is ENGINE-NEUTRAL (Phase 7.8): it carries no engine's name -
 * each modular voice engine (Kokoro first) composes its own subdirectory
 * beneath it when it lands. Legacy `%...%\runtimes\alltalk` trees are
 * migrated away, never read as an active install.
 */

/**
 * The exact special-character set from the historical installer script
 * (`atsetup.bat`, pin `f16117e9...`), copied rather than approximated:
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

/**
 * Resolves `%LOCALAPPDATA%` without inventing Electron path keys (round-7
 * hotfix 4, items A and B).
 *
 * `app.getPath(...)` does not know a 'localAppData' name - passing one throws
 * "Failed to get 'localAppData' path" on every Electron release. The
 * supported, documented source for the *local* (never-roaming) profile
 * directory on Windows is the environment block the OS gives every logged-in
 * process; this validates it before the layout resolver consumes it:
 *
 * - the variable must exist (its absence is a machine fault worth naming,
 *   not a silent roam);
 * - the value must be an absolute Windows path - drive-letter or UNC;
 * - the value must be free of the characters the legacy voice installer
 *   blacklist rejects (the same rule the `_local` choice exists to honour).
 *
 * Off Windows nothing reads this value, so an empty string is honest - the
 * layout resolver only consults it under `platform === 'win32'`.
 */
export interface ResolveLocalAppDataEnv {
  (name: string): string | undefined
}

export const LOCAL_APP_DATA_ENV_NAME = 'LOCALAPPDATA'

/** The profile-root variable the LocalAppData fallback derives from. */
export const USER_PROFILE_ENV_NAME = 'USERPROFILE'

/** Windows only: a rooted drive-letter or UNC path. */
function isAbsoluteWindowsPath(value: string): boolean {
  return /^(?:[a-z]:[/\\]|\\\\)/i.test(value)
}

// replace+compare (never .test on the /g singleton) so repeated calls cannot
// trip over a mutated lastIndex.
function hasForbiddenChars(value: string): boolean {
  return value.replace(ATSETUP_FORBIDDEN_PATH_CHARS, '') !== value
}

const FORBIDDEN_LIST = '!#$%&()*+,;<=>?@[\\]^\`{|}~'

/**
 * A single LocalAppData candidate, validated; the rejection reason (never
 * thrown directly) becomes the detail of the one operational error below.
 */
function validateLocalAppDataValue(value: string, source: string): { dir?: string, reason?: string } {
  const trimmed = value.trim()
  if (!trimmed)
    return { reason: `${source} is empty` }
  if (!isAbsoluteWindowsPath(trimmed))
    return { reason: `${source} ("${trimmed}") is not an absolute Windows path; it must look like "C:\\Users\\<you>\\AppData\\Local"` }
  if (hasForbiddenChars(trimmed))
    return { reason: `${source} ("${trimmed}") contains characters the voice installer cannot handle (${FORBIDDEN_LIST})` }
  return { dir: trimmed }
}

/** Paths the resolver is forbidden from ever substituting for LocalAppData. */
function composedUserProfileFallback(userProfile: string): { dir?: string, reason?: string } {
  // Never APPDATA: fallbacking to the ROAMING root would silently re-point
  // a multi-GB runtime at a folder Windows syncs across machines.
  const base = userProfile.trim().replace(/[\\/]+$/, '')
  return validateLocalAppDataValue(`${base}\\AppData\\Local`, `${USER_PROFILE_ENV_NAME} fallback`)
}

export function resolveLocalAppDataDir(
  platform: string = process.platform,
  env: ResolveLocalAppDataEnv = name => process.env[name],
): string {
  if (platform !== 'win32')
    return ''

  const reasons: string[] = []
  // Order (Windows integration hotfix, item 3): the profile's own env value
  // first, then ONE defensive fallback composed from the profile root.
  const primary = env(LOCAL_APP_DATA_ENV_NAME)
  if (primary?.trim()) {
    const primaryCheck = validateLocalAppDataValue(primary, LOCAL_APP_DATA_ENV_NAME)
    if (primaryCheck.dir)
      return primaryCheck.dir
    reasons.push(primaryCheck.reason!)
  }
  else {
    reasons.push(`${LOCAL_APP_DATA_ENV_NAME} is not present in the environment the Lia received`)
  }

  const userProfile = env(USER_PROFILE_ENV_NAME)
  if (userProfile?.trim()) {
    const fallback = composedUserProfileFallback(userProfile)
    if (fallback.dir)
      return fallback.dir
    reasons.push(fallback.reason!)
  }
  else {
    reasons.push(`${USER_PROFILE_ENV_NAME} is not present in the environment the Lia received`)
  }

  // One operational error (hotfix, item 4): the core cannot conclude a
  // Windows profile is broken merely because an INJECTED env object lacks
  // the key - so no more "reinstall your profile" instructions here. The
  // reasons stay in the message for logs, never as repair advice.
  throw new Error(`Could not resolve Windows LocalAppData for the Lia runtime (needed by the voice engine). Reasons: ${reasons.join('; ')}.`)
}

/** The `join`/`relative` pair of one `node:path` implementation. */
export interface RuntimeRootPathApi {
  join: (...segments: string[]) => string
  relative: (from: string, to: string) => string
}

/**
 * The engine-neutral voice-runtime home (Phase 7.8C):
 * `%LOCALAPPDATA%\Lia\runtimes` on Windows (POSIX: `<userData>/runtimes`).
 * Any concrete modular engine installs its tree UNDER this home - one
 * subdirectory per engine id. The legacy layout functions below keep
 * managing the frozen 'runtimes/alltalk' leaf for already-existing trees.
 */
export function resolveVoiceRuntimeHome(input: {
  env?: ResolveLocalAppDataEnv
  platform?: string
  userDataDir: string
}): string {
  const platform = input.platform ?? process.platform
  if (platform === 'win32')
    return nodePath.join(resolveLocalAppDataDir(platform, input.env), WINDOWS_RUNTIME_PRODUCT_DIR, 'runtimes')
  return nodePath.join(input.userDataDir, 'runtimes')
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
  log?: (entry: RuntimeRootLogEntry) => void
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
