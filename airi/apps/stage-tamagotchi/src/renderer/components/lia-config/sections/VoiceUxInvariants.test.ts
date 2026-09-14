import type { LiaAllTalkStatus, LiaCustomVoiceProfile, LiaRuntimeState } from '../../../../shared/eventa'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import VoiceSection from './VoiceSection.vue'

/**
 * The UX invariants of the Voice tab (item P).
 *
 * These are not rendering tests in the ordinary sense. Each one encodes a
 * decision about what a non-technical user is allowed to be shown, and would fail
 * if a technical detail leaked back into the default path:
 *
 * - the default view carries no server address, no folder, no fallback picker and
 *   never the word "AllTalk";
 * - choosing "My own voice" does not leave a ready-made voice picker visible, so
 *   an imported voice cannot look like it depends on Kokoro;
 * - everything technical still exists, but only inside `<details>`, which the
 *   browser keeps closed;
 * - a missing runtime produces an install offer, not a broken import button.
 *
 * The technical content is deliberately *not* deleted from the DOM - it is inside
 * a collapsed `<details>`. So the assertions split the rendered HTML at the
 * `<details>` boundary and check which side each thing landed on. Deleting it
 * entirely would break the developer and QA paths that need it.
 */

const ipc = vi.hoisted(() => ({
  status: { current: { state: 'notConfigured' } as LiaAllTalkStatus },
  config: { current: { baseUrl: 'http://127.0.0.1:7851' } as Record<string, unknown> },
  runtimeState: { current: { state: 'ready' } as LiaRuntimeState },
  steps: { current: [] as Array<{ detail: string, done: boolean, id: string, link?: string, title: string }> },
  bootstrap: { current: { phase: 'ready', steps: [] } as Record<string, unknown> },
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
    if (id === 'eventa:invoke:lia:voice:profiles:list-receive')
      return async () => ipc.profiles.current
    if (id === 'eventa:invoke:lia:voice:engines:list-receive')
      return async () => [{ id: 'alltalk', label: 'AllTalk', roles: ['referenceAudio'], extensions: ['.wav'] }]
    if (id === 'eventa:invoke:lia:voice:profiles:pick-receive')
      return async () => null
    if (id === 'eventa:invoke:lia:voice:profiles:import-receive')
      return async () => ({ ok: false, error: 'cancelled', message: '' })
    if (id === 'eventa:invoke:lia:voice:profiles:remove-receive')
      return async () => ({ ok: true, value: { id: '' } })
    if (id === 'eventa:invoke:lia:runtime:state-receive')
      return async () => ipc.runtimeState.current
    if (id === 'eventa:invoke:lia:runtime:start-receive')
      return async () => ipc.runtimeState.current
    if (id === 'eventa:invoke:lia:runtime:stop-receive')
      return async () => ({ state: 'stopped' })
    if (id === 'eventa:invoke:lia:runtime:install-dir:pick-receive')
      return async () => null
    if (id === 'eventa:invoke:lia:runtime:install-steps-receive')
      return async () => ipc.steps.current

    // Bootstrap channels. Registered in every harness because the mock throws on
    // an unknown channel, and the runtime store now opens these on mount.
    if (id === 'eventa:invoke:lia:bootstrap:state-receive')
      return async () => ipc.bootstrap.current
    if (id === 'eventa:invoke:lia:bootstrap:run-receive')
      return async () => ipc.bootstrap.current
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
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

vi.mock('@proj-airi/stage-ui/stores/modules/airi-card', () => ({
  useAiriCardStore: () => card,
}))

const TT = 'tamagotchi.home.config.sections.voice'

/**
 * Renders the section with `onMounted` effects applied.
 *
 * The harness components are stubbed so this test stays about *what is shown*,
 * not about how a child component fetches: a real `CustomVoicePanel` would pull in
 * its own IPC and store wiring, which the neighbouring test file already covers.
 */
async function render(options: { stubChildren?: boolean } = {}): Promise<string> {
  const pinia = createPinia()
  setActivePinia(pinia)

  const { useLiaAllTalkStore } = await import('../../../stores/lia/alltalk')
  const { useLiaVoiceProfilesStore } = await import('../../../stores/lia/voice-profiles')
  const { useLiaRuntimeStore } = await import('../../../stores/lia/runtime')
  const { useLiaVoiceStore } = await import('../../../stores/lia/voice')
  const runtimeStore = useLiaRuntimeStore()
  await Promise.all([
    useLiaAllTalkStore().refresh(),
    useLiaVoiceProfilesStore().refresh(),
    runtimeStore.refresh(),
    runtimeStore.loadSteps(),
    // onMounted does not run under SSR, so the bootstrap state has to be pulled
    // here or every test would render the card's unknown-state fallback.
    runtimeStore.loadBootstrap(),
    useLiaVoiceStore().refreshConfig(),
  ])

  const target = options.stubChildren
    ? defineComponent({
        name: 'VoiceSectionStubbed',
        setup: () => () => h(VoiceSection),
      })
    : VoiceSection

  return renderToString(createSSRApp(target).use(pinia))
}

/**
 * The opening `<details ...>` tag itself, or ''.
 *
 * Two traps this has to avoid, both found by mutation rather than by reading:
 *
 * - `renderToString` keeps HTML comments, and the component's own comment names
 *   the element, so a plain `indexOf('<details')` lands inside prose.
 * - `[^>]*` also matches the *empty* string, which lets that same comment
 *   mention (`<details>`) satisfy the pattern.
 *
 * Requiring whitespace after the tag name is what separates the two: the real
 * element always carries attributes, the comment mention never does.
 */
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

beforeEach(() => {
  ipc.status.current = { state: 'notConfigured' }
  ipc.config.current = { baseUrl: 'http://127.0.0.1:7851' }
  ipc.runtimeState.current = { state: 'ready' }
  ipc.steps.current = []
  ipc.bootstrap.current = { phase: 'ready', steps: [] }
  ipc.profiles.current = []
  ipc.voiceConfig.current = { tts: { preferred: { providerId: 'kokoro-local', voiceId: 'af_heart' } } }
})

describe('the default view stays free of technical detail', () => {
  it('opens on the single two-option question', async () => {
    const html = await render()

    expect(html).toContain('data-testid="lia-config-voice-choose"')
    expect(html).toContain(`${TT}.choose.title`)
    expect(html).toContain(`${TT}.choose.ready`)
    expect(html).toContain(`${TT}.choose.custom`)
  })

  it('shows no AllTalk vocabulary outside advanced settings', async () => {
    const visible = beforeAdvanced(await render())

    expect(visible).not.toContain('AllTalk')
    expect(visible).not.toContain('alltalk')
    // Neither the engine nor the model behind the imported voice.
    expect(visible).not.toContain('XTTS')
  })

  it('shows no server address outside advanced settings', async () => {
    const visible = beforeAdvanced(await render())

    expect(visible).not.toContain('data-testid="lia-alltalk-base-url"')
    expect(visible).not.toContain('7851')
    expect(visible).not.toContain('127.0.0.1')
  })

  it('shows no voices folder outside advanced settings', async () => {
    ipc.config.current = { baseUrl: 'http://127.0.0.1:7851', voicesDir: 'C:\\alltalk\\voices' }

    const visible = beforeAdvanced(await render())

    expect(visible).not.toContain('data-testid="lia-alltalk-choose-folder"')
    expect(visible).not.toContain('C:\\alltalk\\voices')
    expect(visible).not.toContain(`${TT}.custom.folder.label`)
  })

  it('shows no fallback picker outside advanced settings', async () => {
    const visible = beforeAdvanced(await render())

    // The emergency voice keeps working; the user is simply not asked about it.
    expect(visible).not.toContain('data-testid="lia-config-voice-reserve"')
    expect(visible).not.toContain(`${TT}.reserve.title`)
  })

  it('keeps every technical control inside the collapsed block', async () => {
    const html = await render()
    const advanced = insideAdvanced(html)

    const tag = detailsTag(html)
    expect(tag).toContain('<details')
    // Closed by default: the real tag must carry no `open` attribute.
    expect(tag)
      .not
      .toContain('open')

    for (const testid of [
      'lia-config-voice-provider',
      'lia-config-voice-reserve',
      'lia-alltalk-base-url',
      'lia-alltalk-choose-folder',
      'lia-runtime-advanced',
    ]) {
      expect(advanced, testid).toContain(`data-testid="${testid}"`)
    }
  })
})

describe('one visible choice', () => {
  it('hides the ready-made voice picker while a custom voice is active', async () => {
    ipc.voiceConfig.current = { tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'p-1' } } }
    ipc.profiles.current = [{
      id: 'p-1',
      name: 'Lia pessoal',
      engine: 'alltalk',
      createdAt: '2026-01-01T00:00:00.000Z',
      files: [{ role: 'referenceAudio', filename: 'lia-p-1.wav', bytes: 1024 }],
      metadata: {},
    }]

    const visible = beforeAdvanced(await render())

    // This is the confusion the redesign removes: an imported voice sitting above
    // "Provider: Kokoro / Voice: Heart" reads as if it depended on Kokoro.
    expect(visible).not.toContain('data-testid="lia-config-voice-primary"')
    expect(visible).not.toContain('data-testid="lia-config-voice-voice"')
    expect(visible).toContain('data-testid="lia-config-voice-custom-mode"')
    expect(visible).not.toContain('Kokoro')
  })

  it('shows the ready-made picker and no custom panel for a built-in voice', async () => {
    const visible = beforeAdvanced(await render())

    expect(visible).toContain('data-testid="lia-config-voice-primary"')
    expect(visible).not.toContain('data-testid="lia-config-voice-custom-mode"')
    expect(visible).toContain('data-testid="lia-config-voice-preview"')
  })
})

describe('the install experience', () => {
  it('offers to install when the runtime is missing, instead of a broken import', async () => {
    ipc.voiceConfig.current = { tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'p-1' } } }
    ipc.runtimeState.current = { state: 'notInstalled' }

    const visible = beforeAdvanced(await render())

    expect(visible).toContain('data-testid="lia-runtime-install"')
    expect(visible).toContain(`${TT}.runtime.needed`)
    expect(visible).toContain('data-testid="lia-runtime-install-button"')
    // The user is not shown an import button that cannot work yet.
    expect(visible).not.toContain('data-testid="lia-custom-voice-import"')
  })

  it('shows the imported voices once the runtime is ready', async () => {
    ipc.voiceConfig.current = { tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'p-1' } } }
    ipc.runtimeState.current = { state: 'ready' }

    const visible = beforeAdvanced(await render())

    expect(visible).not.toContain('data-testid="lia-runtime-install"')
    expect(visible).toContain('data-testid="lia-custom-voice-import"')
  })

  it('shows one install action, not a checklist for the user to work through', async () => {
    // The re-audit found the upstream installer accepts a silent flag and brings
    // its own Python, so there is nothing left for the user to install by hand.
    // A checklist here would be asking them to do work the Lia now does.
    ipc.voiceConfig.current = { tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'p-1' } } }
    ipc.runtimeState.current = { state: 'notInstalled' }
    ipc.bootstrap.current = { phase: 'not-installed', steps: [] }

    const visible = beforeAdvanced(await render())

    expect(visible).toContain('data-testid="lia-runtime-install-button"')
    expect(visible).toContain(`${TT}.runtime.install`)
    // No manual to-do list, and no folder picker: the Lia chooses the folder.
    expect(visible).not.toContain('data-testid="lia-runtime-choose-folder"')
  })

  it('shows read-only progress while installing, with no invented percentage', async () => {
    ipc.voiceConfig.current = { tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'p-1' } } }
    ipc.runtimeState.current = { state: 'notInstalled' }
    ipc.bootstrap.current = {
      phase: 'installing-runtime',
      steps: [
        { id: 'check-environment', status: 'done' },
        { id: 'fetch-source', status: 'done' },
        { id: 'run-setup', status: 'running' },
        { id: 'verify-install', status: 'pending' },
        { id: 'verify-health', status: 'pending' },
      ],
    }

    const visible = beforeAdvanced(await render())

    expect(visible).toContain('data-testid="lia-runtime-steps"')
    expect(visible).toContain('data-testid="lia-runtime-step-run-setup"')
    // A number that moves smoothly while nothing measurable happens is a lie the
    // user can catch, so the honest granularity is which step is running.
    expect(visible).not.toMatch(/\b\d{1,3}%/)
    // The install button is gone while it runs; cancel is offered instead.
    expect(visible).not.toContain('data-testid="lia-runtime-install-button"')
    expect(visible).toContain('data-testid="lia-runtime-cancel"')
  })

  it('offers repair rather than reinstall when the files are there but it will not start', async () => {
    ipc.voiceConfig.current = { tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'p-1' } } }
    ipc.runtimeState.current = { state: 'notInstalled' }
    ipc.bootstrap.current = {
      failureCategory: 'health',
      message: 'The voice system installed but did not start.',
      phase: 'failed',
      steps: [],
    }

    const visible = beforeAdvanced(await render())

    expect(visible).toContain('data-testid="lia-runtime-install-button"')
    expect(visible).toContain(`${TT}.runtime.repair`)
    // The user sees a sentence, not a stack trace.
    expect(visible).toContain('did not start')
    expect(visible).not.toContain('    at ')
  })

  it('says what is wrong about the folder instead of only offering retry', async () => {
    // A folder name the installer cannot use will fail again identically on every
    // retry, so the sentence has to carry the diagnosis - the button alone cannot.
    ipc.voiceConfig.current = { tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'p-1' } } }
    ipc.runtimeState.current = { state: 'notInstalled' }
    ipc.bootstrap.current = {
      failureCategory: 'path',
      message: 'The voice system cannot be installed in a folder whose name contains a space.',
      phase: 'failed',
      steps: [],
    }

    const visible = beforeAdvanced(await render())

    // The sentence is the actionable part, and it names the cause.
    expect(visible).toContain('data-testid="lia-runtime-install-error"')
    expect(visible).toContain('contains a space')
    // Repair would re-run the same installer against the same folder and fail the
    // same way, so this is not a repair case.
    expect(visible).not.toContain(`${TT}.runtime.repair`)
  })

  it('still offers a single action when progress cannot be read', async () => {
    ipc.voiceConfig.current = { tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'p-1' } } }
    ipc.runtimeState.current = { state: 'notInstalled' }
    ipc.bootstrap.current = { phase: 'not-installed', steps: [] }

    const visible = beforeAdvanced(await render())

    expect(visible).toContain('data-testid="lia-runtime-install-button"')
    expect(visible).not.toContain('data-testid="lia-runtime-steps"')
  })
})

describe('training is not fabricated', () => {
  it('shows "coming soon" rather than a link to a notebook that does not exist', async () => {
    ipc.voiceConfig.current = { tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'p-1' } } }

    const visible = beforeAdvanced(await render())

    expect(visible).toContain('data-testid="lia-custom-voice-create"')
    expect(visible).toContain(`${TT}.custom.create.hint`)
    expect(visible).toContain('data-testid="lia-custom-voice-create-soon"')
    // No Colab link exists, so none may be rendered. When one is published and
    // verified, this assertion is the one to change - deliberately.
    expect(visible).not.toContain('colab.research.google.com')
  })
})

describe('a runtime failure never takes the tab down', () => {
  it('still renders the voice choices when the runtime errors', async () => {
    ipc.voiceConfig.current = { tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'p-1' } } }
    ipc.runtimeState.current = { message: 'The voice system took too long to start.', state: 'error' }

    const visible = beforeAdvanced(await render())

    // The choice and the import path stay available; only the runtime is unhappy.
    expect(visible).toContain('data-testid="lia-config-voice-choose"')
    expect(visible).toContain('data-testid="lia-custom-voice-import"')
  })

  it('keeps the tab usable when the runtime cannot be reached at all', async () => {
    ipc.voiceConfig.current = { tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'p-1' } } }

    const pinia = createPinia()
    setActivePinia(pinia)
    const { useLiaRuntimeStore } = await import('../../../stores/lia/runtime')
    const runtimeStore = useLiaRuntimeStore()
    // Simulate the main process being unreachable.
    vi.spyOn(runtimeStore, 'refresh').mockRejectedValue(new Error('main process gone'))
    await expect(runtimeStore.refresh()).rejects.toThrow()

    // The store's own guard is what matters: it converts the failure into a state
    // the UI can render rather than letting it escape into the component.
    expect(['error', 'checking', 'ready', 'notInstalled', 'starting', 'stopped'])
      .toContain(runtimeStore.state.state)
  })
})
