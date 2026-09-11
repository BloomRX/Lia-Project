import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registerProviderCredentialResolver, resetChatProviderRuntimeExtensionsForTesting } from '../chat/chat-provider-runtime'
import { useProviderConfigStore } from './config'
import { useProviderStore } from './provider'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

/**
 * Regression coverage for provider schema defaults reaching `createProvider()`.
 *
 * ROOT CAUSE:
 *
 * Providers declare their endpoint as `baseUrl: z.string().default(...)`, but a
 * zod default only materializes when a config is parsed. Provider instances are
 * built from the raw stored config, so a Lia-activated Groq - stored as `{}` -
 * reached `createOpenAI(apiKey, undefined)`, which falls back to
 * `https://api.openai.com/v1/`. The Groq credential was then sent to OpenAI and
 * rejected with 401 "Missing bearer authentication in header".
 *
 * The fix applies the provider's own declared defaults before instantiation,
 * reusing `normalizeProviderConfigDefaults`; nothing is hardcoded per provider.
 */

/** Deliberately fake. Never a real key, and never expected in any output. */
const FAKE_KEY = 'gsk-diag-fake-credential-not-a-real-key'

const observed = vi.hoisted(() => ({
  createProviderCalls: [] as Array<{ providerId: string, config: Record<string, unknown> }>,
  requests: [] as Array<{ method: string, url: string }>,
}))

vi.mock('../../libs/providers', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const listProviders = actual.listProviders as () => Array<Record<string, any>>

  return {
    ...actual,
    // The registry hands out copies, so this is the only place every definition
    // can be wrapped to observe what `createProvider()` is actually given.
    listProviders: () => listProviders().map(definition => ({
      ...definition,
      createProvider: (config: Record<string, unknown>) => {
        observed.createProviderCalls.push({ providerId: definition.id as string, config: { ...config } })
        return definition.createProvider(config)
      },
    })),
  }
})

function lastCallFor(providerId: string) {
  return [...observed.createProviderCalls].reverse().find(call => call.providerId === providerId)
}

describe('provider schema defaults are applied before creation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    observed.createProviderCalls = []
    observed.requests = []

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      observed.requests.push({
        method: 'GET',
        url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      })
      // The response is never inspected by these tests; only the URL matters.
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }))
  })

  afterEach(() => {
    resetChatProviderRuntimeExtensionsForTesting()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // 1 + 2: Groq stored without a baseUrl must still be built against Groq.
  it('gives Groq its declared baseUrl when the stored config has none', async () => {
    const store = useProviderStore()
    useProviderConfigStore().ensureProvider('groq', 'groq', {})

    await store.getProviderInstance('groq')

    const call = lastCallFor('groq')
    expect(call).toBeDefined()
    expect(call?.config.baseUrl).toBe('https://api.groq.com/openai/v1/')
  })

  // 4: an explicit baseUrl is user configuration and must win.
  it('does not overwrite an explicitly configured baseUrl', async () => {
    const store = useProviderStore()
    useProviderConfigStore().ensureProvider('groq', 'groq', { baseUrl: 'https://groq.example.internal/v1/' })

    await store.getProviderInstance('groq')

    expect(lastCallFor('groq')?.config.baseUrl).toBe('https://groq.example.internal/v1/')
  })

  // 5: the mechanism is generic, not a Groq special case.
  it('applies the declared default of another provider too', async () => {
    const store = useProviderStore()
    useProviderConfigStore().ensureProvider('deepseek', 'deepseek', {})

    await store.getProviderInstance('deepseek')

    expect(lastCallFor('deepseek')?.config.baseUrl).toBe('https://api.deepseek.com/')
  })

  // 6: a provider with no declared default keeps the original behaviour - in
  // particular it must not be handed the `baseUrl: ''` placeholder that
  // `getDefaultProviderConfig` adds for UI purposes.
  it('leaves a provider without defaults untouched', async () => {
    const store = useProviderStore()
    useProviderConfigStore().ensureProvider('cloudflare-workers-ai', 'cloudflare-workers-ai', {
      apiKey: FAKE_KEY,
      accountId: 'acct-1',
    })

    await store.getProviderInstance('cloudflare-workers-ai')

    const call = lastCallFor('cloudflare-workers-ai')
    expect(call?.config).toEqual({ apiKey: FAKE_KEY, accountId: 'acct-1' })
    expect(call?.config).not.toHaveProperty('baseUrl')
  })

  // 7: the credential resolver still supplies the key after normalization.
  it('keeps the resolver-supplied credential alongside the applied default', async () => {
    registerProviderCredentialResolver(async () => ({ apiKey: FAKE_KEY }))
    const store = useProviderStore()
    useProviderConfigStore().ensureProvider('groq', 'groq', {})

    await store.getProviderInstance('groq')

    const call = lastCallFor('groq')
    expect(call?.config.apiKey).toBe(FAKE_KEY)
    expect(call?.config.baseUrl).toBe('https://api.groq.com/openai/v1/')
  })

  // 3 + real-case regression: the exact failing scenario, asserted at the wire.
  it('lists Groq models against api.groq.com and never api.openai.com', async () => {
    registerProviderCredentialResolver(async () => ({ apiKey: FAKE_KEY }))
    const store = useProviderStore()
    // Exactly what Lia activation stores: provider + model, no baseUrl.
    useProviderConfigStore().ensureProvider('groq', 'groq', {})

    await store.fetchModelsForProvider('groq')

    expect(observed.requests.length).toBeGreaterThan(0)
    const urls = observed.requests.map(request => request.url)
    expect(urls.some(url => url.includes('api.groq.com/openai/v1/models'))).toBe(true)
    expect(urls.some(url => url.includes('api.openai.com'))).toBe(false)
  })

  // The chat instance must resolve to the same host as the listing.
  it('builds the chat instance against the Groq host as well', async () => {
    registerProviderCredentialResolver(async () => ({ apiKey: FAKE_KEY }))
    const store = useProviderStore()
    useProviderConfigStore().ensureProvider('groq', 'groq', {})

    await store.getChatProviderInstance('groq', { reasoning: 'disabled' } as never)

    expect(lastCallFor('groq')?.config.baseUrl).toBe('https://api.groq.com/openai/v1/')
  })

  // 8: the credential stays out of persisted config and out of the logs.
  it('never writes the credential into config or logs', async () => {
    const logs: string[] = []
    for (const level of ['log', 'info', 'warn', 'error'] as const)
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.join(' ')))

    registerProviderCredentialResolver(async () => ({ apiKey: FAKE_KEY }))
    const store = useProviderStore()
    const configStore = useProviderConfigStore()
    configStore.ensureProvider('groq', 'groq', {})

    await store.fetchModelsForProvider('groq')

    expect(JSON.stringify(configStore.getProviderConfig('groq'))).not.toContain(FAKE_KEY)
    expect(JSON.stringify(configStore.$state)).not.toContain(FAKE_KEY)
    expect(logs.join('\n')).not.toContain(FAKE_KEY)
  })
})
