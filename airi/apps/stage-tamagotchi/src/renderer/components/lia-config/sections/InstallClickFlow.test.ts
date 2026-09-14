// @vitest-environment jsdom
/**
 * Phase 5 round 7, hotfix 3, items C/D/E: the click, end to end.
 *
 * The round-7 QA report: the button is on screen but clicking it changes
 * nothing - no UI flip, no [LIA-VOICE-BOOTSTRAP] start log. Every existing
 * test proved RENDERING under an injected state; none proved the click has an
 * EFFECT. This suite wires the complete production path, with only the bare
 * IPC transport and the final bootstrap-side implementations faked:
 *
 *   real DOM click in the mounted VoiceSection
 *     -> the real RuntimeInstallCard handler
 *     -> the real Lia runtime store (runBootstrap)
 *     -> the real electron-vueuse defineInvoke
 *     -> the real eventa electron/renderer adapter
 *     -> 'eventa-message' IPC (in-memory pair)
 *     -> the real eventa electron/main adapter
 *     -> the real defineInvokeHandler registration for electronLiaBootstrapRun
 *     -> a spy standing in for the bootstrapper
 *
 * If any link in that chain vanished - the @click binding, the store action,
 * the channel name, the main registration - the spy never fires and no
 * amount of "the button rendered" green would say so.
 *
 * Selection prerequisite of the brief ("escolhe Minha própria voz") is the
 * persisted voice config fixture: the main-side voice-config handler answers
 * a custom-local-voice preference, which is what puts the section into the
 * custom mode where the install card lives.
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
 * One in-memory IPC pair. Identical construction to the round-4 harness: the
 * main adapter sends through `window.webContents.send`, the renderer adapter
 * listens through `ipcRenderer.on`, and the fakes connect the two just like
 * the real 'eventa-message' channel does.
 */
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

interface Mounted {
  container: HTMLElement
  emit: (state: LiaBootstrapState) => Promise<void>
  runSpy: ReturnType<typeof vi.fn>
  unmount: () => void
}

async function flush(): Promise<void> {
  // The invoke round trip crosses several context boundaries; a handful of
  // macrotask hops is what the real adapters take too.
  for (let i = 0; i < 6; i++) {
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick()
  }
}

/** Waits until the DOM/store caught up: halting on a fixed hop count is the
 * flaky half of an async assertion, polling on the outcome is the honest one. */
async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 80 && !cond(); i++) {
    await new Promise(resolve => setTimeout(resolve, 2))
    await nextTick()
  }
}

function click(container: HTMLElement): void {
  const button = container.querySelector('[data-testid="lia-runtime-install-button"]') as HTMLButtonElement | null
  expect(button, 'the primary action button must be on screen').not.toBeNull()
  button!.click()
}

/**
 * The electron-vueuse context singleton captures whatever facade it sees on
 * its first call; remounts inside one test must not rewire it. Routing goes
 * through this indirection instead: the facade is built once and always
 * delegates to the transport currently active, so an already-registered
 * renderer context keeps reaching the newest mount's main side.
 */
const active: { transport: ReturnType<typeof makeTransport> | undefined } = { transport: undefined }

/**
 * Renderer-side listeners live for as long as an eventa renderer context
 * lives - and that context is a singleton across mounts (the electron-vueuse
 * cache). If each new transport carried a fresh listener map, the reply from
 * a later mount's handler would deliver to a map no one reads anymore, which
 * is indistinguishable from "the click died between invoke and reply". Keep
 * the one map every delivery consults.
 */
const sharedRendererListeners = new Map<string, Listener[]>()

const facade = {
  ipcRenderer: {
    on: (channel: string, listener: Listener) => active.transport?.ipcRenderer.on(channel, listener),
    removeListener: (channel: string, listener: Listener) => active.transport?.ipcRenderer.removeListener(channel, listener),
    send: (channel: string, ...args: unknown[]) => active.transport?.ipcRenderer.send(channel, ...args),
  },
}

async function mountSection(options: {
  initialBootstrap?: LiaBootstrapState
  runAnswer?: LiaBootstrapState
} = {}): Promise<Mounted> {
  active.transport = makeTransport(sharedRendererListeners)
  const transport = active.transport
  ;(globalThis.window as { electron?: unknown }).electron = facade

  const { context: mainContext } = createMainContext(transport.ipcMain as never, transport.window as never)

  const bootstrap = options.initialBootstrap ?? { phase: 'not-installed', steps: [] }
  const runSpy = vi.fn(async (_repair?: boolean) => options.runAnswer ?? {
    phase: 'checking' as const,
    steps: [step('check-environment', 'running'), step('fetch-source', 'pending'), step('run-setup', 'pending'), step('verify-install', 'pending'), step('verify-health', 'pending')],
  })

  defineInvokeHandler(mainContext, electronLiaAllTalkStatus, async () => ({ state: 'notConfigured' }))
  defineInvokeHandler(mainContext, electronLiaAllTalkConfigGet, async () => ({ baseUrl: 'http://127.0.0.1:7851' }))
  defineInvokeHandler(mainContext, electronLiaAllTalkConfigSet, async () => ({}))
  defineInvokeHandler(mainContext, electronLiaAllTalkSync, (async () => ({ copied: false, filename: '', ok: true })) as never)
  defineInvokeHandler(mainContext, electronLiaAllTalkVoicesDirPick, async () => null)
  defineInvokeHandler(mainContext, electronLiaRuntimeState, async () => ({ state: 'notInstalled' }))
  defineInvokeHandler(mainContext, electronLiaRuntimeStart, async () => ({ state: 'starting' }))
  defineInvokeHandler(mainContext, electronLiaRuntimeStop, async () => ({ state: 'stopped' }))
  defineInvokeHandler(mainContext, electronLiaRuntimeInstallDirPick, async () => null)
  defineInvokeHandler(mainContext, electronLiaRuntimeInstallSteps, async () => [])
  defineInvokeHandler(mainContext, electronLiaBootstrapState, async () => bootstrap)
  defineInvokeHandler(mainContext, electronLiaBootstrapRun, runSpy as never)
  defineInvokeHandler(mainContext, electronLiaBootstrapCancel, async () => undefined)
  defineInvokeHandler(mainContext, electronLiaBootstrapRemove, async () => undefined)
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
    emit: async (state) => {
      await mainContext.emit(electronLiaBootstrapChanged, state, undefined as never)
      await flush()
    },
    runSpy,
    unmount: () => {
      app.unmount()
      container.remove()
    },
  }
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

describe('the install click, from DOM to main (round-7 hotfix 3, items C/D/E)', () => {
  it('c: clicking [ Instalar ] invokes the bootstrap bridge exactly once, then the panel flips to real progress', async () => {
    const { container, emit, runSpy, unmount } = await mountSection()

    // Idle, first contact: one enabled action, labeled for installing.
    const button = () => container.querySelector('[data-testid="lia-runtime-install-button"]') as HTMLButtonElement | null
    expect(button()).not.toBeNull()
    expect(text(button()!)).toContain('Instalar')
    expect(button()!.disabled).toBe(false)

    click(container)
    await waitFor(() => runSpy.mock.calls.length === 1)

    // The exact effect the round-7 QA could not produce: one invoke crossing
    // the wire with the install intent.
    expect(runSpy).toHaveBeenCalledTimes(1)
    expect(runSpy.mock.calls[0]?.[0]).toBe(false)

    // Item I: the UI flip comes from the state the main process publishes
    // when the run really starts - 'checking' first, then the long phase.
    await emit({ phase: 'checking', steps: [step('check-environment', 'running'), step('fetch-source', 'pending'), step('run-setup', 'pending'), step('verify-install', 'pending'), step('verify-health', 'pending')] })
    expect(text(container)).toContain('Preparando o sistema de voz…')

    await emit({ phase: 'installing-runtime', steps: [step('check-environment', 'done'), step('fetch-source', 'done'), step('run-setup', 'running'), step('verify-install', 'pending'), step('verify-health', 'pending')] })
    expect(text(button()!)).toContain('Instalando…')
    expect(button()!.disabled).toBe(true)

    // While disabled, second clicks - spammed by a user who saw no feedback -
    // never reach the bridge.
    button()!.click()
    await flush()
    expect(runSpy).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('d: a failed run keeps the exact same click path - [ Tentar novamente ] invokes the bridge exactly once', async () => {
    const { container, runSpy, unmount } = await mountSection({
      initialBootstrap: {
        failureCategory: 'setup',
        message: 'A instalação não foi concluída.',
        phase: 'failed',
        steps: [step('check-environment', 'done'), step('fetch-source', 'done'), step('run-setup', 'failed', 'setup'), step('verify-install', 'pending'), step('verify-health', 'pending')],
      },
    })

    const button = () => container.querySelector('[data-testid="lia-runtime-install-button"]') as HTMLButtonElement | null
    expect(button()).not.toBeNull()
    expect(text(button()!)).toContain('Tentar novamente')
    expect(button()!.disabled).toBe(false)

    // Item D: retry must call the exact same bootstrap path install does -
    // not a sibling handler that never runs, not nothing.
    click(container)
    await waitFor(() => runSpy.mock.calls.length === 1)
    expect(runSpy).toHaveBeenCalledTimes(1)
    expect(runSpy.mock.calls[0]?.[0]).toBe(false)

    unmount()
  })

  it('e: [ Reparar ] invokes the bridge exactly once with the repair intent, when the state calls for repair', async () => {
    // Both repair states: a failed health check (files present, server won't
    // start), and the persisted repair-needed phase.
    for (const failing of [true, false] as const) {
      const { container, runSpy, unmount } = await mountSection({
        initialBootstrap: failing
          ? {
              failureCategory: 'health',
              message: 'O sistema de voz não responde.',
              phase: 'failed',
              steps: [step('check-environment', 'done'), step('fetch-source', 'done'), step('run-setup', 'done'), step('verify-install', 'done'), step('verify-health', 'failed', 'health')],
            }
          : {
              phase: 'repair-needed',
              steps: [step('check-environment', 'done'), step('fetch-source', 'done'), step('run-setup', 'done'), step('verify-install', 'done'), step('verify-health', 'pending')],
            },
      })

      await waitFor(() => container.querySelector('[data-testid="lia-runtime-install-button"]') !== null)
      const button = () => container.querySelector('[data-testid="lia-runtime-install-button"]') as HTMLButtonElement | null
      expect(button(), `repair button visible for the ${failing ? 'health-failed' : 'repair-needed'} state`).not.toBeNull()
      expect(text(button()!)).toContain('Reparar')
      expect(button()!.disabled).toBe(false)

      click(container)
      await waitFor(() => runSpy.mock.calls.length === 1)
      expect(runSpy, `one repair invoke for the ${failing ? 'health-failed' : 'repair-needed'} state`).toHaveBeenCalledTimes(1)
      expect(runSpy.mock.calls[0]?.[0]).toBe(true)

      unmount()
    }
  })
})
