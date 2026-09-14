import type { LiaAllTalkStatus, LiaRuntimeState } from '../../../../shared/eventa'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

import VoiceRuntimeAdvanced from './VoiceRuntimeAdvanced.vue'

/**
 * The advanced panel, rendered.
 *
 * These tests moved here from `CustomVoicePanel.test.ts` along with the UI they
 * cover: the server address, the connection status and the voices folder used to
 * sit on the main Voice screen, and now live behind "Advanced settings". The
 * assertions are unchanged, which is the point - moving a control must not
 * quietly drop its coverage.
 *
 * There is no Electron and no display here, so `renderToString` is the honest
 * substitute, the same approach the neighbouring component tests use.
 */

const ipc = vi.hoisted(() => ({
  status: { current: { state: 'notConfigured' } as LiaAllTalkStatus },
  config: { current: { baseUrl: 'http://127.0.0.1:7851' } as Record<string, unknown> },
  runtimeState: { current: { state: 'ready' } as LiaRuntimeState },
  startCalls: { count: 0 },
  stopCalls: { count: 0 },
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
    if (id === 'eventa:invoke:lia:runtime:state-receive')
      return async () => ipc.runtimeState.current
    if (id === 'eventa:invoke:lia:runtime:start-receive') {
      return async () => {
        ipc.startCalls.count += 1
        return ipc.runtimeState.current
      }
    }
    if (id === 'eventa:invoke:lia:runtime:stop-receive') {
      return async () => {
        ipc.stopCalls.count += 1
        return { state: 'stopped' }
      }
    }
    if (id === 'eventa:invoke:lia:runtime:install-dir:pick-receive')
      return async () => null
    if (id === 'eventa:invoke:lia:runtime:install-steps-receive')
      return async () => []

    // Bootstrap channels. Registered in every harness because the mock throws on
    // an unknown channel, and the runtime store now opens these on mount.
    if (id === 'eventa:invoke:lia:bootstrap:state-receive')
      return async () => ({ phase: 'ready', steps: [] })
    if (id === 'eventa:invoke:lia:bootstrap:run-receive')
      return async () => ({ phase: 'ready', steps: [] })
    if (id === 'eventa:invoke:lia:bootstrap:cancel-receive')
      return async () => null
    if (id === 'eventa:invoke:lia:bootstrap:remove-receive')
      return async () => null

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

const TT = 'tamagotchi.home.config.sections.voice.custom'
const TR = 'tamagotchi.home.config.sections.voice.runtime'

/**
 * The whole opening `<button ...>` tag carrying `data-testid="<testid>"`, or ''.
 *
 * Slicing forward from the testid is not enough: Vue renders attributes in
 * template order, so `disabled` lands *before* it and a forward slice would
 * report a disabled button as enabled.
 */
function buttonTag(html: string, testid: string): string {
  const at = html.indexOf(`data-testid="${testid}"`)
  if (at < 0)
    return ''
  const from = html.lastIndexOf('<button', at)
  const to = html.indexOf('>', at)
  return from < 0 || to < 0 ? '' : html.slice(from, to + 1)
}

async function renderPanel(): Promise<string> {
  const pinia = createPinia()
  setActivePinia(pinia)
  // `onMounted` does not run under SSR, so the stores are filled the way the
  // component's mount would fill them.
  const { useLiaAllTalkStore } = await import('../../../stores/lia/alltalk')
  const { useLiaRuntimeStore } = await import('../../../stores/lia/runtime')
  await Promise.all([useLiaAllTalkStore().refresh(), useLiaRuntimeStore().refresh()])

  return renderToString(createSSRApp(VoiceRuntimeAdvanced).use(pinia))
}

beforeEach(() => {
  ipc.status.current = { state: 'notConfigured' }
  ipc.config.current = { baseUrl: 'http://127.0.0.1:7851' }
  ipc.runtimeState.current = { state: 'ready' }
  ipc.startCalls.count = 0
  ipc.stopCalls.count = 0
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

describe('managed lifecycle', () => {
  it('shows the runtime state in words the user can act on', async () => {
    ipc.runtimeState.current = { state: 'ready' }

    const html = await renderPanel()

    expect(html).toContain(`${TR}.ready`)
  })

  it('surfaces a start failure as a sentence', async () => {
    ipc.runtimeState.current = { message: 'The voice system took too long to start.', state: 'error' }

    const html = await renderPanel()

    expect(html).toContain('data-testid="lia-runtime-advanced-error"')
    expect(html).toContain('The voice system took too long to start.')
    expect(html).not.toContain('    at ')
  })

  it('offers stop only while the runtime is actually running', async () => {
    ipc.runtimeState.current = { state: 'stopped' }

    const html = await renderPanel()

    // A stop button that cannot stop anything is noise; it is disabled instead of
    // being hidden, so the control does not move around.
    expect(buttonTag(html, 'lia-runtime-advanced-stop')).toContain('disabled')
  })

  it('lets stop run once the runtime is ready', async () => {
    ipc.runtimeState.current = { state: 'ready' }

    const html = await renderPanel()

    expect(buttonTag(html, 'lia-runtime-advanced-stop')).not.toContain('disabled')
  })

  it('shows where the runtime is installed, or says none is chosen', async () => {
    expect(await renderPanel()).toContain(`${TT}.folder.none`)

    ipc.config.current = { baseUrl: 'http://127.0.0.1:7851', installDir: 'C:\\alltalk_tts' }
    expect(await renderPanel()).toContain('C:\\alltalk_tts')
  })
})
