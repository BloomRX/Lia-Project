import type { LiaVoiceEngineConfig, LiaVoiceStatus } from '../../../shared/eventa'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  electronLiaVoiceEngineConfigGet,
  electronLiaVoiceEngineConfigSet,
  electronLiaVoiceStatus,
} from '../../../shared/eventa'

/**
 * The Lia voice product, as the Voz tab sees it (Phase 7.8, item 19).
 *
 * Engine-agnostic by contract: a plain status word ("pronta / preparando /
 * indisponível") and two honest advanced toggles - fallback on/off and an
 * explicit fallback voice id. No engine names, no ports, no paths on the
 * screen; those belong to diagnostics.
 */
export const useLiaVoiceServerStore = defineStore('lia-voice-server', () => {
  const fetchStatus = useElectronEventaInvoke(electronLiaVoiceStatus)
  const fetchConfig = useElectronEventaInvoke(electronLiaVoiceEngineConfigGet)
  const pushConfig = useElectronEventaInvoke(electronLiaVoiceEngineConfigSet)

  const status = ref<LiaVoiceStatus>({ state: 'checking' })
  const engineConfig = ref<LiaVoiceEngineConfig | undefined>(undefined)
  const isBusy = ref(false)

  const isAvailable = computed(() => status.value.state === 'ready')
  const fallbackEnabled = computed(() => engineConfig.value?.fallback?.enabled ?? true)

  /** Reads config and status together. Safe to call on mount; never polls. */
  async function refresh(): Promise<void> {
    isBusy.value = true
    status.value = { state: 'checking' }
    try {
      engineConfig.value = await fetchConfig()
      status.value = await fetchStatus()
    }
    catch {
      status.value = { note: 'Could not read the voice product settings.', state: 'unavailable' }
    }
    finally {
      isBusy.value = false
    }
  }

  async function setFallbackEnabled(enabled: boolean): Promise<void> {
    isBusy.value = true
    try {
      await pushConfig({ fallback: { enabled } })
      engineConfig.value = await fetchConfig()
      status.value = await fetchStatus()
    }
    finally {
      isBusy.value = false
    }
  }

  async function setFallbackEngineId(engineId: string): Promise<void> {
    isBusy.value = true
    try {
      await pushConfig({ fallback: { engineId } })
      engineConfig.value = await fetchConfig()
    }
    finally {
      isBusy.value = false
    }
  }

  return {
    engineConfig,
    fallbackEnabled,
    isAvailable,
    isBusy,
    status,
    refresh,
    setFallbackEnabled,
    setFallbackEngineId,
  }
})
