import type { LiaAllTalkStatus, LiaCustomVoiceProfile } from '../../../../shared/eventa'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

import CustomVoicePanel from './CustomVoicePanel.vue'

/**
 * The panel, rendered.
 *
 * There is no Electron and no display in this environment, so the component is
 * never actually shown here - `renderToString` is the closest honest substitute,
 * and it is the same approach `VoiceSection.test.ts` uses. What it does prove is
 * that the right words reach the screen for each server state, that a failure
 * arrives as a sentence rather than a stack trace, and that the controls the
 * user needs are present.
 *
 * The IPC edge is mocked by channel id, exactly as the neighbouring tests do.
 */

const ipc = vi.hoisted(() => ({
  status: { current: { state: 'notConfigured' } as LiaAllTalkStatus },
  config: { current: { baseUrl: 'http://127.0.0.1:7851' } as Record<string, unknown> },
  profiles: { current: [] as LiaCustomVoiceProfile[] },
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
    if (id === 'eventa:invoke:lia:alltalk:config:get-receive')
      return async () => ipc.config.current
    if (id === 'eventa:invoke:lia:alltalk:config:set-receive')
      return async () => ipc.config.current
    if (id === 'eventa:invoke:lia:alltalk:status-receive')
      return async () => ipc.status.current
    if (id === 'eventa:invoke:lia:alltalk:voices-dir:pick-receive')
      return async () => null
    if (id === 'eventa:invoke:lia:alltalk:sync-receive')
      return async () => ({ ok: true, copied: false, filename: '' })
    if (id === 'eventa:invoke:lia:voice:config:get-receive')
      return async () => ({ tts: {} })
    if (id === 'eventa:invoke:lia:voice:config:set-receive') {
      return async (_config: unknown) => {
        structuredClone(_config)
      }
    }
    if (id === 'eventa:invoke:lia:voice:profiles:list-receive')
      return async () => ipc.profiles.current
    if (id === 'eventa:invoke:lia:voice:engines:list-receive') {
      return async () => [
        { id: 'alltalk', label: 'AllTalk (voice cloning)', roles: ['referenceAudio'], extensions: ['.wav'] },
      ]
    }
    if (id === 'eventa:invoke:lia:voice:profiles:pick-receive')
      return async () => null
    if (id === 'eventa:invoke:lia:voice:profiles:import-receive')
      return async () => ({ ok: false, error: 'cancelled', message: '' })
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

async function renderPanel(): Promise<string> {
  const pinia = createPinia()
  setActivePinia(pinia)
  // `onMounted` does not run under SSR, so the store is filled the way the
  // component's mount would fill it.
  const { useLiaAllTalkStore } = await import('../../../stores/lia/alltalk')
  const { useLiaVoiceProfilesStore } = await import('../../../stores/lia/voice-profiles')
  await Promise.all([useLiaAllTalkStore().refresh(), useLiaVoiceProfilesStore().refresh()])

  return renderToString(createSSRApp(CustomVoicePanel).use(pinia))
}

beforeEach(() => {
  ipc.status.current = { state: 'notConfigured' }
  ipc.config.current = { baseUrl: 'http://127.0.0.1:7851' }
  ipc.profiles.current = []
})

describe('server status', () => {
  it.each([
    ['connected', { state: 'connected', voices: ['lia.wav'] }],
    ['offline', { state: 'offline' }],
    ['notConfigured', { state: 'notConfigured' }],
    ['error', { state: 'error', error: 'AllTalk answered 500' }],
  ] as Array<[string, LiaAllTalkStatus]>)('shows the %s state as its own word', async (_name, status) => {
    ipc.status.current = status

    const html = await renderPanel()

    expect(html).toContain(`data-testid="lia-alltalk-status-${status.state}"`)
    expect(html).toContain(`${TT}.states.${status.state}`)
  })

  it('renders an error as a sentence, never as a stack trace', async () => {
    ipc.status.current = { state: 'error', error: 'AllTalk answered 500' }

    const html = await renderPanel()

    expect(html).toContain('AllTalk answered 500')
    // A stack trace in the UI is exactly what this feature was told not to do.
    expect(html).not.toMatch(/at \w+ \(/)
    expect(html).not.toContain('TypeError')
    expect(html).not.toContain('    at ')
  })

  it('shows the configured address in the field', async () => {
    ipc.config.current = { baseUrl: 'http://192.168.0.7:7851' }

    const html = await renderPanel()

    expect(html).toContain('data-testid="lia-alltalk-base-url"')
  })
})

describe('voices folder', () => {
  it('offers the picker, and no clear button while nothing is chosen', async () => {
    const html = await renderPanel()

    expect(html).toContain('data-testid="lia-alltalk-choose-folder"')
    expect(html).not.toContain('data-testid="lia-alltalk-clear-folder"')
    expect(html).toContain(`${TT}.folder.none`)
  })

  it('shows the chosen folder and offers to clear it', async () => {
    ipc.config.current = { baseUrl: 'http://127.0.0.1:7851', voicesDir: 'C:\\alltalk\\voices' }

    const html = await renderPanel()

    expect(html).toContain('C:\\alltalk\\voices')
    expect(html).toContain('data-testid="lia-alltalk-clear-folder"')
  })
})

describe('the library', () => {
  it('says so when nothing has been imported yet', async () => {
    const html = await renderPanel()

    expect(html).toContain(`${TT}.profiles.empty`)
    expect(html).toContain('data-testid="lia-custom-voice-import"')
    // Naming happens only after a file is picked, so no stray text field.
    expect(html).not.toContain('data-testid="lia-custom-voice-naming"')
  })

  it('renders a profile with its language, backend and actions', async () => {
    ipc.config.current = { baseUrl: 'http://127.0.0.1:7851', voicesDir: '/v' }
    ipc.status.current = { state: 'connected', voices: ['lia-1.wav'] }
    ipc.profiles.current = [{
      id: 'profile-1',
      name: 'Lia pessoal',
      engine: 'alltalk',
      createdAt: '2026-09-13T00:00:00.000Z',
      files: [{ filename: 'referencia.wav', role: 'referenceAudio', bytes: 1024 }],
      metadata: { language: 'pt-BR', backend: 'XTTS-v2' },
    }]

    const html = await renderPanel()

    expect(html).toContain('data-testid="lia-custom-voice-profile-1"')
    expect(html).toContain('Lia pessoal')
    expect(html).toContain('pt-BR')
    expect(html).toContain('XTTS-v2')
    expect(html).toContain('data-testid="lia-custom-voice-select-profile-1"')
    expect(html).toContain('data-testid="lia-custom-voice-test-profile-1"')
    expect(html).toContain('data-testid="lia-custom-voice-remove-profile-1"')
    expect(html).toContain(`${TT}.profiles.status.ready`)
    // Removal is confirmed in the row, so the prompt is not shown up front.
    expect(html).not.toContain('data-testid="lia-custom-voice-confirm-remove-profile-1"')
  })

  it('explains that the server is not configured instead of offering a broken voice', async () => {
    // A profile the user imported before pointing the app at a server.
    ipc.profiles.current = [{
      id: 'profile-1',
      name: 'Lia pessoal',
      engine: 'alltalk',
      createdAt: '2026-09-13T00:00:00.000Z',
      files: [{ filename: 'referencia.wav', role: 'referenceAudio', bytes: 1024 }],
    }]

    const html = await renderPanel()

    // The profile is still in the library - it was not lost - but the row says
    // what is missing rather than looking ready.
    expect(html).toContain('Lia pessoal')
    expect(html).toContain(`${TT}.profiles.status.notConfigured`)
    expect(html).not.toContain(`${TT}.profiles.status.ready`)
  })

  it('reports an offline server distinctly from an unconfigured one', async () => {
    ipc.config.current = { baseUrl: 'http://127.0.0.1:7851', voicesDir: '/v' }
    ipc.status.current = { state: 'offline' }
    ipc.profiles.current = [{
      id: 'profile-1',
      name: 'Lia pessoal',
      engine: 'alltalk',
      createdAt: '2026-09-13T00:00:00.000Z',
      files: [{ filename: 'referencia.wav', role: 'referenceAudio', bytes: 1024 }],
    }]

    const html = await renderPanel()

    expect(html).toContain(`${TT}.profiles.status.serverOffline`)
    expect(html).not.toContain(`${TT}.profiles.status.notConfigured`)
  })
})
