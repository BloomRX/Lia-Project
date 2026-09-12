import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

import VoiceSection from './VoiceSection.vue'

import { useLiaVoiceStore } from '../../../stores/lia/voice'

/**
 * Rendering half of the 4E-1 voice regression: with a loaded store the section
 * must show the persisted values, and with nothing persisted it must keep saying
 * "unset" instead of inventing a configuration.
 *
 * This runs in the `node` project through `renderToString`. Vitest processes
 * modules in SSR mode, so `@vitejs/plugin-vue` gives each SFC an `ssrRender`
 * (and no client `render`) - SSR rendering is therefore the path that actually
 * executes this template here, and it needs no DOM.
 *
 * Mounting the section - which is what triggers the persisted load - is covered
 * by `VoiceSection.browser.test.ts`, since `onMounted` does not run during SSR.
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

/** Renders the section against a freshly created, already loaded store. */
async function renderSection(): Promise<string> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useLiaVoiceStore()
  await store.refreshConfig().catch(() => {})
  return renderToString(createSSRApp(VoiceSection).use(pinia))
}

function strip(fragment: string): string {
  return fragment
    // A marker that ends inside a tag leaves the rest of that opening tag here.
    .replace(/^[^<>]*>/, '')
    .replace(/<!--[^>]*-->/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

/** Text between two markers, or '' when either is absent. */
function between(haystack: string, start: string, end: string): string {
  const from = haystack.indexOf(start)
  if (from < 0)
    return ''
  const rest = haystack.slice(from + start.length)
  const to = end ? rest.indexOf(end) : rest.length
  return to < 0 ? '' : rest.slice(0, to)
}

/** The visible value of the row carrying `data-testid="lia-config-voice-<field>"`. */
function rowValue(html: string, field: string): string {
  const row = between(html, `data-testid="lia-config-voice-${field}"`, '</dl>')
  return strip(between(row, '</dt>', '</dd>'))
}

function noteText(html: string): string {
  return strip(between(html, 'data-testid="lia-config-voice-note"', '</p>'))
}

describe('voice section rendering (4E-1 voice config)', () => {
  beforeEach(() => {
    ipc.getVoiceConfig.mockReset()
    ipc.getVoiceConfig.mockResolvedValue({ tts: {} })
    ipc.saveVoiceConfig.mockReset()
    ipc.saveVoiceConfig.mockResolvedValue(undefined)
  })

  it('shows the persisted provider, model, voice and fallback count', async () => {
    ipc.getVoiceConfig.mockResolvedValue(CONFIGURED)
    const html = await renderSection()

    expect(rowValue(html, 'provider')).toBe('openai-compatible-audio-speech')
    expect(rowValue(html, 'model')).toBe('tts-1')
    expect(rowValue(html, 'voice')).toBe('alloy')
    expect(rowValue(html, 'fallback')).toBe('2')
    expect(noteText(html)).toBe(`${TT}.configured`)
  })

  it('keeps showing "unset" when nothing is configured', async () => {
    const html = await renderSection()

    for (const field of ['provider', 'model', 'voice', 'fallback'])
      expect(rowValue(html, field), field).toBe(`${TT}.fields.unset`)

    expect(noteText(html)).toBe(`${TT}.notConfigured`)
  })

  it('reports a failing read instead of breaking the section', async () => {
    ipc.getVoiceConfig.mockRejectedValue(new Error('bridge unavailable'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const html = await renderSection()

    expect(noteText(html)).toBe(`${TT}.loadError`)
    // A failed read degrades every row to "unset" rather than throwing.
    expect(rowValue(html, 'provider')).toBe(`${TT}.fields.unset`)
    warn.mockRestore()
  })

  it('never writes the configuration just for being displayed', async () => {
    ipc.getVoiceConfig.mockResolvedValue(CONFIGURED)
    await renderSection()

    // The section reads through the existing get channel only, so showing it
    // cannot change what is persisted.
    expect(ipc.getVoiceConfig).toHaveBeenCalledTimes(1)
    expect(ipc.saveVoiceConfig).not.toHaveBeenCalled()
  })

  it('renders the same values after a restart', async () => {
    ipc.getVoiceConfig.mockResolvedValue(CONFIGURED)

    // A restart is a new store reading the same persisted config.
    const before = await renderSection()
    const after = await renderSection()

    const fields = ['provider', 'model', 'voice', 'fallback'].map(field => rowValue(before, field))
    expect(fields).toEqual(['openai-compatible-audio-speech', 'tts-1', 'alloy', '2'])
    for (const field of ['provider', 'model', 'voice', 'fallback'])
      expect(rowValue(after, field)).toBe(rowValue(before, field))
  })
})
