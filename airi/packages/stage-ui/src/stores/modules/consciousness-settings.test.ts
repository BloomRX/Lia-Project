// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useConsciousnessSettingsStore } from './consciousness-settings'

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

describe('consciousness settings store', () => {
  beforeEach(() => {
    installIsolatedLocalStorage()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('turns model reasoning off by default', () => {
    const store = useConsciousnessSettingsStore()

    expect(store.reasoning).toBe(false)
  })

  it('loads the persisted value', () => {
    localStorage.setItem('settings/consciousness/reasoning', 'true')
    const store = useConsciousnessSettingsStore()

    expect(store.reasoning).toBe(true)
  })

  it('persists changes through store actions', async () => {
    const store = useConsciousnessSettingsStore()
    await store.setReasoning(true)

    expect(store.reasoning).toBe(true)
    expect(localStorage.getItem('settings/consciousness/reasoning')).toBe('true')

    await store.resetState()

    expect(store.reasoning).toBe(false)
    expect(localStorage.getItem('settings/consciousness/reasoning')).toBe('false')
  })

  it('ignores storage events because Pinia owns cross-window synchronization', () => {
    const store = useConsciousnessSettingsStore()

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'settings/consciousness/reasoning',
      newValue: 'true',
    }))

    expect(store.reasoning).toBe(false)
  })
})
