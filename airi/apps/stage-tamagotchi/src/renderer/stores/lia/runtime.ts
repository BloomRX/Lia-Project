import type { LiaRuntimeInstallStep, LiaRuntimeState } from '../../../shared/eventa'
import type { LiaBootstrapState } from '../../../shared/lia-voice'

import { getElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import {
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
} from '../../../shared/eventa'
import { isLiaBootstrapActivePhase } from '../../../shared/lia-voice'

/**
 * The managed voice runtime, as the UI sees it.
 *
 * The renderer holds no process handle and never spawns anything: it asks the
 * main process to start or stop, and renders whatever state comes back. That
 * keeps the lifecycle in one place, where it can be shut down cleanly when the
 * app quits.
 *
 * Vocabulary matters here as much as the state machine does. A non-technical
 * user is told "the voice system is starting", never "spawning start_alltalk.bat
 * in C:\alltalk".
 */
export const useLiaRuntimeStore = defineStore('lia-runtime', () => {
  const fetchState = useElectronEventaInvoke(electronLiaRuntimeState)
  const startRuntime = useElectronEventaInvoke(electronLiaRuntimeStart)
  const stopRuntime = useElectronEventaInvoke(electronLiaRuntimeStop)
  const pickInstallDir = useElectronEventaInvoke(electronLiaRuntimeInstallDirPick)
  const fetchSteps = useElectronEventaInvoke(electronLiaRuntimeInstallSteps)

  const state = ref<LiaRuntimeState>({ state: 'checking' })
  const steps = ref<LiaRuntimeInstallStep[]>([])
  const isBusy = ref(false)

  /**
   * Install/repair progress. `undefined` until the first read succeeds.
   *
   * A shallow ref on purpose: the payload only ever arrives whole from the main
   * process - it is replaced, never edited field by field in here - so deep
   * reactivity would buy nothing, and the proxy it builds would stop the value
   * from being literally the object the state machine produced.
   */
  const bootstrap = shallowRef<LiaBootstrapState | undefined>()

  const installBootstrap = useElectronEventaInvoke(electronLiaBootstrapRun)
  const fetchBootstrap = useElectronEventaInvoke(electronLiaBootstrapState)
  const cancelBootstrap = useElectronEventaInvoke(electronLiaBootstrapCancel)
  const removeBootstrap = useElectronEventaInvoke(electronLiaBootstrapRemove)

  /** Whether the guided wizard should be showing instead of a voice list. */
  const needsInstall = computed(() => state.value.state === 'notInstalled')
  const isReady = computed(() => state.value.state === 'ready')

  /**
   * Whether the bootstrap is mid-run, per the state machine itself.
   *
   * This is the guard beneath the disabled button: the card hides the Install
   * button while running, the main process collapses concurrent runs into one,
   * and this computed is what makes a programmatic second call a no-op too.
   */
  const isInstalling = computed(() => isLiaBootstrapActivePhase(bootstrap.value?.phase))

  /**
   * Whether the bootstrap has something worth showing even when the runtime
   * itself needs nothing.
   *
   * This is what makes "Sistema de voz pronto" visible at all: the runtime
   * flipping to ready would otherwise swap the install card for the voice
   * panel in the same tick and the user would never see the success they
   * caused. `not-installed` is the state of a session that never ran the
   * bootstrap, so a restarted app on a healthy install stays silent, as it
   * should.
   */
  const bootstrapOutcome = computed(() => {
    const phase = bootstrap.value?.phase
    if (!phase || phase === 'not-installed')
      return false
    return isLiaBootstrapActivePhase(phase)
      || phase === 'ready' || phase === 'failed' || phase === 'cancelled' || phase === 'repair-needed'
  })

  /**
   * Mirrors the bootstrap state the main process publishes.
   *
   * The main process is the source of truth for the install; this store holds
   * no timer, no counters and no derived progress of its own. Whatever object
   * arrives over IPC is stored verbatim and rendered verbatim - adding a local
   * copy of the state machine here would be the second source of truth the
   * round-2 brief forbids. The events keep flowing even when the config panel
   * is closed, so an install is never "lost" by navigating away.
   */
  try {
    getElectronEventaContext().on(electronLiaBootstrapChanged, (event) => {
      if (event.body)
        bootstrap.value = event.body
    })
  }
  catch {
    // No ipcRenderer in this context (SSR render in tests, or a non-Electron
    // host): the store degrades to invoke-only, exactly as before.
  }

  /**
   * Reads the current state.
   *
   * An unreachable main process becomes an error state rather than a thrown
   * exception: the Voice tab still has to render, and "we could not reach the
   * voice system" is more useful than a blank panel.
   */
  async function refresh(): Promise<void> {
    isBusy.value = true
    try {
      state.value = await fetchState()
    }
    catch {
      state.value = { message: 'Could not reach the voice system.', state: 'error' }
    }
    finally {
      isBusy.value = false
    }
  }

  async function loadSteps(): Promise<void> {
    try {
      steps.value = await fetchSteps()
    }
    catch {
      // A wizard we cannot populate is worse than none: leave the list empty and
      // the UI falls back to the plain "choose the folder" action.
      steps.value = []
    }
  }

  async function start(): Promise<void> {
    isBusy.value = true
    state.value = { state: 'starting' }
    try {
      state.value = await startRuntime()
    }
    catch {
      state.value = { message: 'Could not start the voice system.', state: 'error' }
    }
    finally {
      isBusy.value = false
    }
  }

  async function stop(): Promise<void> {
    isBusy.value = true
    try {
      state.value = await stopRuntime()
    }
    catch {
      state.value = { message: 'Could not stop the voice system.', state: 'error' }
    }
    finally {
      isBusy.value = false
    }
  }

  /**
   * Opens the OS directory picker for the install location.
   *
   * Resolves the chosen folder, or `null` on cancel - in which case nothing
   * changes. The path never travels from the renderer: the main process writes
   * it, so a compromised renderer cannot aim the runtime at an arbitrary folder.
   */
  async function chooseInstallDir(): Promise<string | null> {
    isBusy.value = true
    try {
      const chosen = await pickInstallDir({})
      if (chosen)
        await refresh()
      return chosen
    }
    finally {
      isBusy.value = false
    }
  }

  /**
   * Runs install, or repair when the runtime is already present.
   *
   * The main process holds a single in-flight run, so clicking twice cannot
   * double-install - but the button is disabled too, because a user who sees a
   * button that appears to do nothing will click it again. And this guard
   * covers the path no button can: a second call that arrives while the state
   * machine already reports a run in flight.
   */
  async function runBootstrap(repair = false): Promise<void> {
    if (isInstalling.value)
      return

    isBusy.value = true
    // Round-7 hotfix-3 trace: if this line prints but the main handler's
    // "install-main-received" never does, the break is between store and
    // main (bridge, channel, preload) - exactly the point the hunt needed.
    console.info('[LIA-VOICE-IPC] install-invoke', repair)
    try {
      const result = await installBootstrap(repair)
      if (result)
        bootstrap.value = result
      await refresh()
    }
    catch (error) {
      // Leaving `bootstrap` as-is keeps the last known progress on screen. A
      // blank card would read as "nothing happened" when in fact it failed -
      // and so would a swallowed invoke error, which is exactly what hid the
      // round-7 click bug. Staying quiet is not an option here anymore.
      console.warn('[LIA-VOICE-IPC] install-invoke failed', error)
    }
    finally {
      isBusy.value = false
    }
  }

  /** Pulls the current bootstrap state, so a reopened UI resumes. */
  async function loadBootstrap(): Promise<void> {
    try {
      const result = await fetchBootstrap()
      if (result)
        bootstrap.value = result
    }
    catch {
      // An unreadable state is not worth surfacing: the card falls back to its
      // idle appearance, and the next run repopulates it.
    }
  }

  async function cancelInstall(): Promise<void> {
    try {
      await cancelBootstrap()
    }
    catch {
      // Cancelling is best-effort; the install stops at its next step boundary.
    }
  }

  /** Removes only what the Lia installed. The caller confirms first. */
  async function removeRuntime(): Promise<void> {
    isBusy.value = true
    try {
      await removeBootstrap()
      await Promise.all([refresh(), loadBootstrap()])
    }
    finally {
      isBusy.value = false
    }
  }

  return {
    bootstrap,
    bootstrapOutcome,
    isBusy,
    isInstalling,
    isReady,
    needsInstall,
    state,
    steps,
    cancelInstall,
    chooseInstallDir,
    loadBootstrap,
    loadSteps,
    refresh,
    removeRuntime,
    runBootstrap,
    start,
    stop,
  }
})
