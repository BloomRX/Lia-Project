import type { LiaCustomVoiceEngineState, LiaRuntimeState } from '../../../../shared/eventa'
// @vitest-environment jsdom
/**
 * Phase 6 hotfix, items E/G/H-4..6: installed is not running - the UI half.
 *
 * The round-3 QA evidence this suite locks down: every install file was on
 * disk, the server merely refused to start, and the card offered [Instalar]
 * over a working install. Two facts were being conflated into one sentence:
 * what EXISTS on disk (install state, answered by main from markers and the
 * persisted record) and who is RUNNING (the server's own state probe).
 *
 * This suite mounts the real VoiceSection over the in-memory eventa pair -
 * same harness lineage as InstallClickFlow - with the two facts driven
 * separately, and asserts the contract from the brief:
 *
 *   INSTALLED + STOPPED    -> "Sistema de voz instalado" / "Iniciando…",
 *                             and [Instalar] must be absent from the card.
 *   INSTALLED + STARTING   -> installed title, the launch is narrated.
 *   INSTALLED + FAILED     -> "Não foi possível iniciar o sistema de voz."
 *                             + [Tentar iniciar novamente] + [Reparar].
 *   INSTALLED + READY      -> the ordinary ready banner, no buttons.
 *   NOT INSTALLED          -> "Sistema de voz necessário" + [Instalar].
 *   REPAIR NEEDED          -> repair banner + [Reparar], never [Instalar].
 *
 * The mutation the matrix guards: any regression that lets a known-installed
 * tree fall through to the legacy bootstrap-driven rows resurfaces the QA
 * sentence "Sistema de voz necessário [Instalar]" and fails here first.
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
  electronLiaBootstrapRemove,
  electronLiaBootstrapRun,
  electronLiaBootstrapState,
  electronLiaCustomVoiceEngineState,
  electronLiaRuntimeChanged,
  electronLiaRuntimeInstallDirPick,
  electronLiaRuntimeInstallState,
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
  'tamagotchi.home.config.sections.voice.runtime.neededHint': 'Para a Lia falar com uma voz sua, ela precisa de um sistema de voz instalado no seu computador.',
  'tamagotchi.home.config.sections.voice.runtime.runningTitle': 'Preparando o sistema de voz…',
  'tamagotchi.home.config.sections.voice.runtime.runningHint': 'Isso leva alguns minutos na primeira vez.',
  'tamagotchi.home.config.sections.voice.runtime.readyTitle': 'Sistema de voz pronto',
  'tamagotchi.home.config.sections.voice.runtime.readyHint': 'A Lia já pode falar com uma voz sua.',
  'tamagotchi.home.config.sections.voice.runtime.failedTitle': 'Não foi possível concluir a instalação.',
  'tamagotchi.home.config.sections.voice.runtime.cancelledTitle': 'Instalação cancelada.',
  'tamagotchi.home.config.sections.voice.runtime.installedTitle': 'Sistema de voz instalado',
  'tamagotchi.home.config.sections.voice.runtime.installedHint': 'Iniciando…',
  'tamagotchi.home.config.sections.voice.runtime.retryStart': 'Tentar iniciar novamente',
  'tamagotchi.home.config.sections.voice.runtime.repairTitle': 'O sistema de voz precisa de reparo.',
  'tamagotchi.home.config.sections.voice.runtime.repairHint': 'Alguns arquivos do sistema de voz precisam ser baixados de novo.',
  'tamagotchi.home.config.sections.voice.runtime.starting': 'Iniciando o sistema de voz…',
  'tamagotchi.home.config.sections.voice.runtime.startingHint': 'Na primeira inicialização isso pode levar alguns minutos.',
  'tamagotchi.home.config.sections.voice.runtime.startingActivity': 'O servidor de voz está subindo…',
  'tamagotchi.home.config.sections.voice.runtime.startFailed': 'Não foi possível iniciar o sistema de voz.',
  'tamagotchi.home.config.sections.voice.runtime.installing': 'Instalando…',
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

/** One in-memory IPC pair, the round-4 harness construction. */
function makeTransport(rendererListeners: Map<string, Listener[]> = new Map()) {
  const mainListeners = new Map<string, Listener[]>()
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
  return { ipcMain, ipcRenderer, window: window_ }
}

function step(id: string, status: LiaBootstrapStepStatus, detail?: string): LiaBootstrapStep {
  return detail === undefined ? { id, status } : { detail, id, status }
}

type RuntimeProbe = 'error' | 'notInstalled' | 'ready' | 'starting' | 'stopped'
type InstallProbe = 'installed' | 'not-installed' | 'repair-needed'

/** The probe word as a full runtime state, whichever variant it names. */
function runtimeStateFor(probe: RuntimeProbe): LiaRuntimeState {
  return probe === 'error' ? { message: 'probe: the runtime refused', state: 'error' } : { state: probe }
}

interface Mounted {
  container: HTMLElement
  emitRuntime: (state: LiaRuntimeState) => Promise<void>
  runSpy: ReturnType<typeof vi.fn>
  startSpy: ReturnType<typeof vi.fn>
  unmount: () => void
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick()
  }
}

async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 80 && !cond(); i++) {
    await new Promise(resolve => setTimeout(resolve, 2))
    await nextTick()
  }
}

/** Routes the singleton electron-vueuse context to the transport of the moment. */
const active: { transport: ReturnType<typeof makeTransport> | undefined } = { transport: undefined }
const sharedRendererListeners = new Map<string, Listener[]>()

const facade = {
  ipcRenderer: {
    on: (channel: string, listener: Listener) => active.transport?.ipcRenderer.on(channel, listener),
    removeListener: (channel: string, listener: Listener) => active.transport?.ipcRenderer.removeListener(channel, listener),
    send: (channel: string, ...args: unknown[]) => active.transport?.ipcRenderer.send(channel, ...args),
  },
}

async function mountSection(options: {
  customVoiceEngine?: LiaCustomVoiceEngineState
  initialBootstrap?: LiaBootstrapState
  installState: InstallProbe
  runtimeState: RuntimeProbe
}): Promise<Mounted> {
  active.transport = makeTransport(sharedRendererListeners)
  const transport = active.transport
  ;(globalThis.window as { electron?: unknown }).electron = facade

  const { context: mainContext } = createMainContext(transport.ipcMain as never, transport.window as never)

  const bootstrap = options.initialBootstrap ?? { phase: 'not-installed', steps: [] }
  const runSpy = vi.fn(async (_repair?: boolean): Promise<LiaBootstrapState> => ({
    phase: 'checking',
    steps: [step('check-environment', 'running'), step('fetch-source', 'pending'), step('run-setup', 'pending'), step('verify-install', 'pending'), step('verify-health', 'pending')],
  }))
  const runtimeState = runtimeStateFor(options.runtimeState)
  const startSpy = vi.fn(async () => runtimeState)

  defineInvokeHandler(mainContext, electronLiaAllTalkStatus, async () => ({ state: 'notConfigured' }))
  defineInvokeHandler(mainContext, electronLiaAllTalkConfigGet, async () => ({ baseUrl: 'http://127.0.0.1:7851' }))
  defineInvokeHandler(mainContext, electronLiaAllTalkConfigSet, async () => ({}))
  defineInvokeHandler(mainContext, electronLiaAllTalkSync, (async () => ({ copied: false, filename: '', ok: true })) as never)
  defineInvokeHandler(mainContext, electronLiaAllTalkVoicesDirPick, async () => null)
  defineInvokeHandler(mainContext, electronLiaRuntimeState, async () => runtimeState)
  defineInvokeHandler(mainContext, electronLiaRuntimeStart, startSpy)
  defineInvokeHandler(mainContext, electronLiaRuntimeStop, async () => ({ state: 'stopped' }))
  defineInvokeHandler(mainContext, electronLiaRuntimeInstallDirPick, async () => null)
  defineInvokeHandler(mainContext, electronLiaRuntimeInstallSteps, async () => [])
  // The Phase 6 witness: main is ASKED what is on disk. Every row of this
  // suite changes only this answer plus the server probe, never the tree.
  defineInvokeHandler(mainContext, electronLiaRuntimeInstallState, async () => ({ state: options.installState }))
  defineInvokeHandler(mainContext, electronLiaBootstrapState, async () => bootstrap)
  defineInvokeHandler(mainContext, electronLiaBootstrapRun, runSpy as never)
  defineInvokeHandler(mainContext, electronLiaBootstrapCancel, async () => undefined)
  defineInvokeHandler(mainContext, electronLiaBootstrapRemove, async () => undefined)
  // Item B of the brief made flesh in the harness: the XTTS clone engine
  // answers whatever the fixture says, so a test can prove the SYSTEM card
  // stopped caring about it.
  defineInvokeHandler(mainContext, electronLiaCustomVoiceEngineState, async () => options.customVoiceEngine ?? { firstRunPending: false, missingModelFiles: 0, modelComplete: true, ready: true })
  defineInvokeHandler(mainContext, electronLiaVoiceConfigGet, async () => ({ tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'p-1' } } }))
  defineInvokeHandler(mainContext, electronLiaVoiceConfigSet, async () => undefined)
  defineInvokeHandler(mainContext, electronLiaVoiceProfilesList, async () => [])
  defineInvokeHandler(mainContext, electronLiaVoiceProfilesPick, async () => null)
  defineInvokeHandler(mainContext, electronLiaVoiceProfilesImport, (async () => ({ error: 'cancelled', message: '', ok: false })) as never)
  defineInvokeHandler(mainContext, electronLiaVoiceProfilesRemove, (async () => ({ ok: true, value: { id: '' } })) as never)
  defineInvokeHandler(mainContext, electronLiaVoiceEnginesList, async () => [
    { extensions: ['.wav'], id: 'alltalk', label: 'AllTalk', roles: ['referenceAudio'] },
  ])

  const pinia = createPinia()
  setActivePinia(pinia)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = createApp(VoiceSection).use(pinia)
  app.mount(container)
  await flush()

  return {
    container,
    // The push half, fired by hand: main republishes the manager's snapshot
    // on this exact channel in production (alltalk-runtime-publish.test.ts
    // proves that end); from here down the chain is the real store and the
    // real card.
    emitRuntime: async (state) => {
      await mainContext.emit(electronLiaRuntimeChanged, state, undefined as never)
      await flush()
    },
    runSpy,
    startSpy,
    unmount: () => {
      app.unmount()
      container.remove()
    },
  }
}

/**
 * The card's mounting condition is `needsInstall || bootstrapOutcome ||
 * state === 'error'`, and both the runtime state and the persisted bootstrap
 * cross the wire AFTER the mount - so the card arrives one microtask later.
 * Waiting on the element is the honest pause; assuming it is the flaky one.
 */
async function mountAndWaitForCard(options: Parameters<typeof mountSection>[0]): Promise<Mounted> {
  const mounted = await mountSection(options)
  await waitFor(() => mounted.container.querySelector('[data-testid="lia-runtime-install"]') !== null)
  return mounted
}

function text(el: HTMLElement): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ')
}

function statusLine(container: HTMLElement) {
  return container.querySelector('[data-testid="lia-runtime-install-status"]') as HTMLElement | null
}
function hintLine(container: HTMLElement) {
  return container.querySelector('[data-testid="lia-runtime-install-hint"]') as HTMLElement | null
}
function primaryButton(container: HTMLElement) {
  return container.querySelector('[data-testid="lia-runtime-install-button"]') as HTMLButtonElement | null
}
function repairSecondary(container: HTMLElement) {
  return container.querySelector('[data-testid="lia-runtime-repair-secondary"]') as HTMLButtonElement | null
}

beforeEach(async () => {
  const { resetElectronEventaContextForTesting } = await import('@proj-airi/electron-vueuse')
  resetElectronEventaContextForTesting()
  document.body.innerHTML = ''
})

afterEach(() => {
  delete (globalThis.window as { electron?: unknown }).electron
})

describe('installed is not running (Phase 6 hotfix, item G: the UI half)', () => {
  it('installed + stopped with a stale failed record: installed banner, and [Instalar] is gone (H-4)', async () => {
    // The QA shape verbatim: the walk once failed in this session's record,
    // yet the files check out. The disk fact must win over the record.
    const { container, unmount } = await mountAndWaitForCard({
      initialBootstrap: { message: 'A port is already in use.', phase: 'failed', steps: [] },
      installState: 'installed',
      runtimeState: 'stopped',
    })

    expect(text(statusLine(container)!)).toContain('Sistema de voz instalado')
    expect(text(hintLine(container)!)).toContain('Iniciando…')
    // The regression sentence, in both halves: neither the label nor the button.
    expect(statusLine(container)!.textContent).not.toContain('Sistema de voz necessário')
    expect(primaryButton(container)).toBeNull()
    expect(repairSecondary(container)).toBeNull()
    expect(text(container)).not.toContain('Instalação cancelada.')
    unmount()
  })

  it('installed + starting: the launch is narrated, not offered as a click', async () => {
    const { container, unmount } = await mountAndWaitForCard({
      initialBootstrap: { phase: 'ready', steps: [] },
      installState: 'installed',
      runtimeState: 'starting',
    })

    expect(text(statusLine(container)!)).toContain('Sistema de voz instalado')
    expect(text(hintLine(container)!)).toContain('Iniciando o sistema de voz…')
    expect(primaryButton(container)).toBeNull()
    unmount()
  })

  it('installed + failed: startFailed hint, [Tentar iniciar novamente] retries the start, [Reparar] walks (H-5)', async () => {
    const { container, runSpy, startSpy, unmount } = await mountSection({
      installState: 'installed',
      runtimeState: 'error',
    })

    expect(text(statusLine(container)!)).toContain('Sistema de voz instalado')
    expect(text(hintLine(container)!)).toContain('Não foi possível iniciar o sistema de voz.')

    const primary = primaryButton(container)
    expect(primary).not.toBeNull()
    expect(text(primary!)).toContain('Tentar iniciar novamente')
    expect(primary!.disabled).toBe(false)

    const secondary = repairSecondary(container)
    expect(secondary).not.toBeNull()
    expect(text(secondary!)).toContain('Reparar')

    // The primary is the server start, never the install walk: only the
    // start invoke may fire, and the bootstrap walk must stay untouched.
    primary!.click()
    await waitFor(() => startSpy.mock.calls.length === 1)
    expect(startSpy).toHaveBeenCalledTimes(1)
    expect(runSpy).not.toHaveBeenCalled()

    // The secondary is the repair walk, with the repair flag on.
    secondary!.click()
    await waitFor(() => runSpy.mock.calls.length === 1)
    expect(runSpy.mock.calls[0]?.[0]).toBe(true)
    unmount()
  })

  it('installed + ready: the card STAYS, reading "Sistema de voz pronto" (round-5, item D)', async () => {
    // The round-7 design hid the card once the server answered; the QA that
    // rained down after was worse than the banner it saved: autostart had
    // adopted the previous Lia's instance, the user opened this section a
    // beat later, refresh() read state=ready, every disjunction went false,
    // and the whole card vanished - nothing on screen could even ACKNOWLEDGE
    // the runtime it had just started. Item D's rule reverses the balance:
    // with installState=installed the card exists in EVERY runtime state -
    // ready reads "pronto", and only 'not-installed' is ever cardless.
    const { container, unmount } = await mountAndWaitForCard({
      installState: 'installed',
      runtimeState: 'ready',
    })

    expect(text(statusLine(container)!)).toContain('Sistema de voz pronto')
    // A working server is not a problem to fix: no primary, no repair secondary.
    expect(primaryButton(container)).toBeNull()
    expect(repairSecondary(container)).toBeNull()
    unmount()
  })

  it('not installed: the classic offer - needed banner and [Instalar] (H-6)', async () => {
    const { container, runSpy, unmount } = await mountAndWaitForCard({
      installState: 'not-installed',
      runtimeState: 'notInstalled',
    })

    expect(text(statusLine(container)!)).toContain('Sistema de voz necessário')
    const primary = primaryButton(container)
    expect(primary).not.toBeNull()
    expect(text(primary!)).toContain('Instalar')
    expect(repairSecondary(container)).toBeNull()

    // And the click still reaches the walk, flag off - sanity that E did not
    // move the install door.
    primary!.click()
    await waitFor(() => runSpy.mock.calls.length === 1)
    expect(runSpy.mock.calls[0]?.[0]).toBe(false)
    unmount()
  })

  it('repair needed: the repair banner and [Reparar], never [Instalar]', async () => {
    const { container, unmount } = await mountAndWaitForCard({
      initialBootstrap: { phase: 'ready', steps: [] },
      installState: 'repair-needed',
      runtimeState: 'stopped',
    })

    expect(text(statusLine(container)!)).toContain('O sistema de voz precisa de reparo.')
    expect(text(hintLine(container)!)).toContain('Alguns arquivos do sistema de voz')
    const primary = primaryButton(container)
    expect(primary).not.toBeNull()
    expect(text(primary!)).toContain('Reparar')
    expect(text(primary!)).not.toContain('Instalar')
    unmount()
  })

  it('the 75 s boot, reproduced (item C): starting shows the launch, the pushed ready flips the card to pronto', async () => {
    // The exact QA fixture: installed on disk, bootstrap record ready, the
    // autostart's server still coming up. Then main republishes the state
    // the manager reached - the event that used to die in main.
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { container, emitRuntime, unmount } = await mountAndWaitForCard({
      initialBootstrap: { phase: 'ready', steps: [] },
      installState: 'installed',
      runtimeState: 'starting',
    })

    expect(text(statusLine(container)!)).toContain('Sistema de voz instalado')
    // Item D: the wait is named, with its honest bound - and a liveness
    // signal that is the state itself, never a percentage.
    expect(text(hintLine(container)!)).toContain('Iniciando o sistema de voz…')
    expect(text(hintLine(container)!)).toContain('pode levar alguns minutos')
    expect(container.querySelector('[data-testid="lia-runtime-install-starting-activity"]')).not.toBeNull()

    await emitRuntime({ state: 'ready' })

    expect(text(statusLine(container)!)).toContain('Sistema de voz pronto')
    expect(primaryButton(container)).toBeNull()
    expect(repairSecondary(container)).toBeNull()
    expect(container.querySelector('[data-testid="lia-runtime-install-starting-activity"]')).toBeNull()
    // The item-A trace pair: the hand-off is printed at both ends now.
    expect(consoleInfo).toHaveBeenCalledWith('[LIA-VOICE-UI] runtime-state-received', 'status=ready')
    expect(consoleInfo).toHaveBeenCalledWith('[LIA-VOICE-UI] install-card-state', 'status=ready')

    consoleInfo.mockRestore()
    unmount()
  })

  it('mutation guard for the missing link: without the push subscription, the pushed ready never lands', async () => {
    // This is the QA bug stated as a test. The ONLY writer of state after
    // mount is the electronLiaRuntimeChanged subscription; ignoring the
    // event (the pre-hotfix posture) must leave the card on starting - the
    // assertion that fails if the subscription is ever deleted again.
    const { container, emitRuntime, runSpy, startSpy, unmount } = await mountAndWaitForCard({
      initialBootstrap: { phase: 'ready', steps: [] },
      installState: 'installed',
      runtimeState: 'starting',
    })
    expect(text(statusLine(container)!)).toContain('Sistema de voz instalado')

    await emitRuntime({ state: 'ready' })
    // If this line says 'installed' instead of 'pronto', the ready event
    // died again - no click, no poll, nothing else moves the state.
    expect(text(statusLine(container)!)).toContain('Sistema de voz pronto')
    expect(runSpy).not.toHaveBeenCalled()
    expect(startSpy).not.toHaveBeenCalled()
    unmount()
  })

  it('runtimeReady ≠ customVoiceServiceReady (item B): the XTTS engine not being prepared must not hold the system card', async () => {
    // AllTalk healthy at the end of a watched start, clone engine still
    // needing first-run preparation: the SYSTEM card flips to pronto the
    // moment the runtime says ready; the need for preparation belongs to
    // the custom voice panel below it, never to the runtime banner.
    const { container, emitRuntime, unmount } = await mountAndWaitForCard({
      customVoiceEngine: { firstRunPending: true, missingModelFiles: 2, modelComplete: false, ready: false },
      initialBootstrap: { phase: 'ready', steps: [] },
      installState: 'installed',
      runtimeState: 'starting',
    })

    await emitRuntime({ state: 'ready' })

    expect(text(statusLine(container)!)).toContain('Sistema de voz pronto')
    expect(text(hintLine(container)!)).toContain('A Lia já pode falar com uma voz sua.')
    expect(primaryButton(container)).toBeNull()
    unmount()
  })

  it('mutation guard: an installed tree never shows the install sentence, however the session rows look', async () => {
    // Sweep every noteworthy legacy row over a known-installed tree: if the
    // display priority regressed to bootstrap-led ordering, one of these
    // combinations reconstitutes the QA bug and fails the assertion.
    for (const phase of ['failed', 'cancelled', 'ready'] as const) {
      const { container, unmount } = await mountAndWaitForCard({
        initialBootstrap: { phase, steps: [] },
        installState: 'installed',
        runtimeState: 'stopped',
      })
      expect(text(statusLine(container)!), `phase ${phase}`).toContain('Sistema de voz instalado')
      expect(text(primaryButton(container) ?? document.createElement('span')), `phase ${phase}`).not.toContain('Instalar')
      unmount()
    }
    // And the round-7 addendum row: an erroring server mounts the card even
    // with no kept record; the installed tree still forbids [Instalar].
    const { container, unmount } = await mountAndWaitForCard({
      installState: 'installed',
      runtimeState: 'error',
    })
    expect(text(statusLine(container)!)).toContain('Sistema de voz instalado')
    expect(text(primaryButton(container)!)).toContain('Tentar iniciar novamente')
    unmount()
  })
})
