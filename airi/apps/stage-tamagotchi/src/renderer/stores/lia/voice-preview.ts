import type { LiaVoiceTtsTarget } from '../../../shared/eventa'

import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'

/**
 * The audio boundary of the voice preview (M1 Phase 4E-2, commit 2).
 *
 * Kept apart from `voice-editor.ts` on purpose: the editor is pure selection
 * logic and stays testable without an `AudioContext`, while everything that
 * needs a sound card lives here and is injected into the editor.
 *
 * It changes no runtime. The synthesis call is the same
 * `speechStore.speech(provider, model, input, voice, config, analytics)` the
 * stage already uses, the provider instance comes from the existing
 * `getProviderInstance`, and the credential is read from the existing
 * provider-config store only to be handed straight to the provider.
 */

/**
 * Speaks `text` with `target` and resolves when playback ends.
 *
 * `onPlaybackStart` lets the caller distinguish "synthesizing" from "audible";
 * `signal` cancels an attempt in flight.
 */
export interface VoicePreviewDriver {
  (
    target: LiaVoiceTtsTarget,
    text: string,
    signal: AbortSignal,
    onPlaybackStart: () => void,
  ): Promise<void>
}

/**
 * Derived from the real `speech()` signature instead of imported, so this file
 * cannot drift from the runtime it calls and needs no `@xsai-ext` alias.
 */
type PreviewSpeechProvider = Parameters<ReturnType<typeof useSpeechStore>['speech']>[0]

/** Decodes and plays one buffer, honouring cancellation. */
async function playAudio(audio: ArrayBuffer, signal: AbortSignal, onPlaybackStart: () => void): Promise<void> {
  const AudioContextCtor = globalThis.AudioContext
  if (!AudioContextCtor)
    throw new Error('No audio output is available on this machine')

  const context = new AudioContextCtor()
  try {
    const buffer = await context.decodeAudioData(audio)
    if (signal.aborted)
      return

    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)

    const ended = new Promise<void>((resolve) => {
      source.onended = () => resolve()
    })
    const cancelled = new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true })
    })

    onPlaybackStart()
    source.start()
    await Promise.race([ended, cancelled])
    source.stop()
  }
  finally {
    await context.close().catch(() => {})
  }
}

/** The default driver: real provider, real synthesis, real output. */
export function createVoicePreviewDriver(): VoicePreviewDriver {
  return async (target, text, signal, onPlaybackStart) => {
    const speechStore = useSpeechStore()
    const providersStore = useProviderStore()
    const configStore = useProviderConfigStore()

    const provider = await providersStore.getProviderInstance<PreviewSpeechProvider>(target.providerId)
    if (!provider)
      throw new Error(`Speech provider "${target.providerId}" is not available`)

    if (signal.aborted)
      return

    // Read at call time and passed straight through. It is never assigned to a
    // ref, never returned by the editor and never rendered, so no credential can
    // reach the UI state or the persisted payload.
    const providerConfig = configStore.getProviderConfig(target.providerId) ?? {}

    const audio = await speechStore.speech(
      provider,
      target.modelId ?? '',
      text,
      target.voiceId ?? '',
      providerConfig,
      { trigger: 'manual', source: 'manual_preview', voice_type: 'custom_configured' },
    )

    if (signal.aborted || !audio || audio.byteLength === 0)
      return

    await playAudio(audio, signal, onPlaybackStart)
  }
}
