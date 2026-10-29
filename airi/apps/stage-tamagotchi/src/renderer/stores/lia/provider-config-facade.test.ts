import type { InferenceServiceProvider } from '@proj-airi/stage-ui/libs/providers/types'

import type { LiaProviderConfigSource } from './provider-config-facade'

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PiniaColada } from '@pinia/colada'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import {
  createLiaProviderConfigFacade,
  LIA_PROVIDER_CONFIG_REMOTE_EFFECTS,
  useLiaProviderConfigFacade,
} from './provider-config-facade'

/**
 * B0.7 — the Lia's provider-configuration facade.
 *
 * Three questions, one `describe` block each:
 *
 *  1. **Is it a facade?** Built over a recording double, every member must
 *     forward the exact arguments to the delegate and return its value
 *     unchanged. Nothing is computed here, so nothing can drift.
 *  2. **Does the shared store stay authoritative?** Against the real stores, a
 *     write through the facade must be visible exactly where the Stage runtime
 *     reads it — `useProviderConfigStore().configs`, the path
 *     `useProviderStore` uses to build instances. If that ever stops being true,
 *     "the Lia configured a provider" and "the runtime can build it" have
 *     diverged.
 *  3. **Which operations still reach the network?** `ensure` must not, and
 *     `updateConfig` must — replication is *not* disabled in this step, and a
 *     silent change in either direction has to fail a test rather than a review.
 *
 * Deterministic by construction: `fetch` is stubbed, no vault, no product file,
 * no credential — and no fake credential either, since nothing here is supposed
 * to carry one. The "no credential" test therefore asserts the payload keys are
 * exactly the ones the caller passed, rather than searching for a key it would
 * have to invent first.
 *
 * Reference: docs/architecture/LIA-PROVIDER-ADAPTER-DESIGN-2026-10-29.md §3 and
 * §6.1 (T1, T2, T3, T8).
 */

const observed = vi.hoisted(() => ({ requests: [] as string[] }))

function stubFetch(response: unknown = { data: [] }) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    observed.requests.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    return new Response(JSON.stringify(response), { status: 200 })
  }))
}

/** Records every call and returns sentinel values, so delegation is observable. */
function createRecordingSource() {
  const record: InferenceServiceProvider = {
    id: 'groq',
    definitionId: 'groq',
    config: { baseUrl: 'https://recorded.invalid/v1' },
    status: 'configured',
    configuredBy: 'user',
  }
  const source = {
    configuredProviders: { groq: true, other: false } as Record<string, boolean>,
    getProvider: vi.fn((providerId: string) => (providerId === 'groq' ? record : undefined)),
    getProviderConfig: vi.fn((providerId: string) => (providerId === 'groq' ? record.config : undefined)),
    ensureProvider: vi.fn((providerId: string, definitionId: string, config?: Record<string, unknown>) => ({
      ...record,
      id: providerId,
      definitionId,
      config: config ?? {},
    })),
    updateProviderConfig: vi.fn(async (providerId: string, config: Record<string, unknown>, status: string) => ({
      ...record,
      id: providerId,
      config,
      status: status as InferenceServiceProvider['status'],
    })),
  } satisfies LiaProviderConfigSource
  return { source, record }
}

describe('lia provider config facade — it only delegates', () => {
  it('forwards each read to the delegate and returns its value unchanged', () => {
    const { source, record } = createRecordingSource()
    const facade = createLiaProviderConfigFacade(source)

    expect(facade.get('groq')).toBe(record)
    expect(source.getProvider).toHaveBeenCalledExactlyOnceWith('groq')

    expect(facade.getConfig('groq')).toBe(record.config)
    expect(source.getProviderConfig).toHaveBeenCalledExactlyOnceWith('groq')

    expect(facade.get('absent')).toBeUndefined()
  })

  it('reads configuredProviders at call time instead of capturing it', () => {
    const { source } = createRecordingSource()
    const facade = createLiaProviderConfigFacade(source)

    expect(facade.isConfigured('groq')).toBe(true)
    expect(facade.isConfigured('other')).toBe(false)
    expect(facade.isConfigured('absent')).toBe(false)

    // A captured copy would keep answering `true` here. The map is derived on
    // the shared store and must stay live for the caller.
    source.configuredProviders.groq = false
    expect(facade.isConfigured('groq')).toBe(false)
  })

  it('forwards ensure with the same arguments and does not copy the payload', () => {
    const { source } = createRecordingSource()
    const facade = createLiaProviderConfigFacade(source)
    const payload = { baseUrl: 'https://example.invalid/v1' }

    facade.ensure('groq', 'groq', payload)

    expect(source.ensureProvider).toHaveBeenCalledExactlyOnceWith('groq', 'groq', payload)
    expect(source.ensureProvider.mock.calls[0][2]).toBe(payload)
  })

  it('defaults an omitted ensure payload to an empty object', () => {
    const { source } = createRecordingSource()
    const facade = createLiaProviderConfigFacade(source)

    facade.ensure('groq', 'groq')

    expect(source.ensureProvider).toHaveBeenCalledExactlyOnceWith('groq', 'groq', {})
  })

  it('forwards updateConfig with payload and status, resolving to the delegate value', async () => {
    const { source } = createRecordingSource()
    const facade = createLiaProviderConfigFacade(source)
    const payload = { baseUrl: 'https://next.invalid/v1' }

    const result = await facade.updateConfig('groq', payload, 'unconfigured')

    expect(source.updateProviderConfig).toHaveBeenCalledExactlyOnceWith('groq', payload, 'unconfigured')
    expect(result).toMatchObject({ id: 'groq', status: 'unconfigured' })
  })
})

describe('lia provider config facade — the shared store stays the source of truth', () => {
  /**
   * Same plugin set the desktop renderer installs; without PiniaColada the
   * remote mutation fails before reaching the network and the test would
   * misreport "no replication".
   */
  function installStores() {
    observed.requests = []
    const app = createApp({})
    const pinia = createPinia()
    app.use(pinia)
    app.use(PiniaColada)
    setActivePinia(pinia)
    return { config: useProviderConfigStore(), facade: useLiaProviderConfigFacade() }
  }

  beforeEach(() => {
    stubFetch()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('ensure writes locally, is visible to the runtime read path, and never reaches the network', () => {
    const { config, facade } = installStores()

    const created = facade.ensure('groq', 'groq', { baseUrl: 'https://example.invalid/v1' })

    expect(created).toMatchObject({ id: 'groq', status: 'unconfigured', configuredBy: 'user' })
    // Deep equality, not identity: the shared store hands back a reactive proxy
    // of the record it holds, so `toBe` compares a proxy against a raw object.
    // What matters is that the store has the record the facade returned.
    expect(config.getProvider('groq')).toStrictEqual(created)
    // `configs` is the exact path `useProviderStore` reads to build instances.
    expect(config.configs.groq).toEqual({ baseUrl: 'https://example.invalid/v1' })
    expect(observed.requests).toEqual([])
  })

  it('ensure on an existing record keeps it, does not overwrite it, and stays offline', () => {
    const { config, facade } = installStores()
    facade.ensure('groq', 'groq', {})
    config.providers.groq.config = { baseUrl: 'https://kept.invalid/v1' }

    const again = facade.ensure('groq', 'groq', { baseUrl: 'https://ignored.invalid/v1' })

    expect(again?.config).toEqual({ baseUrl: 'https://kept.invalid/v1' })
    expect(observed.requests).toEqual([])
  })

  it('updateConfig still replicates to the remote service — replication is not disabled here', async () => {
    stubFetch({
      id: 'groq',
      definitionId: 'groq',
      config: { baseUrl: 'https://next.invalid/v1' },
      status: 'configured',
      configuredBy: 'user',
    })
    const { config, facade } = installStores()
    facade.ensure('groq', 'groq', {})

    const updated = await facade.updateConfig('groq', { baseUrl: 'https://next.invalid/v1' }, 'configured')

    expect(updated).toBeDefined()
    expect(config.getProviderConfig('groq')).toEqual({ baseUrl: 'https://next.invalid/v1' })
    expect(observed.requests.length).toBeGreaterThan(0)
  })

  it('updateConfig keeps the local payload when the remote call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('remote unavailable')
    }))
    const { config, facade } = installStores()
    facade.ensure('groq', 'groq', {})

    await expect(facade.updateConfig('groq', { baseUrl: 'https://kept.invalid/v1' }, 'unconfigured'))
      .resolves
      .toBeDefined()

    expect(config.getProviderConfig('groq')).toEqual({ baseUrl: 'https://kept.invalid/v1' })
  })

  it('treats an update to an unknown provider as a no-op, like the shared store', async () => {
    const { config, facade } = installStores()

    await expect(facade.updateConfig('ghost', { baseUrl: 'https://x.invalid' }, 'unconfigured'))
      .resolves
      .toBeUndefined()

    expect(config.getProvider('ghost')).toBeUndefined()
    expect(observed.requests).toEqual([])
  })

  it('reflects a status written elsewhere on the shared store', () => {
    const { config, facade } = installStores()
    facade.ensure('groq', 'groq', {})

    expect(facade.isConfigured('groq')).toBe(false)

    // Not through the facade: this is the Stage's own runtime path
    // (`forceProviderConfigured`), proving the facade reads shared state rather
    // than keeping an opinion of its own.
    config.setProviderStatus('groq', 'configured')

    expect(facade.isConfigured('groq')).toBe(true)
  })

  it('never adds a credential to the payload it writes', async () => {
    const { config, facade } = installStores()
    facade.ensure('groq', 'groq', { baseUrl: 'https://example.invalid/v1' })

    await facade.updateConfig('groq', { baseUrl: 'https://example.invalid/v1', model: 'm-1' }, 'unconfigured')

    const written = config.getProvider('groq')
    expect(Object.keys(written?.config ?? {}).sort()).toEqual(['baseUrl', 'model'])
    expect(JSON.stringify(written)).not.toContain('apiKey')
  })
})

describe('lia provider config facade — the remote-effect inventory', () => {
  it('declares updateConfig as the only operation with a remote effect', () => {
    const remote = Object.entries(LIA_PROVIDER_CONFIG_REMOTE_EFFECTS)
      .filter(([, effect]) => effect)
      .map(([member]) => member)

    expect(remote).toEqual(['updateConfig'])
  })

  it('declares exactly the members the facade exposes, so a new member cannot skip the inventory', () => {
    const { source } = createRecordingSource()
    const exposed = Object.keys(createLiaProviderConfigFacade(source)).sort()

    expect(Object.keys(LIA_PROVIDER_CONFIG_REMOTE_EFFECTS).sort()).toEqual(exposed)
  })
})

describe('lia provider config facade — the import frontier', () => {
  it('is the only Lia production module that imports the shared provider-config store', () => {
    const directory = import.meta.dirname
    const offenders = readdirSync(directory)
      .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .filter(file => readFileSync(join(directory, file), 'utf8')
        .split('\n')
        // Anchored on the import statement itself, never on prose: a doc comment
        // mentioning the module path must not satisfy or break this check.
        .some(line => /^import\b/.test(line)
          && line.includes('@proj-airi/stage-ui/stores/providers/config')))

    expect(offenders).toEqual(['provider-config-facade.ts'])
  })
})
