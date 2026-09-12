import type { LiaVoiceConfig } from '../../../shared/eventa'

import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 4E-2 commit 2: the preview's audio boundary.
 *
 * The interesting risk here is not the sound, it is the credential. The preview
 * has to authenticate with the provider exactly like the runtime does, which
 * means reading the provider config - so the assertion that matters is that the
 * key goes straight to `speech()` and nowhere near the UI state, the persisted
 * payload or the card.
 *
 * Synthesis is stubbed at `speechStore.speech`, the same call the stage makes,
 * and returns an empty buffer so the driver stops before it needs an
 * `AudioContext` (there is none in the node project).
 */

const SECRET = 'sk-this-must-never-reach-the-ui'

const ipc = vi.hoisted(() => ({
  getVoiceConfig: vi.fn(async (): Promise<unknown> => ({ tts: {} })),
  saveVoiceConfig: vi.fn(async (_config: unknown) => {
    structuredClone(_config)
  }),
}))

type CardSpeech = { provider?: string, model?: string, voice_id?: string } | undefined

const card = vi.hoisted(() => ({
  speech: undefined as CardSpeech,
  persona: { language: { character: 'pt-BR' } },
  updateActiveCardSpeech: vi.fn(async (_speech: CardSpeech) => true),
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
  useI18n: () => ({
    locale: { value: 'pt-BR' },
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

vi.mock('@proj-airi/stage-ui/stores/modules/airi-card', () => ({
  useAiriCardStore: () => card,
}))

const PERSISTED = {
  tts: { preferred: { providerId: 'kokoro-local', modelId: 'kokoro-82m', voiceId: 'af_heart' }, fallback: [] },
}

describe('lia voice preview driver (4E-2 commit 2)', async () => {
  const { createVoicePreviewDriver } = await import('./voice-preview')
  const { useVoiceEditor } = await import('./voice-editor')

  let speechArgs: unknown[] = []

  beforeEach(() => {
    setActivePinia(createPinia())
    speechArgs = []

    ipc.getVoiceConfig.mockReset()
    ipc.getVoiceConfig.mockResolvedValue(PERSISTED)
    ipc.saveVoiceConfig.mockReset()
    ipc.saveVoiceConfig.mockImplementation(async (config: unknown) => {
      structuredClone(config)
    })

    card.speech = undefined
    card.updateActiveCardSpeech.mockReset()
    card.updateActiveCardSpeech.mockImplementation(async (speech: CardSpeech) => {
      card.speech = speech
      return true
    })
    card.persistActiveCardModuleSelections.mockReset()
    card.persistActiveCardModuleSelections.mockResolvedValue(undefined)

    vi.spyOn(useProviderStore(), 'listProviderVoices').mockResolvedValue([] as never)
    vi.spyOn(useProviderConfigStore(), 'getProviderConfig').mockReturnValue({ apiKey: SECRET })
    vi.spyOn(useProviderStore(), 'getProviderInstance').mockResolvedValue({ speech: () => ({}) } as never)
    vi.spyOn(useSpeechStore(), 'speech').mockImplementation(async (...args: unknown[]) => {
      speechArgs = args
      // Empty on purpose: the driver returns before needing an AudioContext.
      return new ArrayBuffer(0)
    })
  })

  /** An editor wired to the real driver, over the persisted configuration. */
  async function setup() {
    const editor = useVoiceEditor({ preview: createVoicePreviewDriver() })
    await editor.hydrate()
    return editor
  }

  it('synthesizes the sample through the existing speech runtime', async () => {
    const editor = await setup()

    await editor.playPreview()

    const speech = useSpeechStore().speech
    expect(speech).toHaveBeenCalledTimes(1)
    // (provider, model, input, voice, providerConfig, analytics)
    expect(speechArgs[1]).toBe('kokoro-82m')
    expect(speechArgs[2]).toBe('Olá! Eu sou a Lia.')
    expect(speechArgs[3]).toBe('af_heart')
    expect(editor.previewState.value).toBe('idle')
  })

  it('hands the credential to the provider and keeps it out of the UI', async () => {
    const editor = await setup()
    const writesBefore = ipc.saveVoiceConfig.mock.calls.length

    await editor.playPreview()

    // Positive control: the key really was read and really reached synthesis,
    // so the assertions below are not passing on an empty path.
    expect(JSON.stringify(speechArgs[4])).toContain(SECRET)

    // It never becomes part of the persisted configuration...
    expect(JSON.stringify(ipc.saveVoiceConfig.mock.calls)).not.toContain(SECRET)
    // ...nor of the card projection...
    expect(JSON.stringify(card.updateActiveCardSpeech.mock.calls)).not.toContain(SECRET)
    // ...nor of anything the editor exposes to the template.
    const exposed = JSON.stringify({
      providers: editor.providerOptions.value,
      voices: editor.voiceOptions.value,
      models: editor.modelOptions.value,
      reserveVoices: editor.fallbackVoiceOptions.value,
      selected: [
        editor.selectedProviderId.value,
        editor.selectedVoiceId.value,
        editor.selectedModelId.value,
      ],
      reserve: editor.fallbackTarget.value,
      preview: [editor.previewState.value, editor.previewError.value],
      saveError: editor.saveError.value,
    })
    expect(exposed).not.toContain(SECRET)

    // And previewing wrote nothing at all.
    expect(ipc.saveVoiceConfig.mock.calls).toHaveLength(writesBefore)
  })

  it('reports a synthesis failure instead of swallowing it', async () => {
    vi.spyOn(useSpeechStore(), 'speech').mockRejectedValue(new Error('provider is not configured'))
    const editor = await setup()

    await editor.playPreview()

    expect(editor.previewState.value).toBe('error')
    expect(editor.previewError.value).toContain('provider is not configured')
  })

  it('refuses to preview when the provider instance cannot be created', async () => {
    vi.spyOn(useProviderStore(), 'getProviderInstance').mockResolvedValue(undefined as never)
    const editor = await setup()

    await editor.playPreview()

    expect(editor.previewState.value).toBe('error')
    expect(editor.previewError.value).toContain('kokoro-local')
  })

  it('leaves the persisted configuration exactly as it was', async () => {
    const editor = await setup()
    await editor.selectVoice('bf_emma')
    const before = JSON.stringify(ipc.saveVoiceConfig.mock.calls.at(-1)?.[0] as LiaVoiceConfig)
    expect(before).toContain('bf_emma')

    await editor.playPreview()

    // The last write is still the one the user made; the preview added none.
    expect(JSON.stringify(ipc.saveVoiceConfig.mock.calls.at(-1)?.[0])).toBe(before)
  })
})
