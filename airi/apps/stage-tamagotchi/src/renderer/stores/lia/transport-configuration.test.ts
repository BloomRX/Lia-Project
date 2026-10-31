import type { LiaProviderChatConfig } from '../../../shared/eventa'

import { PiniaColada } from '@pinia/colada'
import { resetChatProviderRuntimeExtensionsForTesting } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { createLiaTransportClient, legacyTransportCandidates } from '../../services/lia/transport-config'

const ipc = vi.hoisted(() => ({
  chat: vi.fn(async (): Promise<LiaProviderChatConfig> => ({})),
  save: vi.fn(async () => {}),
  available: vi.fn(async () => true),
  has: vi.fn(async () => false),
  get: vi.fn(async (_value: { scope: string, key: string }): Promise<string | undefined> => undefined),
  set: vi.fn(async () => true),
  delete: vi.fn(async () => true),
}))

vi.mock('@proj-airi/electron-vueuse', async () => {
  const { transportTestInvoke } = await import('../../services/lia/transport-config.fixture')
  return {
    useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
      const id = invoke.receiveEvent?.id ?? ''
      const transport = transportTestInvoke(id)
      if (transport)
        return transport
      const handlers: Record<string, unknown> = {
        'eventa:invoke:lia:provider:chat:config:get-receive': ipc.chat,
        'eventa:invoke:lia:provider:chat:config:set-receive': ipc.save,
        'eventa:invoke:lia:secret:encryption-available-receive': ipc.available,
        'eventa:invoke:lia:secret:has-receive': ipc.has,
        'eventa:invoke:lia:secret:get-receive': ipc.get,
        'eventa:invoke:lia:secret:set-receive': ipc.set,
        'eventa:invoke:lia:secret:delete-receive': ipc.delete,
      }
      if (id in handlers)
        return handlers[id]
      throw new Error(`Unexpected invoke: ${id}`)
    },
  }
})
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const { useLiaProviderStore } = await import('./provider')
const baseUrl = 'https://transport-fixture.invalid/custom/v1/'
const key = 'SYNTHETIC_TRANSPORT_SECRET'
const model = 'personal/model:Q4'
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (id: string) => storage.get(id) ?? null,
    setItem: (id: string, value: string) => storage.set(id, value),
    removeItem: (id: string) => storage.delete(id),
  })
  const pinia = createPinia()
  const app = createApp({})
  app.use(pinia)
  app.use(PiniaColada)
  setActivePinia(pinia)
  ipc.chat.mockResolvedValue({ preferred: { providerId: 'openai-compatible', modelId: model } })
  ipc.available.mockResolvedValue(true)
  ipc.has.mockResolvedValue(false)
  ipc.set.mockResolvedValue(true)
  ipc.get.mockResolvedValue(undefined)
  fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: 'OK' } }] }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  resetChatProviderRuntimeExtensionsForTesting()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function snapshot() {
  return createLiaTransportClient().refresh()
}

describe('lia-owned transport configuration integration', () => {
  it('writes a native endpoint without editing the legacy config or issuing PATCH', async () => {
    const shared = useProviderConfigStore()
    shared.ensureProvider('openai-compatible', 'openai-compatible', { baseUrl })
    const update = vi.spyOn(shared, 'updateProviderConfig')
    const lia = useLiaProviderStore()
    await lia.refreshConfig()
    await lia.ensureProviderRecord('openai-compatible', 'https://edited-fixture.invalid/v1/')
    expect((await snapshot()).records[0].baseUrl).toBe('https://edited-fixture.invalid/v1/')
    expect(lia.providerBaseUrl('openai-compatible')).toBe('https://edited-fixture.invalid/v1/')
    expect(shared.getProviderConfig('openai-compatible')?.baseUrl).toBe(baseUrl)
    expect(update).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('decodes both historical shapes and prefers configured entries for a repeated ID', () => {
    const records = legacyTransportCandidates({
      'custom-service': { id: 'custom-service', definitionId: 'openai-compatible', config: { baseUrl, temperature: 0.6 } },
      'lm-studio': { id: 'lm-studio', definitionId: 'lm-studio', config: { baseUrl } },
      'untouched': { id: 'untouched', definitionId: 'unsupported-protocol', config: { baseUrl } },
    }, {
      'openai-compatible': { baseUrl, apiKey: key },
      'lm-studio': { baseUrl: 'https://obsolete-fixture.invalid/v1/' },
    })
    expect(records.map(record => record.id).sort()).toEqual(['custom-service', 'lm-studio', 'openai-compatible'])
    expect(records.find(record => record.id === 'lm-studio')?.config.baseUrl).toBe(baseUrl)
    expect(records.find(record => record.id === 'custom-service')?.definitionId).toBe('openai-compatible')
  })

  it('migrates custom IDs, model associations and adapter options without persisting a legacy secret', async () => {
    localStorage.setItem('settings/providers/configured', JSON.stringify({
      'personal-service': { id: 'personal-service', definitionId: 'openai-compatible', config: { baseUrl, apiKey: key, temperature: 0.6, nested: { mode: 'precise' } } },
    }))
    ipc.chat.mockResolvedValue({ preferred: { providerId: 'personal-service', modelId: model } })
    const lia = useLiaProviderStore()
    await lia.refreshConfig()
    const stored = (await snapshot()).records.find(record => record.id === 'personal-service')!
    expect(stored).toMatchObject({
      id: 'personal-service',
      providerId: 'personal-service',
      definitionId: 'openai-compatible',
      baseUrl,
      modelIds: [model],
      credentialRef: { scope: 'personal-service', key: 'apiKey' },
      adapterOptions: { temperature: 0.6, nested: { mode: 'precise' } },
    })
    expect(JSON.stringify(stored)).not.toContain(key)
    expect(stored.adapterOptions).not.toHaveProperty('apiKey')
    expect(ipc.set).toHaveBeenCalledExactlyOnceWith({ scope: 'personal-service', key: 'apiKey', value: key })
    expect(ipc.delete).not.toHaveBeenCalled()
  })

  it('imports the original credentials-map format without overwriting an existing vault entry', async () => {
    localStorage.setItem('settings/credentials/providers', JSON.stringify({ 'openai-compatible': { baseUrl, apiKey: key, seed: 7 } }))
    ipc.has.mockResolvedValue(true)
    await useLiaProviderStore().refreshConfig()
    const stored = (await snapshot()).records.find(record => record.providerId === 'openai-compatible')!
    expect(stored).toMatchObject({ baseUrl, modelIds: [model], adapterOptions: { seed: 7 } })
    expect(JSON.stringify(stored)).not.toContain(key)
    expect(ipc.has).toHaveBeenCalledWith({ scope: 'openai-compatible', key: 'apiKey' })
    expect(ipc.set).not.toHaveBeenCalled()
    expect(ipc.delete).not.toHaveBeenCalled()
  })

  it('keeps an own edit authoritative across repeated imports and a fresh client cache', async () => {
    const shared = useProviderConfigStore()
    shared.ensureProvider('openai-compatible', 'openai-compatible', { baseUrl })
    const lia = useLiaProviderStore()
    await lia.refreshConfig()
    const old = (await snapshot()).records[0]
    const client = createLiaTransportClient()
    await client.refresh()
    await client.put({ ...old, baseUrl: 'https://current-fixture.invalid/v1/' })
    shared.getProviderConfig('openai-compatible')!.baseUrl = 'https://legacy-edited-fixture.invalid/v1/'
    await lia.refreshConfig()
    await client.migrate([old])
    const restored = await createLiaTransportClient().refresh()
    expect(restored.records).toHaveLength(1)
    expect(restored.records[0].baseUrl).toBe('https://current-fixture.invalid/v1/')
    expect(lia.providerBaseUrl('openai-compatible')).toBe('https://current-fixture.invalid/v1/')
  })

  it('keeps removed transports tombstoned and retains the vault credential explicitly', async () => {
    useProviderConfigStore().ensureProvider('openai-compatible', 'openai-compatible', { baseUrl })
    const lia = useLiaProviderStore()
    await lia.refreshConfig()
    const old = (await snapshot()).records[0]
    await lia.removeTransport('openai-compatible')
    await lia.refreshConfig()
    const client = createLiaTransportClient()
    await client.refresh()
    await client.migrate([old])
    const removed = await snapshot()
    expect(removed.records).toEqual([])
    expect(removed.tombstones).toContain('openai-compatible')
    expect(lia.providerBaseUrl('openai-compatible')).toBeUndefined()
    expect(ipc.delete).not.toHaveBeenCalled()
  })

  it('executes a migrated custom provider ID through the own endpoint and credential scope', async () => {
    localStorage.setItem('settings/providers/configured', JSON.stringify({
      'personal-service': { id: 'personal-service', definitionId: 'openai-compatible', config: { baseUrl } },
    }))
    ipc.chat.mockResolvedValue({ preferred: { providerId: 'personal-service', modelId: model } })
    ipc.get.mockResolvedValue(key)
    const lia = useLiaProviderStore()
    await lia.refreshConfig()
    const source = useProviderStore()
    const legacy = vi.fn(source.getChatProviderInstance)
    source.getChatProviderInstance = legacy
    lia.registerRuntimeExtensions()
    const provider = await source.getChatProviderInstance('personal-service', { reasoning: 'disabled' })
    expect(provider).toBeDefined()
    const response = await provider!.chat(model).fetch!('https://ignored-fixture.invalid', {
      method: 'POST',
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'fixture' }] }),
    })
    expect(await response.json()).toEqual({ choices: [{ message: { content: 'OK' } }] })
    expect(legacy).not.toHaveBeenCalled()
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${baseUrl}chat/completions`)
    expect(ipc.get).toHaveBeenCalledExactlyOnceWith({ scope: 'personal-service', key: 'apiKey' })
    expect(JSON.stringify((await snapshot()).records)).not.toContain(key)
  })

  it('can resume an interrupted credential import in a fresh store without dropping the legacy record', async () => {
    const original = JSON.stringify({ 'openai-compatible': { baseUrl, apiKey: key } })
    localStorage.setItem('settings/credentials/providers', original)
    ipc.set.mockResolvedValue(false)
    const first = useLiaProviderStore()
    await first.refreshConfig()
    expect((await snapshot()).records).toEqual([])
    expect(localStorage.getItem('settings/credentials/providers')).toBe(original)
    first.$dispose()
    ipc.set.mockResolvedValue(true)
    const reopened = useLiaProviderStore()
    await reopened.refreshConfig()
    expect((await snapshot()).records).toHaveLength(1)
    expect((await snapshot()).records[0].baseUrl).toBe(baseUrl)
    expect(ipc.delete).not.toHaveBeenCalled()
  })

  it('keeps multiple same-protocol records isolated and rejects a disabled transport before reading its key', async () => {
    localStorage.setItem('settings/providers/configured', JSON.stringify({
      'first-service': { id: 'first-service', definitionId: 'openai-compatible', config: { baseUrl } },
      'second-service': { id: 'second-service', definitionId: 'openai-compatible', config: { baseUrl: 'https://second-fixture.invalid/v1/' } },
    }))
    const lia = useLiaProviderStore()
    await lia.refreshConfig()
    const client = createLiaTransportClient()
    await client.refresh()
    const first = client.get('first-service')!
    await client.put({ ...first, enabled: false })
    const source = useProviderStore()
    lia.registerRuntimeExtensions()
    await expect(source.getChatProviderInstance('first-service', { reasoning: 'disabled' })).rejects.toThrow()
    expect(ipc.get).not.toHaveBeenCalled()
    const second = await source.getChatProviderInstance('second-service', { reasoning: 'disabled' })
    const response = await second!.chat(model).fetch!('https://ignored-fixture.invalid', {
      method: 'POST',
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'fixture' }] }),
    })
    await response.text()
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://second-fixture.invalid/v1/chat/completions')
    expect(ipc.get).toHaveBeenCalledExactlyOnceWith({ scope: 'second-service', key: 'apiKey' })
    expect((await snapshot()).records).toHaveLength(2)
  })
})
