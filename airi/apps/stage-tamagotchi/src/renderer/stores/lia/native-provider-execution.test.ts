import { PiniaColada } from '@pinia/colada'
import { useLLM } from '@proj-airi/stage-ui/stores/ai/chat-llm/llm'
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
  secretGet: vi.fn(async (): Promise<string | undefined> => undefined),
  secretHas: vi.fn(async () => false),
  secretSet: vi.fn(async () => true),
}))

vi.mock('@proj-airi/electron-vueuse', async () => {
  const { transportTestInvoke } = await import('../../services/lia/transport-config.fixture')
  return ({
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
      const transport = transportTestInvoke(id)
      if (transport)
        return transport
      if (id in handlers)
        return handlers[id]
      throw new Error(`Unexpected eventa invoke: ${id}`)
    },
  })
})

// Only host tool discovery is isolated; merge, execution, SDK and transport run for real.
vi.mock('@proj-airi/stage-ui/stores/ai/chat-llm/tool-resolver', async (original) => {
  const actual = await original<typeof import('@proj-airi/stage-ui/stores/ai/chat-llm/tool-resolver')>()
  return { ...actual, resolveLlmTools: (options: Parameters<typeof actual.resolveLlmTools>[0]) => actual.resolveLlmTools({
    ...options,
    builtInTools: [],
    debugTools: [],
    sparkCommandTools: [],
    webSearchTools: [],
  }) }
})

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
  ipc.secretGet.mockResolvedValue(KEY)
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'custom/Listed:Q4' }, { id: 'custom/Listed:Q4' }] }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetChatProviderRuntimeExtensionsForTesting()
})

const target = { providerId: 'openai-compatible', modelId: 'custom/Native:Q4' }
const address = 'https://service.invalid/v1/'

function sse(parts: string[]) {
  const frames = parts.map(content => `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`).join('')
  return new Response(`${frames}data: ${JSON.stringify({ id: 'test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
}

function install() {
  const lia = useLiaProviderStore()
  const source = useProviderStore()
  useProviderConfigStore().ensureProvider(target.providerId, target.providerId, { baseUrl: address })
  const legacy = vi.fn(source.getChatProviderInstance)
  source.getChatProviderInstance = legacy
  lia.registerRuntimeExtensions()
  lia.registerRuntimeExtensions()
  return { lia, source, legacy }
}

describe('native provider production bridge', () => {
  it('executes the existing Core/xsAI stream through Lia HTTP without creating a legacy instance or exposing the vault key to SDK options', async () => {
    const { source, legacy } = install()
    fetchMock.mockResolvedValueOnce(sse(['Lia', ' ', 'nativa', '\n', '42']))
    const provider = await source.getChatProviderInstance(target.providerId, { reasoning: 'disabled' })
    expect(provider).toBeDefined()
    expect(provider!.chat(target.modelId)).not.toHaveProperty('apiKey')
    const parts: string[] = []
    await useLLM().stream(target.modelId, provider!, [{ role: 'user', content: 'synthetic prompt' }], {
      supportsTools: false,
      onStreamEvent: (event) => {
        if (event.type === 'text-delta')
          parts.push(event.text)
      },
    })
    expect(parts.join('')).toBe('Lia nativa\n42')
    expect(legacy).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${address}chat/completions`)
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(init.body).model).toBe(target.modelId)
    expect(ipc.secretGet).toHaveBeenCalled()
    expect(JSON.stringify(useProviderConfigStore().$state)).not.toContain(KEY)
  })

  it('uses own discovery and selected-model probes without consulting the shared definition factory', async () => {
    const { lia, source } = install()
    const find = vi.spyOn(source, 'findProviderDefinition')
    expect((await lia.discoverModels({ providerId: target.providerId })).status).toBe('ready')
    fetchMock.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'OK' } }] }))
    expect((await lia.testConnection(target)).ok).toBe(true)
    expect(find).not.toHaveBeenCalled()
  })

  it('preserves multimodal content, tool definitions and unknown wire options through the transport bridge', async () => {
    const { source } = install()
    const provider = await source.getChatProviderInstance(target.providerId, { reasoning: 'disabled' })
    const request = {
      model: target.modelId,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'image' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,c3ludGhldGlj' } }] }],
      stream: true,
      tools: [{ type: 'function', function: { name: 'safe_test', parameters: { type: 'object' } } }],
      tool_choice: 'auto',
      reasoning_effort: 'none',
    }
    fetchMock.mockResolvedValueOnce(sse(['OK']))
    const response = await provider!.chat(target.modelId).fetch!(new URL('https://ignored.invalid/'), { method: 'POST', body: JSON.stringify(request) })
    await response.text()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(request)
  })

  it('retains the old executor for providers outside the migrated slice', async () => {
    const { source, legacy } = install()
    legacy.mockResolvedValueOnce({ chat: (model: string) => ({ model, baseURL: address }) })
    const provider = await source.getChatProviderInstance('unmigrated-service', { reasoning: 'disabled' })
    expect(provider).toBeDefined()
    expect(legacy).toHaveBeenCalledExactlyOnceWith('unmigrated-service', { reasoning: 'disabled' })
  })
  it('keeps the real SDK tool round-trip and resolves credentials separately for each HTTP request', async () => {
    const { source, legacy } = install()
    const first = [
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-safe', type: 'function', function: { name: 'safe_fixture', arguments: '{}' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ].map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('')
    fetchMock.mockResolvedValueOnce(new Response(`${first}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }))
      .mockResolvedValueOnce(sse(['Concluído']))
    const execute = vi.fn(async () => {
      ipc.secretGet.mockResolvedValueOnce('ROTATED_SYNTHETIC_SECRET')
      return 'fixture-ok'
    })
    const provider = await source.getChatProviderInstance(target.providerId, { reasoning: 'disabled' })
    const parts: string[] = []
    await useLLM().stream(target.modelId, provider!, [{ role: 'user', content: 'synthetic tool test' }], {
      tools: [{ type: 'function', function: { name: 'safe_fixture', description: 'Harmless deterministic fixture', parameters: { type: 'object', properties: {} } }, execute }],
      onStreamEvent: (event) => {
        if (event.type === 'text-delta')
          parts.push(event.text)
      },
    })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(parts.join('')).toBe('Concluído')
    const second = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(second.model).toBe(target.modelId)
    expect(second.messages).toContainEqual(expect.objectContaining({ role: 'tool', content: 'fixture-ok', tool_call_id: 'call-safe' }))
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('authorization')).toBe('Bearer ROTATED_SYNTHETIC_SECRET')
    expect(legacy).not.toHaveBeenCalled()
  })

  it('rejects a stale tool-round factory after an endpoint change without sending a fresh credential to the old address', async () => {
    const config = { baseUrl: address }
    const resolveCredential = vi.fn(async () => KEY)
    const native = createNativeProviderRuntime({ readConfig: () => config, resolveCredential })
    const previous = await native.getChatProvider(target.providerId)
    config.baseUrl = 'https://changed.invalid/v1/'
    const current = await native.getChatProvider(target.providerId)
    const init = { method: 'POST', body: JSON.stringify({ model: target.modelId, messages: [{ role: 'user', content: 'synthetic' }], stream: true }) }
    await expect(previous!.chat(target.modelId).fetch(new URL('https://ignored.invalid'), init)).rejects.toMatchObject({ code: 'cancelled' })
    expect(resolveCredential).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(sse(['OK']))
    const response = await current!.chat(target.modelId).fetch(new URL('https://ignored.invalid'), init)
    await response.text()
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://changed.invalid/v1/chat/completions')
    native.dispose()
  })
})
