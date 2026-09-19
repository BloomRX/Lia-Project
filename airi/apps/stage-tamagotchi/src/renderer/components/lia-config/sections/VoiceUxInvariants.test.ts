import type { LiaCustomVoiceProfile } from '../../../../shared/eventa'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

import VoiceSection from './VoiceSection.vue'

/**
 * The UX invariants of the Voice tab, transitional contract (Phase 7.8E).
 *
 * Each test encodes what a non-technical user is allowed to be shown WHILE
 * the product has no runnable voice engine:
 *
 * - the custom path says "voice engine not installed yet" in neutral words -
 *   and NOTHING anywhere names an engine (no AllTalk, no XTTS, no F5, no Edge);
 * - there is no install wizard, no readiness gate, no import button that
 *   could not work - the import path of the old architecture is simply gone;
 * - already-imported voices remain readable, selectable and removable;
 * - technical pickers (provider, model, emergency voice) still exist, but only
 *   inside the collapsed `<details>` block.
 *
 * Rendered through the real components under SSR. Assertions split the HTML at
 * the `<details>` boundary, because what may live inside advanced settings is
 * deliberately looser than what the default view may show.
 */

const ipc = vi.hoisted(() => ({
  profiles: { current: [] as LiaCustomVoiceProfile[] },
  voiceConfig: {
    current: {
      tts: { preferred: { providerId: 'kokoro-local', voiceId: 'af_heart' } },
    } as Record<string, unknown>,
  },
}))

const card = vi.hoisted(() => ({
  speech: undefined as { provider?: string, model?: string, voice_id?: string } | undefined,
  persona: { language: { character: 'pt-BR' } },
  updateActiveCardSpeech: vi.fn(async () => true),
  persistActiveCardModuleSelections: vi.fn(async () => {}),
  get activeCard() {
    return { id: 'lia', extensions: { airi: { modules: { speech: card.speech }, persona: card.persona } } }
  },
}))

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
    const id = invoke?.receiveEvent?.id
    if (id === 'eventa:invoke:lia:voice:config:get-receive')
      return async () => ipc.voiceConfig.current
    if (id === 'eventa:invoke:lia:voice:config:set-receive')
      return async () => undefined
    if (id === 'eventa:invoke:lia:voice:profiles:list-receive')
      return async () => ipc.profiles.current
    // Product truth (7.8D/E): NO runnable engine is registered yet.
    if (id === 'eventa:invoke:lia:voice:engines:list-receive')
      return async () => []
    if (id === 'eventa:invoke:lia:voice:profiles:pick-receive')
      return async () => null
    if (id === 'eventa:invoke:lia:voice:profiles:import-receive')
      return async () => ({ error: 'engineUnknown', message: 'deferred', ok: false })
    if (id === 'eventa:invoke:lia:voice:profiles:remove-receive')
      return async () => ({ ok: true, value: { id: '' } })

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

const TT = 'tamagotchi.home.config.sections.voice'

/** Engine names that must never reach the voice UI while none exists. */
const BANNED_WORDS = ['AllTalk', 'alltalk', 'XTTS', 'F5', 'f5-tts', 'Edge']

async function render(): Promise<string> {
  const pinia = createPinia()
  setActivePinia(pinia)

  // The section renders from prepared stores under SSR - same rule as the
  // neighbouring render tests: `onMounted` effects are applied here by hand.
  const { useLiaVoiceProfilesStore } = await import('../../../stores/lia/voice-profiles')
  const { useLiaVoiceStore } = await import('../../../stores/lia/voice')
  await Promise.all([
    useLiaVoiceProfilesStore().refresh(),
    useLiaVoiceStore().refreshConfig(),
  ])

  return renderToString(createSSRApp(VoiceSection).use(pinia))
}

/** The opening `<details ...>` tag itself, or ''. */
function detailsTag(html: string): string {
  const match = /<details\s[^>]*>/.exec(html)
  return match ? match[0] : ''
}

/** Everything the user sees before opening advanced settings. */
function beforeAdvanced(html: string): string {
  const tag = detailsTag(html)
  return tag ? html.slice(0, html.indexOf(tag)) : html
}

/** Everything inside the collapsed advanced block. */
function insideAdvanced(html: string): string {
  const tag = detailsTag(html)
  return tag ? html.slice(html.indexOf(tag)) : ''
}

const CUSTOM_MODE = {
  tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'p-1' } },
}

beforeEach(() => {
  ipc.profiles.current = []
  ipc.voiceConfig.current = { tts: { preferred: { providerId: 'kokoro-local', voiceId: 'af_heart' } } }
})

describe('the custom path is honest about the missing engine', () => {
  it('names the neutral missing-engine state without a single engine word', async () => {
    ipc.voiceConfig.current = CUSTOM_MODE

    const visible = beforeAdvanced(await render())

    expect(visible).toContain('data-testid="lia-custom-voice-engine-missing"')
    expect(visible).toContain(`${TT}.custom.engine.missing.title`)
    expect(visible).toContain(`${TT}.custom.engine.missing.hint`)
    for (const word of BANNED_WORDS)
      expect(visible, word).not.toContain(word)
  })

  it('offers no install wizard, no readiness gate and no import button while none can work', async () => {
    ipc.voiceConfig.current = CUSTOM_MODE

    const visible = beforeAdvanced(await render())

    expect(visible).not.toContain('data-testid="lia-custom-voice-import"')
    expect(visible).not.toContain('data-testid="lia-custom-voice-prepare"')
    expect(visible).not.toContain('data-testid="lia-runtime-install"')
    expect(visible).not.toContain('data-testid="lia-runtime-step-spinner"')
    expect(visible).not.toContain('data-testid="lia-alltalk-base-url"')
  })

  it('keeps already-imported voices readable - with plain "saved" statuses, never server states', async () => {
    ipc.voiceConfig.current = CUSTOM_MODE
    ipc.profiles.current = [
      {
        createdAt: '2025-06-01T12:00:00.000Z',
        engine: 'alltalk',
        files: [{ bytes: 1234, filename: 'reference.wav', role: 'referenceAudio' }],
        id: 'legacy-1',
        name: 'Voz antiga',
      },
    ]

    const visible = beforeAdvanced(await render())

    // The legacy profile is present and labelled - its engine id never is.
    expect(visible).toContain('data-testid="lia-custom-voice-profile-legacy-1"')
    expect(visible).toContain('Voz antiga')
    expect(visible).toContain('data-testid="lia-custom-voice-status-legacy-1"')
    expect(visible).toContain(`${TT}.custom.profiles.status.idle`)
    expect(visible).not.toContain(`${TT}.custom.profiles.status.serverOffline`)
    expect(visible).not.toContain(`${TT}.custom.profiles.status.syncFailed`)
    for (const word of BANNED_WORDS)
      expect(visible, word).not.toContain(word)
  })

  it('still lets the selection and the removal of a profile happen from the row', async () => {
    // The selection points at THIS profile, so the panel may say "in use" -
    // the other of the two plain truths it is allowed to say.
    ipc.voiceConfig.current = {
      tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'legacy-1' } },
    }
    ipc.profiles.current = [
      {
        createdAt: '2025-06-01T12:00:00.000Z',
        engine: 'alltalk',
        files: [{ bytes: 1, filename: 'reference.wav', role: 'referenceAudio' }],
        id: 'legacy-1',
        name: 'Voz antiga',
      },
    ]

    const visible = beforeAdvanced(await render())

    // "In use" is one of the two plain truths the panel is allowed to say.
    expect(visible).toContain(`${TT}.custom.profiles.status.inUse`)
    expect(visible).toContain('data-testid="lia-custom-voice-use-legacy-1"')
    expect(visible).toContain('data-testid="lia-custom-voice-remove-legacy-1"')
  })
})

describe('the default view stays free of technical detail', () => {
  it('opens on the single two-option question, with nothing technical outside advanced settings', async () => {
    const html = await render()
    const visible = beforeAdvanced(html)

    expect(visible).toContain('data-testid="lia-config-voice-choose"')
    // The reserve/emergency voice picker is a technical detail: inside only.
    expect(visible).not.toContain('data-testid="lia-config-voice-reserve"')
    const inside = insideAdvanced(html)
    expect(inside).toContain('data-testid="lia-config-voice-reserve"')
  })

  it('keeps the ready-made voice mode free of custom-voice technicalities', async () => {
    const visible = beforeAdvanced(await render())

    // Ready-made mode: no custom panel, no missing-engine note - nothing to
    // explain, because the highway is a provider the user runs somewhere else.
    expect(visible).not.toContain('data-testid="lia-custom-voice-engine-missing"')
    expect(visible).not.toContain('data-testid="lia-config-voice-custom-mode"')
  })
})
