// @vitest-environment jsdom
/**
 * Phase 5 round 4, item G: the REAL progress path, end to end.
 *
 * The round-2 QA report said the panel never changed while the installer ran.
 * The cause lived in a place no SSR render could see: the main-process eventa
 * adapter only forwards outbound events through `window.webContents.send`, and
 * the Lia bridges were registered with `createContext(ipcMain)` - no window -
 * so every spontaneous emit was silently dropped. SSR tests asserted what the
 * store does with a published state; nothing asserted the state ever crosses
 * the wire.
 *
 * This suite wires the production path with only the transport faked:
 *
 *   main eventa context (electron/main adapter, WITH a window)
 *     -> 'eventa-message' IPC
 *     -> renderer eventa context (electron/renderer adapter, real)
 *     -> the real Lia runtime store (no mocks on electron-vueuse)
 *     -> the real VoiceSection mounted into a real jsdom document
 *
 * Every IPC object below is a bare in-memory fake implementing the four
 * methods the adapters call (on/off/removeListener/send); everything from the
 * event name to the DOM is production code.
 */
import type { LiaBootstrapState, LiaBootstrapStep, LiaBootstrapStepStatus } from '../../../../shared/lia-voice'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createMainContext } from '@moeru/eventa/adapters/electron/main'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

import VoiceSection from './VoiceSection.vue'

import {
  electronLiaAllTalkConfigGet,
  electronLiaAllTalkConfigSet,
  electronLiaAllTalkStatus,
  electronLiaAllTalkSync,
  electronLiaAllTalkVoicesDirPick,
  electronLiaBootstrapCancel,
  electronLiaBootstrapChanged,
  electronLiaBootstrapRemove,
  electronLiaBootstrapRun,
  electronLiaBootstrapState,
  electronLiaRuntimeInstallDirPick,
  electronLiaRuntimeInstallSteps,
  electronLiaRuntimeStart,
  electronLiaRuntimeState,
  electronLiaRuntimeStop,
  electronLiaVoiceConfigGet,
  electronLiaVoiceConfigSet,
  electronLiaVoiceEnginesList,
  electronLiaVoiceProfilesImport,
  electronLiaVoiceProfilesList,
  electronLiaVoiceProfilesPick,
  electronLiaVoiceProfilesRemove,
} from '../../../../shared/eventa'

/** The pt-BR sentences the panel is contractually allowed to show. */
const STR: Record<string, string> = {
  'tamagotchi.home.config.sections.voice.runtime.title': 'Sistema de voz',
  'tamagotchi.home.config.sections.voice.runtime.needed': 'Sistema de voz necessário',
  'tamagotchi.home.config.sections.voice.runtime.neededHint': 'Isso pode levar alguns minutos.',
  'tamagotchi.home.config.sections.voice.runtime.runningTitle': 'Preparando o sistema de voz…',
  'tamagotchi.home.config.sections.voice.runtime.runningHint': 'Isso pode levar alguns minutos.',
  'tamagotchi.home.config.sections.voice.runtime.readyTitle': 'Sistema de voz pronto',
  'tamagotchi.home.config.sections.voice.runtime.readyHint': 'Tudo certo por aqui.',
  'tamagotchi.home.config.sections.voice.runtime.failedTitle': 'Não foi possível concluir a instalação.',
  'tamagotchi.home.config.sections.voice.runtime.cancelledTitle': 'Instalação cancelada.',
  'tamagotchi.home.config.sections.voice.runtime.downloading': 'Baixando os arquivos…',
  'tamagotchi.home.config.sections.voice.runtime.extracting': 'Extraindo os arquivos…',
  'tamagotchi.home.config.sections.voice.runtime.installing': 'Instalando…',
  'tamagotchi.home.config.sections.voice.runtime.environment': 'Preparando o ambiente de voz…',
  'tamagotchi.home.config.sections.voice.runtime.components': 'Instalando os componentes de voz… {done}/{total}',
  'tamagotchi.home.config.sections.voice.runtime.install': 'Instalar',
  'tamagotchi.home.config.sections.voice.runtime.retry': 'Tentar novamente',
  'tamagotchi.home.config.sections.voice.runtime.repair': 'Reparar',
  'tamagotchi.home.config.sections.voice.runtime.cancel': 'Cancelar',
  'tamagotchi.home.config.sections.voice.runtime.step.check-environment': 'Verificando o computador',
  'tamagotchi.home.config.sections.voice.runtime.step.fetch-source': 'Baixando o sistema de voz',
  'tamagotchi.home.config.sections.voice.runtime.step.run-setup': 'Instalando o sistema de voz',
  'tamagotchi.home.config.sections.voice.runtime.step.verify-install': 'Verificando a instalação',
  'tamagotchi.home.config.sections.voice.runtime.step.verify-health': 'Preparando a voz',
}

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'pt-BR' },
    // Named interpolation only: nothing in the UI strings is positional, and
    // the named params are dropped straight into the sentence (vue-i18n braces).
    t: (key: string, named?: Record<string, string>) =>
      Object.entries(named ?? {}).reduce(
        (sentence, [param, value]) => sentence.replaceAll(`{${param}}`, value),
        STR[key] ?? key,
      ),
  }),
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

vi.mock('@proj-airi/stage-ui/stores/modules/airi-card', () => ({
  useAiriCardStore: () => card,
}))

type Listener = (...args: unknown[]) => void

/**
 * One in-memory IPC pair. The main adapter sends through
 * `window.webContents.send`, the renderer adapter listens through
 * `ipcRenderer.on`; the fakes connect the two directly, like the real
 * 'eventa-message' channel does.
 */
function makeTransport() {
  const mainListeners = new Map<string, Listener[]>()
  const rendererListeners = new Map<string, Listener[]>()
  const add = (map: Map<string, Listener[]>) => (channel: string, listener: Listener) => {
    map.set(channel, [...(map.get(channel) ?? []), listener])
  }
  const remove = (map: Map<string, Listener[]>) => (channel: string, listener: Listener) => {
    map.set(channel, (map.get(channel) ?? []).filter(l => l !== listener))
  }
  const deliver = (map: Map<string, Listener[]>) => (channel: string, ...args: unknown[]) => {
    for (const listener of map.get(channel) ?? [])
      listener({}, ...args)
  }

  const ipcMain = { off: remove(mainListeners), on: add(mainListeners) }
  // The invoke reply travels back through the sender handle, exactly like the
  // real adapter replies to an invoke: a plain sender facing our listeners.
  const sender = { isDestroyed: () => false, send: deliver(rendererListeners) }
  const ipcRenderer = {
    on: add(rendererListeners),
    removeListener: remove(rendererListeners),
    send: (channel: string, ...args: unknown[]) => {
      for (const listener of mainListeners.get(channel) ?? [])
        listener(sender, ...args)
    },
  }
  const window_ = {
    isDestroyed: () => false,
    webContents: { id: 1, send: deliver(rendererListeners) },
  }
  // Cuts the wire main->renderer without touching anything in production code:
  // the exact shape of "the subscription never fires".
  const sever = () => rendererListeners.clear()
  return { ipcMain, ipcRenderer, sever, window: window_ }
}

/** The answers the main process gives; overridable per mount for the fixtures. */
function registerMainHandlers(
  context: ReturnType<typeof createMainContext>['context'],
  initial?: { bootstrap?: LiaBootstrapState, runtime?: { state: string } },
) {
  const runtimeState = initial?.runtime ?? { state: 'notInstalled' }
  const bootstrap = initial?.bootstrap ?? { phase: 'not-installed', steps: [] }
  defineInvokeHandler(context, electronLiaAllTalkStatus, async () => ({ state: 'notConfigured' }))
  defineInvokeHandler(context, electronLiaAllTalkConfigGet, async () => ({ baseUrl: 'http://127.0.0.1:7851' }))
  defineInvokeHandler(context, electronLiaAllTalkConfigSet, async () => ({}))
  defineInvokeHandler(context, electronLiaAllTalkSync, (async () => ({ copied: false, filename: '', ok: true })) as never)
  defineInvokeHandler(context, electronLiaAllTalkVoicesDirPick, async () => null)
  defineInvokeHandler(context, electronLiaRuntimeState, async () => runtimeState)
  defineInvokeHandler(context, electronLiaRuntimeStart, async () => runtimeState)
  defineInvokeHandler(context, electronLiaRuntimeStop, async () => ({ state: 'stopped' }))
  defineInvokeHandler(context, electronLiaRuntimeInstallDirPick, async () => null)
  defineInvokeHandler(context, electronLiaRuntimeInstallSteps, async () => [])
  defineInvokeHandler(context, electronLiaBootstrapState, async () => bootstrap)
  defineInvokeHandler(context, electronLiaBootstrapRun, (async () => true) as never)
  defineInvokeHandler(context, electronLiaBootstrapCancel, async () => undefined)
  defineInvokeHandler(context, electronLiaBootstrapRemove, async () => undefined)
  defineInvokeHandler(context, electronLiaVoiceConfigGet, async () => ({ tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'p-1' } } }))
  defineInvokeHandler(context, electronLiaVoiceConfigSet, async () => undefined)
  defineInvokeHandler(context, electronLiaVoiceProfilesList, async () => [])
  defineInvokeHandler(context, electronLiaVoiceProfilesPick, async () => null)
  defineInvokeHandler(context, electronLiaVoiceProfilesImport, (async () => ({ error: 'cancelled', message: '', ok: false })) as never)
  defineInvokeHandler(context, electronLiaVoiceProfilesRemove, (async () => ({ ok: true, value: { id: '' } })) as never)
  defineInvokeHandler(context, electronLiaVoiceEnginesList, async () => [
    { extensions: ['.wav'], id: 'alltalk', label: 'AllTalk', roles: ['referenceAudio'] },
  ])
}

interface Mounted {
  container: HTMLElement
  emit: (state: LiaBootstrapState) => Promise<void>
  sever: () => void
  unmount: () => void
}

async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
}

async function mountSection(options: { initialBootstrap?: LiaBootstrapState, initialRuntime?: { state: string }, windowed?: boolean } = {}): Promise<Mounted> {
  const transport = makeTransport()
  ;(globalThis.window as { electron?: unknown }).electron = { ipcRenderer: transport.ipcRenderer }

  // `windowed: false` recreates the round-3 bug exactly: the adapter then has
  // nobody to forward an outbound emit to, and the panel goes dark.
  const { context: mainContext } = options.windowed === false
    ? createMainContext(transport.ipcMain as never)
    : createMainContext(transport.ipcMain as never, transport.window as never)
  registerMainHandlers(mainContext, { bootstrap: options.initialBootstrap, runtime: options.initialRuntime })

  const pinia = createPinia()
  setActivePinia(pinia)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = createApp(VoiceSection).use(pinia)
  app.mount(container)
  await flush()

  return {
    container,
    emit: async (state) => {
      await mainContext.emit(electronLiaBootstrapChanged, state, undefined as never)
      await flush()
    },
    sever: transport.sever,
    unmount: () => {
      app.unmount()
      container.remove()
    },
  }
}

function step(id: string, status: LiaBootstrapStepStatus, detail?: string): LiaBootstrapStep {
  return detail === undefined ? { id, status } : { detail, id, status }
}

function text(container: HTMLElement): string {
  return (container.textContent ?? '').replace(/\s+/g, ' ')
}

beforeEach(async () => {
  const { resetElectronEventaContextForTesting } = await import('@proj-airi/electron-vueuse')
  resetElectronEventaContextForTesting()
  document.body.innerHTML = ''
})

afterEach(() => {
  delete (globalThis.window as { electron?: unknown }).electron
})

describe('the install progress a Windows user actually sees', () => {
  it('shows every phase the main process publishes, live, until ready', async () => {
    const { container, emit, unmount } = await mountSection()

    // Idle: the install offer is what a fresh profile sees (item I of the brief).
    expect(text(container)).toContain('Sistema de voz necessário')
    const idleButton = container.querySelector('[data-testid="lia-runtime-install-button"]')
    expect(idleButton?.textContent).toContain('Instalar')

    // checking: the card flips to the running title, step 1 spins, the rest wait.
    await emit({
      phase: 'checking',
      steps: [
        step('check-environment', 'running'),
        step('fetch-source', 'pending'),
        step('run-setup', 'pending'),
        step('verify-install', 'pending'),
        step('verify-health', 'pending'),
      ],
    })
    expect(text(container)).toContain('Preparando o sistema de voz…')
    expect(text(container)).toContain('Verificando o computador')
    expect(text(container)).toContain('Baixando o sistema de voz')
    expect(container.querySelector('[data-testid="lia-runtime-step-check-environment"] [data-testid="lia-runtime-step-spinner"]')).not.toBeNull()
    // Round-7: the button is visible but disabled while the machine works.
    expect((container.querySelector('[data-testid="lia-runtime-install-button"]') as HTMLButtonElement).disabled).toBe(true)

    // downloading: step 1 done, step 2 spins.
    await emit({
      phase: 'checking',
      steps: [
        step('check-environment', 'done'),
        step('fetch-source', 'running', 'downloading'),
        step('run-setup', 'pending'),
        step('verify-install', 'pending'),
        step('verify-health', 'pending'),
      ],
    })
    expect(container.querySelector('[data-testid="lia-runtime-step-fetch-source"] [data-testid="lia-runtime-step-spinner"]')).not.toBeNull()
    expect(text(container)).toContain('Baixando os arquivos…')
    expect(text(container)).not.toContain('Extraindo os arquivos…')

    // extracting: the same running step now carries its real sub-state.
    await emit({
      phase: 'checking',
      steps: [
        step('check-environment', 'done'),
        step('fetch-source', 'running', 'extracting'),
        step('run-setup', 'pending'),
        step('verify-install', 'pending'),
        step('verify-health', 'pending'),
      ],
    })
    expect(text(container)).toContain('Extraindo os arquivos…')

    // installing: the setup step spins.
    await emit({
      phase: 'installing-runtime',
      steps: [
        step('check-environment', 'done'),
        step('fetch-source', 'done'),
        step('run-setup', 'running'),
        step('verify-install', 'pending'),
        step('verify-health', 'pending'),
      ],
    })
    expect(container.querySelector('[data-testid="lia-runtime-step-run-setup"] [data-testid="lia-runtime-step-spinner"]')).not.toBeNull()
    expect(text(container)).toContain('Instalando o sistema de voz')

    // verifying: the last checks spin; the card is still busy, never back to the offer.
    await emit({
      phase: 'verifying',
      steps: [
        step('check-environment', 'done'),
        step('fetch-source', 'done'),
        step('run-setup', 'done'),
        step('verify-install', 'done'),
        step('verify-health', 'running'),
      ],
    })
    expect(text(container)).toContain('Preparando o sistema de voz…')
    expect((container.querySelector('[data-testid="lia-runtime-install-button"]') as HTMLButtonElement).disabled).toBe(true)

    // ready: the finished banner.
    await emit({
      phase: 'ready',
      steps: [
        step('check-environment', 'done'),
        step('fetch-source', 'done'),
        step('run-setup', 'done'),
        step('verify-install', 'done'),
        step('verify-health', 'done'),
      ],
    })
    expect(text(container)).toContain('Sistema de voz pronto')

    unmount()
  })

  it('keeps talking during the long setup stages (environment build, component counter)', async () => {
    // The setup step is the longest of all - an environment build, then nine
    // official commands. Round 7 found the gap: with no sub-state the card sat
    // on one spinning line for half an hour and read as "stuck, no way back".
    const { container, emit, unmount } = await mountSection()

    await emit({
      phase: 'installing-runtime',
      steps: [
        step('check-environment', 'done'),
        step('fetch-source', 'done'),
        step('run-setup', 'running', 'environment'),
        step('verify-install', 'pending'),
        step('verify-health', 'pending'),
      ],
    })
    expect(text(container)).toContain('Preparando o ambiente de voz…')

    await emit({
      phase: 'installing-runtime',
      steps: [
        step('check-environment', 'done'),
        step('fetch-source', 'done'),
        step('run-setup', 'running', 'components:3/9'),
        step('verify-install', 'pending'),
        step('verify-health', 'pending'),
      ],
    })
    expect(text(container)).toContain('Instalando os componentes de voz… 3/9')

    // The whole time, the primary button stays visible but disabled and
    // Cancel is the live action: the machine owns the run, the panel owns
    // the words, and the panel never looks empty-handed (round-7 contract).
    expect((container.querySelector('[data-testid="lia-runtime-install-button"]') as HTMLButtonElement).disabled).toBe(true)
    expect(container.querySelector('[data-testid="lia-runtime-cancel"]')).not.toBeNull()

    unmount()
  })

  it('the Round-7 hotfix contract: no real state leaves the panel without an action', async () => {
    // The regression the user saw ("segue sem o botao para instalar"): for the
    // custom voice runtime, `runtime != ready` must ALWAYS come with a button.
    // This matrix emits every phase the state machine can publish - through
    // the real IPC wiring - and asserts both the button's existence and its
    // exact word. `none` is never acceptable while the runtime cannot work.
    const { container, emit, unmount } = await mountSection()
    const button = () => container.querySelector('[data-testid="lia-runtime-install-button"]') as HTMLButtonElement | null

    const expectAction = async (state: LiaBootstrapState, label: string, disabled: boolean) => {
      await emit(state)
      const b = button()
      expect(b, `action ${label} for phase ${String(state.phase)}`).not.toBeNull()
      expect(b!.textContent).toContain(label)
      expect(b!.disabled).toBe(disabled)
    }

    const stepsOf = (...entries: Array<[string, LiaBootstrapStepStatus]>) => entries.map(([id, status]) => step(id, status))

    // not installed, first contact with the card.
    await expectAction(
      { phase: 'not-installed', steps: [] },
      'Instalar',
      false,
    )
    // in flight: visible, disabled, named "Instalando…" - never absent.
    await expectAction(
      { phase: 'installing-runtime', steps: stepsOf(['check-environment', 'done'], ['fetch-source', 'done'], ['run-setup', 'running'], ['verify-install', 'pending'], ['verify-health', 'pending']) },
      'Instalando…',
      true,
    )
    await expectAction(
      { phase: 'checking', steps: stepsOf(['check-environment', 'running'], ['fetch-source', 'pending'], ['run-setup', 'pending'], ['verify-install', 'pending'], ['verify-health', 'pending']) },
      'Instalando…',
      true,
    )
    // failed (any category but health) → retry.
    await expectAction(
      { failureCategory: 'setup', message: 'The voice system could not be installed.', phase: 'failed', steps: stepsOf(['check-environment', 'done'], ['fetch-source', 'done'], ['run-setup', 'failed'], ['verify-install', 'pending'], ['verify-health', 'pending']) },
      'Tentar novamente',
      false,
    )
    // failed health: the files stay, so the right verb is repair.
    await expectAction(
      { failureCategory: 'health', message: 'The voice system installed but did not start.', phase: 'failed', steps: stepsOf(['check-environment', 'done'], ['fetch-source', 'done'], ['run-setup', 'done'], ['verify-install', 'done'], ['verify-health', 'failed']) },
      'Reparar',
      false,
    )
    // cancelled → retry.
    await expectAction(
      { message: 'Installation cancelled.', phase: 'cancelled', steps: stepsOf(['check-environment', 'done'], ['fetch-source', 'running'], ['run-setup', 'pending'], ['verify-install', 'pending'], ['verify-health', 'pending']) },
      'Tentar novamente',
      false,
    )
    // ready → repair, for maintenance after the celebration banner.
    await expectAction(
      { phase: 'ready', steps: stepsOf(['check-environment', 'done'], ['fetch-source', 'done'], ['run-setup', 'done'], ['verify-install', 'done'], ['verify-health', 'done']) },
      'Reparar',
      false,
    )

    unmount()
  })

  it('the round-6/7 partial-install fixture (brief D) offers Tentar novamente in the same session', async () => {
    // The exact state of the QA machine at the round-7 update: source tree and
    // a VALID Miniconda already inside the runtime root, the conda environment
    // still incomplete, start_alltalk.bat missing, the last bootstrap finished
    // as failed, the server not answering. The runtime manager therefore
    // reports notInstalled while the bootstrap keeps the failure of the run -
    // and the card must not collapse to nothing.
    const { container, unmount } = await mountSection({
      initialBootstrap: {
        failureCategory: 'setup',
        message: 'The voice system could not be installed.',
        phase: 'failed',
        steps: [
          step('check-environment', 'done'),
          step('fetch-source', 'done'),
          step('run-setup', 'failed'),
          step('verify-install', 'pending'),
          step('verify-health', 'pending'),
        ],
      },
      initialRuntime: { state: 'notInstalled' },
    })

    expect(text(container)).toContain('Não foi possível concluir a instalação.')
    const b = container.querySelector('[data-testid="lia-runtime-install-button"]') as HTMLButtonElement | null
    expect(b).not.toBeNull()
    expect(b!.textContent).toContain('Tentar novamente')
    expect(b!.disabled).toBe(false)

    unmount()
  })

  it('a runtime-state error (e.g. a rejected IPC read) still mounts the card with an Install way out', async () => {
    // The exact zero-action branch the QA session hit: the runtime probe went
    // down for whatever reason, the store fell back to 'error', and the old
    // mount rule (`needsInstall || bootstrapOutcome`) had no card for that.
    // The panel is not ready and must not be action-less: the idempotent
    // install is the way back.
    const { container, unmount } = await mountSection({
      initialBootstrap: { phase: 'not-installed', steps: [] },
      initialRuntime: { state: 'error' },
    })

    const b = container.querySelector('[data-testid="lia-runtime-install-button"]') as HTMLButtonElement | null
    expect(b, 'error state must still show a primary action').not.toBeNull()
    expect(b!.textContent).toContain('Instalar')

    unmount()
  })

  it('shows the failure with its title and a working "Tentar novamente" action', async () => {
    const { container, emit, unmount } = await mountSection()

    await emit({
      failureCategory: 'setup',
      message: 'The voice system could not be installed.',
      phase: 'failed',
      steps: [
        step('check-environment', 'done'),
        step('fetch-source', 'done'),
        step('run-setup', 'failed'),
        step('verify-install', 'pending'),
        step('verify-health', 'pending'),
      ],
    })
    expect(text(container)).toContain('Não foi possível concluir a instalação.')
    const retry = container.querySelector('[data-testid="lia-runtime-install-button"]')
    expect(retry?.textContent).toContain('Tentar novamente')
    // No raw exits, paths or product names leak into the panel.
    expect(text(container)).not.toMatch(/miniconda|conda|alltalk|C:\\|errorlevel/i)

    unmount()
  })

  it('goes dark the moment the subscription stops delivering - the disconnected-UI mutation', async () => {
    // Mount through the healthy wiring and prove the panel moves; then cut the
    // event channel itself and prove an emit no longer changes a pixel. When
    // production lost the window argument in round 3, every emit died exactly
    // like this: the invoke pathway still worked, so nothing looked broken
    // until an install ran.
    const { container, emit, sever, unmount } = await mountSection()

    await emit({
      phase: 'checking',
      steps: [step('check-environment', 'running'), step('fetch-source', 'pending'), step('run-setup', 'pending')],
    })
    expect(text(container)).toContain('Preparando o sistema de voz…')

    sever()

    await emit({
      phase: 'installing-runtime',
      steps: [step('check-environment', 'done'), step('fetch-source', 'done'), step('run-setup', 'running')],
    })
    expect(text(container)).toContain('Preparando o sistema de voz…')
    expect(container.querySelector('[data-testid="lia-runtime-step-run-setup"] [data-testid="lia-runtime-step-spinner"]')).toBeNull()
    expect(text(container)).toContain('Verificando o computador')

    unmount()
  })
})
