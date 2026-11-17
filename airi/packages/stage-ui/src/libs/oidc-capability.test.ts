import { afterEach, expect, it, vi } from 'vitest'

import { isOidcEnabled } from './oidc-capability'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('requires explicit preload opt-in in the Electron renderer', () => {
  vi.stubEnv('RUNTIME_ENVIRONMENT', 'electron')
  vi.stubGlobal('window', {})
  expect(isOidcEnabled()).toBe(false)
  vi.stubGlobal('window', { liaOidcEnabled: true })
  expect(isOidcEnabled()).toBe(true)
})

it.each(['browser', 'capacitor'])('keeps the existing %s flow without the desktop preload', (runtime) => {
  vi.stubEnv('RUNTIME_ENVIRONMENT', runtime)
  vi.stubGlobal('window', {})
  expect(isOidcEnabled()).toBe(true)
})
