import type { LiaMemoryMutation, LiaMemoryState } from '../../../shared/eventa/lia-memory'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { electronLiaMemoryGet, electronLiaMemoryMutate, electronLiaMemoryRecall } from '../../../shared/eventa/lia-memory'

export const useLiaMemoryStore = defineStore('lia-memory', () => {
  const state = ref<LiaMemoryState>({ schemaVersion: 1, enabled: false, entries: [] })
  const loading = ref(false)
  const busy = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)
  const get = useElectronEventaInvoke(electronLiaMemoryGet)
  const mutate = useElectronEventaInvoke(electronLiaMemoryMutate)
  const recall = useElectronEventaInvoke(electronLiaMemoryRecall)
  let loadPending: Promise<boolean> | undefined

  async function load(): Promise<boolean> {
    if (busy.value)
      return false
    if (loadPending)
      return loadPending
    loading.value = true
    error.value = null
    loadPending = (async () => {
      try {
        const result = await get()
        if (!result.ok) {
          error.value = result.code
          return false
        }
        state.value = result.value
        loaded.value = true
        return true
      }
      catch {
        error.value = 'unavailable'
        return false
      }
      finally {
        loading.value = false
        loadPending = undefined
      }
    })()
    return loadPending
  }
  async function change(request: LiaMemoryMutation): Promise<boolean> {
    if (busy.value || loading.value)
      return false
    busy.value = true
    error.value = null
    try {
      const result = await mutate(request)
      if (!result.ok) {
        error.value = result.code
        return false
      }
      state.value = result.value
      loaded.value = true
      return true
    }
    catch {
      error.value = 'unavailable'
      return false
    }
    finally { busy.value = false }
  }
  /** Ask Main for each turn: another window may have revoked permission. Never cache context. */
  async function retrieveContext(query: string): Promise<string> {
    try {
      const result = await recall({ query })
      return result.ok ? result.value : ''
    }
    catch { return '' }
  }
  return {
    state,
    loading,
    busy,
    loaded,
    error,
    load,
    retrieveContext,
    setEnabled: (enabled: boolean) => change({ action: 'enable', enabled }),
    saveEntry: (text: string, id?: string) => change({ action: 'save', text, id }),
    removeEntry: (id: string) => change({ action: 'remove', id }),
    clear: (confirmed: boolean) => confirmed ? change({ action: 'clear', confirmed: true }) : Promise.resolve(false),
  }
})
