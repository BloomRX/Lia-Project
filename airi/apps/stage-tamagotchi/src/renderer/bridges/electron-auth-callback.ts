import { getElectronEventaContext } from '@proj-airi/electron-vueuse'
import { toast } from 'vue-sonner'

import { electronAuthCallbackError } from '../../shared/eventa'

/**
 * Register auth callback listeners at the renderer service level so they
 * persist for the window's lifetime, independent of any Vue component's
 * mount/unmount lifecycle.
 */
export function initializeElectronAuthCallbackBridge() {
  const context = getElectronEventaContext()

  context.on(electronAuthCallbackError, (event) => {
    if (event.body)
      toast.error(event.body.error)
  })
}
