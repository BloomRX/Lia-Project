import type { PresenceAction, PresenceConfig, PresenceResult, PresenceSnapshot } from '../../../shared/eventa/lia-presence'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { defineStore } from 'pinia'
import { ref, toRaw } from 'vue'

import { electronLiaPresenceAction, electronLiaPresenceGet, electronLiaPresenceSet } from '../../../shared/eventa/lia-presence'

export const useLiaPresenceStore = defineStore('lia-presence', () => {
  const state = ref<PresenceSnapshot>()
  const busy = ref(false)
  const error = ref(false)
  const get = useElectronEventaInvoke(electronLiaPresenceGet)
  const set = useElectronEventaInvoke(electronLiaPresenceSet)
  const act = useElectronEventaInvoke(electronLiaPresenceAction)
  async function run(operation: () => Promise<PresenceResult>) {
    if (busy.value)
      return false
    busy.value = true
    error.value = false
    try {
      const result = await operation()
      if (!result.ok) {
        console.info(`[lia-presence] result=${result.code}`)
        error.value = true
        return false
      }
      state.value = result.state
      return true
    }
    catch {
      console.info('[lia-presence] result=ipc-unavailable')
      error.value = true
      return false
    }
    finally { busy.value = false }
  }
  const refresh = () => run(() => get())
  const update = (patch: Partial<PresenceConfig>) => state.value
    ? run(() => set({ ...structuredClone(toRaw(state.value!.config)), ...patch }))
    : Promise.resolve(false)
  const action = (action: PresenceAction) => run(() => act({ action }))
  return { state, busy, error, refresh, update, action }
})
