import { PiniaColada } from '@pinia/colada'
import { resetChatProviderRuntimeExtensionsForTesting } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { createNativeProviderRuntime } from '../../services/lia/native-provider-runtime'

const ipc = vi.hoisted(() => ({
  chatConfig: vi.fn(async (): Promise<import('../../../shared/eventa').LiaProviderChatConfig> => ({})),
  encryptionAvailable: vi.fn(async () => true),
  saveChatConfig: vi.fn(async (_config: import('../../../shared/eventa').LiaProviderChatConfig) => {}),
  secretDelete: vi.fn(async () => true),
  secretGet: vi.fn(async (_payload: { scope: string, key: string }): Promise<string | undefined> => undefined),
  secretHas: vi.fn(async () => false),
  secretSet: vi.fn(async () => true),
}))

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
    const handlers: Record<string, unknown> = {
      'eventa:invoke:lia:provider:chat:config:get-receive': ipc.chatConfig,
      'eventa:invoke:lia:provider:chat:config:set-receive': ipc.saveChatConfig,
      'eventa:invoke:lia:secret:delete-receive': ipc.secretDelete,
      'eventa:invoke:lia:secret:encryption-available-receive': ipc.encryptionAvailable,
      'eventa:invoke:lia:secret:get-receive': ipc.secretGet,
      'eventa:invoke:lia:secret:has-receive': ipc.secretHas,
      'eventa:invoke:lia:secret:set-receive': ipc.secretSet,
    }
    const id = invoke?.receiveEvent?.id ?? ''
    if (id in handlers)
      return handlers[id]
    throw new Error(`Unexpected eventa invoke: ${id}`)
  },
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const { useLiaProviderStore } = await import('./provider')
const KEY = 'SYNTHETIC_SECRET_NEVER_OUTPUT'
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  const app = createApp({})
  const pinia = createPinia()
  app.use(pinia)
  app.use(PiniaColada)
  setActivePinia(pinia)
  ipc.secretGet.mockResolvedValue(undefined)
  fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/models')
    ? Response.json({ data: [{ id: 'custom/Local:Q4' }] })
    : Response.json({ choices: [{ message: { content: 'OK' } }] }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetChatProviderRuntimeExtensionsForTesting()
})

const localId = 'lm-studio'
const genericId = 'openai-compatible'
const address = 'https://local-service.invalid/v1/'
const model = 'custom/Local-model:Q4'
const wire = { model, messages: [{ role: 'user', content: 'synthetic migration test' }] }

function install(configs: Record<string, Record<string, unknown>>) {
  const lia = useLiaProviderStore()
  const source = useProviderStore()
  const config = useProviderConfigStore()
  for (const [id, value] of Object.entries(configs))
    config.ensureProvider(id, id, value)
  const legacy = vi.fn(source.getChatProviderInstance)
  source.getChatProviderInstance = legacy
  lia.registerRuntimeExtensions()
  return { lia, source, config, legacy }
}

describe('additional compatible transport migration', () => {
  it('owns the persisted local-compatible ID only with an explicit endpoint', async () => {
    const native = createNativeProviderRuntime({ readConfig: () => undefined, resolveCredential: async () => undefined })
    expect(native.owns(localId)).toBe(false)
    expect(native.owns(localId, { baseUrl: address })).toBe(true)
    expect(native.owns(localId, { baseUrl: '' })).toBe(false)
    expect(native.owns(localId, { baseUrl: '  ' })).toBe(false)
    expect(await native.getChatProvider(localId)).toBeUndefined()
    // The original migrated generic target never silently delegates an invalid draft.
    expect(native.owns(genericId)).toBe(true)
    await expect(native.getChatProvider(genericId)).rejects.toMatchObject({ code: 'configuration' })
    native.dispose()
  })

  it('executes a custom model through the native factory with no legacy instance', async () => {
    const { source, legacy, config } = install({ [localId]: { baseUrl: address } })
    const provider = await source.getChatProviderInstance(localId, { reasoning: 'disabled' })
    expect(provider).toBeDefined()
    expect(provider!.chat(model)).not.toHaveProperty('apiKey')
    const response = await provider!.chat(model).fetch!(new URL('https://ignored.invalid'), { method: 'POST', body: JSON.stringify(wire) })
    expect(await response.json()).toEqual({ choices: [{ message: { content: 'OK' } }] })
    expect(legacy).not.toHaveBeenCalled()
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${address}chat/completions`)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(wire)
    expect(new Headers(fetchMock.mock.calls[0][1].headers).has('authorization')).toBe(false)
    expect(JSON.stringify(config.$state)).not.toContain(KEY)
  })

  it('keeps an existing endpoint-less record on the unchanged legacy/default path', async () => {
    const { source, legacy } = install({ [localId]: {} })
    const prior = await legacy(localId, { reasoning: 'disabled' })
    legacy.mockClear()
    const selected = await source.getChatProviderInstance(localId, { reasoning: 'disabled' })
    expect(selected).toBe(prior)
    expect(legacy).toHaveBeenCalledExactlyOnceWith(localId, { reasoning: 'disabled' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses an explicit draft for discovery/probe even without a persisted endpoint', async () => {
    const { lia, source } = install({})
    const find = vi.spyOn(source, 'findProviderDefinition')
    const args = { providerId: localId, baseUrl: address, modelId: model, apiKey: KEY }
    expect(await lia.discoverModels(args)).toEqual({ status: 'ready', models: [{ id: 'custom/Local:Q4', label: 'custom/Local:Q4' }] })
    expect(await lia.testConnection(args)).toEqual({ ok: true, scope: 'text', message: '' })
    expect(find).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('authorization')).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe(model)
    expect(ipc.saveChatConfig).not.toHaveBeenCalled()
  })

  it('does not reuse another provider credential when switching to a keyless compatible target', async () => {
    const logs = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { source, legacy, config } = install({ [genericId]: { baseUrl: 'https://primary-service.invalid/v1/' }, [localId]: { baseUrl: address } })
    ipc.secretGet.mockImplementation(async ({ scope }) => scope === genericId ? KEY : undefined)
    for (const id of [genericId, localId]) {
      const provider = await source.getChatProviderInstance(id, { reasoning: 'disabled' })
      const response = await provider!.chat(model).fetch!(new URL('https://ignored.invalid'), { method: 'POST', body: JSON.stringify(wire) })
      await response.text()
    }
    expect(legacy).not.toHaveBeenCalled()
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('authorization')).toBe(`Bearer ${KEY}`)
    expect(new Headers(fetchMock.mock.calls[1][1].headers).has('authorization')).toBe(false)
    expect(ipc.secretGet.mock.calls.map(([payload]) => payload.scope)).toEqual([genericId, localId])
    expect(JSON.stringify(config.$state)).not.toContain(KEY)
    expect(JSON.stringify(logs.mock.calls)).not.toContain(KEY)
  })

  it('rejects an explicitly invalid endpoint without falling back to the legacy factory', async () => {
    const { source, legacy } = install({ [localId]: { baseUrl: 'invalid-address' } })
    await expect(source.getChatProviderInstance(localId, { reasoning: 'disabled' })).rejects.toMatchObject({ code: 'configuration' })
    expect(legacy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })
})
