import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { env } from 'node:process'

/**
 * Canonical Lia product paths (Phase 7).
 *
 * One product, one home: everything Lia owns - product config, imported
 * voices, the secret vault ciphertext - lives under a single user-data root
 * (`<lia-user-data>`), and managed voice engines under the engine-neutral
 * runtime home (resolved by `resolveVoiceRuntimeHome` in
 * `../bootstrap/runtime-root`, `%LOCALAPPDATA%\Lia\runtimes` on Windows).
 * The Lia Launcher and the AIRI stage host MUST read the same files: the
 * launcher never forks the user's data into a second location.
 *
 * Resolution order for the user-data root:
 *   1. `LIA_USER_DATA` env (explicit override - diagnostics, QA, portable runs);
 *   2. `APP_USER_DATA_PATH` env (the existing AIRI override, so a launcher that
 *      reuses the same env contract sees exactly what AIRI sees);
 *   3. the first well-known %APPDATA% candidate that ALREADY contains a
 *      `lia-product.json` (so we attach to existing data wherever it was born);
 *   4. `%APPDATA%\Lia` - the product default for a fresh machine.
 */

export const LIA_USER_DATA_ENV_NAME = 'LIA_USER_DATA'
export const LIA_PRODUCT_DIR_NAME = 'Lia'

/** File names (not paths) inside `<lia-user-data>`. */
export const LIA_PRODUCT_CONFIG_FILENAME = 'lia-product.json'
export const LIA_VAULT_FILENAME = 'lia-secrets.json'
export const LIA_VOICES_DIR_NAME = 'lia-voices'

export interface LiaProductPaths {
  /** The single Lia user-data root. */
  userDataDir: string
  /** `<lia-user-data>/lia-product.json` - the canonical product document. */
  productConfigFile: string
  /** `<lia-user-data>/lia-voices` - the canonical voice profile library root. */
  voicesRoot: string
  /** `<lia-user-data>/lia-secrets.json` - the canonical secret vault ciphertext. */
  vaultFile: string
  /** How `userDataDir` was chosen, for diagnostics that a user can act on. */
  source: 'lia-user-data-env' | 'app-user-data-env' | 'existing-data-candidate' | 'product-default'
}

export interface LiaProductPathsDeps {
  env?: Record<string, string | undefined>
  exists?: (path: string) => boolean
}

/**
 * The well-known candidates, most specific first. This list exists because the
 * product has been carried by different hosts during its life (dev Electron,
 * packaged AIRI builds, QA overrides) and existing data must remain canonical
 * wherever it currently is - this is a finder, never a mover.
 */
export function liaUserDataCandidates(deps: LiaProductPathsDeps = {}): string[] {
  const environment = deps.env ?? env
  const appData = environment.APPDATA ?? environment.APPDATA_LOCAL
  if (!appData)
    return []
  return [
    join(appData, 'Lia'),
    join(appData, 'lia'),
    join(appData, '@proj-airi/stage-tamagotchi'),
    join(appData, 'stage-tamagotchi'),
    join(appData, 'Electron'),
  ]
}

export function liaProductPaths(deps: LiaProductPathsDeps = {}): LiaProductPaths {
  const environment = deps.env ?? env
  const exists = deps.exists ?? ((p: string) => existsSync(p))

  const explicit = environment[LIA_USER_DATA_ENV_NAME]?.trim()
  if (explicit)
    return pathsFor(explicit, 'lia-user-data-env')

  const shared = environment.APP_USER_DATA_PATH?.trim()
  if (shared)
    return pathsFor(shared, 'app-user-data-env')

  for (const candidate of liaUserDataCandidates(deps)) {
    if (exists(join(candidate, LIA_PRODUCT_CONFIG_FILENAME)))
      return pathsFor(candidate, 'existing-data-candidate')
  }

  const appData = environment.APPDATA ?? environment.APPDATA_LOCAL
  if (!appData) {
    throw new Error(
      'Neither APPDATA nor an explicit Lia user-data override is set, so the product home cannot be resolved. '
      + `Set ${LIA_USER_DATA_ENV_NAME} to an existing or creatable folder.`,
    )
  }
  return pathsFor(join(appData, LIA_PRODUCT_DIR_NAME), 'product-default')
}

function pathsFor(userDataDir: string, source: LiaProductPaths['source']): LiaProductPaths {
  return {
    productConfigFile: join(userDataDir, LIA_PRODUCT_CONFIG_FILENAME),
    source,
    userDataDir,
    vaultFile: join(userDataDir, LIA_VAULT_FILENAME),
    voicesRoot: join(userDataDir, LIA_VOICES_DIR_NAME),
  }
}
