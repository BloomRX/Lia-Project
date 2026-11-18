import { expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'

import {
  electronAuthCallback,
  electronAuthCallbackError,
} from '../../shared/eventa'
import { initializeElectronAuthCallbackBridge } from './electron-auth-callback'

const eventHandlers = vi.hoisted(() => new Map<object, (event: { body?: unknown }) => Promise<void> | void>())

vi.mock('@proj-airi/electron-vueuse', () => ({
  getElectronEventaContext: () => ({
    on: (event: object, handler: (event: { body?: unknown }) => Promise<void> | void) => {
      eventHandlers.set(event, handler)
    },
  }),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}))

it('subscribes only to sanitized errors and ignores the old token callback', () => {
  initializeElectronAuthCallbackBridge()

  expect(eventHandlers.has(electronAuthCallback)).toBe(false)
  const handler = eventHandlers.get(electronAuthCallbackError)
  expect(handler).toBeTypeOf('function')
  handler?.({ body: { error: 'OIDC signing in failed' } })
  expect(toast.error).toHaveBeenCalledExactlyOnceWith('OIDC signing in failed')
})
