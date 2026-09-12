import type { LiaVoiceConfig } from '../../../../shared/eventa'

import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

import VoiceSection from './VoiceSection.vue'

import { useLiaVoiceStore } from '../../../stores/lia/voice'

/**
 * Rendering half of the 4E-2 voice UI.
 *
 * Runs in the `node` project through `renderToString`: vitest processes modules
 * in SSR mode, so `@vitejs/plugin-vue` gives the SFC an `ssrRender` and no
 * client `render`. What this file proves is the part a composable test cannot -
 * **what a user actually reads on screen**: friendly names instead of technical
 * ids, fields that disappear when the runtime has nothing real to offer, and an
 * explanatory state instead of an invented voice list.
 *
 * `onMounted` does not run during SSR, so the stores are prepared here exactly
 * the way `editor.hydrate()` prepares them, and the section then renders from
 * them. Mounting and interaction are covered by `VoiceSection.browser.test.ts`.
 */

const ipc = vi.hoisted(() => ({
  getVoiceConfig: vi.fn(async (): Promise<unknown> => ({ tts: {} })),
  saveVoiceConfig: vi.fn(async (_config: LiaVoiceConfig) => {
    structuredClone(_config)
  }),
}))

/** The slice of the AIRI card the voice store projects onto. */
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
    // Rendering the key keeps assertions exact; `lia-config.test.ts` is what
    // proves those keys exist in both locales.
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

vi.mock('@proj-airi/stage-ui/stores/modules/airi-card', () => ({
  useAiriCardStore: () => card,
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

/** `providerMetadata` is built asynchronously from the static definitions. */
async function waitForProviderCatalogue(): Promise<void> {
  const speech = useSpeechStore()
  for (let attempt = 0; attempt < 200 && speech.availableSpeechProvidersMetadata.length === 0; attempt++)
    await new Promise(resolve => setTimeout(resolve, 10))
}

/**
 * Prepares the stores the way `editor.hydrate()` does, then renders the section
 * against them.
 */
async function renderSection(persisted: unknown = { tts: {} }): Promise<string> {
  const pinia = createPinia()
  setActivePinia(pinia)
  await waitForProviderCatalogue()

  vi.spyOn(useProviderStore(), 'listProviderVoices').mockImplementation(async (providerId: string) =>
    providerId === 'kokoro-local' ? KOKORO_VOICES as never : [] as never)

  ipc.getVoiceConfig.mockResolvedValue(persisted)
  const voiceStore = useLiaVoiceStore()
  await voiceStore.refreshConfig().catch(() => {})

  // `hydrate()` also warms the catalogue of whatever is selected.
  const providerId = voiceStore.preferred?.providerId
  if (providerId)
    await useSpeechStore().loadVoicesForProvider(providerId, voiceStore.preferred?.modelId)

  return renderToString(createSSRApp(VoiceSection).use(pinia))
}

function strip(fragment: string): string {
  return fragment
    .replace(/^[^<>]*>/, '')
    .replace(/<!--[^>]*-->/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

/** The whole `<select>` carrying `data-testid="<testid>"`, or ''. */
function selectBlock(html: string, testid: string): string {
  const from = html.indexOf(`data-testid="${testid}"`)
  if (from < 0)
    return ''
  const open = html.lastIndexOf('<select', from)
  const close = html.indexOf('</select>', from)
  return open < 0 || close < 0 ? '' : html.slice(open, close)
}

/** The visible text of every `<option>` inside that select. */
function optionLabels(html: string, testid: string): string[] {
  const block = selectBlock(html, testid)
  if (!block)
    return []
  return [...block.matchAll(/<option[^>]*>([\s\S]*?)<\/option>/g)].map(match => strip(match[1]))
}

/** The `<option>` values inside that select. */
function optionValues(html: string, testid: string): string[] {
  const block = selectBlock(html, testid)
  if (!block)
    return []
  return [...block.matchAll(/<option[^>]*?\svalue="([^"]*)"/g)].map(match => match[1])
}

function contains(html: string, testid: string): boolean {
  return html.includes(`data-testid="${testid}"`)
}

describe('voice section rendering (4E-2 voice UI)', () => {
  beforeEach(() => {
    ipc.getVoiceConfig.mockReset()
    ipc.getVoiceConfig.mockResolvedValue({ tts: {} })
    ipc.saveVoiceConfig.mockReset()
    ipc.saveVoiceConfig.mockImplementation(async (config: LiaVoiceConfig) => {
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
  })

  it('offers the real provider catalogue, labelled by name', async () => {
    const html = await renderSection()

    const labels = optionLabels(html, 'lia-config-voice-provider')
    const values = optionValues(html, 'lia-config-voice-provider')

    // "Nenhuma voz configurada" plus every real provider.
    expect(labels[0]).toBe(`${TT}.primary.none`)
    expect(labels.length).toBe(useSpeechStore().availableSpeechProvidersMetadata.length + 1)

    // A user reads names; ids travel in `value` only.
    expect(labels.slice(1).every(label => label.startsWith(`${TT}.`) === false)).toBe(true)
    expect(values.slice(1)).toContain('kokoro-local')
    expect(labels.slice(1)).not.toContain('kokoro-local')
  })

  it('shows the voice list of the selected provider', async () => {
    const html = await renderSection(CONFIGURED)

    expect(optionLabels(html, 'lia-config-voice-voice'))
      .toEqual([`${TT}.fields.unset`, 'Heart (English, female)', 'Emma (English, female)'])
  })

  it('keeps the model selector hidden while no model catalogue is usable', async () => {
    const html = await renderSection(CONFIGURED)

    // The runtime can list models for this provider, but nothing is loaded, so
    // there is nothing honest to offer and no free-text field replaces it.
    expect(useProviderStore().supportsModelListing('kokoro-local')).toBe(true)
    expect(contains(html, 'lia-config-voice-model')).toBe(false)
    expect(html).not.toMatch(/<input/)
  })

  it('explains instead of inventing voices for a provider with no catalogue', async () => {
    const html = await renderSection({
      tts: { preferred: { providerId: 'openai-compatible-audio-speech' }, fallback: [] },
    })

    expect(contains(html, 'lia-config-voice-voice')).toBe(false)
    expect(contains(html, 'lia-config-voice-no-catalog')).toBe(true)
    const note = strip(html.slice(html.indexOf('data-testid="lia-config-voice-no-catalog"')))
    expect(note).toContain(`${TT}.catalog.empty`)
    expect(note).toContain(`${TT}.catalog.fromProviderSettings`)
  })

  it('defaults the reserve voice to "Nenhuma"', async () => {
    const html = await renderSection({ tts: { preferred: { providerId: 'kokoro-local', voiceId: 'af_heart' } } })

    expect(optionLabels(html, 'lia-config-voice-reserve-provider')[0]).toBe(`${TT}.reserve.none`)
    expect(contains(html, 'lia-config-voice-reserve-voice')).toBe(false)
  })

  it('shows the configured reserve as a second, secondary block', async () => {
    const html = await renderSection(CONFIGURED)

    const reserve = html.slice(html.indexOf('data-testid="lia-config-voice-reserve"'))
    expect(reserve).toContain('Heart (English, female)')
    expect(optionLabels(html, 'lia-config-voice-reserve-voice'))
      .toEqual([`${TT}.fields.unset`, 'Heart (English, female)', 'Emma (English, female)'])
  })

  it('offers the sample button and no state text while idle', async () => {
    const html = await renderSection(CONFIGURED)

    expect(contains(html, 'lia-config-voice-preview')).toBe(true)
    expect(html).toContain(`${TT}.preview.play`)
    expect(contains(html, 'lia-config-voice-preview-state')).toBe(false)
  })

  it('renders the same values after a restart', async () => {
    const before = await renderSection(CONFIGURED)
    const after = await renderSection(CONFIGURED)

    for (const testid of ['lia-config-voice-provider', 'lia-config-voice-voice', 'lia-config-voice-reserve-provider'])
      expect(optionLabels(after, testid), testid).toEqual(optionLabels(before, testid))
  })

  it('never writes the configuration just for being displayed', async () => {
    await renderSection(CONFIGURED)

    expect(ipc.getVoiceConfig).toHaveBeenCalled()
    expect(ipc.saveVoiceConfig).not.toHaveBeenCalled()
    expect(card.persistActiveCardModuleSelections).not.toHaveBeenCalled()
  })

  it('leaks no technical id into what the user reads', async () => {
    const html = await renderSection(CONFIGURED)

    // Only `value` attributes may carry ids; the rendered text must not.
    const text = html
      .replace(/<option[^>]*?\svalue="[^"]*"/g, '<option')
      .replace(/<[^>]+>/g, ' ')
    for (const id of ['kokoro-local', 'af_heart', 'bf_emma', 'openai-compatible-audio-speech'])
      expect(text, id).not.toContain(id)
  })
})
