import { getProviderCredentialResolver, resetChatProviderRuntimeExtensionsForTesting } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Lia config → AIRI provider runtime wiring (M1 blocker fix).
 *
 * Writing `consciousness.activeProvider` / `activeModel` is NOT the same as
 * having a configured provider. The AIRI runtime keeps three separate things:
 *
 *  - `activeProvider` / `activeModel`: which target the next send uses;
 *  - the provider record (`providers[providerId]`): references/metadata plus a
 *    `status` the runtime and the native UI read as "configured";
 *  - the credential: never stored in either, supplied per build by the
 *    registered resolver from the main-process vault.
 *
 * Lia only wrote the first, so a fully configured Lia still reported
 * "No Providers Configured" and every request that did not go through
 * `getProviderInstance` — model listing included — reached the upstream API
 * without an Authorization header (401).
 *
 * The discriminating test below writes ONLY the consciousness refs and asserts
 * the provider is still not configured; it fails if activation degenerates into
 * assigning those two refs.
 */

const SECRET = 'sk-lia-vault-secret-do-not-leak'

const ipc = vi.hoisted(() => {
  let chat: Record<string, unknown> = {}
  const vault = new Map<string, string>()
  const secretKey = (payload: { scope: string, key: string }) => `${payload.scope}\u0000${payload.key}`

  return {
    /** Test-only: the config main would return, plus its stored secrets. */
    fixture(next: Record<string, unknown>, secrets: Record<string, string> = {}) {
      chat = next
      vault.clear()
      for (const [scope, value] of Object.entries(secrets))
        vault.set(secretKey({ scope, key: 'apiKey' }), value)
    },
    get persistedChat() {
      return chat
    },
    getChatConfig: vi.fn(async (): Promise<unknown> => structuredClone(chat)),
    saveChatConfig: vi.fn(async (config: unknown) => {
      chat = structuredClone(config) as Record<string, unknown>
    }),
    encryptionAvailable: vi.fn(async () => true),
    secretHas: vi.fn(async (payload: { scope: string, key: string }) => vault.has(secretKey(payload))),
    secretSet: vi.fn(async (payload: { scope: string, key: string, value: string }) => {
      vault.set(secretKey(payload), payload.value)
      return true
    }),
    secretGet: vi.fn(async (payload: { scope: string, key: string }): Promise<string | undefined> => vault.get(secretKey(payload))),
    secretDelete: vi.fn(async (payload: { scope: string, key: string }) => vault.delete(secretKey(payload))),
  }
})

/**
 * Records whether the OpenRouter factory was handed a credential. Only the
 * boolean is kept — the value is never stored, asserted on, or logged.
 */
const factory = vi.hoisted(() => ({
  calls: [] as { hadCredential: boolean, hadBaseUrl: boolean }[],
}))

vi.mock('@xsai-ext/providers/create', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    createOpenRouter: (apiKey?: string, baseUrl?: string) => {
      factory.calls.push({
        hadCredential: typeof apiKey === 'string' && apiKey.length > 0,
        hadBaseUrl: typeof baseUrl === 'string' && baseUrl.length > 0,
      })
      return (actual.createOpenRouter as (key?: string, url?: string) => unknown)(apiKey, baseUrl)
    },
  }
})

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
    const handlers: Record<string, unknown> = {
      'eventa:invoke:lia:provider:chat:config:get-receive': ipc.getChatConfig,
      'eventa:invoke:lia:provider:chat:config:set-receive': ipc.saveChatConfig,
      'eventa:invoke:lia:secret:encryption-available-receive': ipc.encryptionAvailable,
      'eventa:invoke:lia:secret:has-receive': ipc.secretHas,
      'eventa:invoke:lia:secret:set-receive': ipc.secretSet,
      'eventa:invoke:lia:secret:get-receive': ipc.secretGet,
      'eventa:invoke:lia:secret:delete-receive': ipc.secretDelete,
    }
    const id = invoke?.receiveEvent?.id ?? ''
    if (id in handlers) {
      return handlers[id]
    }

    throw new Error(`Unexpected eventa invoke: ${id}`)
  },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'en-US' },
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

const { useLiaProviderStore } = await import('./provider')

const OPENROUTER = { providerId: 'openrouter-ai', modelId: 'openai/gpt-oss-120b' }

function keyedConfig() {
  return {
    onboarded: true,
    strategy: 'manual' as const,
    preferred: OPENROUTER,
    fallback: [],
    fallbackEnabled: true,
  }
}

describe('lia provider runtime wiring (M1)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetChatProviderRuntimeExtensionsForTesting()
    factory.calls = []
    ipc.fixture({})
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writing only activeProvider/activeModel does NOT configure the provider', async () => {
    ipc.fixture(keyedConfig(), { 'openrouter-ai': SECRET })
    const store = useLiaProviderStore()
    const consciousness = useConsciousnessStore()
    const providerConfigs = useProviderConfigStore()
    store.registerRuntimeExtensions()
    await store.refreshConfig()

    // Exactly what the previous activation did: assign the two refs.
    consciousness.activeProvider = OPENROUTER.providerId
    consciousness.activeModel = OPENROUTER.modelId

    expect(consciousness.activeProvider).toBe('openrouter-ai')
    expect(consciousness.activeModel).toBe('openai/gpt-oss-120b')
    // ...and the runtime still does not consider the provider configured: there
    // is not even a provider record, let alone one with status 'configured'.
    // This is the gap the fix closes, and the assertion that keeps it closed.
    expect(providerConfigs.configuredProviders['openrouter-ai']).not.toBe(true)
    expect(providerConfigs.getProvider('openrouter-ai')?.status).not.toBe('configured')
  })

  it('activateConfiguredProvider() makes the runtime treat the provider as configured', async () => {
    ipc.fixture(keyedConfig(), { 'openrouter-ai': SECRET })
    const store = useLiaProviderStore()
    const consciousness = useConsciousnessStore()
    const providerConfigs = useProviderConfigStore()
    store.registerRuntimeExtensions()

    expect(await store.activateConfiguredProvider()).toBe(true)

    expect(consciousness.activeProvider).toBe('openrouter-ai')
    expect(consciousness.activeModel).toBe('openai/gpt-oss-120b')
    expect(providerConfigs.configuredProviders['openrouter-ai']).toBe(true)
    expect(providerConfigs.getProvider('openrouter-ai')?.status).toBe('configured')
  })

  it('builds the chat provider instance with the vault credential', async () => {
    ipc.fixture(keyedConfig(), { 'openrouter-ai': SECRET })
    const store = useLiaProviderStore()
    const consciousness = useConsciousnessStore()
    store.registerRuntimeExtensions()
    await store.activateConfiguredProvider()

    factory.calls = []
    const instance = await consciousness.getChatProviderInstance('openrouter-ai')

    expect(instance).toBeTruthy()
    expect(factory.calls.length).toBeGreaterThan(0)
    expect(factory.calls.some(call => call.hadCredential)).toBe(true)
  })

  it('lists models with the vault credential, not with an empty config', async () => {
    ipc.fixture(keyedConfig(), { 'openrouter-ai': SECRET })
    const store = useLiaProviderStore()
    const providers = useProviderStore()
    store.registerRuntimeExtensions()
    await store.activateConfiguredProvider()

    factory.calls = []
    // No network in this environment; the point is what the factory was handed.
    await providers.fetchModelsForProvider('openrouter-ai').catch(() => {})

    expect(factory.calls.length).toBeGreaterThan(0)
    expect(factory.calls.some(call => call.hadCredential)).toBe(true)
  })

  it('configures a keyless provider without any secret', async () => {
    ipc.fixture({
      onboarded: true,
      strategy: 'manual',
      preferred: { providerId: 'ollama', modelId: 'llama3.2' },
      fallback: [],
      fallbackEnabled: true,
    })
    const store = useLiaProviderStore()
    const providerConfigs = useProviderConfigStore()
    store.registerRuntimeExtensions()

    expect(await store.activateConfiguredProvider()).toBe(true)
    expect(ipc.secretSet).not.toHaveBeenCalled()
    expect(providerConfigs.configuredProviders.ollama).toBe(true)
  })

  it('never claims a keyed provider is configured when its secret is missing', async () => {
    ipc.fixture(keyedConfig())
    const store = useLiaProviderStore()
    const consciousness = useConsciousnessStore()
    const providerConfigs = useProviderConfigStore()
    store.registerRuntimeExtensions()

    expect(await store.activateConfiguredProvider()).toBe(false)
    expect(consciousness.activeProvider).toBe('')
    expect(providerConfigs.configuredProviders['openrouter-ai']).not.toBe(true)
  })

  it('re-configures the provider on a fresh boot from the persisted config', async () => {
    ipc.fixture(keyedConfig(), { 'openrouter-ai': SECRET })

    // First boot.
    let store = useLiaProviderStore()
    store.registerRuntimeExtensions()
    expect(await store.activateConfiguredProvider()).toBe(true)

    // Restart: a brand new Pinia, so every runtime ref is back to its default,
    // while main still returns the same persisted config and vault secret.
    setActivePinia(createPinia())
    resetChatProviderRuntimeExtensionsForTesting()
    const consciousness = useConsciousnessStore()
    expect(consciousness.activeProvider).toBe('')

    store = useLiaProviderStore()
    store.registerRuntimeExtensions()
    expect(await store.activateConfiguredProvider()).toBe(true)

    expect(consciousness.activeProvider).toBe('openrouter-ai')
    expect(useProviderConfigStore().configuredProviders['openrouter-ai']).toBe(true)
  })

  it('keeps the secret out of the provider record, the product config and the logs', async () => {
    ipc.fixture(keyedConfig(), { 'openrouter-ai': SECRET })
    const logged: string[] = []
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(arg => String(arg)).join(' '))
      })
    }

    const store = useLiaProviderStore()
    store.registerRuntimeExtensions()
    await store.activateConfiguredProvider()
    await store.persistConfig({ ...(store.loadedConfig ?? {}), onboarded: true })

    // The provider record is what `useLocalStorage('settings/providers/configured')`
    // persists, so a secret here would be a secret in localStorage.
    expect(JSON.stringify(useProviderConfigStore().configs['openrouter-ai'] ?? {})).not.toContain(SECRET)
    expect(JSON.stringify(ipc.persistedChat)).not.toContain(SECRET)
    expect(logged.join('\n')).not.toContain(SECRET)
  })

  it('still resolves the credential only through the registered resolver', async () => {
    ipc.fixture(keyedConfig(), { 'openrouter-ai': SECRET })
    const store = useLiaProviderStore()
    store.registerRuntimeExtensions()

    const resolver = getProviderCredentialResolver()
    expect(resolver).toBeTypeOf('function')
    expect(await resolver!('openrouter-ai')).toEqual({ apiKey: SECRET })
  })
})
