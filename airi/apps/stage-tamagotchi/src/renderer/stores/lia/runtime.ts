import type { LiaRuntimeInstallStep, LiaRuntimeState } from '../../../shared/eventa'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  electronLiaRuntimeInstallDirPick,
  electronLiaRuntimeInstallSteps,
  electronLiaRuntimeStart,
  electronLiaRuntimeState,
  electronLiaRuntimeStop,
} from '../../../shared/eventa'

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

  /** Whether the guided wizard should be showing instead of a voice list. */
  const needsInstall = computed(() => state.value.state === 'notInstalled')
  const isReady = computed(() => state.value.state === 'ready')

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

  return {
    isBusy,
    isReady,
    needsInstall,
    state,
    steps,
    chooseInstallDir,
    loadSteps,
    refresh,
    start,
    stop,
  }
})
