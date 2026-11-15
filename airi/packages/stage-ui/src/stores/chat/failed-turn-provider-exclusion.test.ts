/**
 * Phase 8.0D-M3: failed-turn provider exclusion.
 *
 * A logical send that fails terminally keeps its user turn in the conversation
 * - visible, persisted, retriable - but that turn stops taking part in the
 * provider context of every later model call. Before this invariant a rejected
 * image send stayed fully provider-visible, so the next request re-sent the
 * same image on top of the new one and walked straight into the vision model's
 * image ceiling.
 *
 * These tests drive the REAL chat store (real orchestrator runtime, real
 * projection) with only the LLM transport, the session store and the provider
 * resolver mocked, so the composed prompt asserted below is the prompt the
 * product would really send.
 */
import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { Message, Tool } from '@xsai/shared-chat'

import type { ChatSendPayload } from '../chat'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useChatStore } from '../chat'
import { useConsciousnessSettingsStore } from '../modules/consciousness-settings'
import {
  registerChatFallbackResolver,
  resetChatProviderRuntimeExtensionsForTesting,
} from './chat-provider-runtime'

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
const ensureSessionMock = vi.fn()
const loadSessionMock = vi.fn()
const setSessionMessagesMock = vi.fn()
const getChatProviderInstanceMock = vi.fn()
const getToolsByNamesMock = vi.fn<(names: string[]) => Tool[]>()

const activeSessionIdRef = ref('session-1')
const activeProviderRef = ref('mock-provider')
const activeModelRef = ref('gpt-test')
const streamingMessageRef = ref<any>({ role: 'assistant', content: '', slices: [], tool_results: [] })
const sessionMessages: Record<string, any[]> = {}

vi.mock('pinia', async () => {
  const actual = await vi.importActual<typeof import('pinia')>('pinia')
  return { ...actual, storeToRefs: (store: any) => store }
})
vi.mock('../../composables', () => ({ getConversationAnalyticsSurface: () => 'web' }))
vi.mock('../../libs/analytics', () => ({
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
vi.mock('../../composables/use-io-tracer', () => ({
  activeTurnSpan: { value: undefined },
  startSpan: vi.fn(() => ({ name: 'span', addEvent: vi.fn(), end: vi.fn(), setAttribute: vi.fn() })),
}))
vi.mock('./context-providers', () => ({
  createLiaCapabilitiesContext: () => null,
  createMinecraftContext: () => createMinecraftContextMock(),
}))
vi.mock('./context-store', () => ({
  useChatContextStore: () => ({
    ingestContextMessage: ingestContextMessageMock,
    getContextsSnapshot: getContextsSnapshotMock,
  }),
}))
vi.mock('./session-store', () => ({
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
    deleteSession: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    ensureCurrentSession: vi.fn().mockResolvedValue('session-1'),
    persistSessionMessages: vi.fn(),
    getSessionGeneration: () => 1,
    // The real store replaces the array and persists it; the spy records that
    // the marked tail really was written back through the persisting seam.
    setSessionMessages: (sessionId: string, messages: any[]) => {
      setSessionMessagesMock(sessionId, messages)
      sessionMessages[sessionId] = messages
    },
    forkSession: vi.fn(),
    pushMessageToCloud: vi.fn().mockResolvedValue(undefined),
  }),
}))
vi.mock('./stream-store', () => ({
  useChatStreamStore: () => ({ streamingMessage: streamingMessageRef }),
}))
vi.mock('../ai/chat-llm/llm', () => ({ useLLM: () => ({ stream: llmStreamMock }) }))
vi.mock('../ai/chat-llm/tools', () => ({
  useLlmToolsStore: () => ({ getToolsByNames: (...names: string[]) => getToolsByNamesMock(names) }),
}))
vi.mock('../ai/chat-llm/toolset-prompts', () => ({
  useLlmToolsetPromptsStore: () => ({ activeToolsetPrompt: '' }),
}))
vi.mock('../modules/consciousness', () => ({
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
vi.mock('../modules/airi-card', () => ({ useAiriCardStore: () => ({ activeCard: undefined }) }))
vi.mock('../modules/artistry-autonomous', () => ({ useAutonomousArtistryStore: () => ({ runArtistTask: vi.fn() }) }))
vi.mock('../modules/web-search', () => ({ useWebSearchStore: () => ({}) }))

const provider = { chat: () => ({ baseURL: 'https://example.com/' }) } as unknown as ChatProvider

/** The exact Groq shape the Windows evidence carried, image ceiling included. */
const IMAGE_REJECTION = new Error('Remote sent 400 response: {"error":{"message":"Too many images provided. This model supports up to 3 images"}}')

function imageAttachment(data: string) {
  return { type: 'image' as const, data, mimeType: 'image/png' }
}

/** Every `image_url` part the provider would receive in one composed prompt. */
function imageParts(messages: Message[]): unknown[] {
  return messages.flatMap((message) => {
    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content))
      return []
    return content.filter((part: any) => part?.type === 'image_url')
  })
}

/** Composed prompt of the Nth provider request (0-based). */
function promptOf(callIndex: number): Message[] {
  return llmStreamMock.mock.calls[callIndex]![2] as Message[]
}

function userTurns(sessionId: string) {
  return (sessionMessages[sessionId] ?? []).filter(message => message.role === 'user')
}

function errorBubbles(sessionId: string) {
  return (sessionMessages[sessionId] ?? []).filter(message => message.role === 'error')
}

function succeedOnce(text = 'ok') {
  llmStreamMock.mockImplementationOnce(async (_model: string, _chatProvider: ChatProvider, _messages: Message[], options: any) => {
    await options.onStreamEvent({ type: 'text-delta', text })
    await options.onStreamEvent({ type: 'finish', finishReason: 'stop' })
  })
}

describe('phase 8.0D-M3 failed-turn provider exclusion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    llmStreamMock.mockReset()
    for (const m of Object.values(chatAnalyticsMocks)) m.mockReset()
    ingestContextMessageMock.mockReset()
    getContextsSnapshotMock.mockReset().mockReturnValue({})
    createMinecraftContextMock.mockReset().mockReturnValue(undefined)
    ensureSessionMock.mockReset()
    loadSessionMock.mockReset().mockResolvedValue(true)
    setSessionMessagesMock.mockReset()
    getChatProviderInstanceMock.mockReset().mockResolvedValue(provider)
    getToolsByNamesMock.mockReset().mockImplementation(() => [])
    activeSessionIdRef.value = 'session-1'
    activeProviderRef.value = 'mock-provider'
    activeModelRef.value = 'gpt-test'
    streamingMessageRef.value = { role: 'assistant', content: '', slices: [], tool_results: [] }
    for (const k of Object.keys(sessionMessages)) delete sessionMessages[k]
    sessionMessages['session-1'] = [{ role: 'system', content: 'system prompt', createdAt: 1, id: 'system' }]
  })
  afterEach(() => resetChatProviderRuntimeExtensionsForTesting())

  it('1: a provider 400 after an image turn keeps the turn visible and intact, marks it excluded, and keeps it out of the next prompt', async () => {
    // The Lia fallback resolver IS registered and declines - exactly the
    // Windows path, where a 400 is permanent so no next route is offered.
    registerChatFallbackResolver(() => undefined)
    llmStreamMock.mockRejectedValueOnce(IMAGE_REJECTION)

    const store = useChatStore()
    const payload: ChatSendPayload = {
      sessionId: 'session-1',
      text: 'what is in this picture',
      attachments: [imageAttachment('aW1hZ2Utb25l')],
      routeOverride: { providerId: 'groq', modelId: 'qwen/qwen3.8-27b' },
    }
    await expect(store.send(payload)).rejects.toThrow('Too many images')

    // (a) the failed USER turn is STILL in the conversation - never deleted.
    const turns = userTurns('session-1')
    expect(turns).toHaveLength(1)
    // (b) its original image part is intact, byte-identical.
    const content = turns[0].content as any[]
    expect(Array.isArray(content)).toBe(true)
    expect(content.filter((part: any) => part.type === 'image_url')).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2Utb25l' } },
    ])
    expect(content.find((part: any) => part.type === 'text')?.text).toBe('what is in this picture')
    // (c) it is marked excluded from provider context.
    expect(turns[0].excludedFromProviderContext).toBe(true)
    // (d) the error bubble is still visible to the user.
    expect(errorBubbles('session-1')).toHaveLength(1)
    // (e) and the bubble is NOT part of the marked tail: it was appended after
    // the marking, which pins the required ordering.
    expect(errorBubbles('session-1')[0].excludedFromProviderContext).toBeUndefined()

    // (f) neither the failed turn nor the bubble reaches the NEXT provider prompt.
    succeedOnce()
    await store.send({ sessionId: 'session-1', text: 'thanks anyway' })

    const nextPrompt = promptOf(1)
    expect(imageParts(nextPrompt)).toEqual([])
    expect(nextPrompt.filter(message => (message as { role: string }).role === 'error')).toEqual([])
    const asText = JSON.stringify(nextPrompt)
    expect(asText).not.toContain('what is in this picture')
    expect(asText).not.toContain('Too many images')
    expect(asText).toContain('thanks anyway')
  })

  it('2: repeated failed image sends contribute zero images to the next request', async () => {
    registerChatFallbackResolver(() => undefined)

    const store = useChatStore()
    for (let i = 0; i < 3; i += 1) {
      llmStreamMock.mockRejectedValueOnce(IMAGE_REJECTION)
      await expect(store.send({
        sessionId: 'session-1',
        text: `attempt ${i + 1}`,
        attachments: [imageAttachment(`aW1hZ2Ut${i + 1}`)],
        routeOverride: { providerId: 'groq', modelId: 'qwen/qwen3.8-27b' },
      })).rejects.toThrow('Too many images')
    }

    // A legitimate image send now: only ITS image may reach the provider.
    succeedOnce()
    await store.send({
      sessionId: 'session-1',
      text: 'try the fourth picture',
      attachments: [imageAttachment('aW1hZ2UtZm91cg==')],
      routeOverride: { providerId: 'groq', modelId: 'qwen/qwen3.8-27b' },
    })

    // The consequence first: without the invariant this request would carry 4
    // images - the three rejected ones plus the new one - which is precisely
    // how the vision model's ceiling was hit on Windows.
    const sent = imageParts(promptOf(3))
    expect(sent).toHaveLength(1)
    expect(sent).toEqual([{ type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2UtZm91cg==' } }])

    // And the mechanism: all three failed turns are still in the record -
    // nothing was deleted - each withheld from projection.
    expect(userTurns('session-1')).toHaveLength(4)
    const failed = userTurns('session-1').filter(message => message.excludedFromProviderContext === true)
    expect(failed).toHaveLength(3)
  })

  it('3: a terminal failure with NO fallback resolver at all obeys the same invariant', async () => {
    // Deliberately no registerChatFallbackResolver(...) - the plain web/pocket
    // path. The invariant must not depend on the Lia branch existing.
    llmStreamMock.mockRejectedValueOnce(IMAGE_REJECTION)

    const store = useChatStore()
    await expect(store.send({
      sessionId: 'session-1',
      text: 'no resolver here',
      attachments: [imageAttachment('bm8tcmVzb2x2ZXI=')],
    })).rejects.toThrow('Too many images')

    expect(userTurns('session-1')).toHaveLength(1)
    expect(userTurns('session-1')[0].excludedFromProviderContext).toBe(true)

    succeedOnce()
    await store.send({ sessionId: 'session-1', text: 'next turn' })
    expect(imageParts(promptOf(1))).toEqual([])
  })

  it('4: retry of an excluded failed image turn resolves the same source, rebuilds the exact image, and succeeds visibly', async () => {
    registerChatFallbackResolver(() => undefined)
    llmStreamMock.mockRejectedValueOnce(IMAGE_REJECTION)

    const store = useChatStore()
    await expect(store.send({
      sessionId: 'session-1',
      text: 'describe this',
      attachments: [imageAttachment('c291cmNlLWltYWdl')],
    })).rejects.toThrow('Too many images')

    const failedTurn = userTurns('session-1')[0]
    expect(failedTurn.excludedFromProviderContext).toBe(true)
    const sourceMessageId = failedTurn.id as string
    expect(typeof sourceMessageId).toBe('string')

    // The retry succeeds.
    succeedOnce('it is a cat')
    await store.retry({ sessionId: 'session-1', index: 1, sourceMessageId })

    // The retried turn carries the SAME image, reconstructed from the source.
    const retriedPrompt = promptOf(1)
    expect(imageParts(retriedPrompt)).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,c291cmNlLWltYWdl' } },
    ])
    // The old excluded turn was truncated away, and the freshly appended user
    // turn is a normal, provider-visible message.
    const turns = userTurns('session-1')
    expect(turns).toHaveLength(1)
    expect(turns[0].excludedFromProviderContext).toBeUndefined()
  })

  it('5: a successful send is never marked - only failures are withheld', async () => {
    succeedOnce()
    const store = useChatStore()
    await store.send({ sessionId: 'session-1', text: 'a good turn', attachments: [imageAttachment('Z29vZA==')] })

    const turns = userTurns('session-1')
    expect(turns).toHaveLength(1)
    expect(turns[0].excludedFromProviderContext).toBeUndefined()

    // And its image really does reach the next request - nothing was flattened.
    succeedOnce()
    await store.send({ sessionId: 'session-1', text: 'and now text only' })
    const next = promptOf(1)
    expect(imageParts(next)).toEqual([{ type: 'image_url', image_url: { url: 'data:image/png;base64,Z29vZA==' } }])
    // The historical image is projected as real content, never text-converted.
    const historical = next.find(message => (message as any).role === 'user' && Array.isArray((message as any).content))
    expect(historical).toBeDefined()
  })

  it('6: only the failed send tail is marked - earlier history is untouched', async () => {
    registerChatFallbackResolver(() => undefined)

    const store = useChatStore()
    succeedOnce('first answer')
    await store.send({ sessionId: 'session-1', text: 'first turn' })

    llmStreamMock.mockRejectedValueOnce(IMAGE_REJECTION)
    await expect(store.send({
      sessionId: 'session-1',
      text: 'second turn fails',
      attachments: [imageAttachment('c2Vjb25k')],
    })).rejects.toThrow('Too many images')

    const all = sessionMessages['session-1']
    const firstUser = all.find(message => message.role === 'user' && message.content === 'first turn')
    const failedUser = all.find(message => message.role === 'user' && Array.isArray(message.content))
    const assistant = all.find(message => message.role === 'assistant')

    expect(firstUser?.excludedFromProviderContext).toBeUndefined()
    expect(assistant?.excludedFromProviderContext).toBeUndefined()
    expect(failedUser?.excludedFromProviderContext).toBe(true)

    // The earlier, legitimate turn still reaches the provider.
    succeedOnce()
    await store.send({ sessionId: 'session-1', text: 'third turn' })
    expect(JSON.stringify(promptOf(2))).toContain('first turn')
  })

  it('7: the marked tail is written back through the persisting session seam', async () => {
    llmStreamMock.mockRejectedValueOnce(IMAGE_REJECTION)

    const store = useChatStore()
    await expect(store.send({
      sessionId: 'session-1',
      text: 'persist me',
      attachments: [imageAttachment('cGVyc2lzdA==')],
    })).rejects.toThrow('Too many images')

    // setSessionMessages is the seam that replaces AND persists the list, so
    // the exclusion state reaches local storage rather than living in memory.
    const marked = (setSessionMessagesMock.mock.calls as [string, any[]][]).find(
      ([, messages]) => messages.some(message => message.excludedFromProviderContext === true),
    )
    expect(marked).toBeDefined()
    expect(marked![0]).toBe('session-1')
  })
})
