import type { LiaVoiceTtsTarget } from '../../../shared/eventa'

import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'

import { createNativeSpeechSynthesis } from '../../services/lia/main-speech'
import { useLiaProviderConfigFacade } from './provider-config-facade'
import { useLiaProviderRuntime } from './provider-runtime'

/**
 * The audio boundary of the voice preview (M1 Phase 4E-2, commit 2).
 *
 * Kept apart from `voice-editor.ts` on purpose: the editor is pure selection
 * logic and stays testable without an `AudioContext`, while everything that
 * needs a sound card lives here and is injected into the editor.
 *
 * The compatible remote preview uses the Lia transport port. Local and
 * other adapters still use the Stage speech store.
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
  const synthesize = createNativeSpeechSynthesis(id => useLiaProviderConfigFacade().getConfig(id)?.baseUrl)
  return async (target, text, signal, onPlaybackStart) => {
    if (signal.aborted)
      return
    const native = synthesize(target, text, signal)
    if (native) {
      const audio = await native
      if (!signal.aborted)
        await playAudio(audio, signal, onPlaybackStart)
      return
    }
    const speechStore = useSpeechStore()
    const providerRuntime = useLiaProviderRuntime()
    const providerConfig = useLiaProviderConfigFacade()

    /*
     * A voice provider whose credential cannot live in this window fails here,
     * at build time: the credential resolver refuses every text-to-speech
     * definition (see `resolveApiKey`), and providers that need a key build from
     * an empty one. That is the safe outcome, but the raw error is a TypeError
     * from inside a provider's `createProvider`, which tells the user nothing.
     *
     * Re-thrown with a reason, and with `cause` kept for diagnostics. Nothing
     * about the failure can carry a secret: the credential was never obtained.
     * Local engines build normally and never reach this branch.
     */
    let provider: PreviewSpeechProvider | undefined
    try {
      provider = await providerRuntime.getInstance<PreviewSpeechProvider>(target.providerId)
    }
    catch (error) {
      throw new Error(
        `Voice provider "${target.providerId}" cannot be prepared in this window`,
        { cause: error },
      )
    }
    if (!provider)
      throw new Error(`Speech provider "${target.providerId}" is not available`)

    if (signal.aborted)
      return

    // Read at call time and passed straight through. It is never assigned to a
    // ref, never returned by the editor and never rendered, so no credential can
    // reach the UI state or the persisted payload.
    const targetConfig = providerConfig.getConfig(target.providerId) ?? {}

    const audio = await speechStore.speech(
      provider,
      target.modelId ?? '',
      text,
      target.voiceId ?? '',
      targetConfig,
      { trigger: 'manual', source: 'manual_preview', voice_type: 'custom_configured' },
    )

    if (signal.aborted || !audio || audio.byteLength === 0)
      return

    await playAudio(audio, signal, onPlaybackStart)
  }
}
