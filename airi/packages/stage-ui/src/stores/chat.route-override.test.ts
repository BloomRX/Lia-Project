import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { Message, Tool } from '@xsai/shared-chat'

import type { ChatSendPayload } from './chat'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useChatStore } from './chat'
import {
  registerChatFallbackResolver,
  resetChatProviderRuntimeExtensionsForTesting,
} from './chat/chat-provider-runtime'
import { useConsciousnessSettingsStore } from './modules/consciousness-settings'

vi.hoisted(() => {
  ;(globalThis as any).window = {
    location: { origin: 'http://localhost' },
  }
})

const llmStreamMock = vi.fn()
const trackFirstMessageMock = vi.fn()
const chatAnalyticsMocks = vi.hoisted(() => ({
  trackAiGeneration: vi.fn(),
  trackMessageRound: vi.fn(),
  trackMessageRoundFailed: vi.fn(),
  trackMessageSent: vi.fn(),
}))
const ingestContextMessageMock = vi.fn()
const getContextsSnapshotMock = vi.fn()
const createMinecraftContextMock = vi.fn()
const persistSessionMessagesMock = vi.fn()
const forkSessionMock = vi.fn()
const ensureSessionMock = vi.fn()
const loadSessionMock = vi.fn()
const deleteSessionMock = vi.fn()
const initializeSessionMock = vi.fn()
const disposeSessionMock = vi.fn()
const ensureCurrentSessionMock = vi.fn()
const getChatProviderInstanceMock = vi.fn()
const getToolsByNamesMock = vi.fn<(names: string[]) => Tool[]>()

const activeSessionIdRef = ref('session-1')
const activeProviderRef = ref('mock-provider')
const activeModelRef = ref('gpt-test')
const streamingMessageRef = ref<any>({ role: 'assistant', content: '', slices: [], tool_results: [] })
const sessionMessages: Record<string, any[]> = {}
let currentGeneration = 1

vi.mock('pinia', async () => {
  const actual = await vi.importActual<typeof import('pinia')>('pinia')
  return { ...actual, storeToRefs: (store: any) => store }
})
vi.mock('../composables', () => ({ getConversationAnalyticsSurface: () => 'web' }))
vi.mock('../libs/analytics', () => ({
  getAnalytics: () => ({
    emit: (event: { name: string }, properties: unknown) => {
      switch (event.name) {
        case '$ai_generation':
          chatAnalyticsMocks.trackAiGeneration(properties)
          break
        case 'message_round':
          chatAnalyticsMocks.trackMessageRound(properties)
          break
        case 'message_round_failed':
          chatAnalyticsMocks.trackMessageRoundFailed(properties)
          break
        case 'message_sent':
          chatAnalyticsMocks.trackMessageSent(properties)
          break
        default:
          return false
      }
      return true
    },
    recordFirstMessage: trackFirstMessageMock,
  }),
}))
vi.mock('../composables/use-io-tracer', () => ({
  activeTurnSpan: { value: undefined },
  startSpan: vi.fn(() => ({ name: 'span', addEvent: vi.fn(), end: vi.fn(), setAttribute: vi.fn() })),
}))
vi.mock('./chat/context-providers', () => ({
  createLiaCapabilitiesContext: () => null,
  createMinecraftContext: () => createMinecraftContextMock(),
}))
vi.mock('./chat/context-store', () => ({
  useChatContextStore: () => ({
    ingestContextMessage: ingestContextMessageMock,
    getContextsSnapshot: getContextsSnapshotMock,
  }),
}))
vi.mock('./chat/session-store', () => ({
  useChatSessionStore: () => ({
    activeSessionId: activeSessionIdRef,
    sessionMessages,
    ensureSession: (sessionId: string) => {
      ensureSessionMock(sessionId)
      sessionMessages[sessionId] ??= [{ role: 'system', content: 'system prompt', createdAt: 1, id: 'system' }]
    },
    appendSessionMessage: (sessionId: string, message: any) => {
      sessionMessages[sessionId] ??= []
      sessionMessages[sessionId].push(message)
    },
    cleanupMessages: (sessionId: string) => { sessionMessages[sessionId] = [] },
    getSessionMessages: (sessionId: string) => sessionMessages[sessionId] ?? [],
    getSessionMessagesIfLoaded: (sessionId: string) => sessionMessages[sessionId],
    loadSession: loadSessionMock,
    deleteSession: deleteSessionMock,
    initialize: initializeSessionMock,
    dispose: disposeSessionMock,
    ensureCurrentSession: ensureCurrentSessionMock,
    persistSessionMessages: persistSessionMessagesMock,
    getSessionGeneration: () => currentGeneration,
    setSessionMessages: (sessionId: string, messages: any[]) => { sessionMessages[sessionId] = messages },
    forkSession: forkSessionMock,
    pushMessageToCloud: vi.fn().mockResolvedValue(undefined),
  }),
}))
vi.mock('./chat/stream-store', () => ({
  useChatStreamStore: () => ({ streamingMessage: streamingMessageRef }),
}))
vi.mock('./ai/chat-llm/llm', () => ({ useLLM: () => ({ stream: llmStreamMock }) }))
vi.mock('./ai/chat-llm/tools', () => ({
  useLlmToolsStore: () => ({ getToolsByNames: (...names: string[]) => getToolsByNamesMock(names) }),
}))
vi.mock('./ai/chat-llm/toolset-prompts', () => ({
  useLlmToolsetPromptsStore: () => ({ activeToolsetPrompt: 'Plugin toolset guidance.' }),
}))
vi.mock('./modules/consciousness', () => ({
  useConsciousnessStore: () => {
    const store: any = {
      getChatProviderInstance: (providerId: string) => getChatProviderInstanceMock(providerId, { reasoning: useConsciousnessSettingsStore().reasoning ? 'enabled' : 'disabled' }),
    }
    Object.defineProperty(store, 'activeProvider', {
      get() { return activeProviderRef.value },
      set(v: string) { activeProviderRef.value = v },
      enumerable: true,
      configurable: true,
    })
    Object.defineProperty(store, 'activeModel', {
      get() { return activeModelRef.value },
      set(v: string) { activeModelRef.value = v },
      enumerable: true,
      configurable: true,
    })
    // Keep refs accessible for storeToRefs mock which does storeToRefs = (store)=>store
    // so that `activeProvider` accessed via storeToRefs returns the ref wrapper
    // For our getter/setter store, storeToRefs will just return the same store,
    // so we expose the underlying refs as well for destructuring parity.
    // The store itself acts as both.
    return new Proxy(store, {
      get(target, prop) {
        if (prop === 'activeProvider')
          return activeProviderRef
        if (prop === 'activeModel')
          return activeModelRef
        return (target as any)[prop]
      },
      set(target, prop, value) {
        if (prop === 'activeProvider') {
          activeProviderRef.value = value
          return true
        }
        if (prop === 'activeModel') {
          activeModelRef.value = value
          return true
        }
        ;(target as any)[prop] = value
        return true
      },
    })
  },
}))
vi.mock('./modules/airi-card', () => ({ useAiriCardStore: () => ({ activeCard: undefined }) }))
vi.mock('./modules/artistry-autonomous', () => ({ useAutonomousArtistryStore: () => ({ runArtistTask: vi.fn() }) }))
vi.mock('./modules/web-search', () => ({ useWebSearchStore: () => ({}) }))

const provider = { chat: () => ({ baseURL: 'https://example.com/' }) } as unknown as ChatProvider
const fallbackProvider = { chat: () => ({ baseURL: 'https://fallback.example.com/' }) } as unknown as ChatProvider
const fallbackProvider2 = { chat: () => ({ baseURL: 'https://fallback2.example.com/' }) } as unknown as ChatProvider

describe('chat routeOverride (4D4C4-D2A)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    llmStreamMock.mockReset()
    for (const m of Object.values(chatAnalyticsMocks)) m.mockReset()
    ingestContextMessageMock.mockReset()
    getContextsSnapshotMock.mockReset().mockReturnValue({})
    createMinecraftContextMock.mockReset().mockReturnValue(undefined)
    persistSessionMessagesMock.mockReset()
    forkSessionMock.mockReset()
    ensureSessionMock.mockReset()
    loadSessionMock.mockReset().mockResolvedValue(true)
    deleteSessionMock.mockReset().mockResolvedValue(undefined)
    initializeSessionMock.mockReset().mockResolvedValue(undefined)
    disposeSessionMock.mockReset()
    ensureCurrentSessionMock.mockReset().mockResolvedValue('session-1')
    getChatProviderInstanceMock.mockReset().mockImplementation(async (providerId: string) => {
      if (providerId === 'mock-provider')
        return provider
      if (providerId === 'override-provider')
        return provider
      if (providerId === 'fallback-provider')
        return fallbackProvider
      if (providerId === 'fallback-provider-2')
        return fallbackProvider2
      // unknown provider -> undefined to trigger resolution failure
      return undefined
    })
    getToolsByNamesMock.mockReset().mockImplementation(names => names.map(name => ({
      type: 'function' as const,
      function: { name, parameters: { type: 'object', properties: {} } },
      execute: vi.fn(),
    })))
    activeSessionIdRef.value = 'session-1'
    activeProviderRef.value = 'mock-provider'
    activeModelRef.value = 'gpt-test'
    streamingMessageRef.value = { role: 'assistant', content: '', slices: [], tool_results: [] }
    currentGeneration = 1
    for (const k of Object.keys(sessionMessages)) delete sessionMessages[k]
    sessionMessages['session-1'] = [{ role: 'system', content: 'system prompt', createdAt: 1, id: 'system' }]
  })
  afterEach(() => {
    resetChatProviderRuntimeExtensionsForTesting()
    activeProviderRef.value = 'mock-provider'
    activeModelRef.value = 'gpt-test'
  })

  function streamOnce() {
    llmStreamMock.mockImplementation(async (_model: string, _chatProvider: ChatProvider, _messages: Message[], options: any) => {
      await options.onStreamEvent({ type: 'text-delta', text: 'ok' })
      await options.onStreamEvent({ type: 'finish', finishReason: 'stop' })
    })
  }

  it('a: no override baseline — uses global activeProvider/activeModel', async () => {
    streamOnce()
    const store = useChatStore()
    await store.send({ sessionId: 'session-1', text: 'hello' })
    expect(getChatProviderInstanceMock).toHaveBeenCalledWith('mock-provider', expect.anything())
    expect(llmStreamMock.mock.calls[0]?.[0]).toBe('gpt-test')
    expect(llmStreamMock.mock.calls[0]?.[1]).toBe(provider)
    expect(activeProviderRef.value).toBe('mock-provider')
    expect(activeModelRef.value).toBe('gpt-test')
  })

  it('b: override P0/M0 success — uses override, global unchanged, payload immutable', async () => {
    streamOnce()
    const store = useChatStore()
    const payload: ChatSendPayload = {
      sessionId: 'session-1',
      text: 'hello',
      routeOverride: { providerId: 'override-provider', modelId: 'override-model' },
    }
    const originalOverride = { ...payload.routeOverride! }
    await store.send(payload)
    expect(getChatProviderInstanceMock).toHaveBeenCalledWith('override-provider', expect.anything())
    expect(llmStreamMock.mock.calls[0]?.[0]).toBe('override-model')
    expect(llmStreamMock.mock.calls[0]?.[1]).toBe(provider)
    // global unchanged
    expect(activeProviderRef.value).toBe('mock-provider')
    expect(activeModelRef.value).toBe('gpt-test')
    // immutability
    expect(payload.routeOverride).toEqual(originalOverride)
    expect(payload.routeOverride?.providerId).toBe('override-provider')
  })

  it('c: override failure with no fallback — throws, single attempt, global unchanged', async () => {
    llmStreamMock.mockRejectedValueOnce(new Error('override failed'))
    const fallbackResolver = vi.fn(async () => undefined)
    registerChatFallbackResolver(fallbackResolver)
    const store = useChatStore()
    await expect(store.send({
      sessionId: 'session-1',
      text: 'hello',
      routeOverride: { providerId: 'override-provider', modelId: 'override-model' },
    })).rejects.toThrow('override failed')
    expect(llmStreamMock).toHaveBeenCalledTimes(1)
    expect(getChatProviderInstanceMock).toHaveBeenCalledWith('override-provider', expect.anything())
    expect(fallbackResolver).toHaveBeenCalledTimes(1)
    expect(fallbackResolver).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'override-provider',
      modelId: 'override-model',
      attemptIndex: 0,
    }))
    expect(activeProviderRef.value).toBe('mock-provider')
    expect(activeModelRef.value).toBe('gpt-test')
  })

  it('d: override with one fallback — second attempt uses P1, global unchanged, resolver sees P0', async () => {
    llmStreamMock.mockRejectedValueOnce(new Error('recoverable'))
    streamOnce()
    const seen: any[] = []
    registerChatFallbackResolver(async (args) => {
      seen.push({ ...args })
      return { providerId: 'fallback-provider', modelId: 'fallback-model' }
    })
    const store = useChatStore()
    await store.send({
      sessionId: 'session-1',
      text: 'hello',
      routeOverride: { providerId: 'override-provider', modelId: 'override-model' },
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ providerId: 'override-provider', modelId: 'override-model', attemptIndex: 0 })
    expect(getChatProviderInstanceMock.mock.calls.map(c => c[0])).toEqual(['override-provider', 'fallback-provider'])
    expect(llmStreamMock.mock.calls[0]?.[0]).toBe('override-model')
    expect(llmStreamMock.mock.calls[1]?.[0]).toBe('fallback-model')
    // global unchanged throughout
    expect(activeProviderRef.value).toBe('mock-provider')
    expect(activeModelRef.value).toBe('gpt-test')
  })

  it('d2: override with multiple fallbacks — P0->P1->P2 no snap-back', async () => {
    llmStreamMock.mockRejectedValueOnce(new Error('fail1'))
    llmStreamMock.mockRejectedValueOnce(new Error('fail2'))
    streamOnce()
    const seen: any[] = []
    registerChatFallbackResolver(async (args) => {
      seen.push({ ...args })
      if (args.attemptIndex === 0)
        return { providerId: 'fallback-provider', modelId: 'fallback-model' }
      if (args.attemptIndex === 1)
        return { providerId: 'fallback-provider-2', modelId: 'fallback-model-2' }
      return undefined
    })
    const store = useChatStore()
    await store.send({
      sessionId: 'session-1',
      text: 'hello',
      routeOverride: { providerId: 'override-provider', modelId: 'override-model' },
    })
    expect(seen).toHaveLength(2)
    expect(seen[0]).toMatchObject({ providerId: 'override-provider', modelId: 'override-model', attemptIndex: 0 })
    expect(seen[1]).toMatchObject({ providerId: 'fallback-provider', modelId: 'fallback-model', attemptIndex: 1 })
    expect(getChatProviderInstanceMock.mock.calls.map(c => c[0])).toEqual(['override-provider', 'fallback-provider', 'fallback-provider-2'])
    expect(llmStreamMock.mock.calls[2]?.[0]).toBe('fallback-model-2')
    expect(activeProviderRef.value).toBe('mock-provider')
    expect(activeModelRef.value).toBe('gpt-test')
  })

  it('global unchanged after failed override with fallback exhausted', async () => {
    llmStreamMock.mockRejectedValue(new Error('always failing'))
    registerChatFallbackResolver(async () => ({ providerId: 'fallback-provider', modelId: 'fallback-model' }))
    const store = useChatStore()
    await expect(store.send({
      sessionId: 'session-1',
      text: 'hello',
      routeOverride: { providerId: 'override-provider', modelId: 'override-model' },
    })).rejects.toThrow('always failing')
    expect(activeProviderRef.value).toBe('mock-provider')
    expect(activeModelRef.value).toBe('gpt-test')
  })

  it('unknown provider in override — throws without fallback, global unchanged', async () => {
    const store = useChatStore()
    await expect(store.send({
      sessionId: 'session-1',
      text: 'hello',
      routeOverride: { providerId: 'unknown-provider', modelId: 'unknown-model' },
    })).rejects.toThrow('Failed to resolve chat provider \"unknown-provider\"')
    expect(activeProviderRef.value).toBe('mock-provider')
    expect(activeModelRef.value).toBe('gpt-test')
    expect(getChatProviderInstanceMock).toHaveBeenCalledWith('unknown-provider', expect.anything())
  })

  it('unknown provider in override with fallback — fallback receives P0, then succeeds', async () => {
    // first attempt unknown fails at provider resolution before stream, second succeeds
    streamOnce()
    registerChatFallbackResolver(async (args) => {
      expect(args.providerId).toBe('unknown-provider')
      expect(args.modelId).toBe('unknown-model')
      return { providerId: 'fallback-provider', modelId: 'fallback-model' }
    })
    const store = useChatStore()
    await store.send({
      sessionId: 'session-1',
      text: 'hello',
      routeOverride: { providerId: 'unknown-provider', modelId: 'unknown-model' },
    })
    expect(getChatProviderInstanceMock.mock.calls.map(c => c[0])).toEqual(['unknown-provider', 'fallback-provider'])
    expect(llmStreamMock).toHaveBeenCalledTimes(1)
    expect(llmStreamMock.mock.calls[0]?.[0]).toBe('fallback-model')
    expect(activeProviderRef.value).toBe('mock-provider')
  })

  it('non-override fallback still mutates and restores global (backward compat)', async () => {
    llmStreamMock.mockRejectedValueOnce(new Error('fail'))
    streamOnce()
    registerChatFallbackResolver(async () => {
      return { providerId: 'fallback-provider', modelId: 'fallback-model' }
    })
    const store = useChatStore()
    await store.send({ sessionId: 'session-1', text: 'hello' })
    expect(getChatProviderInstanceMock.mock.calls.map(c => c[0])).toEqual(['mock-provider', 'fallback-provider'])
    // after send, global restored to original via store finally
    expect(activeProviderRef.value).toBe('mock-provider')
    expect(activeModelRef.value).toBe('gpt-test')
  })

  it('routeOverride is readonly and optional — absent stays absent', async () => {
    streamOnce()
    const store = useChatStore()
    const payload: ChatSendPayload = { sessionId: 'session-1', text: 'hello' }
    expect(() => structuredClone(payload)).not.toThrow()
    await store.send(payload)
    expect(payload.routeOverride).toBeUndefined()
    expect(getChatProviderInstanceMock).toHaveBeenCalledWith('mock-provider', expect.anything())
  })
})
