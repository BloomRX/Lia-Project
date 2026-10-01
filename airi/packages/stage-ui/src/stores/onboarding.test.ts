// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useOnboardingStore } from './onboarding'

vi.mock('./auth', async () => {
  const { defineStore } = await import('pinia')

  return {
    useAuthStore: defineStore('auth', {
      state: () => ({
        isAuthenticated: false,
        token: null,
      }),
    }),
  }
})

vi.mock('./providers/config', async () => {
  const { defineStore } = await import('pinia')

  return {
    useProviderConfigStore: defineStore('provider-config', {
      state: () => ({
        configuredProviders: {},
      }),
      actions: {
        getProviderConfig: () => undefined,
      },
    }),
  }
})

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

// TEST-ONLY: every test gets its own storage so state cannot leak between tests
// (jsdom/browser localStorage is shared per document, which is not isolation).
function installIsolatedLocalStorage() {
  const storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
  try {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage, writable: true })
  }
  catch {}
  return storage
}

describe('onboarding store', () => {
  beforeEach(() => {
    installIsolatedLocalStorage()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ROOT CAUSE:
  //
  // The standalone onboarding renderer previously depended on a localStorage
  // event to discover that another renderer had completed authentication. Once
  // storage stopped acting as a state bus, the BrowserWindow stayed open.
  //
  // The authenticated command now persists completion and publishes a
  // monotonic close request through synchronized Pinia state.
  it('publishes a close request after authentication', () => {
    const store = useOnboardingStore()

    store.closeAfterAuthentication()

    expect(store.hasCompletedSetup).toBe(true)
    expect(store.hasSkippedSetup).toBe(false)
    expect(store.closeRequestId).toBe(1)
    expect(store.$state).not.toHaveProperty('closeRequestId')
    expect(store.$state).not.toHaveProperty('hasCompletedSetup')
    expect(localStorage.getItem('onboarding/completed')).toBe('true')
    expect(localStorage.getItem('onboarding/skipped')).toBe('false')
  })
})
