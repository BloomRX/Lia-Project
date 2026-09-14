import type { VoiceRuntimeEnvironment } from './voice-runtime-env'
import type { RuntimeRootLayout } from './voice-runtime-root'

import process from 'node:process'

import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { app } from 'electron'

import { RUNTIME_APP_SUBDIR } from './voice-runtime-bootstrap'
import { probeVoiceRuntimeEnvironment } from './voice-runtime-env'
import { createRuntimeLogger, createRuntimeRunCommand, freeBytesFor } from './voice-runtime-install-exec'
import {
  adoptRuntimeRootSync,
  resolveRuntimeRootLayout,

} from './voice-runtime-root'

/**
 * The parts of the voice-runtime install that genuinely need Electron.
 *
 * Everything else - spawning, downloading, extracting, logging - lives in
 * `voice-runtime-install-exec`, which is dependency-free so it can be tested in a
 * Node process. Only these three need `app.getPath`, and only `createRuntimeProbe`
 * needs it transitively.
 *
 * The re-exports at the bottom keep a single import surface, so callers do not
 * have to know which half a helper ended up in.
 */

let cachedRootLayout: RuntimeRootLayout | undefined

function runtimeRootLayout(): RuntimeRootLayout {
  if (cachedRootLayout)
    return cachedRootLayout
  const platform = process.platform
  const layout = resolveRuntimeRootLayout({
    appDataDir: app.getPath('appData'),
    // `localAppData` is a Windows-only Electron path; off Windows the
    // resolver never reads it, so an empty string is honest rather than a
    // thrown "unknown path" at startup.
    localAppDataDir: platform === 'win32' ? app.getPath('localAppData') : '',
    platform,
    userDataDir: app.getPath('userData'),
  })
  // One adoption decision per process, latched either way: `adoptRuntimeRootSync`
  // migrates when it can and, when the rename is rejected (a locked file in
  // the old tree, an antivirus handle), adopts a workable root for this
  // session instead of throwing - a throw here made every runtime-state IPC
  // reject forever, and with it went the card that offers Install. The next
  // process start runs the whole decision again, so a temporary lock does not
  // become a permanent loss of the new root.
  const decision = adoptRuntimeRootSync(layout, {
    existsSync,
    log: createRuntimeLogger(),
    mkdirSync: target => mkdirSync(target, { recursive: true }),
    renameSync,
  })
  if (decision.error) {
    createRuntimeLogger()({
      detail: `adoption=${decision.adopted} root=${decision.rootDir} error=${decision.error}`,
      event: 'runtime-root-adopted-with-fallback',
      step: 'runtime-root',
    })
  }
  cachedRootLayout = decision.rootDir === layout.rootDir
    ? layout
    : { ...layout, legacyRootDirs: [], rootDir: decision.rootDir }
  return cachedRootLayout
}

/**
 * Where the runtime lives (item D, moved in round 7).
 *
 * Off Windows: `<userData>/runtimes/alltalk`, as before. On Windows:
 * `%LOCALAPPDATA%\Lia\runtimes\alltalk` - local rather than roaming (this
 * tree carries Conda and gigabytes of models, not config), and free of the
 * `@` that made the Miniconda silent installer exit 2 (see
 * `voice-runtime-root`). Lia-controlled either way: survives app updates,
 * not inside the repository, not the user's Downloads folder.
 */
export function runtimeRootDir(): string {
  return runtimeRootLayout().rootDir
}

/** The AllTalk tree itself, inside the runtime root. */
export function runtimeAppDir(): string {
  return join(runtimeRootDir(), RUNTIME_APP_SUBDIR)
}

/** Builds the real probe, bound to this machine. */
export function createRuntimeProbe(): () => Promise<VoiceRuntimeEnvironment> {
  const run = createRuntimeRunCommand()
  return () =>
    probeVoiceRuntimeEnvironment({
      freeBytes: () => freeBytesFor(runtimeRootDir()),
      run,
      // Carried so the path can be rejected before a 97 MB download rather than
      // after, when the installer would abort on its own terms.
      runtimeDir: runtimeAppDir(),
    })
}

export { stat as statPath }

export {
  createRuntimeDownload,
  createRuntimeExec,
  createRuntimeExtract,
  createRuntimeLogger,
  createRuntimeStateStore,
  LOG_PREFIX,
} from './voice-runtime-install-exec'
