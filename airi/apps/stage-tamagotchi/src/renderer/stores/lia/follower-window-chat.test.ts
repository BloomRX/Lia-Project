import { getProviderCredentialResolver, resetChatProviderRuntimeExtensionsForTesting } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSecretAdoptHandler } from '../../services/lia/secret-adopt.fixture'
import { createLiaTransportClient } from '../../services/lia/transport-config'
import { setTransportTestVaultResolver, setTransportTestWriteFailure } from '../../services/lia/transport-config.fixture'

/**
 * The follower-only window must be able to chat.
 *
 * `#/chat` runs in a window whose leadership is `false`, so `App.vue` skipped
 * `registerRuntimeExtensions()` — correctly, since the vault resolver, the
 * fallback chain and the hearing projection must live in exactly one window.
 * But the chat factory was installed *inside* that leader-only call, so the
 * follower fell through to the untouched legacy implementation:
 * `getChatProviderInstance` there built an SDK client from whatever local config
 * it had, with no credential resolver registered to supply a key. Every send
 * produced a request without an `Authorization` header — a 401 that no leader
 * test could see, because the leader's own path was fine.
 *
 * The fix splits the two responsibilities: the chat transport bridge installs in
 * every window (it reads no credential), while the leader-only runtime
 * extensions stay leader-only. These tests pin both halves.
 */

const SECRET = 'sk-lia-vault-secret-do-not-leak'
const MODEL = 'openai/gpt-oss-120b'
const BASE_URL = 'https://openrouter.ai/api/v1/'

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
    /**
     * Main reading its own vault, which is NOT the renderer asking over IPC.
     * Keeping them as separate spies is what lets the test distinguish "the key
     * stayed in main" from "the key was handed to the renderer": `secretGet` is
     * the renderer-facing channel, this is the in-process read the transport
     * service performs.
     */
    vaultRead: vi.fn(async (payload: { scope: string, key: string }): Promise<string | undefined> => vault.get(secretKey(payload))),
  }
})

vi.mock('@proj-airi/electron-vueuse', async () => {
  const { transportTestInvoke } = await import('../../services/lia/transport-config.fixture')
  return {
    useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
      const id = invoke?.receiveEvent?.id ?? ''
      const transport = transportTestInvoke(id)
      if (transport)
        return transport
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
      if (id in handlers)
        return handlers[id]
      throw new Error(`Unexpected eventa invoke: ${id}`)
    },
  }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: { value: 'en-US' }, t: (key: string, fallback?: string) => fallback ?? key }),
}))

const { useLiaProviderStore } = await import('./provider')

function keyedConfig() {
  return {
    onboarded: true,
    strategy: 'manual' as const,
    preferred: { providerId: 'openrouter-ai', modelId: MODEL },
    fallback: [],
    fallbackEnabled: true,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  const pinia = createPinia()
  setActivePinia(pinia)
  setTransportTestVaultResolver(pinia, ipc.vaultRead)
  resetChatProviderRuntimeExtensionsForTesting()
  ipc.fixture({})
  vi.clearAllMocks()
  fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: 'OK' } }] }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('follower-only window chat', () => {
  it('chats through main with only the transport bridge installed — no credential resolver, no vault read', async () => {
    ipc.fixture(keyedConfig(), { 'openrouter-ai': SECRET })
    const store = useLiaProviderStore()
    // Exactly what `App.vue` does in a follower window: the bridge, and nothing
    // else. Standing in for the record the leader already persisted at
    // activation time, this window never writes configuration remotely.
    store.registerChatTransport()
    await store.ensureProviderRecord('openrouter-ai', BASE_URL)

    expect(getProviderCredentialResolver()).toBeUndefined()

    const provider = useProviderStore()
    const instance = await provider.getChatProviderInstance('openrouter-ai', { reasoning: 'disabled' })
    expect(instance).toBeTruthy()

    const response = await instance!.chat(MODEL).fetch!(new URL('https://ignored.invalid'), {
      method: 'POST',
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'fixture' }] }),
    })
    await response.text()

    // Main executed it, once, against the provider's own endpoint.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE_URL}chat/completions`)
    // Main read its own vault to sign the request...
    expect(ipc.vaultRead).toHaveBeenCalledWith({ scope: 'openrouter-ai', key: 'apiKey' })
    // ...and the renderer-facing channel was never used: the key never crossed back.
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })

  it('installs the same bridge from the leader-only extensions, so the leader keeps chatting', async () => {
    ipc.fixture(keyedConfig(), { 'openrouter-ai': SECRET })
    const store = useLiaProviderStore()
    store.registerRuntimeExtensions()

    // The leader still gets everything else it needs.
    expect(getProviderCredentialResolver()).toBeTypeOf('function')

    await store.ensureProviderRecord('openrouter-ai', BASE_URL)
    const instance = await useProviderStore().getChatProviderInstance('openrouter-ai', { reasoning: 'disabled' })
    const response = await instance!.chat(MODEL).fetch!(new URL('https://ignored.invalid'), {
      method: 'POST',
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'fixture' }] }),
    })
    await response.text()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(ipc.vaultRead).toHaveBeenCalled()
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })

  it('is idempotent: installing the bridge again does not forward the request twice', async () => {
    ipc.fixture(keyedConfig(), { 'openrouter-ai': SECRET })
    const store = useLiaProviderStore()
    store.registerChatTransport()
    store.registerChatTransport()
    store.registerRuntimeExtensions()
    await store.ensureProviderRecord('openrouter-ai', BASE_URL)

    const instance = await useProviderStore().getChatProviderInstance('openrouter-ai', { reasoning: 'disabled' })
    const response = await instance!.chat(MODEL).fetch!(new URL('https://ignored.invalid'), {
      method: 'POST',
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'fixture' }] }),
    })
    await response.text()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  /**
   * Window order, not configuration.
   *
   * The transport record is written by whichever window gets there first, but
   * until this cut only the LEADER ever wrote it - so a follower-only window
   * opened first found nothing to read and every send failed with
   * `configuration`, even though the provider was fully configured.
   *
   * The recovery must not become a second source of truth: the follower creates
   * the record with the same idempotent call, into the same main repository,
   * with no credential. Main stays the only authority.
   */
  it('chats from a follower opened BEFORE the leader, creating the record in main only', async () => {
    ipc.fixture(keyedConfig(), { 'openrouter-ai': SECRET })
    // The address the user configured. It is synced state, so a follower that
    // opened first already has it - that is the whole precondition.
    useProviderConfigStore().ensureProvider('openrouter-ai', 'openrouter-ai', { baseUrl: BASE_URL })
    const store = useLiaProviderStore()
    store.registerChatTransport()
    expect(getProviderCredentialResolver()).toBeUndefined()
    // Nothing was persisted by a leader: main's repository is empty.
    expect((await createLiaTransportClient().refresh()).records).toEqual([])

    const instance = await useProviderStore().getChatProviderInstance('openrouter-ai', { reasoning: 'disabled' })
    const response = await instance!.chat(MODEL).fetch!(new URL('https://ignored.invalid'), {
      method: 'POST',
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'fixture' }] }),
    })
    await response.text()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE_URL}chat/completions`)
    // The recovery wrote the record into MAIN, not into a renderer cache...
    const records = (await createLiaTransportClient().refresh()).records
    expect(records.map(record => record.providerId)).toEqual(['openrouter-ai'])
    // ...and it carried no credential: main read its own vault to sign.
    expect(JSON.stringify(records)).not.toContain(SECRET)
    expect(ipc.vaultRead).toHaveBeenCalledWith({ scope: 'openrouter-ai', key: 'apiKey' })
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })

  it('still fails closed when main cannot persist the record', async () => {
    ipc.fixture(keyedConfig(), { 'openrouter-ai': SECRET })
    useProviderConfigStore().ensureProvider('openrouter-ai', 'openrouter-ai', { baseUrl: BASE_URL })
    const store = useLiaProviderStore()
    store.registerChatTransport()
    // Main refuses every write: the recovery has nothing to fall back to, and
    // must NOT invent an endpoint or send unauthenticated.
    setTransportTestWriteFailure(getActivePinia()!, 'storage')

    await expect(useProviderStore().getChatProviderInstance('openrouter-ai', { reasoning: 'disabled' }))
      .rejects
      .toThrowError(/configuration/i)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })

  it('never resurrects a removed provider from the follower recovery', async () => {
    ipc.fixture(keyedConfig(), { 'openrouter-ai': SECRET })
    useProviderConfigStore().ensureProvider('openrouter-ai', 'openrouter-ai', { baseUrl: BASE_URL })
    const store = useLiaProviderStore()
    store.registerChatTransport()
    const client = createLiaTransportClient()
    await client.refresh()
    await client.remove('openrouter-ai')

    await expect(useProviderStore().getChatProviderInstance('openrouter-ai', { reasoning: 'disabled' }))
      .rejects
      .toThrowError(/configuration/i)
    expect(fetchMock).not.toHaveBeenCalled()
    const records = (await createLiaTransportClient().refresh()).records
    expect(records.some(record => record.providerId === 'openrouter-ai')).toBe(false)
  })

  it('keeps chatting after the leader goes away, because main owns the record', async () => {
    ipc.fixture(keyedConfig(), { 'openrouter-ai': SECRET })
    useProviderConfigStore().ensureProvider('openrouter-ai', 'openrouter-ai', { baseUrl: BASE_URL })
    const follower = useLiaProviderStore()
    follower.registerChatTransport()

    const send = async () => {
      const instance = await useProviderStore().getChatProviderInstance('openrouter-ai', { reasoning: 'disabled' })
      const response = await instance!.chat(MODEL).fetch!(new URL('https://ignored.invalid'), {
        method: 'POST',
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'fixture' }] }),
      })
      return response.text()
    }

    await send()
    // The leader window closing is a renderer lifecycle event: the main process
    // that stores the record is untouched, so the follower's next send still
    // resolves the endpoint and the credential in main.
    expect(await send()).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })
})
