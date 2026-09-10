import type { LiaVoiceConfig, LiaVoiceTtsTarget } from '../../../shared/eventa'

import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { electronLiaVoiceConfigGet, electronLiaVoiceConfigSet } from '../../../shared/eventa'

/**
 * Renderer half of the Lia `voice.tts` bridge (4D-2).
 *
 * Mocking follows the patterns already in this repo:
 *  - the IPC edge is mocked exactly like `../tools/mcp.test.ts` /
 *    `../settings/server-channel.test.ts` (`useElectronEventaInvoke` keyed on the
 *    channel's `receiveEvent.id`);
 *  - the speech runtime is the REAL `useSpeechStore` from stage-ui, with only
 *    `vue-i18n` mocked and `listProviderVoices` spied — the same two edges
 *    `packages/stage-ui/src/stores/modules/speech.test.ts` stubs. The store
 *    under test and the speech store it writes to are never mocked.
 */

const ipc = vi.hoisted(() => ({
  getVoiceConfig: vi.fn(async (): Promise<unknown> => ({ tts: {} })),
  saveVoiceConfig: vi.fn(async (_config: LiaVoiceConfig) => {}),
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

const PREFERRED: LiaVoiceTtsTarget = {
  providerId: 'openai-compatible-audio-speech',
  modelId: 'tts-1',
  voiceId: 'alloy',
}
const FALLBACK_A: LiaVoiceTtsTarget = {
  providerId: 'kokoro-local',
  modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  voiceId: 'af_sky',
}
const FALLBACK_B: LiaVoiceTtsTarget = { providerId: 'voicevox' }
const FALLBACK_C: LiaVoiceTtsTarget = { providerId: 'aivis-speech', voiceId: 'lia' }

/** The payload the store last sent over the Set channel (asserted non-empty). */
function lastSentConfig(): LiaVoiceConfig {
  const call = ipc.saveVoiceConfig.mock.calls.at(-1)
  if (!call)
    throw new Error('saveVoiceConfig was never called')
  return call[0]
}

describe('lia voice store (4D-2)', async () => {
  const { useLiaVoiceStore } = await import('./voice')

  let speechStore: ReturnType<typeof useSpeechStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    ipc.getVoiceConfig.mockReset()
    ipc.saveVoiceConfig.mockReset()
    ipc.getVoiceConfig.mockResolvedValue({ tts: {} })
    ipc.saveVoiceConfig.mockResolvedValue(undefined)

    const providersStore = useProviderStore()
    // Same edge `speech.test.ts` stubs: no voice catalog is fetched over IPC.
    vi.spyOn(providersStore, 'listProviderVoices').mockResolvedValue([])

    speechStore = useSpeechStore()
  })

  it('matches the channel ids the IPC mock is keyed on', () => {
    expect(electronLiaVoiceConfigGet.receiveEvent.id).toBe('eventa:invoke:lia:voice:config:get-receive')
    expect(electronLiaVoiceConfigSet.receiveEvent.id).toBe('eventa:invoke:lia:voice:config:set-receive')
  })

  it('load without configuration yields an empty state and an empty chain', async () => {
    const store = useLiaVoiceStore()

    const state = await store.refreshConfig()

    expect(ipc.getVoiceConfig).toHaveBeenCalledTimes(1)
    expect(state).toEqual({ fallback: [] })
    expect(store.preferred).toBeUndefined()
    expect(store.fallback).toEqual([])
    expect(store.voiceTargetChain).toEqual([])
    expect(store.hasConfiguration).toBe(false)
    expect(store.isLoaded).toBe(true)
    expect(store.resolveCurrentVoiceTarget()).toBeUndefined()
  })

  it('load with a preferred target normalizes it and materializes fallback as []', async () => {
    ipc.getVoiceConfig.mockResolvedValue({ tts: { preferred: PREFERRED } })
    const store = useLiaVoiceStore()

    const state = await store.refreshConfig()

    expect(state).toEqual({ preferred: PREFERRED, fallback: [] })
    expect(store.preferred).toEqual(PREFERRED)
    expect(store.fallback).toEqual([])
  })

  it('load with preferred + fallback keeps the order', async () => {
    ipc.getVoiceConfig.mockResolvedValue({ tts: { preferred: PREFERRED, fallback: [FALLBACK_A, FALLBACK_B] } })
    const store = useLiaVoiceStore()

    await store.refreshConfig()

    expect(store.preferred).toEqual(PREFERRED)
    expect(store.fallback).toEqual([FALLBACK_A, FALLBACK_B])
    expect(store.voiceTargetChain).toEqual([PREFERRED, FALLBACK_A, FALLBACK_B])
  })

  it('load with multiple fallbacks and no preferred starts the chain at fallback[0]', async () => {
    ipc.getVoiceConfig.mockResolvedValue({ tts: { fallback: [FALLBACK_A, FALLBACK_B, FALLBACK_C] } })
    const store = useLiaVoiceStore()

    await store.refreshConfig()

    expect(store.preferred).toBeUndefined()
    expect(store.voiceTargetChain).toEqual([FALLBACK_A, FALLBACK_B, FALLBACK_C])
    // Documented decision: a configured fallback is usable, so the chain simply
    // starts there instead of requiring a preferred target.
    expect(store.resolveCurrentVoiceTarget()).toEqual(FALLBACK_A)
    expect(store.hasConfiguration).toBe(true)
  })

  it('drops malformed targets while loading instead of poisoning the chain', async () => {
    ipc.getVoiceConfig.mockResolvedValue({
      tts: {
        preferred: { modelId: 'orphan-without-provider' },
        fallback: [FALLBACK_A, 'not-an-object', null, { providerId: '' }, { providerId: 'elevenlabs', apiKey: 'sk-x' }],
      },
    })
    const store = useLiaVoiceStore()

    const state = await store.refreshConfig()

    expect(state.preferred).toBeUndefined()
    expect(state.fallback).toEqual([FALLBACK_A, { providerId: 'elevenlabs' }])
  })

  it('a reload resets the cursor, so a stale failure position never survives a new configuration', async () => {
    ipc.getVoiceConfig.mockResolvedValue({ tts: { preferred: PREFERRED, fallback: [FALLBACK_A, FALLBACK_B] } })
    const store = useLiaVoiceStore()
    await store.refreshConfig()

    store.nextVoiceTargetOnFailure()
    store.nextVoiceTargetOnFailure()
    expect(store.resolveCurrentVoiceTarget()).toEqual(FALLBACK_B)

    ipc.getVoiceConfig.mockResolvedValue({ tts: { preferred: FALLBACK_C, fallback: [FALLBACK_A] } })
    await store.refreshConfig()

    expect(store.activeTargetIndex).toBe(0)
    expect(store.resolveCurrentVoiceTarget()).toEqual(FALLBACK_C)
    expect(store.voiceTargetChain).toEqual([FALLBACK_C, FALLBACK_A])
  })

  it('resolves the preferred target first', async () => {
    ipc.getVoiceConfig.mockResolvedValue({ tts: { preferred: PREFERRED, fallback: [FALLBACK_A, FALLBACK_B] } })
    const store = useLiaVoiceStore()
    await store.refreshConfig()

    expect(store.activeTargetIndex).toBe(0)
    expect(store.resolveCurrentVoiceTarget()).toEqual(PREFERRED)
  })

  it('nextVoiceTargetOnFailure walks the chain and stops at the end', async () => {
    ipc.getVoiceConfig.mockResolvedValue({ tts: { preferred: PREFERRED, fallback: [FALLBACK_A, FALLBACK_B] } })
    const store = useLiaVoiceStore()
    await store.refreshConfig()

    expect(store.nextVoiceTargetOnFailure()).toEqual(FALLBACK_A)
    expect(store.resolveCurrentVoiceTarget()).toEqual(FALLBACK_A)
    expect(store.nextVoiceTargetOnFailure()).toEqual(FALLBACK_B)
    expect(store.resolveCurrentVoiceTarget()).toEqual(FALLBACK_B)
    // Exhausted: stays on the last target and reports there is nothing left.
    expect(store.nextVoiceTargetOnFailure()).toBeUndefined()
    expect(store.resolveCurrentVoiceTarget()).toEqual(FALLBACK_B)
    expect(store.nextVoiceTargetOnFailure()).toBeUndefined()
  })

  it('nextVoiceTargetOnFailure is prepared but NOT activated — it never touches the speech runtime', async () => {
    ipc.getVoiceConfig.mockResolvedValue({ tts: { preferred: PREFERRED, fallback: [FALLBACK_A] } })
    const store = useLiaVoiceStore()
    await store.refreshConfig()

    // Non-default runtime state, so an unwanted write would be visible.
    speechStore.activeSpeechProvider = 'voicevox'
    speechStore.activeSpeechModel = 'preexisting-model'
    speechStore.activeSpeechVoiceId = 'preexisting-voice'
    await nextTick()

    const before = {
      provider: speechStore.activeSpeechProvider,
      model: speechStore.activeSpeechModel,
      voiceId: speechStore.activeSpeechVoiceId,
    }

    expect(store.nextVoiceTargetOnFailure()).toEqual(FALLBACK_A)
    await nextTick()

    expect(speechStore.activeSpeechProvider).toBe(before.provider)
    expect(speechStore.activeSpeechModel).toBe(before.model)
    expect(speechStore.activeSpeechVoiceId).toBe(before.voiceId)
  })

  it('resetVoiceTarget points back at the preferred target without applying it', async () => {
    ipc.getVoiceConfig.mockResolvedValue({ tts: { preferred: PREFERRED, fallback: [FALLBACK_A, FALLBACK_B] } })
    const store = useLiaVoiceStore()
    await store.refreshConfig()

    store.nextVoiceTargetOnFailure()
    store.nextVoiceTargetOnFailure()
    expect(store.resolveCurrentVoiceTarget()).toEqual(FALLBACK_B)

    store.resetVoiceTarget()

    expect(store.activeTargetIndex).toBe(0)
    expect(store.resolveCurrentVoiceTarget()).toEqual(PREFERRED)
  })

  it('applies provider, model and voice to the existing speech runtime', async () => {
    const store = useLiaVoiceStore()

    const applied = await store.applyVoiceTarget(PREFERRED)
    await nextTick()

    expect(applied).toBe(true)
    expect(speechStore.activeSpeechProvider).toBe(PREFERRED.providerId)
    expect(speechStore.activeSpeechModel).toBe(PREFERRED.modelId)
    expect(speechStore.activeSpeechVoiceId).toBe(PREFERRED.voiceId)
  })

  it('clears the model and voice when the target does not carry them', async () => {
    const store = useLiaVoiceStore()

    await store.applyVoiceTarget(PREFERRED)
    await nextTick()
    await store.applyVoiceTarget(FALLBACK_B)
    await nextTick()

    expect(speechStore.activeSpeechProvider).toBe('voicevox')
    // The previous provider's model/voice must not leak into the new provider.
    expect(speechStore.activeSpeechModel).toBe('')
    expect(speechStore.activeSpeechVoiceId).toBe('')
  })

  it('applyResolvedTarget applies the target the cursor points at', async () => {
    ipc.getVoiceConfig.mockResolvedValue({ tts: { preferred: PREFERRED, fallback: [FALLBACK_A] } })
    const store = useLiaVoiceStore()
    await store.refreshConfig()

    expect(await store.applyResolvedTarget()).toBe(true)
    expect(speechStore.activeSpeechProvider).toBe(PREFERRED.providerId)

    store.nextVoiceTargetOnFailure()
    expect(await store.applyResolvedTarget()).toBe(true)
    await nextTick()
    expect(speechStore.activeSpeechProvider).toBe(FALLBACK_A.providerId)
    expect(speechStore.activeSpeechVoiceId).toBe(FALLBACK_A.voiceId)
  })

  it('persists the full tts slice and round-trips it back through load', async () => {
    const store = useLiaVoiceStore()

    await store.updateTtsConfig({ preferred: PREFERRED, fallback: [FALLBACK_A, FALLBACK_B] })

    expect(ipc.saveVoiceConfig).toHaveBeenCalledTimes(1)
    const sent = lastSentConfig()
    expect(sent).toEqual({
      tts: { preferred: PREFERRED, fallback: [FALLBACK_A, FALLBACK_B] },
    })

    // Round-trip: feed exactly what was sent back through the Get channel.
    ipc.getVoiceConfig.mockResolvedValue(sent)
    const store2 = useLiaVoiceStore()
    const reloaded = await store2.refreshConfig()

    expect(reloaded).toEqual({ preferred: PREFERRED, fallback: [FALLBACK_A, FALLBACK_B] })
  })

  it('always sends fallback as an array so a replace cannot drop it by omission', async () => {
    const store = useLiaVoiceStore()

    await store.updateTtsConfig({ preferred: PREFERRED })

    const sent = lastSentConfig()
    expect(sent).toEqual({ tts: { preferred: PREFERRED, fallback: [] } })
    expect(Array.isArray(sent.tts?.fallback)).toBe(true)
  })

  it('sanitizes the outgoing payload down to providerId/modelId/voiceId', async () => {
    const store = useLiaVoiceStore()

    await store.updateTtsConfig({
      preferred: {
        ...PREFERRED,
        apiKey: 'sk-super-secret-123',
        baseUrl: 'https://example.com/v1',
        token: 'bearer-AAAA',
      } as unknown as LiaVoiceTtsTarget,
      fallback: [
        { ...FALLBACK_A, apiKey: 'sk-second' },
        'not-an-object',
        null,
        { modelId: 'orphan-without-provider' },
      ] as unknown as LiaVoiceTtsTarget[],
    })

    const sent = lastSentConfig()
    expect(sent).toEqual({
      tts: {
        preferred: PREFERRED,
        fallback: [FALLBACK_A],
      },
    })

    const raw = JSON.stringify(sent)
    expect(raw).not.toContain('sk-super-secret-123')
    expect(raw).not.toContain('sk-second')
    expect(raw).not.toContain('bearer-AAAA')
    expect(raw).not.toContain('https://example.com/v1')
    expect(raw).not.toMatch(/apiKey|api_key|token|secret|baseUrl|authorization/i)
  })

  it('never sends a voice.stt key, so the main process keeps preserving it', async () => {
    const store = useLiaVoiceStore()

    await store.updateTtsConfig({ preferred: PREFERRED, fallback: [FALLBACK_A] })

    const sent = lastSentConfig() as unknown as Record<string, unknown>
    expect(Object.keys(sent)).toEqual(['tts'])
    expect('stt' in sent).toBe(false)
  })

  it('is inert without configuration: apply is a no-op and leaves the speech runtime alone', async () => {
    // Move the runtime off its defaults first. "Left alone" is only observable
    // from a non-default state — the default provider already is 'speech-noop',
    // so an assertion from there would also pass if the store overwrote it.
    speechStore.activeSpeechProvider = 'voicevox'
    speechStore.activeSpeechModel = 'preexisting-model'
    speechStore.activeSpeechVoiceId = 'preexisting-voice'
    await nextTick()

    const store = useLiaVoiceStore()
    await store.refreshConfig()

    const before = {
      provider: speechStore.activeSpeechProvider,
      model: speechStore.activeSpeechModel,
      voiceId: speechStore.activeSpeechVoiceId,
    }

    expect(await store.applyResolvedTarget()).toBe(false)
    expect(await store.applyVoiceTarget(undefined)).toBe(false)
    await nextTick()

    expect(speechStore.activeSpeechProvider).toBe(before.provider)
    expect(speechStore.activeSpeechModel).toBe(before.model)
    expect(speechStore.activeSpeechVoiceId).toBe(before.voiceId)
    expect(ipc.saveVoiceConfig).not.toHaveBeenCalled()
  })

  it('refreshConfig is safe when the bridge answers with nothing at all', async () => {
    ipc.getVoiceConfig.mockResolvedValue(undefined)
    const store = useLiaVoiceStore()

    const state = await store.refreshConfig()

    expect(state).toEqual({ fallback: [] })
    expect(store.hasConfiguration).toBe(false)
    expect(store.loadError).toBeNull()
  })

  it('surfaces a failing Get as loadError without leaving a half-applied state', async () => {
    ipc.getVoiceConfig.mockRejectedValue(new Error('ipc down'))
    const store = useLiaVoiceStore()

    await expect(store.refreshConfig()).rejects.toThrow('ipc down')

    expect(store.loadError).toBe('ipc down')
    expect(store.isLoaded).toBe(false)
    expect(store.isLoading).toBe(false)
    expect(store.hasConfiguration).toBe(false)
  })
})
