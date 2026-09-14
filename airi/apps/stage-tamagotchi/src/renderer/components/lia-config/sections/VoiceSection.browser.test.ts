import type { LiaVoiceConfig } from '../../../../shared/eventa'

import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'

import VoiceSection from './VoiceSection.vue'

import { useLiaVoiceStore } from '../../../stores/lia/voice'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

/**
 * Mounting half of the voice UI (4E-2 commit 2).
 *
 * This is the file that needs a real DOM: it proves that *mount alone* loads the
 * persisted configuration, that a change in a `<select>` really reaches
 * `saveTtsConfiguration`, and that hearing a sample writes nothing. None of that
 * is observable through SSR rendering, which is what
 * `VoiceSection.test.ts` covers.
 *
 * NOTE: this suite runs in vitest's `browser` project and needs a browser
 * binary. It was written against the same locator API the 4E-1 version used.
 */

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

const preview = vi.hoisted(() => ({
  calls: [] as { providerId: string, voiceId?: string, text: string }[],
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
    // Rendering keys keeps assertions exact; `lia-config.test.ts` is what proves
    // those keys exist in both locales.
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

vi.mock('@proj-airi/stage-ui/stores/modules/airi-card', () => ({
  useAiriCardStore: () => card,
}))

// The sample needs no sound card here: what matters is which target it was
// asked to speak, and that asking changed nothing.
vi.mock('../../../stores/lia/voice-preview', () => ({
  createVoicePreviewDriver: () => async (
    target: { providerId: string, voiceId?: string },
    text: string,
  ) => {
    preview.calls.push({ providerId: target.providerId, voiceId: target.voiceId, text })
  },
}))

const TT = 'tamagotchi.home.config.sections.voice'

const KOKORO_VOICES = [
  { id: 'af_heart', name: 'Heart (English, female)', provider: 'kokoro-local' },
  { id: 'bf_emma', name: 'Emma (English, female)', provider: 'kokoro-local' },
]

const CONFIGURED = {
  tts: {
    preferred: { providerId: 'kokoro-local', voiceId: 'af_heart' },
    fallback: [{ providerId: 'kokoro-local', voiceId: 'bf_emma' }],
  },
}

/** Mounts the section on a fresh pinia. Deliberately does NOT load the config. */
async function mountSection(persisted: unknown = { tts: {} }) {
  const pinia = createPinia()
  setActivePinia(pinia)

  vi.spyOn(useProviderStore(), 'listProviderVoices').mockImplementation(async (providerId: string) =>
    providerId === 'kokoro-local' ? KOKORO_VOICES as never : [] as never)

  ipc.getVoiceConfig.mockResolvedValue(persisted)

  const screen = await render(VoiceSection, { global: { plugins: [pinia] } })
  return { pinia, screen, store: useLiaVoiceStore(pinia), speech: useSpeechStore(pinia) }
}

function lastSent(): LiaVoiceConfig | undefined {
  return ipc.saveVoiceConfig.mock.calls.at(-1)?.[0] as LiaVoiceConfig | undefined
}

describe('voice section mounting (4E-2 voice UI)', () => {
  beforeEach(() => {
    ipc.getVoiceConfig.mockReset()
    ipc.getVoiceConfig.mockResolvedValue({ tts: {} })
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

    preview.calls.length = 0
  })

  it('loads the persisted configuration on mount, with no explicit load call', async () => {
    const { screen, store } = await mountSection(CONFIGURED)

    // The 4E-1 regression guard: mounting alone must populate the store.
    await vi.waitFor(() => expect(store.isLoaded).toBe(true))

    await expect.element(screen.getByTestId('lia-config-voice-provider')).toHaveValue('kokoro-local')
    await expect.element(screen.getByTestId('lia-config-voice-note')).toHaveTextContent(`${TT}.configured`)
  })

  it('never writes the configuration just for being opened', async () => {
    const { store } = await mountSection(CONFIGURED)

    await vi.waitFor(() => expect(store.isLoaded).toBe(true))

    expect(ipc.getVoiceConfig).toHaveBeenCalledTimes(1)
    expect(ipc.saveVoiceConfig).not.toHaveBeenCalled()
  })

  it('persists a provider chosen from the dropdown', async () => {
    const { screen } = await mountSection()

    await screen.getByTestId('lia-config-voice-provider').selectOptions('kokoro-local')

    await vi.waitFor(() => expect(lastSent()?.tts?.preferred).toEqual({ providerId: 'kokoro-local' }))
    await expect.element(screen.getByTestId('lia-config-voice-voice')).toBeInTheDocument()
  })

  it('persists the whole target when a voice is chosen', async () => {
    const { screen } = await mountSection(CONFIGURED)
    await vi.waitFor(() => expect(screen.getByTestId('lia-config-voice-voice').element()).toBeTruthy())

    await screen.getByTestId('lia-config-voice-voice').selectOptions('bf_emma')

    await vi.waitFor(() =>
      expect(lastSent()?.tts?.preferred).toEqual({ providerId: 'kokoro-local', voiceId: 'bf_emma' }))
  })

  it('turns "Nenhuma" into an empty fallback array', async () => {
    const { screen } = await mountSection(CONFIGURED)
    await vi.waitFor(() => expect(screen.getByTestId('lia-config-voice-reserve-voice').element()).toBeTruthy())

    await screen.getByTestId('lia-config-voice-reserve-provider').selectOptions('')

    await vi.waitFor(() => expect(lastSent()?.tts?.fallback).toEqual([]))
  })

  it('previews the selected voice and writes nothing while doing it', async () => {
    const { screen } = await mountSection(CONFIGURED)
    await vi.waitFor(() => expect(screen.getByTestId('lia-config-voice-preview').element()).toBeTruthy())

    const writesBefore = ipc.saveVoiceConfig.mock.calls.length
    await screen.getByTestId('lia-config-voice-preview').click()

    await vi.waitFor(() => expect(preview.calls).toHaveLength(1))
    expect(preview.calls[0]).toEqual({
      providerId: 'kokoro-local',
      voiceId: 'af_heart',
      text: 'Olá! Eu sou a Lia.',
    })
    expect(ipc.saveVoiceConfig.mock.calls).toHaveLength(writesBefore)
  })

  it('shows the persisted values again after a restart', async () => {
    const first = await mountSection(CONFIGURED)
    await vi.waitFor(() => expect(first.store.isLoaded).toBe(true))

    const second = await mountSection(CONFIGURED)
    await vi.waitFor(() => expect(second.store.isLoaded).toBe(true))

    await expect.element(second.screen.getByTestId('lia-config-voice-provider')).toHaveValue('kokoro-local')
    await expect.element(second.screen.getByTestId('lia-config-voice-voice')).toHaveValue('af_heart')
  })
})
