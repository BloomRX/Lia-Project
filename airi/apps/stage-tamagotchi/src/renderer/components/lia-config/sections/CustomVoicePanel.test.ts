import type { LiaCustomVoiceProfile } from '../../../../shared/eventa'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

import CustomVoicePanel from './CustomVoicePanel.vue'

/**
 * The panel, rendered under the transitional product contract (Phase 7.8E).
 *
 * With no runnable voice engine the panel's job is to be honest: say the
 * engine is not installed yet in neutral words, keep the already-imported
 * voices visible and selectable/removable, and render absolutely nothing of
 * the old AllTalk-era surface - no server state, no publish/sync row, no
 * prepare flow, no import button that could not work.
 */

const ipc = vi.hoisted(() => ({
  profiles: { current: [] as LiaCustomVoiceProfile[] },
  voiceConfig: { current: { tts: {} } as Record<string, unknown> },
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
    // Rendering the key keeps assertions exact; the locale files are what prove
    // those keys exist in both languages.
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

vi.mock('@proj-airi/stage-ui/stores/modules/airi-card', () => ({
  useAiriCardStore: () => card,
}))

const TT = 'tamagotchi.home.config.sections.voice.custom'

const LEGACY_PROFILE: LiaCustomVoiceProfile = {
  createdAt: '2025-06-01T12:00:00.000Z',
  engine: 'alltalk',
  files: [{ bytes: 1234, filename: 'reference.wav', role: 'referenceAudio' }],
  id: 'legacy-1',
  name: 'Voz antiga',
}

async function render(): Promise<string> {
  const pinia = createPinia()
  setActivePinia(pinia)

  // `onMounted` does not fire under SSR; hydrate the stores exactly the way
  // the panel does when it is really shown.
  const { useLiaVoiceProfilesStore } = await import('../../../stores/lia/voice-profiles')
  const { useLiaVoiceStore } = await import('../../../stores/lia/voice')
  await Promise.all([
    useLiaVoiceProfilesStore().refresh(),
    useLiaVoiceStore().refreshConfig(),
  ])

  return renderToString(createSSRApp(CustomVoicePanel).use(pinia))
}

beforeEach(() => {
  ipc.profiles.current = []
  ipc.voiceConfig.current = { tts: {} }
})

describe('the neutral empty-engine state', () => {
  it('says the voice engine is not installed yet - in neutral words, without any engine name', async () => {
    const html = await render()

    expect(html).toContain('data-testid="lia-custom-voice-engine-missing"')
    expect(html).toContain(`${TT}.engine.missing.title`)
    expect(html).toContain(`${TT}.engine.missing.hint`)
  })

  it('renders no AllTalk-era surface at all', async () => {
    ipc.profiles.current = [LEGACY_PROFILE]

    const html = await render()

    for (const testid of [
      'lia-custom-voice-import',
      'lia-custom-voice-prepare',
      'lia-custom-voice-naming',
      'lia-custom-voice-create',
      'lia-alltalk-base-url',
      'lia-alltalk-choose-folder',
    ])
      expect(html, testid).not.toContain(`data-testid="${testid}"`)
    // No engine anywhere.
    for (const word of ['AllTalk', 'alltalk', 'XTTS', 'F5', 'Edge'])
      expect(html, word).not.toContain(word)
  })
})

describe('the already-imported library stays alive', () => {
  it('shows each old profile with a plain saved status - never a server state', async () => {
    ipc.profiles.current = [LEGACY_PROFILE]

    const html = await render()

    expect(html).toContain('data-testid="lia-custom-voice-profile-legacy-1"')
    expect(html).toContain('Voz antiga')
    expect(html).toContain('data-testid="lia-custom-voice-status-legacy-1"')
    expect(html).toContain(`${TT}.profiles.status.idle`)
    expect(html).toContain(`data-testid="lia-custom-voice-use-legacy-1"`)
    expect(html).toContain(`data-testid="lia-custom-voice-remove-legacy-1"`)
  })

  it('marks the profile the selection points at as in use', async () => {
    ipc.profiles.current = [LEGACY_PROFILE]
    ipc.voiceConfig.current = {
      tts: { preferred: { providerId: 'custom-local-voice', voiceId: LEGACY_PROFILE.id } },
    }

    const html = await render()

    expect(html).toContain(`${TT}.profiles.status.inUse`)
  })

  it('says "no imported voices yet" only when the library is really empty', async () => {
    const html = await render()

    expect(html).toContain(`${TT}.profiles.empty`)
    expect(html).not.toContain('data-testid="lia-custom-voice-library"')
  })
})
