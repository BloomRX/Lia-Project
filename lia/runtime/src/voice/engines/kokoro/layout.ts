import nodePath from 'node:path'
import process from 'node:process'

import {
  KOKORO_MODEL_FILE,
  KOKORO_NPZ_BUILDER_FILENAME,
  KOKORO_STATE_FILENAME,
  KOKORO_VOICES,
  KOKORO_VOICES_NPZ_FILENAME,
  KOKORO_WORKER_FILENAME,
} from './manifest'

/**
 * The Kokoro engine owns its ENTIRE runtime tree - venv, model, voices,
 * worker script, scratch space - exactly one subdirectory below the
 * engine-neutral voice-runtime home (`runtimes/kokoro`). The Stage and
 * the Lia Voice Service never compose any of these paths: the engine is
 * the single authority, which is what lets a future engine land without
 * touching shared layout code.
 */

export interface KokoroLayout {
  /** `<home>/kokoro` */
  rootDir: string
  venvDir: string
  /** Platform-correct venv interpreter (`Scripts/python.exe` vs `bin/python`). */
  venvPython: string
  modelsDir: string
  modelFile: string
  voicesDir: string
  voicesNpz: string
  workerDir: string
  workerFile: string
  npzBuilderFile: string
  tmpDir: string
  /** Durable marker the installer writes last; absence means "never finished". */
  stateFile: string
}

export function resolveKokoroLayout(input: { home: string, platform?: string }): KokoroLayout {
  const platform = input.platform ?? process.platform
  const rootDir = nodePath.join(input.home, 'kokoro')
  const venvDir = nodePath.join(rootDir, 'venv')
  const modelsDir = nodePath.join(rootDir, 'models')
  const voicesDir = nodePath.join(modelsDir, 'voices')
  const workerDir = nodePath.join(rootDir, 'worker')
  return {
    rootDir,
    venvDir,
    venvPython: platform === 'win32'
      ? nodePath.join(venvDir, 'Scripts', 'python.exe')
      : nodePath.join(venvDir, 'bin', 'python'),
    modelsDir,
    modelFile: nodePath.join(modelsDir, KOKORO_MODEL_FILE),
    voicesDir,
    voicesNpz: nodePath.join(modelsDir, KOKORO_VOICES_NPZ_FILENAME),
    workerDir,
    workerFile: nodePath.join(workerDir, KOKORO_WORKER_FILENAME),
    npzBuilderFile: nodePath.join(workerDir, KOKORO_NPZ_BUILDER_FILENAME),
    tmpDir: nodePath.join(rootDir, 'tmp'),
    stateFile: nodePath.join(rootDir, KOKORO_STATE_FILENAME),
  }
}

export interface KokoroInstallCheckDeps {
  existsSync: (path: string) => boolean
}

export interface KokoroInstallState {
  installed: boolean
  /** Every marker that is missing (empty when installed). */
  missing: string[]
}

/**
 * Decides "installed" only from bytes on disk, never from an implied
 * state: a partial first install answers UNAVAILABLE with the exact
 * markers it still owes, and re-running the installer is always safe.
 */
export function inspectKokoroInstall(layout: KokoroLayout, deps: KokoroInstallCheckDeps): KokoroInstallState {
  const required: Array<{ label: string, path: string }> = [
    { label: 'venv-python', path: layout.venvPython },
    { label: 'model', path: layout.modelFile },
    ...KOKORO_VOICES.map(voice => ({
      label: `voice-${voice.name}`,
      path: nodePath.join(layout.voicesDir, `${voice.name}.bin`),
    })),
    { label: 'voices-npz', path: layout.voicesNpz },
    { label: 'worker', path: layout.workerFile },
    { label: 'install-state', path: layout.stateFile },
  ]
  const missing = required.filter(entry => !deps.existsSync(entry.path)).map(entry => entry.label)
  return { installed: missing.length === 0, missing }
}
