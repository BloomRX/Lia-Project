import type { Ref } from 'vue'

import type { LiaModelDiscoveryResult } from './provider-runtime'

import { ref, watch } from 'vue'

/** Component-scoped suggestions. Stale responses never replace a newer draft. */
export function useLiaModelDiscovery(
  draft: Ref<{ providerId: string, baseUrl?: string, apiKey?: string }>,
  discover: (args: { providerId: string, baseUrl?: string, apiKey?: string }) => Promise<LiaModelDiscoveryResult>,
) {
  const state = ref<'idle' | 'loading' | LiaModelDiscoveryResult['status']>('idle')
  const models = ref<LiaModelDiscoveryResult['models']>([])
  const revision = ref(0)
  watch([draft, revision], ([args], _previous, cleanup) => {
    const snapshot = { ...args }
    let current = true
    models.value = []
    state.value = args.providerId ? 'loading' : 'idle'
    // Debounce edits without persisting the credential or using it as a cache key.
    const timer = setTimeout(async () => {
      if (!args.providerId)
        return
      try {
        const result = await discover(snapshot)
        if (current) {
          models.value = result.models
          state.value = result.status
        }
      }
      catch {
        if (current)
          state.value = 'error'
      }
    }, 300)
    cleanup(() => {
      current = false
      clearTimeout(timer)
    })
  }, { immediate: true, deep: true })
  return { state, models, refresh: () => {
    revision.value++
  } }
}
