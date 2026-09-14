import type { LiaAllTalkRuntimeConfig, LiaAllTalkStatus } from '../../../shared/eventa'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  electronLiaAllTalkConfigGet,
  electronLiaAllTalkConfigSet,
  electronLiaAllTalkStatus,
  electronLiaAllTalkVoicesDirPick,
} from '../../../shared/eventa'

/**
 * The AllTalk runtime, as the Voz tab sees it.
 *
 * Two rules the UI owes the user:
 *
 * - **It never sends a path.** The folder is chosen by the main process's own
 *   dialog; this store only asks for the picker to open and reads back what was
 *   chosen. A cancelled picker changes nothing.
 * - **It never polls.** The status is fetched when the section opens and after a
 *   configuration change. A background loop would hammer a local server the user
 *   may not even have started, for information that only matters while this tab
 *   is open.
 */
export const useLiaAllTalkStore = defineStore('lia-alltalk', () => {
  const getConfig = useElectronEventaInvoke(electronLiaAllTalkConfigGet)
  const setConfig = useElectronEventaInvoke(electronLiaAllTalkConfigSet)
  const pickDir = useElectronEventaInvoke(electronLiaAllTalkVoicesDirPick)
  const fetchStatus = useElectronEventaInvoke(electronLiaAllTalkStatus)

  const config = ref<LiaAllTalkRuntimeConfig | undefined>(undefined)
  const status = ref<LiaAllTalkStatus>({ state: 'checking' })
  const isBusy = ref(false)

  const isConfigured = computed(() => Boolean(config.value?.voicesDir))
  const isConnected = computed(() => status.value.state === 'connected')

  /** Reads config and status together. Safe to call on mount. */
  async function refresh(): Promise<void> {
    isBusy.value = true
    status.value = { state: 'checking' }
    try {
      config.value = await getConfig()
      status.value = await fetchStatus()
    }
    catch {
      // An unreachable main process is reported as an error state, not thrown
      // into the component: the tab still has to render.
      status.value = { state: 'error', error: 'Could not read the voice server settings.' }
    }
    finally {
      isBusy.value = false
    }
  }

  async function saveBaseUrl(baseUrl: string): Promise<void> {
    isBusy.value = true
    try {
      config.value = await setConfig({ baseUrl })
      status.value = await fetchStatus()
    }
    finally {
      isBusy.value = false
    }
  }

  /**
   * Opens the OS directory picker in the main process.
   *
   * Resolves the chosen folder, or `null` when the user cancels - in which case
   * the previous folder stays configured and nothing else changes.
   */
  async function chooseVoicesDir(): Promise<string | null> {
    isBusy.value = true
    try {
      const chosen = await pickDir({})
      if (chosen) {
        config.value = await getConfig()
        status.value = await fetchStatus()
      }
      return chosen
    }
    finally {
      isBusy.value = false
    }
  }

  async function clearVoicesDir(): Promise<void> {
    isBusy.value = true
    try {
      await pickDir({ clear: true })
      config.value = await getConfig()
      status.value = await fetchStatus()
    }
    finally {
      isBusy.value = false
    }
  }

  return {
    config,
    isBusy,
    isConfigured,
    isConnected,
    status,
    chooseVoicesDir,
    clearVoicesDir,
    refresh,
    saveBaseUrl,
  }
})
