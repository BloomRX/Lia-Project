import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LiaHearingConfig, LiaHearingSttTarget, LiaVoiceConfig, LiaVoiceTtsConfig, LiaVoiceTtsTarget } from '../../../shared/eventa'
import type { LiaProductConfig } from '../../configs/lia'

import { defineInvokeHandler } from '@moeru/eventa'

import {
  electronLiaHearingConfigGet,
  electronLiaVoiceConfigGet,
  electronLiaVoiceConfigSet,
} from '../../../shared/eventa'
import { defaultLiaProductConfig } from '../../configs/lia'

type MainContext = ReturnType<typeof createContext>['context']

/**
 * The persisted shape of `voice.tts`. `voiceConfigSchema` declares `fallback` as
 * `optional(array(ttsTargetSchema), [])`, whose *output* type makes the array
 * required — so the document written to `lia-product.json` always carries a
 * concrete `fallback`, even when the renderer omitted it over IPC.
 */
type PersistedTtsConfig = NonNullable<NonNullable<LiaProductConfig['voice']>['tts']>

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Keeps exactly the reference fields a TTS target is made of (`providerId` plus
 * the optional `modelId`/`voiceId`). Anything else a caller sends — an
 * `apiKey`, a `baseUrl`, an arbitrary blob — is dropped here, so a credential
 * can never reach `lia-product.json` through this bridge. Secrets stay in the
 * main-process vault (Phase 4C) and are merged in per-use at runtime.
 *
 * Returns `undefined` for anything that is not an object carrying a usable
 * `providerId`, which makes such an entry simply absent from the persisted list.
 */
function normalizeTtsTarget(value: unknown): LiaVoiceTtsTarget | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined

  const { providerId, modelId, voiceId } = value as Record<string, unknown>
  if (!isNonEmptyString(providerId))
    return undefined

  const target: LiaVoiceTtsTarget = { providerId }
  if (isNonEmptyString(modelId))
    target.modelId = modelId
  if (isNonEmptyString(voiceId))
    target.voiceId = voiceId
  return target
}

/**
 * Normalizes the `voice.tts` slice, or returns `undefined` when the payload
 * carries no recognizable TTS field at all (→ the write becomes a no-op).
 *
 * Semantics are *replace for the `tts` slice*: the normalized slice is what gets
 * persisted, so a payload that only sends `preferred` clears a previously stored
 * `fallback` (and vice versa). Callers therefore always send the full TTS state
 * they want — the same "the renderer owns the whole sub-domain" contract the
 * `provider.chat` bridge (Phase 4C) uses.
 */
function normalizeTtsConfig(value: unknown): LiaVoiceTtsConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined

  if (!('preferred' in value) && !('fallback' in value))
    return undefined

  const { preferred, fallback } = value as Record<string, unknown>
  const tts: LiaVoiceTtsConfig = {}

  const preferredTarget = normalizeTtsTarget(preferred)
  if (preferredTarget)
    tts.preferred = preferredTarget

  if (Array.isArray(fallback)) {
    tts.fallback = fallback
      .map(normalizeTtsTarget)
      .filter((target): target is LiaVoiceTtsTarget => target !== undefined)
  }

  return tts
}

/**
 * Wires the Lia `voice.tts` configuration (references/metadata only — no
 * secrets) between the renderer and the Lia product config at
 * `userData/lia-product.json`.
 *
 * Only the `voice` domain is ever written: `persona`, `provider` and
 * `preferences` are carried over verbatim, and `voice.stt` is preserved even
 * though this bridge (4D-1) exposes no STT surface. An unrecognized or
 * non-object payload is a no-op — the previous config stays untouched.
 *
 * Phase 8.0D-10B-4D4C4-SHELL-B1: this is also the single registration point for
 * the READ-ONLY managed Hearing facts ({@link registerLiaHearingConfigBridge}).
 * Both bridges serve the same canonical `voice` domain through the same config
 * handle, so wiring them together keeps one seam and guarantees the STT read
 * surface can never be registered without the voice bridge it depends on. The
 * STT surface remains getter-only — this bridge still never writes `voice.stt`.
 */
export function registerLiaVoiceConfigBridge(params: {
  context: MainContext
  liaProductConfig: { get: () => LiaProductConfig | undefined, update: (value: LiaProductConfig) => void }
}): void {
  const { context, liaProductConfig } = params

  registerLiaHearingConfigBridge({ context, liaProductConfig })

  defineInvokeHandler(context, electronLiaVoiceConfigGet, (): LiaVoiceConfig => {
    const voice = liaProductConfig.get()?.voice
    return { tts: voice?.tts ?? {} }
  })

  defineInvokeHandler(context, electronLiaVoiceConfigSet, (voice: LiaVoiceConfig) => {
    if (!voice || typeof voice !== 'object' || Array.isArray(voice))
      return

    const tts = normalizeTtsConfig(voice.tts)
    if (!tts)
      return

    // Materialize the persisted shape: the schema's `fallback` default makes the
    // array required in the stored document, so an omitted list is stored as `[]`.
    const persistedTts: PersistedTtsConfig = { fallback: tts.fallback ?? [] }
    if (tts.preferred)
      persistedTts.preferred = tts.preferred

    const current = liaProductConfig.get() ?? defaultLiaProductConfig
    liaProductConfig.update({
      schemaVersion: current.schemaVersion ?? defaultLiaProductConfig.schemaVersion,
      persona: current.persona ?? {},
      provider: current.provider ?? {},
      voice: { ...current.voice, tts: persistedTts },
      preferences: current.preferences ?? {},
    })
  })
}

/**
 * Keeps exactly the two reference fields an STT target is made of. Anything else
 * present in the stored document — a credential, a base URL, a stray runtime
 * object — is dropped here rather than forwarded, so this read-only surface can
 * never become a channel for secret material.
 */
function normalizeSttTarget(value: unknown): LiaHearingSttTarget | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined

  const { providerId, modelId } = value as Record<string, unknown>
  if (!isNonEmptyString(providerId))
    return undefined

  const target: LiaHearingSttTarget = { providerId }
  if (isNonEmptyString(modelId))
    target.modelId = modelId
  return target
}

/**
 * Phase 8.0D-10B-4D4C4-SHELL-B1: the READ-ONLY managed Hearing facts bridge.
 *
 * Exposes the product-level voice switch and the canonical STT selection the Lia
 * Launcher resolved, so the managed Stage can project them into the existing AIRI
 * Hearing runtime and the user never has to open AIRI Settings > Hearing.
 *
 * Deliberately asymmetric with {@link registerLiaVoiceConfigBridge}: there is NO
 * setter. AIRI must not become a second writer of speech-to-text configuration —
 * the Launcher and Lia Core stay the only authorities. This bridge also never
 * touches the document, so the existing TTS get/set behavior is unchanged.
 */
export function registerLiaHearingConfigBridge(params: {
  context: MainContext
  liaProductConfig: { get: () => LiaProductConfig | undefined }
}): void {
  const { context, liaProductConfig } = params

  defineInvokeHandler(context, electronLiaHearingConfigGet, (): LiaHearingConfig => {
    const voice = liaProductConfig.get()?.voice
    const config: LiaHearingConfig = {}
    // Absent means enabled (the product default); only an explicit false opts
    // out. Forward the tri-state as-is rather than inventing a boolean.
    if (typeof voice?.enabled === 'boolean')
      config.enabled = voice.enabled

    const preferred = normalizeSttTarget(voice?.stt?.preferred)
    if (preferred)
      config.preferred = preferred

    return config
  })
}
