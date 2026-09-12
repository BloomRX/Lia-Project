import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'

import VoiceSection from './VoiceSection.vue'

import { useLiaVoiceStore } from '../../../stores/lia/voice'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

/**
 * Mounting half of the 4E-1 voice regression.
 *
 * The defect was that nothing in runtime called `useLiaVoiceStore.refreshConfig()`,
 * so the section read empty refs and reported "not configured" for a Lia that was
 * configured. The fix loads the persisted config when the section mounts, so the
 * assertion that matters here is the one this file can make and the SSR-render
 * companion (`VoiceSection.test.ts`) cannot: **mount alone, with no explicit
 * load call, is enough for the real values to appear.**
 *
 * The IPC edge is mocked exactly like `stores/lia/voice.test.ts` keys it, on the
 * channel's `receiveEvent.id`. The store under test is the real one.
 */

const ipc = vi.hoisted(() => ({
  getVoiceConfig: vi.fn(async (): Promise<unknown> => ({ tts: {} })),
  saveVoiceConfig: vi.fn(async () => {}),
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
    t: (key: string) => key,
  }),
}))

const TT = 'tamagotchi.home.config.sections.voice'

const CONFIGURED = {
  tts: {
    preferred: {
      providerId: 'openai-compatible-audio-speech',
      modelId: 'tts-1',
      voiceId: 'alloy',
    },
    fallback: [
      { providerId: 'kokoro-local', modelId: 'kokoro-82m', voiceId: 'af_heart' },
      { providerId: 'edge-tts', modelId: 'edge', voiceId: 'pt-BR-AntonioNeural' },
    ],
  },
}

/** Mounts the section on a fresh pinia. Deliberately does NOT load the config. */
async function mountSection() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const screen = await render(VoiceSection, {
    global: { plugins: [pinia] },
  })
  return { pinia, screen, store: useLiaVoiceStore(pinia) }
}

function rowText(screen: Awaited<ReturnType<typeof mountSection>>['screen'], field: string): string {
  return (screen.getByTestId(`lia-config-voice-${field}`).element() as HTMLElement).textContent?.trim() ?? ''
}

function noteText(screen: Awaited<ReturnType<typeof mountSection>>['screen']): string {
  return (screen.getByTestId('lia-config-voice-note').element() as HTMLElement).textContent?.trim() ?? ''
}

describe('voice section mounting (4E-1 voice config loading)', () => {
  beforeEach(() => {
    ipc.getVoiceConfig.mockReset()
    ipc.getVoiceConfig.mockResolvedValue({ tts: {} })
    ipc.saveVoiceConfig.mockReset()
    ipc.saveVoiceConfig.mockResolvedValue(undefined)
  })

  it('loads the persisted configuration on mount, with no explicit load call', async () => {
    ipc.getVoiceConfig.mockResolvedValue(CONFIGURED)
    const { screen, store } = await mountSection()

    // This is the regression guard: mounting alone must populate the store.
    await vi.waitFor(() => {
      expect(store.isLoaded).toBe(true)
    })

    expect(rowText(screen, 'provider')).toBe('openai-compatible-audio-speech')
    expect(rowText(screen, 'model')).toBe('tts-1')
    expect(rowText(screen, 'voice')).toBe('alloy')
    expect(rowText(screen, 'fallback')).toBe('2')
    expect(noteText(screen)).toBe(`${TT}.configured`)
  })

  it('keeps showing "unset" when nothing is configured', async () => {
    const { screen, store } = await mountSection()

    await vi.waitFor(() => {
      expect(store.isLoaded).toBe(true)
    })

    for (const field of ['provider', 'model', 'voice', 'fallback'])
      expect(rowText(screen, field), field).toBe(`${TT}.fields.unset`)

    expect(noteText(screen)).toBe(`${TT}.notConfigured`)
  })

  it('survives a failing refreshConfig and reports it instead of breaking', async () => {
    ipc.getVoiceConfig.mockRejectedValue(new Error('bridge unavailable'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { screen, store } = await mountSection()

    await vi.waitFor(() => {
      expect(store.loadError).not.toBeNull()
    })

    expect(noteText(screen)).toBe(`${TT}.loadError`)
    // The rows still render: a failed read degrades to "unset", not to a crash.
    expect(rowText(screen, 'provider')).toBe(`${TT}.fields.unset`)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('never writes the configuration just for being opened', async () => {
    ipc.getVoiceConfig.mockResolvedValue(CONFIGURED)
    const { store } = await mountSection()

    await vi.waitFor(() => {
      expect(store.isLoaded).toBe(true)
    })

    // Reading goes through the existing get channel only; the set channel is
    // never touched, so opening the panel cannot change what is persisted.
    expect(ipc.getVoiceConfig).toHaveBeenCalledTimes(1)
    expect(ipc.saveVoiceConfig).not.toHaveBeenCalled()
  })

  it('shows the same values after a restart', async () => {
    ipc.getVoiceConfig.mockResolvedValue(CONFIGURED)

    const first = await mountSection()
    await vi.waitFor(() => {
      expect(first.store.isLoaded).toBe(true)
    })
    const before = ['provider', 'model', 'voice', 'fallback'].map(field => rowText(first.screen, field))

    // A restart is a new app, a new pinia and a new store over the same
    // persisted config.
    const second = await mountSection()
    await vi.waitFor(() => {
      expect(second.store.isLoaded).toBe(true)
    })
    const after = ['provider', 'model', 'voice', 'fallback'].map(field => rowText(second.screen, field))

    expect(before).toEqual(['openai-compatible-audio-speech', 'tts-1', 'alloy', '2'])
    expect(after).toEqual(before)
  })
})
