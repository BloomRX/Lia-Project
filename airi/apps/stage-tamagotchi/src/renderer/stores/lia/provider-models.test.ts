import { PiniaColada } from '@pinia/colada'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { useI18n } from 'vue-i18n'

const ipc = vi.hoisted(() => ({
  chatConfig: vi.fn(async (): Promise<import('../../../shared/eventa').LiaProviderChatConfig> => ({})),
  encryptionAvailable: vi.fn(async () => true),
  saveChatConfig: vi.fn(async (_config: import('../../../shared/eventa').LiaProviderChatConfig) => {}),
  secretDelete: vi.fn(async () => true),
  secretGet: vi.fn(async (): Promise<string | undefined> => undefined),
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
const { createLiaDraftProviderRuntime } = await import('./provider-runtime')
const KEY = 'SYNTHETIC_SECRET_NEVER_OUTPUT'
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  const app = createApp({})
  const pinia = createPinia()
  app.use(pinia)
  app.use(PiniaColada)
  setActivePinia(pinia)
  ipc.secretGet.mockResolvedValue(KEY)
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'custom/Listed:Q4' }, { id: 'custom/Listed:Q4' }] }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function chatResponse(text = 'OK') {
  return new Response(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200 })
}

const target = { providerId: 'openai-compatible', modelId: 'custom/Meu-modelo:Q4' }
const draft = { ...target, baseUrl: 'https://service.invalid/v1/', apiKey: KEY }

describe('draft models through the real Lia ports and provider definition', () => {
  it('discovers and deduplicates IDs using the edited endpoint and transient credential without storing it', async () => {
    const result = await useLiaProviderStore().discoverModels(draft)
    expect(result).toEqual({ status: 'ready', models: [{ id: 'custom/Listed:Q4', label: 'custom/Listed:Q4' }] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://service.invalid/v1/models')
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${KEY}`)
    expect(JSON.stringify(useProviderConfigStore().$state)).not.toContain(KEY)
    expect(JSON.stringify(useProviderStore().$state)).not.toContain(KEY)
    expect(JSON.stringify(result)).not.toContain(KEY)
    expect(ipc.saveChatConfig).not.toHaveBeenCalled()
  })

  it('uses the vault key and saved endpoint when no draft replacement was supplied', async () => {
    useProviderConfigStore().ensureProvider(target.providerId, target.providerId, { baseUrl: draft.baseUrl })
    await useLiaProviderStore().discoverModels({ providerId: target.providerId })
    expect(ipc.secretGet).toHaveBeenCalled()
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://service.invalid/v1/models')
  })

  it('does not expose a discovery exception and leaves the manual model probe available', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockRejectedValueOnce(new Error(KEY))
    const store = useLiaProviderStore()
    expect(await store.discoverModels(draft)).toEqual({ status: 'error', models: [] })
    fetchMock.mockResolvedValueOnce(chatResponse())
    expect((await store.testConnection(draft)).ok).toBe(true)
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(KEY)
    expect(JSON.stringify(warnLog.mock.calls)).not.toContain(KEY)
  })

  it('handles an empty list without asserting the selected model is invalid', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
    expect(await useLiaProviderStore().discoverModels(draft)).toEqual({ status: 'ready', models: [] })
  })

  it('handles a definition with an empty built-in list and no chat without inventing support', async () => {
    const store = useLiaProviderStore()
    expect(await store.discoverModels({ providerId: 'speech-noop' })).toEqual({ status: 'ready', models: [] })
    expect(await store.testConnection({ providerId: 'speech-noop', modelId: 'manual' })).toMatchObject({ ok: false, failure: 'unsupported' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the exact selected custom model to chat without first requiring GET models', async () => {
    fetchMock.mockResolvedValueOnce(chatResponse())
    expect(await useLiaProviderStore().testConnection(draft)).toEqual({ ok: true, scope: 'text', message: '' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://service.invalid/v1/chat/completions')
    expect(JSON.parse(init.body).model).toBe(target.modelId)
    expect(JSON.parse(init.body)).not.toHaveProperty('max_tokens')
  })

  it('rejects an empty model before any request', async () => {
    expect(await useLiaProviderStore().testConnection({ ...draft, modelId: '  ' })).toMatchObject({ ok: false, failure: 'configuration' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['not a url', 'file:///private', 'https://user:password@service.invalid/v1/'])('rejects unsafe endpoint %s without a request', async (baseUrl) => {
    expect(await useLiaProviderStore().testConnection({ ...draft, baseUrl })).toMatchObject({ ok: false, failure: 'configuration' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not approve an empty successful response', async () => {
    fetchMock.mockResolvedValueOnce(chatResponse(''))
    expect(await useLiaProviderStore().testConnection(draft)).toMatchObject({ ok: false, failure: 'empty' })
  })

  it('keeps request rejection separate from invalid configuration without echoing the server body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: KEY, code: 'model_not_found' } }), { status: 404 }))
    const result = await useLiaProviderStore().testConnection(draft)
    expect(result).toMatchObject({ ok: false, failure: 'request' })
    expect(JSON.stringify(result)).not.toContain(KEY)
  })

  it('persists and reloads an existing or custom ID unchanged, then activates that exact ID', async () => {
    const store = useLiaProviderStore()
    await store.persistConfig({ preferred: target, fallbackEnabled: false })
    const saved = ipc.saveChatConfig.mock.calls[0][0]
    expect(structuredClone(saved)).toMatchObject({ preferred: target })
    ipc.chatConfig.mockResolvedValueOnce(saved)
    await store.refreshConfig()
    expect(store.loadedConfig?.preferred).toEqual(target)
    await store.activatePreferred()
    expect(useConsciousnessStore().activeModel).toBe(target.modelId)
    expect(useConsciousnessStore().activeProvider).toBe(target.providerId)
  })
  it('deduplicates simultaneous lookups of the same effective draft', async () => {
    let resolve!: (value: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => {
      resolve = done
    }))
    const store = useLiaProviderStore()
    const a = store.discoverModels(draft)
    const b = store.discoverModels(draft)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }))
    expect(await a).toEqual(await b)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports unsupported discovery and disposes a temporary instance without touching the shared cache', async () => {
    const dispose = vi.fn(async () => {})
    const definition = useProviderStore().getProviderDefinition('speech-noop')
    const runtime = createLiaDraftProviderRuntime({
      findProviderDefinition: () => ({
        ...definition,
        extraMethods: undefined,
        createProvider: () => ({ speech: () => ({ baseURL: 'https://service.invalid/', model: 'noop' }), dispose }),
      }),
    }, useI18n().t)
    expect(await runtime.discover('test-service', {})).toEqual({ status: 'unsupported', models: [] })
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('classifies transport failure separately from a rejected model request, without exposing details', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError(KEY))
    const result = await useLiaProviderStore().testConnection(draft)
    expect(result.ok).toBe(false)
    expect(result.failure).toBe('endpoint')
    expect(result.failure).not.toBe('configuration')
    expect(JSON.stringify(result)).not.toContain(KEY)
  })
})
