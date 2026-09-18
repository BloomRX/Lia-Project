import process from 'node:process'

import { join } from 'node:path'

import { RUNTIME_APP_SUBDIR } from '../bootstrap/bootstrap'
import { resolveLocalAppDataDir, WINDOWS_RUNTIME_PRODUCT_DIR } from '../bootstrap/runtime-root'

/**
 * The canonical Lia RUNTIME paths (Windows integration hotfix, Phase 7.1).
 *
 * The product document's home and the voice runtime's home are two
 * different roots on purpose: the document is small roaming config, the
 * runtime is several GB of local, never-roaming machinery. Round 7 fixed
 * the Windows location as `%LOCALAPPDATA%\Lia\runtimes\alltalk` - and this
 * module is the ONE place every consumer derives it from. Nobody
 * reconstructs an install location out of the Electron `userData` path,
 * the Roaming stage-tamagotchi legacy root, or a local constant again:
 * derivation from the wrong root is exactly the bug this hotfix fixes.
 *
 * Layout, as the installer writes it:
 *   <runtimeRoot>/            - e.g. %LOCALAPPDATA%\Lia\runtimes\alltalk
 *     state.json              - the bootstrap's install record
 *     app/                    - RUNTIME_APP_SUBDIR: the AllTalk tree itself
 *       script.py, system/, voices/, alltalk_environment/, start_alltalk.bat
 *
 * Detection (what makes it "installed") stays where it always was:
 * `inspectAllTalkInstall` in ../alltalk/runtime. Paths point at where the
 * runtime lives; markers prove it is really there.
 */

export interface LiaRuntimePathsDeps {
  /** Environment block (tests inject fake Windows homes). */
  env?: Record<string, string | undefined>
  /** `win32` activates the LOCALAPPDATA rule; anything else is the POSIX rule. */
  platform?: string
  /**
   * The product user-data home (the POSIX runtime root lives under it;
   * Windows NEVER derives from it - deriving from it is the bug).
   */
  userDataDir?: string
}

function platformOf(deps: LiaRuntimePathsDeps): string {
  return deps.platform ?? process.platform
}

/**
 * The RUNTIME ROOT: the directory that holds `state.json` and `app/`.
 *
 * win32: `%LOCALAPPDATA%\Lia\runtimes\alltalk` - resolved strictly from the
 * validated LOCALAPPDATA env (never from userData, never from Roaming).
 * posix: `<userDataDir>/runtimes/alltalk` - the unchanged legacy rule.
 */
export function resolveLiaRuntimeRoot(deps: LiaRuntimePathsDeps = {}): string {
  if (platformOf(deps) === 'win32') {
    const env = deps.env
    const localAppData = resolveLocalAppDataDir('win32', name => env ? env[name] : process.env[name])
    return join(localAppData, WINDOWS_RUNTIME_PRODUCT_DIR, 'runtimes', 'alltalk')
  }
  const userData = deps.userDataDir?.trim()
  if (!userData) {
    throw new Error('The product user-data home is required to resolve the runtime root outside Windows.')
  }
  return join(userData, 'runtimes', 'alltalk')
}

/** The AllTalk APP directory - `<runtimeRoot>/app`, the tree markers check. */
export function resolveAllTalkRuntimeDir(deps: LiaRuntimePathsDeps = {}): string {
  return join(resolveLiaRuntimeRoot(deps), RUNTIME_APP_SUBDIR)
}

export type LiaInstallDirSource = 'canonical-runtime' | 'configured-product-document'

export interface LiaInstallDirCandidate {
  dir: string
  source: LiaInstallDirSource
}

/**
 * The install-dir candidates, in trust order. A configured path from the
 * product document wins when it proves out (QA rigs, deliberate moves);
 * the canonical runtime app dir is always there as the default. A
 * configured path identical to the canonical one is emitted once.
 */
export function resolveAllTalkInstallCandidates(input: LiaRuntimePathsDeps & {
  /** `voice.runtime.alltalk.installDir` as written in the product document. */
  configuredInstallDir?: string
}): LiaInstallDirCandidate[] {
  const candidates: LiaInstallDirCandidate[] = []
  const configured = input.configuredInstallDir?.trim()
  if (configured) {
    candidates.push({ dir: configured, source: 'configured-product-document' })
  }
  const canonical = resolveAllTalkRuntimeDir(input)
  if (candidates.every(c => c.dir !== canonical)) {
    candidates.push({ dir: canonical, source: 'canonical-runtime' })
  }
  return candidates
}
