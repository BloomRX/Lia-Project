import type { InferenceServiceProvider } from '@proj-airi/stage-ui/libs/providers/types'

import { PiniaColada } from '@pinia/colada'
import { registerProviderCredentialResolver, resetChatProviderRuntimeExtensionsForTesting } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

/**
 * Conformance battery for the provider surface the Lia consumes (B0.2, step 1).
 *
 * The Lia does not own a provider layer: it drives the shared Stage stores
 * through exactly thirteen members. Before anything is extracted, this file
 * pins what those thirteen members observably do TODAY, so a future
 * replacement can be judged against the same expectations instead of against a
 * memory of them.
 *
 * Scope discipline, deliberately narrow:
 *
 *  - It adds no implementation, adapter or indirection. It calls the two real
 *    stores, unchanged.
 *  - It asserts only what the Lia depends on. Behaviour that belongs to the
 *    Stage as a product (remote replication, authentication-owned providers)
 *    is marked as such below and pinned as *current*, not as required.
 *  - Nothing here touches the vault, the product config file or the network.
 *    `fetch` is stubbed for every test; a real credential is never used, and a
 *    fake one is asserted absent from logs, state and serialized output.
 *
 * Reference: docs/architecture/LIA-STAGE-DEPENDENCY-MAP-2026-10-28.md §12.6.
 */

/** Deliberately fake. Never a real key, and never expected in any output. */
const FAKE_KEY = 'sk-lia-conformance-fake-not-a-real-key'

/** The complete set of members the Lia reads. Confirmed by call-site search. */
const LIA_CONFIG_SURFACE = [
  'getProvider',
  'getProviderConfig',
  'ensureProvider',
  'updateProviderConfig',
  'providers',
  'configuredProviders',
] as const

const LIA_RUNTIME_SURFACE = [
  'validateProviderConfig',
  'disposeProviderInstance',
  'initializeProvider',
  'forceProviderConfigured',
  'getModelsForProvider',
  'supportsModelListing',
  'getProviderInstance',
] as const

const observed = vi.hoisted(() => ({
  requests: [] as string[],
  resolverCalls: [] as string[],
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

/**
 * The one subject this battery runs against today. A future adapter is expected
 * to be dropped in here without touching an assertion.
 */
function createSubject() {
  return {
    config: useProviderConfigStore(),
    runtime: useProviderStore(),
  }
}

/**
 * Installs the same plugins the desktop renderer installs (`main.ts` uses both
 * Vue and PiniaColada). Omitting PiniaColada would not merely weaken the test:
 * it would misreport it. Without the plugin the remote replication mutation
 * fails before reaching the network, so "an update replicates" would appear
 * false while the shipped app does replicate.
 */
function installStores() {
  const app = createApp({})
  const pinia = createPinia()
  app.use(pinia)
  app.use(PiniaColada)
  setActivePinia(pinia)
  return createSubject()
}

function stubFetch(response: unknown = { data: [] }, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    observed.requests.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    return new Response(JSON.stringify(response), { status })
  }))
}

function resetObservations() {
  observed.requests = []
  observed.resolverCalls = []
}

describe('lia provider conformance — surface inventory', () => {
  beforeEach(() => {
    installStores()
  })

  it('still exposes every config member the Lia calls', () => {
    const { config } = createSubject()
    for (const member of LIA_CONFIG_SURFACE)
      expect(config[member], `missing config member: ${member}`).toBeDefined()
  })

  it('still exposes every runtime member the Lia calls', () => {
    const { runtime } = createSubject()
    for (const member of LIA_RUNTIME_SURFACE)
      expect(runtime[member], `missing runtime member: ${member}`).toBeDefined()
  })

  it('covers exactly thirteen members across the two stores', () => {
    expect(LIA_CONFIG_SURFACE.length + LIA_RUNTIME_SURFACE.length).toBe(13)
  })
})

describe('lia provider conformance — reading and updating configuration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetObservations()
    stubFetch()
  })

  afterEach(() => {
    resetChatProviderRuntimeExtensionsForTesting()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('creates a keyless record marked unconfigured and owned by the user', () => {
    const { config } = installStores()

    const created = config.ensureProvider('groq', 'groq', { baseUrl: 'https://example.invalid/v1' })

    expect(created).toMatchObject({
      id: 'groq',
      definitionId: 'groq',
      status: 'unconfigured',
      configuredBy: 'user',
    })
    expect(created?.config).toEqual({ baseUrl: 'https://example.invalid/v1' })
  })

  it('is idempotent: a second ensure returns the existing record and never overwrites it', () => {
    const { config } = installStores()
    config.ensureProvider('groq', 'groq', {})
    config.providers.groq.config = { baseUrl: 'https://kept.invalid/v1' }

    const again = config.ensureProvider('groq', 'groq', { baseUrl: 'https://ignored.invalid/v1' })

    expect(again?.config).toEqual({ baseUrl: 'https://kept.invalid/v1' })
  })

  it('refuses an unknown definition instead of inventing a record', () => {
    const { config } = installStores()

    expect(() => config.ensureProvider('ghost', 'no-such-definition', {}))
      .toThrow(/no-such-definition/)

    expect(config.getProvider('ghost')).toBeUndefined()
  })

  it('reads back what it wrote and reports absence without throwing', () => {
    const { config } = installStores()
    config.ensureProvider('groq', 'groq', { baseUrl: 'https://example.invalid/v1' })

    expect(config.getProvider('groq')?.id).toBe('groq')
    expect(config.getProviderConfig('groq')).toEqual({ baseUrl: 'https://example.invalid/v1' })

    expect(config.getProvider('never-created')).toBeUndefined()
    expect(config.getProviderConfig('never-created')).toBeUndefined()
  })

  it('replaces configuration and status through updateProviderConfig', async () => {
    const { config } = installStores()
    config.ensureProvider('groq', 'groq', {})

    await config.updateProviderConfig('groq', { baseUrl: 'https://next.invalid/v1' }, 'configured')

    expect(config.getProviderConfig('groq')).toEqual({ baseUrl: 'https://next.invalid/v1' })
    expect(config.getProvider('groq')?.status).toBe('configured')
  })

  it('treats an update to an unknown provider as a no-op rather than creating one', async () => {
    const { config } = installStores()

    await expect(config.updateProviderConfig('ghost', { baseUrl: 'https://x.invalid' }, 'configured'))
      .resolves
      .toBeUndefined()

    expect(config.getProvider('ghost')).toBeUndefined()
  })
})

describe('lia provider conformance — selection and availability state', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetObservations()
    stubFetch()
  })

  afterEach(() => {
    resetChatProviderRuntimeExtensionsForTesting()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('derives configuredProviders from the record status, not from presence', () => {
    const { config } = installStores()
    config.ensureProvider('groq', 'groq', {})

    expect(config.configuredProviders.groq).toBe(false)

    config.setProviderStatus('groq', 'configured')
    expect(config.configuredProviders.groq).toBe(true)
  })

  it('creates the record and runtime state through initializeProvider', async () => {
    const { config, runtime } = installStores()

    await runtime.initializeProvider('groq')

    const record: InferenceServiceProvider | undefined = config.getProvider('groq')
    expect(record).toBeDefined()
    // initializeProvider must not imply "configured": that is forceProviderConfigured's job.
    expect(record?.status).toBe('unconfigured')
    expect(runtime.getModelsForProvider('groq')).toEqual([])
  })

  it('marks a provider configured through forceProviderConfigured', async () => {
    const { config, runtime } = installStores()
    config.ensureProvider('groq', 'groq', {})

    await runtime.initializeProvider('groq')
    runtime.forceProviderConfigured('groq')

    expect(config.getProvider('groq')?.status).toBe('configured')
    expect(config.configuredProviders.groq).toBe(true)
  })

  it('answers supportsModelListing for known definitions and refuses unknown ones', () => {
    const { runtime } = installStores()

    expect(runtime.supportsModelListing('groq')).toBe(true)
    expect(runtime.supportsModelListing('no-such-provider')).toBe(false)
  })

  it('returns an empty model list for a provider that never loaded models', () => {
    const { runtime } = installStores()

    expect(runtime.getModelsForProvider('no-such-provider')).toEqual([])
  })
})

describe('lia provider conformance — failure handling', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetObservations()
    stubFetch()
  })

  afterEach(() => {
    resetChatProviderRuntimeExtensionsForTesting()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reports an invalid configuration as a result instead of throwing', async () => {
    const { runtime } = installStores()

    const result = await runtime.validateProviderConfig('groq', {})

    expect(result.valid).toBe(false)
    expect(typeof result.reason).toBe('string')
  })

  it('refuses to build an instance for a provider that was never configured', async () => {
    const { runtime } = installStores()

    await expect(runtime.getProviderInstance('groq'))
      .rejects
      .toThrow(/groq/)
  })
})

describe('lia provider conformance — the credential stays out of every surface', () => {
  let logged: string[] = []

  beforeEach(() => {
    setActivePinia(createPinia())
    resetObservations()
    logged = []

    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '))
      })
    }

    stubFetch()

    registerProviderCredentialResolver(async (providerId: string) => {
      observed.resolverCalls.push(providerId)
      return { apiKey: FAKE_KEY }
    })
  })

  afterEach(() => {
    resetChatProviderRuntimeExtensionsForTesting()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('builds the instance from the resolver without writing the secret into the record', async () => {
    const { config, runtime } = installStores()
    config.ensureProvider('groq', 'groq', { baseUrl: 'https://example.invalid/v1' })

    await runtime.getProviderInstance('groq')

    expect(observed.resolverCalls).toContain('groq')
    expect(JSON.stringify(config.getProvider('groq'))).not.toContain(FAKE_KEY)
    expect(JSON.stringify(config.providers)).not.toContain(FAKE_KEY)
  })

  it('keeps the secret out of the logs and out of the whole store state', async () => {
    const { config, runtime } = installStores()
    config.ensureProvider('groq', 'groq', {})

    await runtime.getProviderInstance('groq')
    runtime.forceProviderConfigured('groq')
    await runtime.initializeProvider('groq')

    expect(logged.join('\n')).not.toContain(FAKE_KEY)
    expect(JSON.stringify(config.$state)).not.toContain(FAKE_KEY)
  })

  it('re-resolves the credential after disposal instead of reusing a stale instance', async () => {
    const { config, runtime } = installStores()
    config.ensureProvider('groq', 'groq', {})

    await runtime.getProviderInstance('groq')
    const afterFirst = observed.resolverCalls.filter(id => id === 'groq').length

    await runtime.disposeProviderInstance('groq')
    await runtime.getProviderInstance('groq')

    const afterSecond = observed.resolverCalls.filter(id => id === 'groq').length
    expect(afterSecond).toBeGreaterThan(afterFirst)
  })
})

/**
 * Behaviour that belongs to the Stage as a product, pinned only so the
 * difference is visible rather than assumed.
 *
 * The Lia does not depend on any of it. When the Lia gets its own store these
 * expectations are meant to be dropped — deliberately, in a diff that says so,
 * not silently.
 */
describe('lia provider conformance — Stage-only behaviour (not a Lia requirement)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetObservations()
  })

  afterEach(() => {
    resetChatProviderRuntimeExtensionsForTesting()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('replicates an update to the remote service — current Stage behaviour', async () => {
    // The backend echoes the stored record. Note what that means: when the
    // remote answers, its copy replaces the local one wholesale — the local
    // write is not authoritative. A Lia-owned store would not have this
    // ordering problem, because it would have nothing to replicate to.
    stubFetch({
      id: 'groq',
      definitionId: 'groq',
      config: { baseUrl: 'https://next.invalid/v1' },
      status: 'configured',
      configuredBy: 'user',
    })
    const { config } = installStores()
    config.ensureProvider('groq', 'groq', {})

    await config.updateProviderConfig('groq', { baseUrl: 'https://next.invalid/v1' }, 'configured')

    // The Lia needs the local write. The remote attempt is the Stage's, and is
    // exactly what a Lia-owned store is meant to drop.
    expect(config.getProviderConfig('groq')).toEqual({ baseUrl: 'https://next.invalid/v1' })
    expect(observed.requests.length).toBeGreaterThan(0)
  })

  it('keeps the local configuration when the remote update fails — current Stage behaviour', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('remote unavailable')
    }))
    const { config } = installStores()
    config.ensureProvider('groq', 'groq', {})

    await expect(config.updateProviderConfig('groq', { baseUrl: 'https://kept.invalid/v1' }, 'configured'))
      .resolves
      .toBeDefined()

    expect(config.getProviderConfig('groq')).toEqual({ baseUrl: 'https://kept.invalid/v1' })
  })
})
