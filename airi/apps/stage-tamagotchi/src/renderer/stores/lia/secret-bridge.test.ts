/**
 * Phase 7.3 secret-bridge integration tests (F/H/I/J) against the REAL Lia
 * provider store, reusing the activation harness: only the IPC edge and
 * i18n are mocked.
 *
 * F: preferred=groq + Lia vault secret -> the provider build receives the
 *    vault credential (never the legacy store).
 * H: missing vault secret -> the resolver surfaces the explicit missing
 *    state, WITHOUT fabricating a placeholder key.
 * I: fallbackEnabled=false -> the fallback resolver declines; no silent
 *    provider hop after an auth failure.
 * J: the resolver's diagnostic log carries METADATA ONLY - never the
 *    literal key.
 */
import { getChatFallbackResolver, getProviderCredentialResolver, resetChatProviderRuntimeExtensionsForTesting } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSecretAdoptHandler } from '../../services/lia/secret-adopt.fixture'

const ipc = vi.hoisted(() => {
  let chat: Record<string, unknown> = {}
  const vault = new Map<string, string>()
  const secretKey = (payload: { scope: string, key: string }) => `${payload.scope}\u0000${payload.key}`
  return {
    fixture(next: Record<string, unknown>, secrets: Record<string, string> = {}) {
      chat = next
      vault.clear()
      for (const [scope, value] of Object.entries(secrets))
        vault.set(secretKey({ scope, key: 'apiKey' }), value)
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
      if (id in handlers)
        return handlers[id]
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

const SIMULATED_KEY = 'sk-simulated-bridge-secret'

function validConfig(fallbackEnabled = false) {
  return {
    fallback: [{ modelId: 'gpt-4', providerId: 'openai' }],
    fallbackEnabled,
    onboarded: true,
    preferred: { modelId: 'llama-3.3-70b-versatile', providerId: 'groq' },
    strategy: 'manual' as const,
  }
}

describe('phase 7.3 secret bridge (F/H/I/J)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetChatProviderRuntimeExtensionsForTesting()
    ipc.fixture({})
    vi.clearAllMocks()
  })

  /**
   * PROMPT-26: the preferred id is `groq`, a curated provider, so the resolver
   * must refuse it — its chat executes in main now. The vault channel must not
   * even be touched. The path that still resolves here is a provider OUTSIDE
   * the catalog, asserted below so the two halves stay distinguishable.
   */
  it('f: the resolver refuses the curated preferred id and still serves a non-curated one', async () => {
    ipc.fixture(validConfig(), { groq: SIMULATED_KEY, deepseek: SIMULATED_KEY })
    const store = useLiaProviderStore()
    store.registerRuntimeExtensions()
    await store.refreshConfig()

    const resolver = getProviderCredentialResolver()
    expect(resolver).toBeDefined()
    expect(await resolver!('groq')).toBeUndefined()
    expect(ipc.secretGet).not.toHaveBeenCalled()

    // Documented debt, pinned so it cannot be forgotten: non-curated ids still
    // resolve in this process until their consumers are migrated.
    expect(await resolver!('deepseek')).toEqual({ apiKey: SIMULATED_KEY })
    expect(ipc.secretGet).toHaveBeenCalledWith({ scope: 'deepseek', key: 'apiKey' })
  })

  it('h: a missing vault secret yields the explicit missing state (undefined), never a fabricated key', async () => {
    ipc.fixture(validConfig(), {}) // vault empty
    const store = useLiaProviderStore()
    store.registerRuntimeExtensions()
    await store.refreshConfig()

    const resolver = getProviderCredentialResolver()
    const credential = await resolver!('groq')
    expect(credential).toBeUndefined()
  })

  it('i: fallbackEnabled=false declines the fallback even after an auth-class error', async () => {
    ipc.fixture(validConfig(false), { groq: SIMULATED_KEY })
    const store = useLiaProviderStore()
    store.registerRuntimeExtensions()
    await store.refreshConfig()

    const fallback = getChatFallbackResolver()
    expect(fallback).toBeDefined()
    type FallbackArgs = Parameters<NonNullable<ReturnType<typeof getChatFallbackResolver>>>
    const next = await fallback!({
      error: new Error('Remote sent 401 response'),
      modelId: 'llama-3.3-70b-versatile',
      providerId: 'groq',
    } as FallbackArgs[0])
    expect(next).toBeUndefined() // no silent hop to the openai fallback
  })

  it('j: resolver diagnostics carry metadata only - never the literal secret', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    ipc.fixture(validConfig(), { groq: SIMULATED_KEY, deepseek: SIMULATED_KEY })
    const store = useLiaProviderStore()
    store.registerRuntimeExtensions()
    await store.refreshConfig()

    // The curated id is refused before any lookup, so it logs nothing at all…
    await getProviderCredentialResolver()!('groq')
    // …and the non-curated path logs its metadata without the value.
    await getProviderCredentialResolver()!('deepseek')
    const logged = info.mock.calls.map(call => call.join(' ')).join(' ')
    expect(logged).toContain('providerId=deepseek')
    expect(logged).toContain('secretSource=lia-vault')
    expect(logged).toContain('hasApiKey=true')
    expect(logged).not.toContain('providerId=groq')
    expect(logged).not.toContain(SIMULATED_KEY)
    info.mockRestore()
  })

  describe('8.0D failure behavior through the registered Lia policy', () => {
    it.each([
      'Remote sent 429 response: rate_limit_exceeded',
      'Remote sent 500 response: internal server error',
      'Remote sent 503 response: service unavailable',
      'fetch failed: ECONNRESET',
    ])('selects the next configured target after a recoverable failure: %s', async (message) => {
      const config = validConfig(true)
      ipc.fixture(config)
      const store = useLiaProviderStore()
      store.registerRuntimeExtensions()
      await store.refreshConfig()

      const resolve = getChatFallbackResolver()!
      const next = await resolve({
        attemptIndex: 0,
        error: new Error(message),
        ...config.preferred,
      })

      expect(next).toEqual(config.fallback[0])
      expect(await resolve({
        attemptIndex: 1,
        error: new Error(message),
        ...next,
      })).toBeUndefined()
      expect(store.loadedConfig).toEqual(config)
      expect(ipc.saveChatConfig).not.toHaveBeenCalled()
      expect(ipc.secretGet).not.toHaveBeenCalled()
    })

    it.each([
      'Remote sent 400 response: invalid request',
      'Remote sent 401 response: unauthorized',
      'Remote sent 403 response: forbidden',
      'Remote sent 404 response: model_not_found',
      'This model is unsupported',
      'Invalid configuration',
    ])('declines a permanent failure even when failover is enabled: %s', async (message) => {
      const config = validConfig(true)
      ipc.fixture(config)
      const store = useLiaProviderStore()
      store.registerRuntimeExtensions()
      await store.refreshConfig()

      expect(await getChatFallbackResolver()!({
        attemptIndex: 0,
        error: new Error(message),
        ...config.preferred,
      })).toBeUndefined()
      expect(store.loadedConfig).toEqual(config)
      expect(ipc.saveChatConfig).not.toHaveBeenCalled()
      expect(ipc.secretGet).not.toHaveBeenCalled()
    })

    it('respects the opt-out even for a recoverable service failure', async () => {
      const config = validConfig(false)
      ipc.fixture(config)
      const store = useLiaProviderStore()
      store.registerRuntimeExtensions()
      await store.refreshConfig()

      expect(await getChatFallbackResolver()!({
        attemptIndex: 0,
        error: new Error('Remote sent 503 response: service unavailable'),
        ...config.preferred,
      })).toBeUndefined()
      expect(ipc.saveChatConfig).not.toHaveBeenCalled()
    })
  })
})
