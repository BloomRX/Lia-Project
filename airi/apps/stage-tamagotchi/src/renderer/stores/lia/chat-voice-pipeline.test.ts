import type { LiaVoiceConfig } from '../../../shared/eventa'

import { isModellessTarget, resolveSynthesisTarget } from '@proj-airi/stage-ui/libs/speech/synthesize-target'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * End-to-end coverage of the chat voice path: persisted `voice.tts` -> runtime
 * hydration -> assistant text -> real segmenter -> real target resolution ->
 * `speechStore.speech()` -> the provider.
 *
 * This is the test that was missing when the chat answered in text and spoke
 * nothing. The bug was not in hydration: `Stage.vue` required BOTH a model and a
 * resolved voice object before synthesizing, and Kokoro publishes no model
 * catalogue, so every segment was dropped by a silent `return null`.
 *
 * What is real here: the Lia voice store and its persistence bridge, the speech
 * store, the speech runtime's segmenter (`openIntent`), the TTS session factory,
 * `resolveSynthesisTarget` (the same function `Stage.vue` calls) and
 * `speechStore.speech()` itself. What is stubbed: the provider instance, so no
 * ONNX model or network is involved, and the playback manager, which only
 * records what it was handed.
 */

const ipc = vi.hoisted(() => ({
  getVoiceConfig: vi.fn(async (): Promise<unknown> => ({ tts: {} })),
  saveVoiceConfig: vi.fn(async (_config: unknown) => {
    structuredClone(_config)
  }),
}))

const card = vi.hoisted(() => ({
  speech: undefined as { provider?: string, model?: string, voice_id?: string } | undefined,
  persona: { language: { character: 'pt-BR' } },
  updateActiveCardSpeech: vi.fn(async () => true),
  persistActiveCardModuleSelections: vi.fn(async () => {}),
  get activeCard() {
    return {
      id: 'lia',
      extensions: { airi: { modules: { speech: card.speech }, persona: card.persona } },
    }
  },
}))

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
    if (invoke?.receiveEvent?.id === 'eventa:invoke:lia:voice:config:get-receive')
      return ipc.getVoiceConfig
    if (invoke?.receiveEvent?.id === 'eventa:invoke:lia:voice:config:set-receive')
      return ipc.saveVoiceConfig
    throw new Error(`Unexpected eventa invoke: ${JSON.stringify(invoke)}`)
  },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: { value: 'pt-BR' }, t: (key: string) => `T(${key})` }),
}))

vi.mock('@proj-airi/stage-ui/stores/modules/airi-card', () => ({
  useAiriCardStore: () => card,
}))

/** A provider whose synthesis is recorded instead of performed. */
const synth = vi.hoisted(() => ({
  calls: [] as Array<{ model: string, input: string, voice: string }>,
}))

function makeProviderStub() {
  return {
    speech: (model: string) => ({
      // `speechStore.speech()` spreads this into `generateSpeech({ ...provider.speech(model, cfg), input, voice })`,
      // and `postJSON` builds the request URL from `baseURL`. The real call ends
      // in a fetch; here the fetch records and returns non-empty bytes.
      baseURL: 'http://127.0.0.1:1/v1',
      apiKey: 'not-a-real-key',
      fetch: async (_input: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string, voice?: string }
        synth.calls.push({ model, input: body.input ?? '', voice: body.voice ?? '' })
        return new Response(new Uint8Array([1, 2, 3, 4]).buffer, {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        })
      },
    }),
  }
}

const KOKORO = 'kokoro-local'
const VOICE = 'af_heart'
/** Kokoro lists no models, so the Lia editor never offers one and this stays ''. */
const NO_MODEL = ''

describe('lia chat voice production', async () => {
  const { useLiaVoiceStore } = await import('./voice')

  /**
   * The per-segment callback `Stage.vue` hands to the runtime. Same shape, and
   * it calls the SAME `resolveSynthesisTarget` the component calls, so the
   * production decision is what is under test.
   */
  function makeTtsCallback() {
    const speech = useSpeechStore()
    const providers = useProviderStore()
    const seen: Array<{ provider: string, model: string, voice: string }> = []

    const tts = async (request: { text?: string }) => {
      const providerId = speech.activeSpeechProvider
      const target = resolveSynthesisTarget({
        providerId,
        modelId: speech.activeSpeechModel,
        voiceId: speech.activeSpeechVoiceId,
        resolvedVoice: speech.activeSpeechVoice,
      })
      if (!target)
        return null
      if (isModellessTarget(target))
        seen.push({ provider: providerId, model: '', voice: target.voice.id })

      const provider = await providers.getProviderInstance(providerId) as never
      if (!provider || !request.text)
        return null

      const audio = await speech.speech(provider, target.model, request.text, target.voice.id, {})
      seen.push({ provider: providerId, model: target.model, voice: target.voice.id })
      return audio as unknown as AudioBuffer
    }

    return { tts, seen }
  }

  /**
   * Persisted config -> hydrated runtime -> assistant segments -> provider.
   *
   * Scope, stated plainly: this drives the pipeline at the boundary the
   * segmenter itself uses - the per-segment `tts` callback - with one call per
   * segment the assistant produced. The segmenter's own host wiring is covered
   * by `libs/speech/tts-fallback.pipeline.test.ts`, which drives the real
   * `createSpeechPipeline`; wiring a host here would duplicate that without
   * adding coverage of the Lia path.
   *
   * What is real and shared with production: the Lia voice store and its
   * persistence bridge, `hydrateRuntime()`, the speech store,
   * `resolveSynthesisTarget` (the very function `Stage.vue` calls) and
   * `speechStore.speech()`.
   */
  async function runAssistantTurn(persisted: LiaVoiceConfig, segments = ['Oi! ', 'Que bom te ver.']) {
    ipc.getVoiceConfig.mockResolvedValue(structuredClone(persisted))
    const voiceStore = useLiaVoiceStore()
    await voiceStore.hydrateRuntime()

    const speech = useSpeechStore()
    const providers = useProviderStore()
    const { tts, seen } = makeTtsCallback()

    for (const text of segments)
      await tts({ text })

    return { speech, providers, seen }
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    synth.calls.length = 0
    const providers = useProviderStore()
    vi.spyOn(providers, 'getProviderInstance').mockResolvedValue(makeProviderStub() as never)
  })

  it('carries the persisted voice all the way to the provider', async () => {
    const { speech, seen } = await runAssistantTurn({
      tts: { preferred: { providerId: KOKORO, voiceId: VOICE, modelId: NO_MODEL }, fallback: [] },
    })

    // Hydration applied the persisted target rather than leaving the default.
    expect(speech.activeSpeechProvider).toBe(KOKORO)
    expect(speech.activeSpeechVoiceId).toBe(VOICE)

    // The segmenter produced at least one segment and it reached the provider.
    expect(synth.calls.length).toBeGreaterThan(0)
    expect(synth.calls[0]?.voice).toBe(VOICE)
    expect(synth.calls[0]?.model).toBe(NO_MODEL)
    expect(synth.calls[0]?.input.length).toBeGreaterThan(0)
    expect(seen[0]).toMatchObject({ provider: KOKORO, voice: VOICE })
  })

  it('speaks even though the provider publishes no model catalogue', async () => {
    // This is the regression itself: Kokoro has no models, so `activeSpeechModel`
    // is empty. The old `if (!model || !voice) return null` dropped everything.
    const { speech } = await runAssistantTurn({
      tts: { preferred: { providerId: KOKORO, voiceId: VOICE, modelId: NO_MODEL }, fallback: [] },
    })

    expect(speech.activeSpeechModel).toBe('')
    expect(synth.calls.length).toBeGreaterThan(0)
  })

  it('stays silent - and only silent - when nothing is configured', async () => {
    const { speech } = await runAssistantTurn({ tts: {} })

    // The runtime is still on its own default, which is the no-output provider.
    expect(speech.activeSpeechProvider).toBe('speech-noop')
    expect(synth.calls).toHaveLength(0)
  })

  it('does not synthesize through speech-noop even with a leftover voice id', async () => {
    // `activeSpeechVoiceId` is its own persisted setting, so it can outlive the
    // provider it belonged to. With nothing configured the runtime sits on the
    // no-output provider; a stale voice id must not be enough to start speaking.
    const { speech } = await runAssistantTurn({ tts: {} }, [])

    expect(speech.activeSpeechProvider).toBe('speech-noop')
    speech.activeSpeechVoiceId = 'af_heart'

    const { tts } = makeTtsCallback()
    await tts({ text: 'Oi! Que bom te ver.' })

    expect(synth.calls).toHaveLength(0)
  })

  it('does not let speech-noop take over after a configured hydration', async () => {
    const { speech } = await runAssistantTurn({
      tts: { preferred: { providerId: KOKORO, voiceId: VOICE, modelId: NO_MODEL }, fallback: [] },
    })

    expect(speech.activeSpeechProvider).not.toBe('speech-noop')
    expect(synth.calls.length).toBeGreaterThan(0)
  })
})
