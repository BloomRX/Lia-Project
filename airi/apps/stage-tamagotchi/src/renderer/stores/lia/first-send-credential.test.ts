import type { LiaProviderChatConfig } from '../../../shared/eventa'

import { PiniaColada } from '@pinia/colada'
import { resetChatProviderRuntimeExtensionsForTesting } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { createSecretAdoptHandler } from '../../services/lia/secret-adopt.fixture'
import { createLiaTransportClient } from '../../services/lia/transport-config'
import { setTransportTestVaultResolver, setTransportTestWriteFailure } from '../../services/lia/transport-config.fixture'

/**
 * Corte B, Fase 1 — the credential never rides on an execution payload.
 *
 * What was wrong: `LiaTransportStartRequest.draft` accepted `apiKey`. It exists
 * for "test this provider before saving it", so the FIRST contact with a
 * provider that had no record carried the key in the very message that asked for
 * execution. Main discarded it afterwards, but by then the renderer had already
 * held it and put it on a request body that travels over IPC.
 *
 * What replaces it, and what these tests pin:
 *
 *  1. the credential goes up through `secrets:set` and nowhere else;
 *  2. main confirms the vault write (a `false` answer is fatal, not ignored);
 *  3. the transport record is persisted WITHOUT the credential;
 *  4. only then is the provider executed, and the execution payload has no field
 *     that could hold a secret;
 *  5. the renderer never receives the key back.
 */

const SECRET = 'SYNTHETIC_FIRST_SEND_SECRET'
const MODEL = 'openai/gpt-oss-120b'
const BASE_URL = 'https://first-send.invalid/v1/'

const ipc = vi.hoisted(() => {
  let chat: Record<string, unknown> = {}
  const vault = new Map<string, string>()
  const secretKey = (payload: { scope: string, key: string }) => `${payload.scope}\u0000${payload.key}`
  /** Every payload the execution channel was asked to send, verbatim. */
  const executions: unknown[] = []
  return {
    executions,
    fixture(next: Record<string, unknown> | LiaProviderChatConfig) {
      chat = next as Record<string, unknown>
      vault.clear()
    },
    getChatConfig: vi.fn(async (): Promise<unknown> => structuredClone(chat)),
    saveChatConfig: vi.fn(async (config: unknown) => {
      chat = structuredClone(config) as Record<string, unknown>
    }),
    encryptionAvailable: vi.fn(async () => true),
    secretHas: vi.fn(async (payload: { scope: string, key: string }) => vault.has(secretKey(payload))),
    /** The credential channel. Records what arrived and answers like the vault. */
    secretSet: vi.fn(async (payload: { scope: string, key: string, value: string }) => {
      vault.set(secretKey(payload), payload.value)
      return true
    }),
    secretGet: vi.fn(async (payload: { scope: string, key: string }): Promise<string | undefined> => vault.get(secretKey(payload))),
    secretDelete: vi.fn(async (payload: { scope: string, key: string }) => vault.delete(secretKey(payload))),
    /** Main reading its own vault: distinct from the renderer-facing getter. */
    vaultRead: vi.fn(async (payload: { scope: string, key: string }): Promise<string | undefined> => vault.get(secretKey(payload))),
  }
})

vi.mock('@proj-airi/electron-vueuse', async () => {
  const { transportTestInvoke } = await import('../../services/lia/transport-config.fixture')
  return {
    useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
      const id = invoke?.receiveEvent?.id ?? ''
      if (id.startsWith('eventa:invoke:lia:transport:')) {
        // Wrapping the fake execution service is the only way to observe the
        // payload as it crosses: the assertion below is about that object.
        const inner = transportTestInvoke(id)!
        return async (payload: unknown) => {
          if (id === 'eventa:invoke:lia:transport:start-receive')
            ipc.executions.push(structuredClone(payload))
          return inner(payload as never)
        }
      }
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

function keyedConfig(): LiaProviderChatConfig {
  return {
    onboarded: true,
    strategy: 'manual',
    preferred: { providerId: 'openrouter-ai', modelId: MODEL },
    fallback: [],
    fallbackEnabled: true,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

/** Reads the records the way the application does, through the same client. */
function snapshot() {
  return createLiaTransportClient().refresh()
}

beforeEach(() => {
  const pinia = createPinia()
  const app = createApp({})
  app.use(pinia)
  app.use(PiniaColada)
  setActivePinia(pinia)
  setTransportTestVaultResolver(pinia, ipc.vaultRead)
  resetChatProviderRuntimeExtensionsForTesting()
  ipc.fixture({})
  ipc.executions.length = 0
  vi.clearAllMocks()
  fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/models')
    ? Response.json({ data: [{ id: MODEL }] })
    : Response.json({ choices: [{ message: { role: 'assistant', content: 'OK' } }] }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  setTransportTestWriteFailure(getActivePinia()!, undefined)
  resetChatProviderRuntimeExtensionsForTesting()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('first send of a provider that has no record yet', () => {
  it('stores the key, persists the endpoint, and only then executes — with no credential on the payload', async () => {
    ipc.fixture(keyedConfig())
    const store = useLiaProviderStore()

    // Exactly what the settings screen does when the user types a key and
    // presses "test": nothing is saved yet, and the provider has no record.
    const result = await store.testConnection({ providerId: 'openrouter-ai', modelId: MODEL, apiKey: SECRET, baseUrl: BASE_URL })
    expect(result.ok).toBe(true)

    // 1. The credential went up the credential channel...
    expect(ipc.secretSet).toHaveBeenCalledWith({ scope: 'openrouter-ai', key: 'apiKey', value: SECRET })
    // 2. ...the record was persisted...
    const records = (await snapshot()).records
    expect(records.find(record => record.providerId === 'openrouter-ai')?.baseUrl).toBe(BASE_URL)
    expect(JSON.stringify(records)).not.toContain(SECRET)
    // 3. ...and the execution payload carried neither.
    expect(ipc.executions).toHaveLength(1)
    expect(JSON.stringify(ipc.executions)).not.toContain(SECRET)
    const [execution] = ipc.executions as Array<Record<string, unknown>>
    expect(execution.draft).toEqual({ baseUrl: BASE_URL })
    expect(JSON.stringify(execution)).not.toMatch(/apiKey/)
    // 4. Main read its own vault to sign the request; the renderer never did.
    expect(ipc.vaultRead).toHaveBeenCalledWith({ scope: 'openrouter-ai', key: 'apiKey' })
    expect(ipc.secretGet).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never sends the credential to the renderer on the way back', async () => {
    ipc.fixture(keyedConfig())
    const store = useLiaProviderStore()
    const result = await store.testConnection({ providerId: 'groq', modelId: MODEL, apiKey: SECRET, baseUrl: BASE_URL })
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(JSON.stringify(ipc.executions)).not.toContain(SECRET)
    expect(JSON.stringify(useProviderConfigStore().$state)).not.toContain(SECRET)
    expect(JSON.stringify(useProviderStore().$state)).not.toContain(SECRET)
  })

  it('stops before executing when the vault refuses the write', async () => {
    ipc.fixture(keyedConfig())
    ipc.secretSet.mockResolvedValueOnce(false)
    const store = useLiaProviderStore()
    const result = await store.testConnection({ providerId: 'groq', modelId: MODEL, apiKey: SECRET, baseUrl: BASE_URL })
    expect(result).toMatchObject({ ok: false, failure: 'configuration' })
    // The endpoint record is not created either: a provider whose key did not
    // store must not look configured.
    expect(ipc.executions).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await snapshot()).records).toHaveLength(0)
  })

  it('stops before executing when the endpoint cannot be persisted', async () => {
    ipc.fixture(keyedConfig())
    setTransportTestWriteFailure(getActivePinia()!, 'storage')
    const store = useLiaProviderStore()
    const result = await store.testConnection({ providerId: 'groq', modelId: MODEL, apiKey: SECRET, baseUrl: BASE_URL })
    expect(result).toMatchObject({ ok: false, failure: 'configuration' })
    expect(ipc.executions).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is repeatable: a second attempt stores the same key once more and creates no duplicate record', async () => {
    ipc.fixture(keyedConfig())
    const store = useLiaProviderStore()
    expect((await store.testConnection({ providerId: 'groq', modelId: MODEL, apiKey: SECRET, baseUrl: BASE_URL })).ok).toBe(true)
    expect((await store.testConnection({ providerId: 'groq', modelId: MODEL, apiKey: SECRET, baseUrl: BASE_URL })).ok).toBe(true)
    expect(ipc.secretSet).toHaveBeenCalledTimes(2)
    expect(ipc.secretSet.mock.calls[0]).toEqual(ipc.secretSet.mock.calls[1])
    expect((await snapshot()).records.filter(record => record.providerId === 'groq')).toHaveLength(1)
    expect(ipc.executions.every((payload: unknown) => !JSON.stringify(payload).includes(SECRET))).toBe(true)
  })

  it('converges when two configurations of the same provider race, instead of losing one to a stale revision', async () => {
    ipc.fixture(keyedConfig())
    const store = useLiaProviderStore()
    const [first, second] = await Promise.all([
      store.testConnection({ providerId: 'groq', modelId: MODEL, apiKey: SECRET, baseUrl: BASE_URL }),
      store.testConnection({ providerId: 'groq', modelId: MODEL, apiKey: SECRET, baseUrl: BASE_URL }),
    ])
    // Both are authorized by the same persisted endpoint; neither fails because
    // the other wrote first, and exactly one record exists.
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    const records = (await snapshot()).records
    expect(records.filter(record => record.providerId === 'groq')).toHaveLength(1)
    expect(records[0].baseUrl).toBe(BASE_URL)
    expect(JSON.stringify(records)).not.toContain(SECRET)
  })

  it('keeps two different providers concurrent and isolated', async () => {
    ipc.fixture(keyedConfig())
    const store = useLiaProviderStore()
    const other = 'SYNTHETIC_OTHER_SECRET'
    await Promise.all([
      store.testConnection({ providerId: 'groq', modelId: MODEL, apiKey: SECRET, baseUrl: BASE_URL }),
      store.testConnection({ providerId: 'cerebras-ai', modelId: MODEL, apiKey: other, baseUrl: 'https://cerebras.invalid/v1/' }),
    ])
    const calls = ipc.vaultRead.mock.calls.map(([payload]: [{ scope: string }]) => payload.scope)
    expect(new Set(calls)).toEqual(new Set(['groq', 'cerebras-ai']))
    const records = (await snapshot()).records
    expect(records.map(record => record.baseUrl).sort()).toEqual([BASE_URL, 'https://cerebras.invalid/v1/'].sort())
    expect(JSON.stringify(records)).not.toContain(SECRET)
    expect(JSON.stringify(records)).not.toContain(other)
  })
})

describe('the execution payload has no field that can hold a secret', () => {
  it('uses a stored key without any credential on the payload', async () => {
    ipc.fixture(keyedConfig())
    const store = useLiaProviderStore()
    // The transport bridge is what makes this renderer forward instead of
    // building an SDK client of its own.
    store.registerChatTransport()
    await store.ensureProviderRecord('openrouter-ai', BASE_URL)
    await store.setApiKey('openrouter-ai', SECRET)
    ipc.executions.length = 0

    const instance = await useProviderStore().getChatProviderInstance('openrouter-ai', { reasoning: 'disabled' })
    const response = await instance!.chat(MODEL).fetch!(new URL('https://ignored.invalid'), {
      method: 'POST',
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'fixture' }] }),
    })
    await response.text()

    expect(ipc.executions).toHaveLength(1)
    const [execution] = ipc.executions as Array<Record<string, unknown>>
    // No draft at all: everything the request needs is persisted.
    expect(execution.draft).toBeUndefined()
    expect(Object.keys(execution).sort()).toEqual(['body', 'expectedBaseUrl', 'operation', 'providerId'])
    expect(JSON.stringify(execution)).not.toContain(SECRET)
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })

  it('a discovery request carries an endpoint and never a key', async () => {
    ipc.fixture(keyedConfig())
    const store = useLiaProviderStore()
    store.registerChatTransport()
    await store.discoverModels({ providerId: 'openrouter-ai', baseUrl: BASE_URL })
    const [execution] = ipc.executions as Array<Record<string, unknown>>
    expect(execution.operation).toBe('models')
    expect(JSON.stringify(execution)).not.toMatch(/apiKey/)
  })
})
