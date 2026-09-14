import type { VoiceInfo } from '../providers/types'

/**
 * What the chat auto-TTS needs in order to synthesize one segment.
 *
 * Extracted from the middle of `Stage.vue` so the production decision can be
 * exercised by a test instead of restated by one. The component and this
 * function share exactly one implementation.
 */
export interface SynthesisTarget {
  model: string
  voice: VoiceInfo
}

export interface ResolveSynthesisTargetParams {
  /** `activeSpeechProvider` - the provider the runtime is currently on. */
  providerId: string
  /** `activeSpeechModel`. Empty for providers that publish no model catalogue. */
  modelId: string
  /** `activeSpeechVoiceId` - the persisted/selected id. */
  voiceId: string
  /**
   * `activeSpeechVoice` - the id resolved against the provider's catalogue, or
   * `undefined` when the catalogue has not loaded yet (Kokoro only publishes
   * its voices once its ONNX model is up) or the provider publishes none at all.
   */
  resolvedVoice: VoiceInfo | undefined
}

/**
 * A descriptor good enough to synthesize when the catalogue has not resolved
 * the id. Mirrors what the OpenAI-compatible path has always built inline.
 *
 * `languages` is left empty rather than guessed: claiming a language the voice
 * does not speak would feed a wrong tag into SSML.
 */
function minimalVoice(voiceId: string, providerId: string): VoiceInfo {
  return {
    id: voiceId,
    name: voiceId,
    description: voiceId,
    previewURL: '',
    languages: [],
    provider: providerId,
    gender: 'neutral',
  }
}

/**
 * Resolves the provider/model/voice a segment should be synthesized with.
 *
 * Returns `null` when there is genuinely nothing to speak: no provider, the
 * no-output provider, or no voice id at all.
 *
 * Two rules here used to live as a single `if (!model || !voice) return null`
 * inside the component, and both were wrong for the Lia setup:
 *
 * - **A model is optional.** Providers that publish no model catalogue -
 *   Kokoro, Edge TTS - give the voice editor nothing to select, so
 *   `activeSpeechModel` stays empty. Requiring it dropped every segment
 *   silently: the chat answered in text and spoke nothing. `speech()` forwards
 *   the model straight to `provider.speech(model, ...)`, and providers that
 *   ignore it accept an empty string - which is what the voice preview has
 *   always passed. A provider that genuinely needs one now fails loudly and
 *   reaches the fallback policy instead of muting the conversation.
 * - **An unresolved voice object is not an unselected voice.** The id is enough
 *   to synthesize; the catalogue object is only needed for SSML language hints.
 */
export function resolveSynthesisTarget(
  params: ResolveSynthesisTargetParams,
): SynthesisTarget | null {
  const { providerId, modelId, voiceId, resolvedVoice } = params

  if (!providerId || providerId === 'speech-noop')
    return null

  const voice = resolvedVoice ?? (voiceId ? minimalVoice(voiceId, providerId) : undefined)
  if (!voice)
    return null

  return { model: modelId ?? '', voice }
}

/** Whether a resolved target is missing only the model, i.e. worth a warning. */
export function isModellessTarget(target: SynthesisTarget): boolean {
  return !target.model
}
