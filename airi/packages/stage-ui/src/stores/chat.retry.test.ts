import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { Message, Tool } from '@xsai/shared-chat'

import type { ChatRetryPayload, ChatSendPayload } from './chat'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

// TEST-ONLY helper: keep source guards stable across CRLF/LF checkouts
function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function readChatSource(): string {
  return normalizeLineEndings(readFileSync(resolve(__dirname, './chat.ts'), 'utf-8'))
}

/** Mirrors exactly how the send path stores an image part: a base64 data URL. */
function storedImageUrl(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`
}

function storedTextPart(text: string) {
  return { type: 'text' as const, text }
}

function storedImagePart(mimeType: string, data: string) {
  return { type: 'image_url' as const, image_url: { url: storedImageUrl(mimeType, data) } }
}

/** A stored USER turn shaped exactly as the orchestrator appends it. */
function storedUser(opts: {
  id?: string
  text: string
  images?: Array<[string, string]>
  tools?: Array<{ name: string }>
}) {
  const parts = [storedTextPart(opts.text), ...(opts.images ?? []).map(([mime, data]) => storedImagePart(mime, data))]
  return {
    role: 'user' as const,
    content: parts.length > 1 ? parts : opts.text,
    createdAt: 1,
    ...(opts.id === undefined ? {} : { id: opts.id }),
    ...(opts.tools === undefined ? {} : { tools: opts.tools }),
  }
}

const SYSTEM = { role: 'system', content: 'system prompt', createdAt: 1, id: 'system' }

function seed(messages: unknown[]) {
  sessionMessages['session-1'] = [SYSTEM, ...messages] as any[]
}

/** The content of the LAST user message handed to the provider on one attempt. */
function sentUserContent(callIndex = 0): unknown {
  const sent = llmStreamMock.mock.calls[callIndex]?.[2] as Message[] | undefined
  const user = [...(sent ?? [])].reverse().find(message => message.role === 'user')
  return user?.content
}

/**
 * The user text as the provider received it. The orchestrator prepends its own
 * stable time prefix to user content (core-agent, untouched here), so the
 * prefix is stripped before comparing retry text semantics.
 */
function sentUserText(callIndex = 0): string {
  const content = sentUserContent(callIndex)
  const raw = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n\n')
      : ''
  return raw.replace(/^\[[^\]]*\]\s*/, '')
}

function sentImageUrls(callIndex = 0): string[] {
  const content = sentUserContent(callIndex)
  if (!Array.isArray(content))
    return []
  return content
    .filter((part: any): part is { type: 'image_url', image_url: { url: string } } => part.type === 'image_url')
    .map(part => part.image_url.url)
}

describe('chat retry stable source target (Phase 8.0D-10B-4D4C4-D2B6 corrective)', () => {
  it('chatRetryPayload has optional sourceMessageId, correlationId, reasoning, routeOverride', async () => {
    const src = readChatSource()
    expect(src).toMatch(/export interface ChatRetryPayload/)
    expect(src).toMatch(/sourceMessageId\?: string/)
    expect(src).not.toMatch(/messageId\?: string/)
    expect(src).toMatch(/correlationId\?: string/)
    expect(src).toMatch(/reasoning\?: boolean/)
    expect(src).toMatch(/routeOverride\?: ChatSendRouteOverride/)
  })

  it('retry resolves sourceMessageId to CURRENT user index and fails safely without fallback to stale index', async () => {
    const src = readChatSource()
    expect(src).toMatch(/if \(payload\.sourceMessageId !== undefined\)/)
    expect(src).toMatch(/\.id === payload\.sourceMessageId/)
    expect(src).toMatch(/message\.role === 'user'/)
    expect(src).toMatch(/findIndex/)
    expect(src).toMatch(/throw new Error\('Retry target has no retriable source message: stale sourceMessageId'\)/)
    // ensure no fallback to payload.index when sourceMessageId present
    const retryBlock = src.slice(src.indexOf('async function retry'))
    expect(retryBlock).not.toMatch(/payload\.sourceMessageId !== undefined[^?]*\?.*payload\.index[^:]*:.*payload\.index/s)
  })

  it('forwards correlationId, reasoning, routeOverride when supplied and preserves absence', async () => {
    const src = readChatSource()
    const retryBlock = src.slice(src.indexOf('async function retry'))
    expect(retryBlock).toMatch(/\.\.\.\(payload\.correlationId === undefined \? \{\} : \{ correlationId: payload\.correlationId \}\)/)
    expect(retryBlock).toMatch(/\.\.\.\(payload\.reasoning === undefined \? \{\} : \{ reasoning: payload\.reasoning \}\)/)
    expect(retryBlock).toMatch(/\.\.\.\(payload\.routeOverride === undefined \? \{\} : \{ routeOverride: payload\.routeOverride \}\)/)
  })

  it('uses retrySourceIndexFrom only for legacy index path, not after sourceMessageId', async () => {
    const src = readChatSource()
    expect(src).toMatch(/import \{ retrySourceIndexFrom \} from '\.\/chat\/retry-source'/)
    // sourceMessageId branch sets sourceIndex = found directly
    expect(src).toMatch(/sourceIndex = found/)
    // legacy branch uses helper
    expect(src).toMatch(/retrySourceIndexFrom\(currentMessages, payload\.index\)/)
  })

  it('legacy index-only behavior preserved when sourceMessageId absent', async () => {
    const src = readChatSource()
    const retryBlock = src.slice(src.indexOf('async function retry'))
    expect(retryBlock).toMatch(/else \{/)
    expect(retryBlock).toMatch(/retrySourceIndexFrom\(currentMessages, payload\.index\)/)
  })

  it('phase D2B11: ChatRetryPayload exposes an OPTIONAL attachment snapshot, and retry prefers it over source-derived attachments', () => {
    const src = readChatSource()
    expect(src).toMatch(/attachments\?: NonNullable<ChatSendPayload\['attachments'\]>/)
    const retryBlock = src.slice(src.indexOf('async function retry'))
    expect(retryBlock).toMatch(/payload\.attachments === undefined/)
    expect(retryBlock).toMatch(/cloneRetryAttachments\(payload\.attachments\)/)
    // content is derived BEFORE history is truncated
    const deriveAt = retryBlock.indexOf('retryContentFromUserMessage(sourceMessage)')
    const truncateAt = retryBlock.indexOf('chatSession.setSessionMessages(payload.sessionId, currentMessages.slice(0, sourceIndex))')
    expect(deriveAt).toBeGreaterThan(-1)
    expect(truncateAt).toBeGreaterThan(-1)
    expect(deriveAt).toBeLessThan(truncateAt)
    // the retry re-enters the ONE generic send path with the attachments
    expect(retryBlock).toMatch(/attachments: effectiveAttachments/)
    expect(retryBlock).toMatch(/return executeSettledSend\(\{/)
    // no second text-extraction implementation survives in the store
    expect(src).not.toMatch(/retryTextFrom/)
  })
})

describe('chat retry image fidelity (Phase 8.0D-10B-4D4C4-D2B11)', () => {
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
      if (providerId === 'fallback-provider')
        return fallbackProvider
      if (providerId === 'fallback-provider-2')
        return fallbackProvider2
      return provider
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

  it('5: a text-only retry is unchanged - no image parts are invented', async () => {
    streamOnce()
    seed([storedUser({ id: 'u1', text: 'plain question' })])
    const store = useChatStore()
    await store.retry({ sessionId: 'session-1', index: 1, sourceMessageId: 'u1' })
    expect(sentUserText()).toBe('plain question')
    expect(sentImageUrls()).toEqual([])
  })

  it('2 + 6: a generic retry with no supplied attachments reconstructs the source images', async () => {
    streamOnce()
    seed([storedUser({ id: 'u1', text: 'what is this', images: [['image/png', 'QUJD']] })])
    const store = useChatStore()
    await store.retry({ sessionId: 'session-1', index: 1, sourceMessageId: 'u1' })
    expect(sentImageUrls()).toEqual([storedImageUrl('image/png', 'QUJD')])
    expect(sentUserText()).toBe('what is this')
  })

  it('7: an image-only stored turn is retryable and keeps its image', async () => {
    streamOnce()
    seed([storedUser({ id: 'u1', text: '', images: [['image/webp', 'R0hJ']] })])
    const store = useChatStore()
    await expect(store.retry({ sessionId: 'session-1', index: 1, sourceMessageId: 'u1' })).resolves.toBeTruthy()
    expect(sentImageUrls()).toEqual([storedImageUrl('image/webp', 'R0hJ')])
  })

  it('8 + 9 + 10: multiple images keep order, exact data and exact MIME', async () => {
    streamOnce()
    const data = 'aGVsbG8gd29ybGQ=/+/QUJDREVGR0hpamts'
    seed([storedUser({
      id: 'u1',
      text: 'three pictures',
      images: [['image/png', data], ['image/jpeg', 'VFdP'], ['image/svg+xml', 'VEhSRUU']],
    })])
    const store = useChatStore()
    await store.retry({ sessionId: 'session-1', index: 1, sourceMessageId: 'u1' })
    expect(sentImageUrls()).toEqual([
      storedImageUrl('image/png', data),
      storedImageUrl('image/jpeg', 'VFdP'),
      storedImageUrl('image/svg+xml', 'VEhSRUU'),
    ])
  })

  it('3: an explicitly supplied snapshot takes precedence over source-derived attachments', async () => {
    streamOnce()
    seed([storedUser({ id: 'u1', text: 'original', images: [['image/png', 'T1JJR0lOQUw']] })])
    const store = useChatStore()
    await store.retry({
      sessionId: 'session-1',
      index: 1,
      sourceMessageId: 'u1',
      attachments: [{ type: 'image', data: 'QVVUSE9SSVRBVElWRQ', mimeType: 'image/gif' }],
    })
    expect(sentImageUrls()).toEqual([storedImageUrl('image/gif', 'QVVUSE9SSVRBVElWRQ')])
  })

  it('3b: a supplied EMPTY snapshot is authoritative - source images are not re-added', async () => {
    streamOnce()
    seed([storedUser({ id: 'u1', text: 'original', images: [['image/png', 'T1JJR0lOQUw']] })])
    const store = useChatStore()
    await store.retry({ sessionId: 'session-1', index: 1, sourceMessageId: 'u1', attachments: [] })
    expect(sentImageUrls()).toEqual([])
  })

  it('4: the supplied snapshot is copied, never retained by mutable alias', async () => {
    const caller = [{ type: 'image' as const, data: 'T1JJR0lOQUw', mimeType: 'image/png' }]
    // Mutate the caller's own array and object AFTER the store has taken its
    // snapshot but BEFORE the provider is reached.
    getChatProviderInstanceMock.mockImplementation(async () => {
      caller.push({ type: 'image', data: 'SU5KRUNURUQ', mimeType: 'image/png' })
      caller[0]!.data = 'T1ZFUldSSVRURU4'
      caller[0]!.mimeType = 'image/gif'
      return provider
    })
    llmStreamMock.mockImplementation(async (_m: string, _p: ChatProvider, _msgs: Message[], options: any) => {
      await options.onStreamEvent({ type: 'text-delta', text: 'ok' })
      await options.onStreamEvent({ type: 'finish', finishReason: 'stop' })
    })
    seed([storedUser({ id: 'u1', text: 'caption' })])
    const store = useChatStore()
    await store.retry({ sessionId: 'session-1', index: 1, sourceMessageId: 'u1', attachments: caller })
    expect(sentImageUrls()).toEqual([storedImageUrl('image/png', 'T1JJR0lOQUw')])
  })

  it('11 + 13: sourceMessageId resolves the CURRENT user by stable id, ignoring a stale numeric index', async () => {
    streamOnce()
    seed([
      storedUser({ id: 'u-a', text: 'first turn' }),
      storedUser({ id: 'u-b', text: 'second turn', images: [['image/png', 'QkJC']] }),
    ])
    const store = useChatStore()
    // index points at u-a, but the stable id names u-b: the id wins.
    await store.retry({ sessionId: 'session-1', index: 1, sourceMessageId: 'u-b' })
    expect(sentImageUrls()).toEqual([storedImageUrl('image/png', 'QkJC')])
    // the stale index pointed at 'first turn'; the stable id selected 'second turn'
    expect(sentUserText()).toBe('second turn')
  })

  it('12: a stale sourceMessageId fails safely and sends nothing', async () => {
    streamOnce()
    seed([storedUser({ id: 'u1', text: 'present', images: [['image/png', 'QUJD']] })])
    const store = useChatStore()
    await expect(store.retry({ sessionId: 'session-1', index: 1, sourceMessageId: 'deleted-id' }))
      .rejects
      .toThrow('Retry target has no retriable source message: stale sourceMessageId')
    expect(llmStreamMock).not.toHaveBeenCalled()
  })

  it('12b: a captured snapshot never authorizes a source that no longer exists', async () => {
    streamOnce()
    seed([storedUser({ id: 'u1', text: 'present' })])
    const store = useChatStore()
    await expect(store.retry({
      sessionId: 'session-1',
      index: 1,
      sourceMessageId: 'deleted-id',
      attachments: [{ type: 'image', data: 'Q0FQVFVSRUQ', mimeType: 'image/png' }],
    })).rejects.toThrow('stale sourceMessageId')
    expect(llmStreamMock).not.toHaveBeenCalled()
  })

  it('14 + 15: the legacy index path resolves a preceding USER and preserves its images without any Brain input', async () => {
    streamOnce()
    seed([
      storedUser({ text: 'id-less turn', images: [['image/png', 'SURMRVNT']] }),
      { role: 'assistant', content: 'reply', createdAt: 2, id: 'a1' },
    ])
    const store = useChatStore()
    // Clicked the assistant at index 2; no sourceMessageId at all.
    await store.retry({ sessionId: 'session-1', index: 2 })
    expect(sentImageUrls()).toEqual([storedImageUrl('image/png', 'SURMRVNT')])
    expect(sentUserText()).toBe('id-less turn')
  })

  it('15b: an id-less image-only turn is retryable through the legacy path', async () => {
    streamOnce()
    seed([storedUser({ text: '', images: [['image/jpeg', 'SURMRVNTT05MWQ']] })])
    const store = useChatStore()
    await store.retry({ sessionId: 'session-1', index: 1 })
    expect(sentImageUrls()).toEqual([storedImageUrl('image/jpeg', 'SURMRVNTT05MWQ')])
  })

  /**
   * The orchestrator records the outgoing tool references on the user message
   * it appends, so the stored turn shows exactly which tools the retry carried.
   */
  function appendedUserTools(): unknown {
    const appended = sessionMessages['session-1'].filter((message: any) => message.role === 'user')
    return appended[appended.length - 1]?.tools
  }

  it('19: tools fall back to the source message tools exactly as before', async () => {
    streamOnce()
    seed([storedUser({ id: 'u1', text: 'use a tool', tools: [{ name: 'search' }] })])
    const store = useChatStore()
    await store.retry({ sessionId: 'session-1', index: 1, sourceMessageId: 'u1' })
    expect(appendedUserTools()).toEqual([{ name: 'search' }])
  })

  it('19b: payload tools still take precedence over source message tools', async () => {
    streamOnce()
    seed([storedUser({ id: 'u1', text: 'use a tool', tools: [{ name: 'search' }] })])
    const store = useChatStore()
    await store.retry({ sessionId: 'session-1', index: 1, sourceMessageId: 'u1', tools: [{ name: 'weather' }] })
    expect(appendedUserTools()).toEqual([{ name: 'weather' }])
  })

  it('20: history is truncated only after the source content was derived', async () => {
    streamOnce()
    seed([
      storedUser({ id: 'u1', text: 'source turn', images: [['image/png', 'UVJD']] }),
      { role: 'assistant', content: 'reply', createdAt: 2, id: 'a1' },
    ])
    const store = useChatStore()
    await store.retry({ sessionId: 'session-1', index: 2, sourceMessageId: 'u1' })
    // The source turn is gone from history...
    expect(sessionMessages['session-1'].some((message: any) => message.id === 'u1')).toBe(false)
    expect(sessionMessages['session-1'].some((message: any) => message.id === 'a1')).toBe(false)
    // ...yet its image still reached the provider. That is only possible if the
    // content was read BEFORE the truncation: had truncation come first, the
    // source would have been absent and the retry would have thrown.
    expect(sentImageUrls()).toEqual([storedImageUrl('image/png', 'UVJD')])
    expect(sentUserText()).toBe('source turn')
  })

  it('39: every fallback attempt reuses the SAME payload, so attachments survive each attempt', async () => {
    // Attempt 0 fails; the fallback resolver picks another provider.
    llmStreamMock
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockImplementation(async (_m: string, _p: ChatProvider, _msgs: Message[], options: any) => {
        await options.onStreamEvent({ type: 'text-delta', text: 'ok' })
        await options.onStreamEvent({ type: 'finish', finishReason: 'stop' })
      })
    registerChatFallbackResolver(vi.fn(async () => ({ providerId: 'fallback-provider', modelId: 'fallback-model' })))
    seed([storedUser({
      id: 'u1',
      text: 'two pictures',
      images: [['image/png', 'T05F'], ['image/jpeg', 'VFdP']],
    })])
    const store = useChatStore()
    await store.retry({ sessionId: 'session-1', index: 1, sourceMessageId: 'u1' })

    expect(llmStreamMock).toHaveBeenCalledTimes(2)
    const expected = [storedImageUrl('image/png', 'T05F'), storedImageUrl('image/jpeg', 'VFdP')]
    expect(sentImageUrls(0)).toEqual(expected)
    expect(sentImageUrls(1)).toEqual(expected)
    expect(sentUserText(1)).toBe('two pictures')
    expect(sentUserContent(1)).toEqual([
      { type: 'text', text: expect.stringContaining('two pictures') },
      storedImagePart('image/png', 'T05F'),
      storedImagePart('image/jpeg', 'VFdP'),
    ])
  })

  it('a malformed stored image part fails the retry instead of degrading it to text-only', async () => {
    streamOnce()
    seed([{
      role: 'user' as const,
      content: [storedTextPart('caption'), { type: 'image_url' as const, image_url: { url: 'https://example.com/a.png' } }],
      createdAt: 1,
      id: 'u1',
    }])
    const store = useChatStore()
    await expect(store.retry({ sessionId: 'session-1', index: 1, sourceMessageId: 'u1' }))
      .rejects
      .toThrow(/cannot be losslessly reconstructed/)
    expect(llmStreamMock).not.toHaveBeenCalled()
  })

  it('a normal send and a retry of that same turn produce the same image parts', async () => {
    streamOnce()
    seed([])
    const store = useChatStore()
    const attachments = [{ type: 'image' as const, data: 'UUUQ', mimeType: 'image/png' }]
    await store.send({ sessionId: 'session-1', text: 'look', attachments } satisfies ChatSendPayload)
    const fromSend = sentImageUrls(0)

    const stored = sessionMessages['session-1'].find((m: any) => m.role === 'user')
    await store.retry({ sessionId: 'session-1', index: 1, sourceMessageId: stored.id } satisfies ChatRetryPayload)
    expect(sentImageUrls(1)).toEqual(fromSend)
  })
})
