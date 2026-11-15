import { getProviderCredentialResolver, resetChatProviderRuntimeExtensionsForTesting } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { initializeManagedChat } from '../../services/lia/managed-chat-startup'
import { createSecretAdoptHandler } from '../../services/lia/secret-adopt.fixture'
import { createLiaTransportClient, toTransportRecord } from '../../services/lia/transport-config'
import { setTransportTestVaultResolver } from '../../services/lia/transport-config.fixture'

/**
 * Config → runtime activation (M1 blocker fix).
 *
 * Reproduced bug: with a fully valid persisted Lia config (preferred provider +
 * model, key in the vault, onboarded) the chat still failed the first send,
 * because nothing ever applied that config to the shared AIRI runtime.
 * `persistConfig()` only writes `lia-product.json`; `chat.executeSendAttempt`
 * reads `consciousness.activeProvider` / `activeModel`, and the only writer was
 * the Home "Conversar" click. Any entry into the chat that did not go through
 * that button sent with an empty provider/model and threw
 * "No active chat provider or model configured".
 *
 * The store under test is real; only the IPC edge and `vue-i18n` are mocked. The
 * IPC mock structured-clones payloads the way Electron does.
 */

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

function validConfig(providerId: string, modelId: string) {
  return {
    onboarded: true,
    strategy: 'manual' as const,
    preferred: { providerId, modelId },
    fallback: [],
    fallbackEnabled: true,
  }
}

describe('lia chat provider activation (M1)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetChatProviderRuntimeExtensionsForTesting()
    ipc.fixture({})
    vi.clearAllMocks()
  })

  it('hydrates explicit keyless transport consent before checking first-use readiness', async () => {
    const providerId = 'openai-compatible'
    ipc.fixture(validConfig(providerId, 'local-dynamic-model'))
    const transports = createLiaTransportClient()
    const record = toTransportRecord(providerId, providerId, { baseUrl: 'http://127.0.0.1:12345/v1/' }, ['local-dynamic-model'])
    record.adapterOptions.allowUnauthenticated = true
    await transports.put(record)
    const store = useLiaProviderStore()
    expect(await store.activateConfiguredProvider()).toBe(true)
    expect(useConsciousnessStore().activeModel).toBe('local-dynamic-model')
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })

  it('boots managed chat from a persisted dynamic endpoint and model with no renderer selection', async () => {
    const providerId = 'openai-compatible'
    const modelId = 'configured-by-user/first-install-model'
    const baseUrl = 'https://user-selected.example.test/inference/v1/'
    ipc.fixture(validConfig(providerId, modelId), { [providerId]: 'stored-in-main-only' })
    const transports = createLiaTransportClient()
    await transports.put(toTransportRecord(providerId, providerId, { baseUrl }, [modelId]))
    const store = useLiaProviderStore()
    const consciousness = useConsciousnessStore()
    expect(consciousness.activeProvider).toBe('')
    expect(consciousness.activeModel).toBe('')
    store.registerRuntimeExtensions()

    expect(await initializeManagedChat({ liaManaged: true, leadership: 'leader-only', stageRuntime: 'full' }, store, consciousness)).toBe('ready')
    expect(consciousness.activeProvider).toBe(providerId)
    expect(consciousness.activeModel).toBe(modelId)
    expect((await transports.refresh()).records[0].baseUrl).toBe(baseUrl)
    expect(ipc.saveChatConfig).not.toHaveBeenCalled()
    expect(ipc.secretGet).not.toHaveBeenCalled()

    // Exercise the actual Main execution fixture with the activated pair. Only
    // the HTTP edge is stubbed; the endpoint comes exclusively from persistence.
    setTransportTestVaultResolver(getActivePinia()!, async () => 'stored-in-main-only')
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetch)
    try {
      const instance = await consciousness.getChatProviderInstance(consciousness.activeProvider)
      const response = await instance!.chat(consciousness.activeModel).fetch!(new URL('https://ignored.example.test/'), {
        method: 'POST',
        body: JSON.stringify({ model: consciousness.activeModel, messages: [{ role: 'user', content: 'hello' }] }),
      })
      await response.text()
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(String(fetch.mock.calls[0][0])).toBe(`${baseUrl}chat/completions`)
      expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).model).toBe(modelId)
      expect(ipc.secretGet).not.toHaveBeenCalled()
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('leaves the runtime unconfigured when nothing applied the config (the bug)', async () => {
    ipc.fixture(validConfig('openai', 'gpt-5.5'), { openai: 'sk-test' })
    const store = useLiaProviderStore()
    const consciousness = useConsciousnessStore()

    store.registerRuntimeExtensions()
    await store.refreshConfig()

    // A valid, ready config...
    expect(await store.isReadyToChat()).toBe(true)
    // ...that is still absent from the runtime until something applies it. This
    // empty pair is exactly what made the first send throw.
    expect(consciousness.activeProvider).toBe('')
    expect(consciousness.activeModel).toBe('')
  })

  it('activates the preferred provider and model from the persisted config', async () => {
    ipc.fixture(validConfig('openai', 'gpt-5.5'), { openai: 'sk-test' })
    const store = useLiaProviderStore()
    const consciousness = useConsciousnessStore()

    store.registerRuntimeExtensions()
    const activated = await store.activateConfiguredProvider()

    expect(activated).toBe(true)
    expect(consciousness.activeProvider).toBe('openai')
    expect(consciousness.activeModel).toBe('gpt-5.5')
  })

  it('is idempotent across repeated boots and re-activation', async () => {
    ipc.fixture(validConfig('groq', 'llama-3.3-70b-versatile'), { groq: 'gsk-test' })
    const store = useLiaProviderStore()
    const consciousness = useConsciousnessStore()
    store.registerRuntimeExtensions()

    expect(await store.activateConfiguredProvider()).toBe(true)
    expect(await store.activateConfiguredProvider()).toBe(true)

    expect(consciousness.activeProvider).toBe('groq')
    expect(consciousness.activeModel).toBe('llama-3.3-70b-versatile')
  })

  it('activates a keyless provider without any secret', async () => {
    ipc.fixture(validConfig('ollama', 'llama3.2'))
    const store = useLiaProviderStore()
    const consciousness = useConsciousnessStore()
    store.registerRuntimeExtensions()

    expect(await store.activateConfiguredProvider()).toBe(true)
    expect(ipc.secretSet).not.toHaveBeenCalled()
    expect(consciousness.activeProvider).toBe('ollama')
    expect(consciousness.activeModel).toBe('llama3.2')
  })

  it('does not activate when a keyed provider has no stored secret', async () => {
    ipc.fixture(validConfig('openai', 'gpt-5.5'))
    const store = useLiaProviderStore()
    const consciousness = useConsciousnessStore()
    store.registerRuntimeExtensions()

    expect(await store.activateConfiguredProvider()).toBe(false)
    expect(consciousness.activeProvider).toBe('')
    expect(consciousness.activeModel).toBe('')
  })

  it('does not activate an incomplete config (missing model)', async () => {
    ipc.fixture({ onboarded: true, preferred: { providerId: 'openai' }, fallback: [] })
    const store = useLiaProviderStore()
    const consciousness = useConsciousnessStore()
    store.registerRuntimeExtensions()

    expect(await store.activateConfiguredProvider()).toBe(false)
    expect(consciousness.activeProvider).toBe('')
  })

  it('does not activate before onboarding is complete', async () => {
    ipc.fixture({ ...validConfig('openai', 'gpt-5.5'), onboarded: false }, { openai: 'sk-test' })
    const store = useLiaProviderStore()
    const consciousness = useConsciousnessStore()
    store.registerRuntimeExtensions()

    expect(await store.activateConfiguredProvider()).toBe(false)
    expect(consciousness.activeProvider).toBe('')
  })

  /**
   * PROMPT-26: this test used to assert that the resolver handed `openai`'s
   * vault key to a renderer build. That is the exposure the boundary exists to
   * close — every curated id executes in main, so no consumer here needs the
   * key. The assertion is now the opposite, and stronger: asking for a curated
   * id returns nothing AND never touches the vault channel.
   */
  it('never resolves a curated provider key in this process, even when asked', async () => {
    ipc.fixture(validConfig('openai', 'gpt-5.5'), { openai: 'sk-from-vault' })
    const store = useLiaProviderStore()
    store.registerRuntimeExtensions()

    const resolver = getProviderCredentialResolver()
    expect(resolver).toBeTypeOf('function')
    expect(await resolver!('openai')).toBeUndefined()
    expect(ipc.secretGet).not.toHaveBeenCalled()

    // The secret never reaches the persisted document either.
    await store.activateConfiguredProvider()
    expect(JSON.stringify(ipc.persistedChat)).not.toContain('sk-from-vault')
  })

  it('keeps the configured fallback chain available to the chat runtime', async () => {
    ipc.fixture({
      ...validConfig('openai', 'gpt-5.5'),
      fallback: [{ providerId: 'groq', modelId: 'llama-3.3-70b-versatile' }],
    }, { openai: 'sk-test', groq: 'gsk-test' })
    const store = useLiaProviderStore()
    store.registerRuntimeExtensions()

    expect(await store.activateConfiguredProvider()).toBe(true)
    expect(await store.isFallbackConfigured()).toBe(true)
  })
})
