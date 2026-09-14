import { join } from 'node:path'

/**
 * AllTalk first-run and TTS-engine state, read and written through the
 * mechanisms the pinned upstream (erew123/alltalk_tts f16117e9) supports:
 *
 * - `confignew.json` holds `firstrun_model`. While `true`, `script.py` runs
 *   `system/config/firstrun.py` at every start, which presents an interactive
 *   60-second menu when no `--tts_model` argument is given. A managed window-less
 *   spawn cannot answer that prompt, so the timeout expires and the upstream
 *   code downloads the **Piper** model - exactly the silent fallback the QA
 *   pass caught. Setting `firstrun_model: false` before any start is the
 *   supported way to skip the prompt entirely; it is what the upstream
 *   `set_firstrun_model_false()` writes after its own guided flow.
 * - `system/tts_engines/tts_engines.json` holds `engine_loaded`, `selected_model`
 *   and the `engines_available` table. `tts_server.py` imports
 *   `system.tts_engines.<engine_loaded>.model_engine` at boot and raises on an
 *   unknown name - so the file, not a guess, is the source of truth for which
 *   engine will answer synthesis calls.
 * - The engine's weights live under `models/xtts/xttsv2_2.0.3/`. Presence of
 *   every file the pin's `available_models.json` downloads (which includes the
 *   upstream `LICENSE.txt`) is what makes the custom voice actually usable; a
 *   server that boots with an empty `models/xtts` folder starts but serves no
 *   XTTS model.
 *
 * Nothing here downloads anything. The download itself is the prepare flow in
 * `alltalk-custom-voice-prepare.ts`, which drives the upstream
 * `firstrun.py --tts_model xtts` CLI - the officially documented way to bypass
 * the interactive menu.
 */

/** Files the pin downloads for `xttsv2_2.0.3` (its own `available_models.json`). */
export const CUSTOM_VOICE_MODEL_FILES = [
  'LICENSE.txt',
  'README.md',
  'config.json',
  'model.pth',
  'dvae.pth',
  'mel_stats.pth',
  'speakers_xtts.pth',
  'vocab.json',
] as const

/** The engine/model pair the Lia's custom voice flow uses. */
export const CUSTOM_VOICE_ENGINE = {
  engine: 'xtts',
  model: 'xttsv2_2.0.3',
} as const

export const ALLTALK_CONFIG_FILENAME = 'confignew.json'
export const ALLTALK_ENGINES_CONFIG_FILENAME = 'tts_engines.json'
export const ALLTALK_ENGINES_CONFIG_PATH = join('system', 'tts_engines', ALLTALK_ENGINES_CONFIG_FILENAME)

/** What a consumer sees; never throws - failures become `parseError`. */
export interface CustomVoiceEngineStatus {
  /** The engine recorded as loaded, lower-cased, or `undefined` when unknown. */
  engine?: string
  /** All model files present under `models/xtts/xttsv2_2.0.3`. */
  modelComplete: boolean
  /** Model files found, for diagnostics that want more than a boolean. */
  missingModelFiles: string[]
  /** `confignew.json.firstrun_model` still true - a start WOULD prompt/timeout. */
  firstRunPending: boolean
  /** engine === 'xtts', no missing files, no pending first run. */
  ready: boolean
  /** A config file could not be parsed; carries the file's display name. */
  parseError?: string
}

export interface EngineConfigFs {
  readFile: (path: string) => Promise<string | undefined>
  listFiles?: (dir: string) => Promise<string[] | undefined>
  writeFile: (path: string, content: string) => Promise<void>
}

function engineConfigPath(appDir: string, relative: string): string {
  return join(appDir, relative)
}

/**
 * Reads the pinned config files and reports what they actually say.
 *
 * `listFiles` is optional because only the model-presence check needs a
 * directory listing; everything else is JSON content. A missing directory
 * listing is treated as zero files rather than an error - a half-complete
 * download is data, not a crash.
 */
export async function readCustomVoiceEngineStatus(
  deps: EngineConfigFs,
  appDir: string,
): Promise<CustomVoiceEngineStatus> {
  const status: CustomVoiceEngineStatus = {
    modelComplete: false,
    missingModelFiles: [...CUSTOM_VOICE_MODEL_FILES],
    firstRunPending: false,
    ready: false,
  }

  const configRaw = await deps.readFile(engineConfigPath(appDir, ALLTALK_CONFIG_FILENAME))
  if (configRaw !== undefined) {
    try {
      const parsed = JSON.parse(configRaw) as { firstrun_model?: unknown }
      status.firstRunPending = parsed.firstrun_model === true
    }
    catch {
      status.parseError = ALLTALK_CONFIG_FILENAME
    }
  }
  // A missing confignew.json cannot be claimed "first run done": the upstream
  // template ships `firstrun_model: true`, so absence of proof is proof of
  // absence here.
  else {
    status.firstRunPending = true
  }

  const enginesRaw = await deps.readFile(engineConfigPath(appDir, ALLTALK_ENGINES_CONFIG_PATH))
  if (enginesRaw !== undefined) {
    try {
      const parsed = JSON.parse(enginesRaw) as { engine_loaded?: unknown }
      const engine = typeof parsed.engine_loaded === 'string' ? parsed.engine_loaded.trim().toLowerCase() : ''
      status.engine = engine || undefined
    }
    catch {
      if (status.parseError === undefined)
        status.parseError = ALLTALK_ENGINES_CONFIG_FILENAME
    }
  }

  if (deps.listFiles) {
    const modelDir = engineConfigPath(appDir, join('models', CUSTOM_VOICE_ENGINE.engine, CUSTOM_VOICE_ENGINE.model))
    const present = new Set((await deps.listFiles(modelDir)) ?? [])
    status.missingModelFiles = CUSTOM_VOICE_MODEL_FILES.filter(file => !present.has(file))
    status.modelComplete = status.missingModelFiles.length === 0
  }

  status.ready = status.engine === CUSTOM_VOICE_ENGINE.engine
    && status.modelComplete
    && !status.firstRunPending
    && status.parseError === undefined

  return status
}

/**
 * Sets `firstrun_model` in `confignew.json`, preserving every other key.
 *
 * Fails loudly instead of writing over an unreadable file: destroying the
 * user's config to force the flag would be a much worse outcome than a
 * visible step error.
 *
 * Returns `true` when the file changed, `false` when it already matched -
 * letting the caller distinguish "I repaired this" from "nothing to do".
 */
export async function setAlltalkFirstRunPending(
  deps: Pick<EngineConfigFs, 'readFile' | 'writeFile'>,
  appDir: string,
  pending: boolean,
): Promise<boolean> {
  const path = engineConfigPath(appDir, ALLTALK_CONFIG_FILENAME)
  const raw = await deps.readFile(path)
  if (raw === undefined)
    throw new Error(`${ALLTALK_CONFIG_FILENAME} is missing - the voice system source was not extracted correctly.`)

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch {
    throw new Error(`${ALLTALK_CONFIG_FILENAME} is not readable JSON - repair the voice system or remove and reinstall.`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error(`${ALLTALK_CONFIG_FILENAME} has an unexpected shape.`)

  const record = parsed as Record<string, unknown>
  if (record.firstrun_model === pending && Object.keys(record).length > 0)
    return false

  record.firstrun_model = pending
  await deps.writeFile(path, `${JSON.stringify(record, null, 4)}\n`)
  return true
}

/**
 * Sets `firstrun_model: false` - used by the bootstrap step that prepares the
 * runtime for a headless first start, so a windowless spawn never meets the
 * upstream interactive menu and its 60-second Piper timeout.
 */
export async function markAlltalkFirstRunDone(
  deps: Pick<EngineConfigFs, 'readFile' | 'writeFile'>,
  appDir: string,
): Promise<boolean> {
  return setAlltalkFirstRunPending(deps, appDir, false)
}
