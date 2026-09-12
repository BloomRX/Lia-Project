import type { LiaVoiceConfig, LiaVoiceTtsTarget } from '../../../shared/eventa'

import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { electronLiaVoiceConfigGet, electronLiaVoiceConfigSet } from '../../../shared/eventa'

/**
 * 4E-2 commit 1: writing `voice.tts` from the "Configurar Lia" Voice tab.
 *
 * The behaviour under test is the ordering rule closed in decision 9.2 of
 * `docs/product/M1-PHASE4E2-VOICE-PLAN.md`: `voice.tts` is the source of truth
 * and is written FIRST; the card projection is derived and written SECOND; a
 * failing projection never rolls the source back, and the next open repairs the
 * card through `resyncProjectionFromSource()`.
 *
 * Mocking follows `voice.test.ts`: the IPC edge is keyed on the channel's
 * `receiveEvent.id`, the speech runtime is the real stage-ui store, and only
 * `vue-i18n` and the voice catalog fetch are stubbed. The card store IS mocked -
 * the orchestration order and its failure modes are what these tests assert, and
 * `packages/stage-ui`'s own suite already covers the card store itself.
 */

const ipc = vi.hoisted(() => ({
  getVoiceConfig: vi.fn(async (): Promise<unknown> => ({ tts: {} })),
  saveVoiceConfig: vi.fn(async (_config: unknown) => {
    // Electron IPC serializes invoke payloads with the structured clone
    // algorithm, so a Vue reactive Proxy throws here exactly as it throws in the
    // real app.
    structuredClone(_config)
  }),
}))

/** Controllable stand-in for the active card's speech module. */
/** The slice of the AIRI card the voice store projects onto. */
type CardSpeech = { provider?: string, model?: string, voice_id?: string } | undefined

const card = vi.hoisted(() => ({
  speech: undefined as CardSpeech,
  persona: { language: { character: 'pt-BR' } },
  // Declared with its real parameter on purpose: as `async () => true`,
  // TypeScript infers a zero-argument mock and every
  // `mockImplementation(async speech => ...)` below stops type-checking.
  updateActiveCardSpeech: vi.fn(async (_speech: CardSpeech) => true),
  persistActiveCardModuleSelections: vi.fn(async () => {}),
  get activeCard() {
    return {
      id: 'lia',
      extensions: {
        airi: {
          modules: { speech: card.speech },
          persona: card.persona,
        },
      },
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
  useI18n: () => ({
    locale: { value: 'en-US' },
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

vi.mock('@proj-airi/stage-ui/stores/modules/airi-card', () => ({
  useAiriCardStore: () => card,
}))

const PREFERRED: LiaVoiceTtsTarget = {
  providerId: 'openai-compatible-audio-speech',
  modelId: 'tts-1',
  voiceId: 'alloy',
}
const RESERVE: LiaVoiceTtsTarget = {
  providerId: 'kokoro-local',
  modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  voiceId: 'af_heart',
}

/** What the store last sent over the Set channel. */
function lastSent(): LiaVoiceConfig {
  const call = ipc.saveVoiceConfig.mock.calls.at(-1)
  if (!call)
    throw new Error('saveVoiceConfig was never called')
  return call[0] as LiaVoiceConfig
}

describe('lia voice save (4E-2 commit 1)', async () => {
  const { useLiaVoiceStore } = await import('./voice')

  beforeEach(() => {
    setActivePinia(createPinia())
    ipc.getVoiceConfig.mockReset()
    ipc.getVoiceConfig.mockResolvedValue({ tts: {} })
    ipc.saveVoiceConfig.mockReset()
    ipc.saveVoiceConfig.mockImplementation(async (config: unknown) => {
      structuredClone(config)
    })

    card.speech = undefined
    card.persona = { language: { character: 'pt-BR' } }
    card.updateActiveCardSpeech.mockReset()
    card.updateActiveCardSpeech.mockImplementation(async (speech: CardSpeech) => {
      card.speech = speech
      return true
    })
    card.persistActiveCardModuleSelections.mockReset()
    card.persistActiveCardModuleSelections.mockResolvedValue(undefined)

    vi.spyOn(useProviderStore(), 'listProviderVoices').mockResolvedValue([])
    useSpeechStore()
  })

  it('persists a preferred voice', async () => {
    const store = useLiaVoiceStore()
    const result = await store.saveTtsConfiguration({ preferred: PREFERRED })

    expect(result).toEqual({ persisted: true, projected: true, failedStage: null, error: null })
    expect(lastSent().tts?.preferred).toEqual(PREFERRED)
  })

  it('persists preferred and reserve together, keeping the order', async () => {
    const store = useLiaVoiceStore()
    await store.saveTtsConfiguration({ preferred: PREFERRED, fallback: [RESERVE] })

    expect(lastSent().tts?.preferred).toEqual(PREFERRED)
    expect(lastSent().tts?.fallback).toEqual([RESERVE])
  })

  it('turns "no reserve" into an empty array, never an omitted field', async () => {
    const store = useLiaVoiceStore()
    await store.saveTtsConfiguration({ preferred: PREFERRED, fallback: [] })

    const sent = lastSent().tts
    expect(sent).toHaveProperty('fallback')
    expect(sent?.fallback).toEqual([])
    expect(sent?.fallback).not.toBeUndefined()
  })

  it('never carries a credential into voice.tts', async () => {
    const store = useLiaVoiceStore()
    await store.saveTtsConfiguration({
      preferred: { ...PREFERRED, apiKey: 'sk-secret', baseUrl: 'https://example.test' } as LiaVoiceTtsTarget,
    })

    const serialized = JSON.stringify(lastSent())
    expect(serialized).not.toContain('sk-secret')
    expect(serialized).not.toContain('apiKey')
    expect(serialized).not.toContain('authorization')
    expect(Object.keys(lastSent().tts?.preferred ?? {}).sort()).toEqual(['modelId', 'providerId', 'voiceId'])
  })

  it('writes voice.tts before projecting to the card', async () => {
    const store = useLiaVoiceStore()
    const order: string[] = []
    ipc.saveVoiceConfig.mockImplementation(async (config: unknown) => {
      structuredClone(config)
      order.push('voice.tts')
    })
    card.updateActiveCardSpeech.mockImplementation(async (speech: CardSpeech) => {
      order.push('card')
      card.speech = speech
      return true
    })

    await store.saveTtsConfiguration({ preferred: PREFERRED })

    expect(order).toEqual(['voice.tts', 'card'])
  })

  it('keeps voice.tts persisted when the card projection fails', async () => {
    const store = useLiaVoiceStore()
    card.updateActiveCardSpeech.mockRejectedValue(new Error('card write failed'))

    const result = await store.saveTtsConfiguration({ preferred: PREFERRED })

    expect(result.persisted).toBe(true)
    expect(result.projected).toBe(false)
    expect(result.failedStage).toBe('projection')
    expect(result.error).toContain('card write failed')
    // The source of truth was written and stays written.
    expect(ipc.saveVoiceConfig).toHaveBeenCalledTimes(1)
    expect(lastSent().tts?.preferred).toEqual(PREFERRED)
    expect(store.preferred).toEqual(PREFERRED)
  })

  it('reports a persist failure without projecting anything', async () => {
    const store = useLiaVoiceStore()
    ipc.saveVoiceConfig.mockRejectedValue(new Error('disk unavailable'))

    const result = await store.saveTtsConfiguration({ preferred: PREFERRED })

    expect(result).toMatchObject({ persisted: false, projected: false, failedStage: 'persist' })
    expect(result.error).toContain('disk unavailable')
    expect(card.updateActiveCardSpeech).not.toHaveBeenCalled()
  })

  it('re-syncs the card from voice.tts on the next open after a failed projection', async () => {
    const store = useLiaVoiceStore()
    card.updateActiveCardSpeech.mockRejectedValueOnce(new Error('card write failed'))

    const failed = await store.saveTtsConfiguration({ preferred: PREFERRED })
    expect(failed.projected).toBe(false)
    expect(card.speech).toBeUndefined()

    // Reopening the tab reads the persisted source and repairs the projection.
    card.updateActiveCardSpeech.mockImplementation(async (speech: CardSpeech) => {
      card.speech = speech
      return true
    })
    const resynced = await store.resyncProjectionFromSource()

    expect(resynced).toBe(true)
    expect(card.speech).toEqual({
      provider: PREFERRED.providerId,
      model: PREFERRED.modelId,
      voice_id: PREFERRED.voiceId,
    })
    expect(card.persistActiveCardModuleSelections).toHaveBeenCalled()
  })

  it('does not re-project when the card already agrees with voice.tts', async () => {
    const store = useLiaVoiceStore()
    await store.saveTtsConfiguration({ preferred: PREFERRED })
    card.updateActiveCardSpeech.mockClear()
    card.persistActiveCardModuleSelections.mockClear()

    expect(await store.resyncProjectionFromSource()).toBe(false)
    expect(card.updateActiveCardSpeech).not.toHaveBeenCalled()
  })

  it('never wipes the card when no voice is configured', async () => {
    const store = useLiaVoiceStore()
    card.speech = { provider: 'something-the-user-chose-elsewhere', model: '', voice_id: '' }

    expect(await store.resyncProjectionFromSource()).toBe(false)
    expect(card.updateActiveCardSpeech).not.toHaveBeenCalled()
    expect(card.speech?.provider).toBe('something-the-user-chose-elsewhere')
  })

  it('persists provider, model and voice into the card projection', async () => {
    const store = useLiaVoiceStore()
    await store.saveTtsConfiguration({ preferred: PREFERRED })

    expect(card.updateActiveCardSpeech).toHaveBeenCalledWith({
      provider: PREFERRED.providerId,
      model: PREFERRED.modelId,
      voice_id: PREFERRED.voiceId,
    })
  })

  it('treats the model as optional', async () => {
    const store = useLiaVoiceStore()
    const noModel: LiaVoiceTtsTarget = { providerId: 'voicevox', voiceId: 'lia' }
    await store.saveTtsConfiguration({ preferred: noModel })

    expect(lastSent().tts?.preferred).toEqual(noModel)
    expect(lastSent().tts?.preferred).not.toHaveProperty('modelId')
    expect(card.updateActiveCardSpeech).toHaveBeenCalledWith({
      provider: 'voicevox',
      model: '',
      voice_id: 'lia',
    })
  })

  it('leaves the character language untouched', async () => {
    const store = useLiaVoiceStore()
    await store.saveTtsConfiguration({ preferred: PREFERRED })

    // Voice selection and the persona's character language are different
    // concepts; saving a voice must not move the language dimension.
    expect(card.persona.language.character).toBe('pt-BR')
    const speechArg = card.updateActiveCardSpeech.mock.calls[0][0]
    expect(Object.keys(speechArg ?? {}).sort()).toEqual(['model', 'provider', 'voice_id'])
    expect(JSON.stringify(ipc.saveVoiceConfig.mock.calls)).not.toContain('language')
  })

  it('has no factory default: an untouched store configures nothing', async () => {
    const store = useLiaVoiceStore()
    await store.refreshConfig()

    expect(store.hasConfiguration).toBe(false)
    expect(store.preferred).toBeUndefined()
    expect(store.fallback).toEqual([])
    expect(ipc.saveVoiceConfig).not.toHaveBeenCalled()
  })

  it('applies the saved voice to the existing speech runtime', async () => {
    const store = useLiaVoiceStore()
    const speechStore = useSpeechStore()

    await store.saveTtsConfiguration({ preferred: PREFERRED })

    // Asserted on the runtime's own state rather than by spying on the store:
    // `saveTtsConfiguration` calls `applyVoiceTarget` through its closure, so a
    // spy on the store instance would never see it and would pass vacuously.
    expect(speechStore.activeSpeechProvider).toBe(PREFERRED.providerId)
    expect(speechStore.activeSpeechModel).toBe(PREFERRED.modelId)
    expect(speechStore.activeSpeechVoiceId).toBe(PREFERRED.voiceId)
    expect(card.updateActiveCardSpeech).toHaveBeenCalled()
  })

  it('leaves the runtime alone when the projection failed', async () => {
    const store = useLiaVoiceStore()
    const speechStore = useSpeechStore()
    const providerBefore = speechStore.activeSpeechProvider
    card.updateActiveCardSpeech.mockRejectedValue(new Error('card write failed'))

    await store.saveTtsConfiguration({ preferred: PREFERRED })

    // voice.tts is persisted, but the runtime must not start speaking a voice
    // whose projection is known to be broken.
    expect(speechStore.activeSpeechProvider).toBe(providerBefore)
  })
})

describe('lia voice save channel contract', () => {
  it('uses the existing get/set channels and no new persistence path', () => {
    expect(electronLiaVoiceConfigGet.receiveEvent.id).toBe('eventa:invoke:lia:voice:config:get-receive')
    expect(electronLiaVoiceConfigSet.receiveEvent.id).toBe('eventa:invoke:lia:voice:config:set-receive')
  })
})
