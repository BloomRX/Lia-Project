import type { VoiceRuntimeEnvironment } from './voice-runtime-env'

import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { app } from 'electron'

import { RUNTIME_APP_SUBDIR } from './voice-runtime-bootstrap'
import { probeVoiceRuntimeEnvironment } from './voice-runtime-env'
import { createRuntimeRunCommand, freeBytesFor } from './voice-runtime-install-exec'

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

/**
 * Where the runtime lives (item D).
 *
 * `<userData>/runtimes/alltalk`: Lia-controlled, survives app updates, not inside
 * the repository, not the user's Downloads folder, and independent of whatever
 * directory the app happened to be launched from.
 */
export function runtimeRootDir(): string {
  return join(app.getPath('userData'), 'runtimes', 'alltalk')
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
