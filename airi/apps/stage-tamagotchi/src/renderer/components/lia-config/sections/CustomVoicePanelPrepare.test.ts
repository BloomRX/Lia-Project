// @vitest-environment happy-dom

import type { LiaAllTalkStatus, LiaCustomVoiceProfile } from '../../../../shared/eventa'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import CustomVoicePanel from './CustomVoicePanel.vue'

import { useLiaRuntimeStore } from '../../../stores/lia/runtime'

/**
 * The prepare card and the import picker, clicked.
 *
 * `CustomVoicePanel.test.ts` covers the rendered reading (SSR); this file
 * covers the pressing: prepare asks main for preparation, prepare-in-flight
 * shows cancellable progress, a failed prepare shows its error and a retry,
 * and picking a file either lands in the naming step, somewhere quiet when
 * cancelled, or in a sentence when the op throughr failed.
 *
 * The IPC edge is mocked by channel id, exactly as the neighbouring tests do.
 */

const ipc = vi.hoisted(() => ({
  status: { current: { state: 'connected', voices: [] } as LiaAllTalkStatus },
  config: { current: { baseUrl: 'http://127.0.0.1:7851' } as Record<string, unknown> },
  profiles: { current: [] as LiaCustomVoiceProfile[] },
  runtimeState: { current: { state: 'ready' } as Record<string, unknown> },
  customVoiceEngine: {
    current: { firstRunPending: false, missingModelFiles: 0, modelComplete: true, ready: true } as Record<string, unknown>,
  },
  prepare: {
    calls: 0,
    phase: 'ready' as string,
    error: undefined as string | undefined,
  },
  picker: {
    calls: 0,
    answer: undefined as string | null | undefined,
    throws: undefined as Error | undefined,
  },
  importProfile: {
    calls: [] as string[],
    result: { ok: true, profile: { id: 'profile-1', name: 'voz' } } as Record<string, unknown>,
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
        { extensions: ['.wav'], id: 'alltalk', label: 'AllTalk (voice cloning)', roles: ['referenceAudio'] },
      ]
    }
    if (id === 'eventa:invoke:lia:voice:profiles:pick-receive') {
      return async () => {
        ipc.picker.calls += 1
        if (ipc.picker.throws)
          throw ipc.picker.throws
        return ipc.picker.answer == null ? null : [ipc.picker.answer]
      }
    }
    if (id === 'eventa:invoke:lia:voice:profiles:import-receive') {
      return async (path: string) => {
        ipc.importProfile.calls.push(path)
        return ipc.importProfile.result
      }
    }
    if (id === 'eventa:invoke:lia:voice:profiles:remove-receive')
      return async () => ({ ok: true, value: { id: '' } })

    // Runtime + bootstrap channels, answered with the healthy machine.
    if (id === 'eventa:invoke:lia:runtime:state-receive')
      return async () => ipc.runtimeState.current
    if (id === 'eventa:invoke:lia:runtime:start-receive')
      return async () => ipc.runtimeState.current
    if (id === 'eventa:invoke:lia:runtime:stop-receive')
      return async () => ({ state: 'stopped' })
    if (id === 'eventa:invoke:lia:runtime:install-dir:pick-receive')
      return async () => null
    if (id === 'eventa:invoke:lia:runtime:install-steps-receive')
      return async () => []
    if (id === 'eventa:invoke:lia:bootstrap:state-receive')
      return async () => ({ phase: 'ready', steps: [] })
    if (id === 'eventa:invoke:lia:bootstrap:run-receive')
      return async () => ({ phase: 'ready', steps: [] })
    if (id === 'eventa:invoke:lia:bootstrap:cancel-receive')
      return async () => null
    if (id === 'eventa:invoke:lia:bootstrap:remove-receive')
      return async () => null

    // The channels under test. After a successful prepare the engine answers
    // ready, mirroring main's verified write; after a failure it stays
    // not-ready, which is exactly what keeps the card (and its error) visible.
    if (id === 'eventa:invoke:lia:custom-voice:engine-state-receive')
      return async () => ipc.customVoiceEngine.current
    if (id === 'eventa:invoke:lia:custom-voice:prepare-receive') {
      return async () => {
        ipc.prepare.calls += 1
        if (ipc.prepare.phase === 'ready')
          ipc.customVoiceEngine.current = { firstRunPending: false, missingModelFiles: 0, modelComplete: true, ready: true }
        return { detail: ipc.prepare.error, phase: ipc.prepare.phase }
      }
    }
    if (id === 'eventa:invoke:lia:custom-voice:cancel-receive')
      return async () => null

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

const TT = 'tamagotchi.home.config.sections.voice.custom'

/** A suspenseful wrapper so mounted hooks settle before asserting. */
async function mountPanel() {
  const App = defineComponent({
    setup: () => () => h(CustomVoicePanel),
  })
  const pinia = createPinia()
  setActivePinia(pinia)
  // The panel asks main for the engine state only when the runtime is up -
  // so the store must be refilled the way the Editor would refill it.
  await useLiaRuntimeStore().refresh()
  const wrapper = mount(App, { global: { plugins: [pinia] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  ipc.status.current = { state: 'connected', voices: [] }
  ipc.config.current = { baseUrl: 'http://127.0.0.1:7851' }
  ipc.profiles.current = []
  ipc.runtimeState.current = { state: 'ready' }
  ipc.customVoiceEngine.current = { firstRunPending: false, missingModelFiles: 0, modelComplete: true, ready: true }
  ipc.prepare.calls = 0
  ipc.prepare.phase = 'ready'
  ipc.prepare.error = undefined
  ipc.picker.calls = 0
  ipc.picker.answer = undefined
  ipc.picker.throws = undefined
})

describe('the prepare card', () => {
  it('is absent while the engine is confirmed ready', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.find('[data-testid="lia-custom-voice-prepare"]').exists()).toBe(false)
  })

  it('asks main to prepare when the engine is not ready, and hides the card once it is', async () => {
    ipc.customVoiceEngine.current = { firstRunPending: true, missingModelFiles: 4, modelComplete: false, ready: false }
    const wrapper = await mountPanel()

    const prepare = wrapper.find('[data-testid="lia-custom-voice-prepare"]')
    expect(prepare.exists()).toBe(true)
    expect(prepare.text()).toContain(`${TT}.prepare.title`)

    await prepare.find('[data-testid="lia-custom-voice-prepare-button"]').trigger('click')
    await flushPromises()

    expect(ipc.prepare.calls).toBe(1)
    expect(wrapper.find('[data-testid="lia-custom-voice-prepare"]').exists()).toBe(false)
  })

  it('shows the prepare failure as a sentence and offers a retry', async () => {
    ipc.customVoiceEngine.current = { firstRunPending: true, missingModelFiles: 4, modelComplete: false, ready: false }
    ipc.prepare.phase = 'error'
    ipc.prepare.error = 'download interrupted'
    const wrapper = await mountPanel()

    await wrapper.find('[data-testid="lia-custom-voice-prepare-button"]').trigger('click')
    await flushPromises()

    const error = wrapper.find('[data-testid="lia-custom-voice-prepare-error"]')
    expect(error.exists()).toBe(true)
    // The friendliness contract (item F): a modeled sentence on screen, the
    // raw detail stays in the logs.
    expect(error.text()).toContain(`${TT}.prepare.phase.error`)
    expect(error.text()).not.toContain('download interrupted')
    // ... and the retry button offers the way back.
    expect(wrapper.find('[data-testid="lia-custom-voice-prepare-button"]').exists()).toBe(true)
  })

  it('marks a profile the user had imported before preparing the engine', async () => {
    ipc.status.current = { state: 'connected', voices: ['referencia.wav'] }
    ipc.customVoiceEngine.current = { firstRunPending: true, missingModelFiles: 4, modelComplete: false, ready: false }
    ipc.profiles.current = [{
      createdAt: '2026-09-13T00:00:00.000Z',
      engine: 'alltalk',
      files: [{ bytes: 1024, filename: 'referencia.wav', role: 'referenceAudio' }],
      id: 'profile-1',
      name: 'Lia pessoal',
    } as unknown as LiaCustomVoiceProfile]
    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain(`${TT}.profiles.status.notPrepared`)
    expect(wrapper.text()).not.toContain(`${TT}.profiles.status.ready`)
  })

  it('gates Import and Test until the service is proven ready (hotfix brief N)', async () => {
    ipc.customVoiceEngine.current = { firstRunPending: true, missingModelFiles: 4, modelComplete: false, ready: false }
    ipc.profiles.current = [{
      createdAt: '2026-09-13T00:00:00.000Z',
      engine: 'alltalk',
      files: [{ bytes: 1024, filename: 'referencia.wav', role: 'referenceAudio' }],
      id: 'profile-1',
      name: 'Lia pessoal',
    } as unknown as LiaCustomVoiceProfile]
    const wrapper = await mountPanel()

    const importButton = wrapper.find('[data-testid="lia-custom-voice-import"]')
    const testButton = wrapper.find('[data-testid="lia-custom-voice-test-profile-1"]')
    expect(importButton.attributes('disabled')).toBeDefined()
    expect(testButton.attributes('disabled')).toBeDefined()
  })

  it('unlocks Import and Test once the service is ready', async () => {
    ipc.profiles.current = [{
      createdAt: '2026-09-13T00:00:00.000Z',
      engine: 'alltalk',
      files: [{ bytes: 1024, filename: 'referencia.wav', role: 'referenceAudio' }],
      id: 'profile-1',
      name: 'Lia pessoal',
    } as unknown as LiaCustomVoiceProfile]
    const wrapper = await mountPanel()

    expect(wrapper.find('[data-testid="lia-custom-voice-import"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="lia-custom-voice-test-profile-1"]').attributes('disabled')).toBeUndefined()
  })
})

describe('the import picker', () => {
  it('lands in the naming step with the chosen file once a file is picked', async () => {
    ipc.picker.answer = '/home/user/audio/minha voz.wav'
    const wrapper = await mountPanel()

    await wrapper.find('[data-testid="lia-custom-voice-import"]').trigger('click')
    await flushPromises()

    expect(ipc.picker.calls).toBe(1)
    const naming = wrapper.find('[data-testid="lia-custom-voice-naming"]')
    expect(naming.exists()).toBe(true)
    expect(wrapper.find('[data-testid="lia-custom-voice-chosen-file"]').text()).toContain('minha voz.wav')
  })

  it('stays quiet when the user cancels the dialog', async () => {
    ipc.picker.answer = null
    const wrapper = await mountPanel()

    await wrapper.find('[data-testid="lia-custom-voice-import"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="lia-custom-voice-naming"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="lia-custom-voice-pick-error"]').exists()).toBe(false)
  })

  it('turns a failed dialog into a sentence instead of a silent rejection', async () => {
    ipc.picker.throws = new Error('dialog exploded')
    const wrapper = await mountPanel()

    await wrapper.find('[data-testid="lia-custom-voice-import"]').trigger('click')
    await flushPromises()

    const pickError = wrapper.find('[data-testid="lia-custom-voice-pick-error"]')
    expect(pickError.exists()).toBe(true)
    expect(pickError.text()).toContain(`${TT}.import.pickFailed`)
  })
})
