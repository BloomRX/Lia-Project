import { join } from 'node:path'
import { platform } from 'node:process'

import { errorMessageFrom } from '@moeru/std'

import {
  CUSTOM_VOICE_ENGINE,
  readCustomVoiceEngineStatus,
  setAlltalkFirstRunPending,
} from './alltalk-engine-config'

/**
 * Preparing the custom voice model (Phase 6, items H/I/J).
 *
 * The pinned AllTalk offers exactly one non-interactive way to install its
 * first model: the documented CLI `python system/config/firstrun.py --tts_model
 * xtts`. The CLI's own docstring says it "bypasses the interactive menu"; it
 * downloads `xttsv2_2.0.3` from the origin the pin itself declares
 * (`huggingface.co/coqui/XTTS-v2`, LICENSE.txt included in the downloaded set),
 * writes `engine_loaded: 'xtts'` into `tts_engines.json` and finally flips
 * `firstrun_model` to `false`. No keys are pressed, no stdio is patched.
 *
 * Design consequences:
 *
 * - **It runs on demand only.** Nothing here is triggered by the bootstrap or
 *   by an autostart: the user explicitly asks (the "Prepare custom voice"
 *   button), because the XTTS-v2 weights are a few gigabytes and carry their
 *   own license (CPML, not MIT) - download happens when the person opts in,
 *   never silently behind an install step. (The pin does not ask again; the
 *   Lia asks once, in its own words.)
 * - **It never falls back silently.** After the CLI returns, this function
 *   re-reads the config files and declares success ONLY if the engine is now
 *   `xtts` with every model file present. An exit code 0 that left Piper
 *   configured is reported as an error, with the engine name in the message -
 *   QA item H.
 * - **Idempotence is read-back based.** If the engine is already xtts-complete
 *   the function returns immediately: preparing again costs a file scan, never
 *   a re-download. A re-run after a partial download lets the upstream script
 *   resume from what is actually on disk.
 */

/** Logs use this prefix; never a path with user folders, never URLs. */
export const CUSTOM_VOICE_PREPARE_LOG_PREFIX = '[LIA-VOICE-RUNTIME]'

/**
 * Hard ceiling for the whole prepare run. The fit model is about 2 GB from a
 * CDN; the bound is loose enough for slow links and tight enough that a wedged
 * download cannot hold the app forever.
 */
export const CUSTOM_VOICE_PREPARE_TIMEOUT_MS = 45 * 60 * 1000

export interface PrepareLogEntry {
  event: string
  /** Short display text; never a stack trace, never credentials. */
  detail?: string
}

export type CustomVoicePreparePhase
  = | 'checking'
    | 'enabling-first-run'
    | 'downloading'
    | 'verifying'
    | 'ready'
    | 'error'
    | 'cancelled'

export interface CustomVoicePrepareState {
  phase: CustomVoicePreparePhase
  /** Present on `error`; a human sentence safe to show. */
  detail?: string
}

export type CustomVoicePrepareErrorCode
  = | 'cancelled'
    | 'execFailed'
    | 'configNotApplied'
    | 'engineNotCustom'
    | 'modelIncomplete'

export type CustomVoicePrepareResult
  = | { ok: true, changed: boolean }
    | { message: string, error: CustomVoicePrepareErrorCode, ok: false }

export interface CustomVoicePrepareDeps {
  /** Same shape as the bootstrap exec: argument array, never a shell string. */
  exec: (command: string, args: string[], options: { cwd: string, timeoutMs: number }) => Promise<{ code: number | null, stderr: string, stdout: string }>
  readFile: (path: string) => Promise<string | undefined>
  listFiles: (dir: string) => Promise<string[] | undefined>
  writeFile: (path: string, content: string) => Promise<void>
  /** The managed install root (contains `confignew.json`, `alltalk_environment/`). */
  appDir: string
  log: (entry: PrepareLogEntry) => void
  onStateChange?: (state: CustomVoicePrepareState) => void
  isCancelled?: () => boolean
  platform?: NodeJS.Platform
}

/** The upstream script that performs the download and config write. */
export const FIRSTRUN_SCRIPT_RELATIVE = join('system', 'config', 'firstrun.py')

/**
 * How the pin's conda environment is invoked on Windows. The layout mirrors
 * the bootstrap launchers: `alltalk_environment/env` is the env root. Kept as
 * a function so the platform difference is reviewable, testable, and not a
 * string concatenated at the call site.
 */
export function firstrunCommandFor(
  platform: NodeJS.Platform,
  appDir: string,
): { args: string[], command: string } {
  if (platform === 'win32') {
    return {
      command: join(appDir, 'alltalk_environment', 'env', 'python.exe'),
      args: [FIRSTRUN_SCRIPT_RELATIVE, '--tts_model', CUSTOM_VOICE_ENGINE.engine],
    }
  }
  return {
    command: 'python3',
    args: [FIRSTRUN_SCRIPT_RELATIVE, '--tts_model', CUSTOM_VOICE_ENGINE.engine],
  }
}

/** The last useful line of the CLI output, for an error detail. Free of paths. */
export function summarizeExecFailure(stdout: string, stderr: string): string | undefined {
  const candidates = [...stderr.split('\n'), ...stdout.split('\n')]
    .map(line => line.trim())
    // The pin prints ANSI colour codes; strip them from anything the UI may see.
    .map(line => line.replace(/\[\d+m/g, ''))
    .filter(line => line.length > 0 && /error|exhausted|failed|exception|traceback|denied/i.test(line))
  const last = candidates[candidates.length - 1]
  if (!last)
    return undefined
  return last.length > 200 ? `${last.slice(0, 197)}...` : last
}

export async function prepareCustomVoiceEngine(
  deps: CustomVoicePrepareDeps,
): Promise<CustomVoicePrepareResult> {
  const set = (state: CustomVoicePrepareState): void => {
    deps.onStateChange?.(state)
  }
  const cancelled = (): boolean => deps.isCancelled?.() === true

  deps.log({ event: 'prepare.requested' })
  set({ phase: 'checking' })

  const initial = await readCustomVoiceEngineStatus(
    { readFile: deps.readFile, listFiles: deps.listFiles, writeFile: deps.writeFile },
    deps.appDir,
  )
  if (initial.ready) {
    deps.log({ event: 'prepare.skipped-already-ready' })
    set({ phase: 'ready' })
    return { changed: false, ok: true }
  }

  if (cancelled()) {
    deps.log({ event: 'prepare.cancelled' })
    set({ detail: 'Cancelled before the download started.', phase: 'cancelled' })
    return { error: 'cancelled', message: 'Preparation was cancelled.', ok: false }
  }

  // The upstream CLI only acts when the first run is still pending; arm it again
  // on purpose (this is also what repairs a machine that already lost the 60s
  // timeout race to Piper).
  set({ phase: 'enabling-first-run' })
  try {
    await setAlltalkFirstRunPending(deps, deps.appDir, true)
  }
  catch (error) {
    const message = errorMessageFrom(error) ?? 'The preparation could not run.'
    deps.log({ detail: message, event: 'prepare.configure-failed' })
    set({ detail: message, phase: 'error' })
    return { error: 'configNotApplied', message, ok: false }
  }

  set({ phase: 'downloading' })
  deps.log({ detail: `${CUSTOM_VOICE_ENGINE.engine} ${CUSTOM_VOICE_ENGINE.model}`, event: 'prepare.download-started' })

  const { command, args } = firstrunCommandFor(deps.platform ?? platform, deps.appDir)
  let result: { code: number | null, stderr: string, stdout: string }
  try {
    result = await deps.exec(command, args, { cwd: deps.appDir, timeoutMs: CUSTOM_VOICE_PREPARE_TIMEOUT_MS })
  }
  catch (error) {
    const message = errorMessageFrom(error) ?? 'The preparation could not run.'
    deps.log({ detail: message, event: 'prepare.download-failed' })
    set({ detail: message, phase: 'error' })
    return { error: 'execFailed', message, ok: false }
  }

  if (cancelled()) {
    deps.log({ event: 'prepare.cancelled' })
    set({ detail: 'Cancelled during the download.', phase: 'cancelled' })
    return { error: 'cancelled', message: 'Preparation was cancelled.', ok: false }
  }

  set({ phase: 'verifying' })

  if (result.code !== 0) {
    const detail = summarizeExecFailure(result.stdout, result.stderr)
      ?? `The model download ended with exit code ${String(result.code)}.`
    deps.log({ detail, event: 'prepare.download-failed' })
    set({ detail, phase: 'error' })
    return { error: 'execFailed', message: detail, ok: false }
  }

  // The source of truth after the run is the config, not the exit code: the
  // pin exits 0 having written nothing when, for example, a flag is off.
  const verified = await readCustomVoiceEngineStatus(
    { readFile: deps.readFile, listFiles: deps.listFiles, writeFile: deps.writeFile },
    deps.appDir,
  )

  if (verified.ready) {
    deps.log({ event: 'prepare.finished' })
    set({ phase: 'ready' })
    return { changed: true, ok: true }
  }

  if (verified.engine && verified.engine !== CUSTOM_VOICE_ENGINE.engine) {
    // QA item H: this is the silent-Piper failure shape, made loud on purpose.
    const message = `The voice system finished but is configured for "${verified.engine}", not the custom voice engine. No fallback voice was installed.`
    deps.log({ detail: `engine=${verified.engine}`, event: 'prepare.engine-mismatch' })
    set({ detail: message, phase: 'error' })
    return { error: 'engineNotCustom', message, ok: false }
  }

  if (verified.engine === CUSTOM_VOICE_ENGINE.engine && !verified.modelComplete) {
    const message = 'The custom voice engine is selected but some of its model files are missing. Try preparing again.'
    deps.log({ detail: `missing=${verified.missingModelFiles.length}`, event: 'prepare.model-incomplete' })
    set({ detail: message, phase: 'error' })
    return { error: 'modelIncomplete', message, ok: false }
  }

  const message = 'The preparation ended without applying the voice engine configuration.'
  deps.log({ detail: `engine=${verified.engine ?? 'unknown'} firstRunPending=${verified.firstRunPending}`, event: 'prepare.unverified' })
  set({ detail: message, phase: 'error' })
  return { error: 'configNotApplied', message, ok: false }
}
