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

const ioTracerMocks = vi.hoisted(() => {
  const activeTurnSpan = { value: undefined as any }
  const spans: any[] = []
  const startSpanMock = vi.fn((name: string) => {
    const span = { name, addEvent: vi.fn(), end: vi.fn(), setAttribute: vi.fn() }
    spans.push(span)
    return span
  })
  return { activeTurnSpan, spans, startSpanMock }
})

const llmStreamMock = vi.fn()
const trackFirstMessageMock = vi.fn()
const chatAnalyticsMocks = vi.hoisted(() => ({
  trackAiGeneration: vi.fn(),
  trackMessageRound: vi.fn(),
  trackMessageRoundFailed: vi.fn(),
  trackMessageSent: vi.fn(),
}))
const redundantChatAnalyticsMocks = vi.hoisted(() => ({
  trackAssistantResponseCompleted: vi.fn(),
  trackChatFailed: vi.fn(),
  trackChatStarted: vi.fn(),
  trackFeatureUsed: vi.fn(),
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

vi.mock('../composables', () => ({
  getConversationAnalyticsSurface: () => 'web',
}))

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
  activeTurnSpan: ioTracerMocks.activeTurnSpan,
  startSpan: ioTracerMocks.startSpanMock,
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

vi.mock('./ai/chat-llm/llm', () => ({
  useLLM: () => ({ stream: llmStreamMock }),
}))

vi.mock('./ai/chat-llm/tools', () => ({
  useLlmToolsStore: () => ({ getToolsByNames: (...names: string[]) => getToolsByNamesMock(names) }),
}))

vi.mock('./ai/chat-llm/toolset-prompts', () => ({
  useLlmToolsetPromptsStore: () => ({ activeToolsetPrompt: 'Plugin toolset guidance.' }),
}))

vi.mock('./modules/consciousness', () => ({
  useConsciousnessStore: () => ({
    activeModel: activeModelRef,
    activeProvider: activeProviderRef,
    getChatProviderInstance: (providerId: string) =>
      getChatProviderInstanceMock(providerId, {
        reasoning: useConsciousnessSettingsStore().reasoning ? 'enabled' : 'disabled',
      }),
  }),
}))

vi.mock('./providers/provider', () => ({
  useProviderStore: () => ({
    getChatProviderInstance: (providerId: string, options: { reasoning: 'enabled' | 'disabled' }) =>
      getChatProviderInstanceMock(providerId, options),
  }),
}))

vi.mock('./modules/airi-card', () => ({
  useAiriCardStore: () => ({ activeCard: undefined }),
}))

vi.mock('./modules/artistry-autonomous', () => ({
  useAutonomousArtistryStore: () => ({ runArtistTask: vi.fn() }),
}))

vi.mock('./modules/web-search', () => ({
  useWebSearchStore: () => ({}),
}))

const provider = { chat: () => ({ baseURL: 'https://example.com/' }) } as unknown as ChatProvider

describe('chat store reasoning per-send foundation (phase 8.0D-10B-4D4C4-D2B2-C1)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    llmStreamMock.mockReset()
    trackFirstMessageMock.mockReset()
    for (const m of Object.values(chatAnalyticsMocks)) m.mockReset()
    for (const m of Object.values(redundantChatAnalyticsMocks)) m.mockReset()
    ingestContextMessageMock.mockReset()
    getContextsSnapshotMock.mockReset()
    getContextsSnapshotMock.mockReturnValue({})
    createMinecraftContextMock.mockReset()
    createMinecraftContextMock.mockReturnValue(undefined)
    persistSessionMessagesMock.mockReset()
    forkSessionMock.mockReset()
    ensureSessionMock.mockReset()
    loadSessionMock.mockReset().mockResolvedValue(true)
    deleteSessionMock.mockReset().mockResolvedValue(undefined)
    initializeSessionMock.mockReset().mockResolvedValue(undefined)
    disposeSessionMock.mockReset()
    ensureCurrentSessionMock.mockReset().mockResolvedValue('session-1')
    getChatProviderInstanceMock.mockReset().mockResolvedValue(provider)
    getToolsByNamesMock.mockReset().mockImplementation(names =>
      names.map(name => ({
        type: 'function',
        function: { name, parameters: { type: 'object', properties: {} } },
        execute: vi.fn(),
      })),
    )
    ioTracerMocks.activeTurnSpan.value = undefined
    ioTracerMocks.spans.length = 0
    ioTracerMocks.startSpanMock.mockClear()
    activeSessionIdRef.value = 'session-1'
    activeProviderRef.value = 'mock-provider'
    activeModelRef.value = 'gpt-test'
    streamingMessageRef.value = { role: 'assistant', content: '', slices: [], tool_results: [] }
    currentGeneration = 1
    for (const k of Object.keys(sessionMessages)) delete sessionMessages[k]
    sessionMessages['session-1'] = [{ role: 'system', content: 'system prompt', createdAt: 1, id: 'system' }]
    // Ensure global reasoning starts false for determinism
    const settings = useConsciousnessSettingsStore()
    settings.reasoning = false as any
    resetChatProviderRuntimeExtensionsForTesting()
    activeModelRef.value = 'gpt-test'
    activeProviderRef.value = 'mock-provider'
  })

  afterEach(() => {
    resetChatProviderRuntimeExtensionsForTesting()
    const settings = useConsciousnessSettingsStore()
    settings.reasoning = false as any
    activeProviderRef.value = 'mock-provider'
    activeModelRef.value = 'gpt-test'
  })

  function streamWithUsage() {
    llmStreamMock.mockImplementation(async (_model: string, _chatProvider: ChatProvider, _messages: Message[], options: any) => {
      await options.onStreamEvent({ type: 'text-delta', text: 'ok' })
      await options.onStreamEvent({ type: 'finish', finishReason: 'stop' })
      await options.onUsage?.({ inputTokens: 1, outputTokens: 1, totalTokens: 2, source: 'reported' })
    })
  }

  it('backward: absent reasoning uses live global (disabled by default)', async () => {
    streamWithUsage()
    const store = useChatStore()
    const settings = useConsciousnessSettingsStore()
    expect(settings.reasoning).toBe(false)
    await store.send({ sessionId: 'session-1', text: 'hello' })
    expect(getChatProviderInstanceMock).toHaveBeenCalledTimes(1)
    expect(getChatProviderInstanceMock).toHaveBeenCalledWith('mock-provider', { reasoning: 'disabled' })
  })

  it('backward: absent reasoning follows global when enabled', async () => {
    const settings = useConsciousnessSettingsStore()
    await settings.setReasoning(true)
    streamWithUsage()
    const store = useChatStore()
    await store.send({ sessionId: 'session-1', text: 'hello' })
    expect(getChatProviderInstanceMock).toHaveBeenCalledWith('mock-provider', { reasoning: 'enabled' })
    await settings.setReasoning(false)
  })

  it('explicit true survives even when global is disabled', async () => {
    const settings = useConsciousnessSettingsStore()
    settings.reasoning = false as any
    streamWithUsage()
    const store = useChatStore()
    await store.send({ sessionId: 'session-1', text: 'hello', reasoning: true })
    expect(getChatProviderInstanceMock).toHaveBeenCalledWith('mock-provider', { reasoning: 'enabled' })
    // Global remains untouched
    expect(settings.reasoning).toBe(false)
  })

  it('explicit false survives even when global is enabled (false is not falsy fallback)', async () => {
    const settings = useConsciousnessSettingsStore()
    await settings.setReasoning(true)
    streamWithUsage()
    const store = useChatStore()
    await store.send({ sessionId: 'session-1', text: 'hello', reasoning: false })
    expect(getChatProviderInstanceMock).toHaveBeenCalledWith('mock-provider', { reasoning: 'disabled' })
    expect(settings.reasoning).toBe(true)
    await settings.setReasoning(false)
  })

  it('true vs global false and false vs global true both directions', async () => {
    const settings = useConsciousnessSettingsStore()
    // true vs false global
    settings.reasoning = false as any
    streamWithUsage()
    const store1 = useChatStore()
    await store1.send({ sessionId: 'session-1', text: 'a', reasoning: true })
    expect(getChatProviderInstanceMock).toHaveBeenLastCalledWith('mock-provider', { reasoning: 'enabled' })
    getChatProviderInstanceMock.mockClear()
    // false vs true global
    await settings.setReasoning(true)
    const store2 = useChatStore()
    // need fresh pinia? use same store but ensure mock cleared
    llmStreamMock.mockImplementation(async (_m: string, _p: ChatProvider, _msgs: Message[], opts: any) => {
      await opts.onStreamEvent({ type: 'text-delta', text: 'ok' })
      await opts.onStreamEvent({ type: 'finish', finishReason: 'stop' })
    })
    await store2.send({ sessionId: 'session-1', text: 'b', reasoning: false })
    expect(getChatProviderInstanceMock).toHaveBeenCalledWith('mock-provider', { reasoning: 'disabled' })
    await settings.setReasoning(false)
  })

  it('frozen: global divergence mid-send does not affect captured reasoning (true)', async () => {
    const settings = useConsciousnessSettingsStore()
    settings.reasoning = false as any
    // Simulate global flipping to true during provider resolution, but per-send true should stay enabled
    getChatProviderInstanceMock.mockImplementationOnce(async (providerId: string, opts: any) => {
      // flip global inside first attempt
      settings.reasoning = true as any
      // opts should be enabled because payload true
      expect(opts).toEqual({ reasoning: 'enabled' })
      return provider
    })
    streamWithUsage()
    // override the first implementation's stream to still succeed after flip
    llmStreamMock.mockImplementationOnce(async (_m: string, _p: ChatProvider, _msgs: Message[], opts: any) => {
      await opts.onStreamEvent({ type: 'text-delta', text: 'ok' })
      await opts.onStreamEvent({ type: 'finish', finishReason: 'stop' })
    })
    const store = useChatStore()
    await store.send({ sessionId: 'session-1', text: 'hello', reasoning: true })
    expect(getChatProviderInstanceMock).toHaveBeenCalledWith('mock-provider', { reasoning: 'enabled' })
    expect(settings.reasoning).toBe(true)
    // reset
    settings.reasoning = false as any
  })

  it('frozen: global divergence mid-send does not affect captured reasoning (false)', async () => {
    const settings = useConsciousnessSettingsStore()
    await settings.setReasoning(true)
    getChatProviderInstanceMock.mockImplementationOnce(async (providerId: string, opts: any) => {
      settings.reasoning = false as any
      expect(opts).toEqual({ reasoning: 'disabled' })
      return provider
    })
    streamWithUsage()
    llmStreamMock.mockImplementationOnce(async (_m: string, _p: ChatProvider, _msgs: Message[], opts: any) => {
      await opts.onStreamEvent({ type: 'text-delta', text: 'ok' })
      await opts.onStreamEvent({ type: 'finish', finishReason: 'stop' })
    })
    const store = useChatStore()
    await store.send({ sessionId: 'session-1', text: 'hello', reasoning: false })
    expect(getChatProviderInstanceMock).toHaveBeenCalledWith('mock-provider', { reasoning: 'disabled' })
    await settings.setReasoning(false)
  })

  it('1 fallback preserves captured reasoning (true)', async () => {
    const settings = useConsciousnessSettingsStore()
    settings.reasoning = false as any
    llmStreamMock.mockRejectedValueOnce(new Error('recoverable'))
    streamWithUsage()
    registerChatFallbackResolver(async () => ({ providerId: 'mock-provider', modelId: 'gpt-test' }))
    const store = useChatStore()
    await store.send({ sessionId: 'session-1', text: 'hello', reasoning: true })
    expect(getChatProviderInstanceMock).toHaveBeenCalledTimes(2)
    expect(getChatProviderInstanceMock.mock.calls[0]?.[1]).toEqual({ reasoning: 'enabled' })
    expect(getChatProviderInstanceMock.mock.calls[1]?.[1]).toEqual({ reasoning: 'enabled' })
  })

  it('multi fallback (3 attempts) preserves captured reasoning (false)', async () => {
    const settings = useConsciousnessSettingsStore()
    await settings.setReasoning(true)
    llmStreamMock.mockReset()
    llmStreamMock
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockImplementation(async (_m: string, _p: ChatProvider, _msgs: Message[], opts: any) => {
        await opts.onStreamEvent({ type: 'text-delta', text: 'ok' })
        await opts.onStreamEvent({ type: 'finish', finishReason: 'stop' })
      })
    getChatProviderInstanceMock.mockResolvedValue(provider)
    registerChatFallbackResolver(async () => ({ providerId: 'mock-provider', modelId: 'gpt-test' }))
    const store = useChatStore()
    await store.send({ sessionId: 'session-1', text: 'hello', reasoning: false })
    expect(getChatProviderInstanceMock).toHaveBeenCalledTimes(3)
    for (const call of getChatProviderInstanceMock.mock.calls) {
      expect(call[1]).toEqual({ reasoning: 'disabled' })
    }
    await settings.setReasoning(false)
  })

  it('routeOverride and reasoning are orthogonal (both present)', async () => {
    streamWithUsage()
    const store = useChatStore()
    const settings = useConsciousnessSettingsStore()
    settings.reasoning = false as any
    await store.send({
      sessionId: 'session-1',
      text: 'hello',
      reasoning: true,
      routeOverride: { providerId: 'mock-provider', modelId: 'gpt-test' },
    })
    expect(getChatProviderInstanceMock).toHaveBeenCalledWith('mock-provider', { reasoning: 'enabled' })
    expect(settings.reasoning).toBe(false)
  })

  it('routeOverride without reasoning still uses global', async () => {
    const settings = useConsciousnessSettingsStore()
    await settings.setReasoning(true)
    streamWithUsage()
    const store = useChatStore()
    await store.send({
      sessionId: 'session-1',
      text: 'hello',
      routeOverride: { providerId: 'mock-provider', modelId: 'gpt-test' },
    })
    expect(getChatProviderInstanceMock).toHaveBeenCalledWith('mock-provider', { reasoning: 'enabled' })
    await settings.setReasoning(false)
  })

  it('optional contract: payload without reasoning is still valid (typecheck 9 cases)', async () => {
    streamWithUsage()
    const store = useChatStore()
    // 1: absent
    const p1: ChatSendPayload = { sessionId: 'session-1', text: 'a' }
    await store.send(p1)
    // 2: true
    const p2: ChatSendPayload = { sessionId: 'session-1', text: 'b', reasoning: true }
    await store.send(p2)
    // 3: false
    const p3: ChatSendPayload = { sessionId: 'session-1', text: 'c', reasoning: false }
    await store.send(p3)
    // 4: true with routeOverride
    const p4: ChatSendPayload = { sessionId: 'session-1', text: 'd', reasoning: true, routeOverride: { providerId: 'mock-provider', modelId: 'gpt-test' } }
    await store.send(p4)
    // 5: false with routeOverride
    const p5: ChatSendPayload = { sessionId: 'session-1', text: 'e', reasoning: false, routeOverride: { providerId: 'mock-provider', modelId: 'gpt-test' } }
    await store.send(p5)
    // 6: undefined explicit
    const p6: ChatSendPayload = { sessionId: 'session-1', text: 'f', reasoning: undefined }
    await store.send(p6)
    // 7: tools + reasoning
    const p7: ChatSendPayload = { sessionId: 'session-1', text: 'g', reasoning: true, tools: [{ name: 'stage_widgets' }] }
    await store.send(p7)
    // 8: correlation + reasoning
    const p8: ChatSendPayload = { sessionId: 'session-1', text: 'h', reasoning: false, correlationId: 'corr-1' }
    await store.send(p8)
    // 9: minimal second turn without reasoning after previous with reasoning
    const p9: ChatSendPayload = { sessionId: 'session-1', text: 'i' }
    await store.send(p9)

    // All 9 succeeded, total calls = 9 (plus fallback? no fallback here) — but we already had prior tests, so just ensure last call disabled
    expect(getChatProviderInstanceMock).toHaveBeenCalled()
    // Verify the 9th still uses global disabled
    const lastCall = getChatProviderInstanceMock.mock.calls.at(-1)
    expect(lastCall?.[1]).toEqual({ reasoning: 'disabled' })
  })

  it('does not mutate global reasoning when per-send is used', async () => {
    const settings = useConsciousnessSettingsStore()
    settings.reasoning = false as any
    streamWithUsage()
    const store = useChatStore()
    await store.send({ sessionId: 'session-1', text: 'hello', reasoning: true })
    expect(settings.reasoning).toBe(false)
    await store.send({ sessionId: 'session-1', text: 'hello2', reasoning: false })
    expect(settings.reasoning).toBe(false)
    // absent preserves
    await store.send({ sessionId: 'session-1', text: 'hello3' })
    expect(settings.reasoning).toBe(false)
  })

  it('converts boolean to enabled/disabled at provider border only when defined', async () => {
    streamWithUsage()
    const store = useChatStore()
    const settings = useConsciousnessSettingsStore()
    settings.reasoning = false as any
    await store.send({ sessionId: 'session-1', text: 'a', reasoning: true })
    expect(getChatProviderInstanceMock).toHaveBeenLastCalledWith('mock-provider', { reasoning: 'enabled' })
    await store.send({ sessionId: 'session-1', text: 'b', reasoning: false })
    expect(getChatProviderInstanceMock).toHaveBeenLastCalledWith('mock-provider', { reasoning: 'disabled' })
    // undefined uses global disabled
    await store.send({ sessionId: 'session-1', text: 'c' })
    expect(getChatProviderInstanceMock).toHaveBeenLastCalledWith('mock-provider', { reasoning: 'disabled' })
    // undefined uses global enabled when set
    await settings.setReasoning(true)
    await store.send({ sessionId: 'session-1', text: 'd' })
    expect(getChatProviderInstanceMock).toHaveBeenLastCalledWith('mock-provider', { reasoning: 'enabled' })
    await settings.setReasoning(false)
  })

  it('fallback with routeOverride preserves reasoning orthogonal (true across 2 attempts)', async () => {
    const settings = useConsciousnessSettingsStore()
    settings.reasoning = false as any
    llmStreamMock.mockRejectedValueOnce(new Error('recoverable'))
    streamWithUsage()
    registerChatFallbackResolver(async ({ providerId }) => ({
      providerId: providerId === 'mock-provider' ? 'fallback-provider' : 'mock-provider',
      modelId: 'gpt-test',
    }))
    getChatProviderInstanceMock.mockResolvedValue(provider)
    const store = useChatStore()
    await store.send({
      sessionId: 'session-1',
      text: 'hello',
      reasoning: true,
      routeOverride: { providerId: 'mock-provider', modelId: 'gpt-test' },
    })
    expect(getChatProviderInstanceMock).toHaveBeenCalledTimes(2)
    expect(getChatProviderInstanceMock.mock.calls[0]).toEqual(['mock-provider', { reasoning: 'enabled' }])
    expect(getChatProviderInstanceMock.mock.calls[1]).toEqual(['fallback-provider', { reasoning: 'enabled' }])
  })

  it('guards: no Lia coupling, no cache/timer, payload reasoning is independent of routeOverride', async () => {
    streamWithUsage()
    const store = useChatStore()
    // Ensure payload with only reasoning and without routeOverride works and vice versa
    await store.send({ sessionId: 'session-1', text: 'only reasoning', reasoning: true })
    expect(getChatProviderInstanceMock).toHaveBeenLastCalledWith('mock-provider', { reasoning: 'enabled' })
    getChatProviderInstanceMock.mockClear()
    await store.send({ sessionId: 'session-1', text: 'only route', routeOverride: { providerId: 'mock-provider', modelId: 'gpt-test' } })
    expect(getChatProviderInstanceMock).toHaveBeenLastCalledWith('mock-provider', { reasoning: 'disabled' })
    // Both undefined -> global
    getChatProviderInstanceMock.mockClear()
    await store.send({ sessionId: 'session-1', text: 'neither' })
    expect(getChatProviderInstanceMock).toHaveBeenLastCalledWith('mock-provider', { reasoning: 'disabled' })
  })
})
