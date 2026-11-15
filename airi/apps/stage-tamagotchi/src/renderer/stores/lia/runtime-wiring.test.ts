import { getProviderCredentialResolver, resetChatProviderRuntimeExtensionsForTesting } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSecretAdoptHandler } from '../../services/lia/secret-adopt.fixture'

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

vi.mock('@proj-airi/electron-vueuse', async () => {
  const { transportTestInvoke } = await import('../../services/lia/transport-config.fixture')
  return ({
    useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
      const handlers: Record<string, unknown> = {
        'eventa:invoke:lia:provider:chat:config:get-receive': ipc.getChatConfig,
        'eventa:invoke:lia:provider:chat:config:set-receive': ipc.saveChatConfig,
        'eventa:invoke:lia:secret:encryption-available-receive': ipc.encryptionAvailable,
        'eventa:invoke:lia:secret:has-receive': ipc.secretHas,
        'eventa:invoke:lia:secret:set-receive': ipc.secretSet,
        'eventa:invoke:lia:secret:adopt-receive': createSecretAdoptHandler({ secretHas: ipc.secretHas, secretGet: ipc.secretGet, secretSet: ipc.secretSet }),
        'eventa:invoke:lia:secret:get-receive': ipc.secretGet,
        'eventa:invoke:lia:secret:delete-receive': ipc.secretDelete,
      }
      const id = invoke?.receiveEvent?.id ?? ''
      const transport = transportTestInvoke(id)
      if (transport)
        return transport
      if (id in handlers) {
        return handlers[id]
      }

      throw new Error(`Unexpected eventa invoke: ${id}`)
    },
  })
})

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

  /**
   * Corte B inverted this assertion.
   *
   * It used to require that the vault credential reached
   * `createOpenRouter`, which meant the secret crossed IPC into this renderer
   * and lived in an SDK client's closure for the rest of the session. The chat
   * boundary is now the main process: the provider handed to the chat runtime is
   * a transport shim whose only job is to forward the request. So the test
   * asserts the absence of what it used to require — no factory call, no vault
   * read, and no `apiKey` on the object the SDK will use.
   */
  it('builds the chat provider instance WITHOUT resolving the vault credential in the renderer', async () => {
    ipc.fixture(keyedConfig(), { 'openrouter-ai': SECRET })
    const store = useLiaProviderStore()
    const consciousness = useConsciousnessStore()
    store.registerRuntimeExtensions()
    await store.activateConfiguredProvider()

    factory.calls = []
    ipc.secretGet.mockClear()
    const instance = await consciousness.getChatProviderInstance('openrouter-ai')

    expect(instance).toBeTruthy()
    // The provider factory never ran, so no SDK client was built around the key.
    expect(factory.calls).toHaveLength(0)
    // And the credential was never pulled out of the vault for it.
    expect(ipc.secretGet).not.toHaveBeenCalled()
    const options = instance.chat('openai/gpt-oss-120b') as unknown as Record<string, unknown>
    expect(options).not.toHaveProperty('apiKey')
    expect(options.baseURL).toBe('https://openrouter.ai/api/v1/')
    expect(typeof options.fetch).toBe('function')
  })

  /**
   * Corte B, Fase 2 reversed this test's expectation, and that is the point.
   *
   * It used to assert that listing models built a client WITH the vault
   * credential inside this renderer - the last place a curated provider's key
   * still crossed back. Now the shared selector delegates to main, so the
   * factory must not run and the renderer must not read its own vault.
   */
  it('lists models through main, without building a client or reading the vault here', async () => {
    ipc.fixture(keyedConfig(), { 'openrouter-ai': SECRET })
    const store = useLiaProviderStore()
    const providers = useProviderStore()
    store.registerRuntimeExtensions()
    await store.activateConfiguredProvider()

    factory.calls = []
    ipc.secretGet.mockClear()
    // No network in this environment; the point is what the factory was handed.
    await providers.fetchModelsForProvider('openrouter-ai').catch(() => {})

    expect(factory.calls).toHaveLength(0)
    expect(ipc.secretGet).not.toHaveBeenCalled()
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
    await store.persistConfig({ ...store.loadedConfig, onboarded: true })

    // The provider record is what `useLocalStorage('settings/providers/configured')`
    // persists, so a secret here would be a secret in localStorage.
    expect(JSON.stringify(useProviderConfigStore().configs['openrouter-ai'] ?? {})).not.toContain(SECRET)
    expect(JSON.stringify(ipc.persistedChat)).not.toContain(SECRET)
    expect(logged.join('\n')).not.toContain(SECRET)
  })

  /**
   * PROMPT-26: the resolver is still the ONLY credential source in this
   * process, but it now refuses curated ids, because every one of them is
   * executed in main. What used to be asserted here (that asking for
   * `openrouter-ai` returned the key) is the exposure being closed.
   */
  it('registers a resolver that refuses curated ids and never reads the vault for them', async () => {
    ipc.fixture(keyedConfig(), { 'openrouter-ai': SECRET })
    const store = useLiaProviderStore()
    store.registerRuntimeExtensions()

    const resolver = getProviderCredentialResolver()
    expect(resolver).toBeTypeOf('function')
    expect(await resolver!('openrouter-ai')).toBeUndefined()
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })
})
