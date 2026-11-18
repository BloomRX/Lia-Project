import { afterEach, expect, it, vi } from 'vitest'

import { isOidcEnabled } from './oidc-capability'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('keeps the legacy renderer flow disabled in Electron regardless of the old preload flag', () => {
  vi.stubEnv('RUNTIME_ENVIRONMENT', 'electron')
  vi.stubGlobal('window', {})
  expect(isOidcEnabled()).toBe(false)
  vi.stubGlobal('window', { liaOidcEnabled: true })
  expect(isOidcEnabled()).toBe(false)
})

it.each(['browser', 'capacitor'])('keeps the existing %s flow without the desktop preload', (runtime) => {
  vi.stubEnv('RUNTIME_ENVIRONMENT', runtime)
  vi.stubGlobal('window', {})
  expect(isOidcEnabled()).toBe(true)
})
