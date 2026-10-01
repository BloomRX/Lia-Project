import { retrySourceMessageIdFrom } from '@proj-airi/stage-ui/stores/chat/retry-source'
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeLineEndings } from '../../test-helpers'
import { executeLiaAuthoritativeRetry } from '../services/lia/lia-authoritative-retry'
import { widgetToolReferences } from '../stores/tools'

const mocks = vi.hoisted(() => ({
  requestDecision: vi.fn(),
  hasApiKey: vi.fn(),
}))

vi.mock('../services/lia/brain-shadow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/lia/brain-shadow')>()
  return {
    ...actual,
    requestLiaBrainDecisionForChatTurn: mocks.requestDecision,
  }
})

vi.mock('../stores/lia/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stores/lia/provider')>()
  return {
    ...actual,
    useLiaProviderStore: () => ({
      hasApiKey: mocks.hasApiKey,
    }),
  }
})

const MINTED = '1f9d6a1e-0000-4000-8000-000000000020'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requestDecision.mockResolvedValue({ status: 'modeUnspecified' })
  mocks.hasApiKey.mockResolvedValue(true)
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(MINTED)
})

// Simulates InteractiveArea thin owner logic using REAL helpers — not a replica of Brain sequence
async function handleRetryViaRealHelpers(opts: {
  messages: Array<{ id?: string, role: string, content?: unknown }>
  index: number
  sessionId: string
  reasoning: boolean
  retry: (payload: Record<string, unknown>) => Promise<unknown>
  mint?: () => string
}) {
  const sourceMessageId = retrySourceMessageIdFrom(opts.messages as unknown as import('@proj-airi/stage-ui/types/chat').ChatHistoryItem[], opts.index)
  const toolsToRetry = [...widgetToolReferences]
  if (sourceMessageId === undefined) {
    await opts.retry({
      sessionId: opts.sessionId,
      index: opts.index,
      tools: toolsToRetry,
    })
    return { path: 'legacy' as const, sourceMessageId }
  }
  await executeLiaAuthoritativeRetry(
    {
      sessionId: opts.sessionId,
      index: opts.index,
      sourceMessageId,
      reasoning: opts.reasoning,
      tools: toolsToRetry,
    },
    {
      retry: opts.retry as never,
      mintCorrelationId: opts.mint ?? (() => MINTED),
    },
  )
  return { path: 'authoritative' as const, sourceMessageId }
}

describe('interactive area retry thin owner (Phase 8.0D-10B-4D4C4-D2B6 corrective)', () => {
  it('clicked user → authoritative with same user id', async () => {
    const messages = [{ id: 'u1', role: 'user', content: 'hi' }, { id: 'a1', role: 'assistant', content: 'reply' }]
    const retry = vi.fn().mockResolvedValue({})
    const result = await handleRetryViaRealHelpers({ messages, index: 0, sessionId: 's1', reasoning: false, retry })
    expect(result.path).toBe('authoritative')
    expect(result.sourceMessageId).toBe('u1')
    const [payload] = retry.mock.calls[0] as [Record<string, unknown>]
    expect(payload.sourceMessageId).toBe('u1')
  })

  it('clicked assistant → preceding user', async () => {
    const messages = [{ id: 'u1', role: 'user', content: 'hi' }, { id: 'a1', role: 'assistant', content: 'reply' }]
    const retry = vi.fn().mockResolvedValue({})
    const result = await handleRetryViaRealHelpers({ messages, index: 1, sessionId: 's1', reasoning: false, retry })
    expect(result.sourceMessageId).toBe('u1')
    expect(retry.mock.calls[0][0]).toHaveProperty('sourceMessageId', 'u1')
  })

  it('clicked error WITHOUT id → preceding user u1 (core corrective)', async () => {
    const messages = [{ id: 'u1', role: 'user', content: 'hi' }, { role: 'error', content: 'boom' } as unknown as { id?: string, role: string }]
    const retry = vi.fn().mockResolvedValue({})
    const result = await handleRetryViaRealHelpers({ messages, index: 1, sessionId: 's1', reasoning: false, retry })
    expect(result.sourceMessageId).toBe('u1')
    expect(result.path).toBe('authoritative')
  })

  it('eRROR-BUBBLE RACE: capture before shift, shift history while Brain pending, still uses u1', async () => {
    let resolveBrain!: (v: unknown) => void
    mocks.requestDecision.mockImplementation(
      () => new Promise((res) => {
        resolveBrain = res as unknown as (v: unknown) => void
      }),
    )
    const history = [{ id: 'u1', role: 'user', content: 'first' }, { role: 'error', content: 'boom' } as unknown as { id?: string, role: string }]
    let messagesRef = [...history]
    // Simulate capturer that would have run at click time before Brain await
    const sourceAtClick = retrySourceMessageIdFrom(messagesRef as unknown as import('@proj-airi/stage-ui/types/chat').ChatHistoryItem[], 1)
    expect(sourceAtClick).toBe('u1')
    const retry = vi.fn().mockImplementation(async (payload: Record<string, unknown>) => {
      // chatStore-like lookup by sourceMessageId
      const idx = messagesRef.findIndex(m => (m as { id?: string }).id === payload.sourceMessageId && m.role === 'user')
      if (idx < 0)
        throw new Error('Retry target has no retriable source message: stale sourceMessageId')
      return {}
    })
    const pending = executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 1, sourceMessageId: sourceAtClick!, reasoning: false, tools: [...widgetToolReferences] },
      { retry: retry as never, mintCorrelationId: () => MINTED },
    )
    await new Promise(r => setTimeout(r, 5))
    expect(mocks.requestDecision).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()
    // shift history by adding earlier messages
    messagesRef = [{ id: 'u0', role: 'user', content: 'new' }, { id: 'a0', role: 'assistant', content: 'new' }, ...history]
    resolveBrain({ status: 'modeUnspecified' })
    await pending
    const [payload] = retry.mock.calls[0] as [Record<string, unknown>]
    expect(payload.sourceMessageId).toBe('u1')
    expect(payload.index).toBe(1) // original clicked index, stale index irrelevant for source lookup
  })

  it('eRROR-BUBBLE DELETION: remove u1 while Brain pending → fails safely without fallback to stale index', async () => {
    let resolveBrain!: (v: unknown) => void
    mocks.requestDecision.mockImplementation(
      () => new Promise((res) => {
        resolveBrain = res as unknown as (v: unknown) => void
      }),
    )
    const history = [{ id: 'u1', role: 'user', content: 'first' }, { role: 'error', content: 'boom' } as unknown as { id?: string, role: string }]
    let messagesRef = [...history]
    const sourceAtClick = retrySourceMessageIdFrom(messagesRef as unknown as import('@proj-airi/stage-ui/types/chat').ChatHistoryItem[], 1)!
    const retry = vi.fn().mockImplementation(async (payload: Record<string, unknown>) => {
      const idx = messagesRef.findIndex(m => (m as { id?: string }).id === payload.sourceMessageId && m.role === 'user')
      if (idx < 0)
        throw new Error('Retry target has no retriable source message: stale sourceMessageId')
      return {}
    })
    const pending = executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 1, sourceMessageId: sourceAtClick, reasoning: false, tools: [...widgetToolReferences] },
      { retry: retry as never, mintCorrelationId: () => MINTED },
    )
    await new Promise(r => setTimeout(r, 5))
    // delete u1
    messagesRef = messagesRef.filter(m => m.id !== 'u1')
    resolveBrain({ status: 'modeUnspecified' })
    await expect(pending).rejects.toThrow('stale sourceMessageId')
    // ensure retry was attempted but threw, not silently retried stale index
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('lEGACY ID-LESS USER: source user itself has no ID → immediate legacy path, no Brain', async () => {
    const messages = [{ role: 'user', content: 'legacy' } as unknown as { id?: string, role: string }, { role: 'error', content: 'boom' } as unknown as { id?: string, role: string }]
    const retry = vi.fn().mockResolvedValue({})
    const result = await handleRetryViaRealHelpers({ messages: messages as Array<{ id?: string, role: string }>, index: 1, sessionId: 's1', reasoning: false, retry })
    expect(result.path).toBe('legacy')
    expect(mocks.requestDecision).not.toHaveBeenCalled()
    expect(retry).toHaveBeenCalledTimes(1)
    const [payload] = retry.mock.calls[0] as [Record<string, unknown>]
    expect(payload).not.toHaveProperty('sourceMessageId')
    expect(payload).not.toHaveProperty('correlationId')
    expect(payload.index).toBe(1)
  })

  it('clicked user without id → legacy path', async () => {
    const messages = [{ role: 'user', content: 'no id' } as unknown as { id?: string, role: string }]
    const retry = vi.fn().mockResolvedValue({})
    const result = await handleRetryViaRealHelpers({ messages: messages as Array<{ id?: string, role: string }>, index: 0, sessionId: 's1', reasoning: false, retry })
    expect(result.path).toBe('legacy')
    expect(mocks.requestDecision).not.toHaveBeenCalled()
  })

  it('stable source survives index shift: captured u1 before shift still used after shift', async () => {
    const history = [{ id: 'u1', role: 'user', content: 'first' }, { id: 'a1', role: 'assistant', content: 'reply' }, { id: 'u2', role: 'user', content: 'second' }, { id: 'a2', role: 'assistant', content: 'reply2' }]
    const source = retrySourceMessageIdFrom(history as unknown as import('@proj-airi/stage-ui/types/chat').ChatHistoryItem[], 3)
    expect(source).toBe('u2')
    // shift
    const shifted = [{ id: 'u0', role: 'user', content: 'new' }, ...history]
    // source still u2, even though its index moved from 2 to 3
    const found = shifted.findIndex(m => m.id === source && m.role === 'user')
    expect(found).toBe(3)
  })

  it('no global provider/model writes in InteractiveArea', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = normalizeLineEndings(readFileSync(resolve(__dirname, './InteractiveArea.vue'), 'utf-8'))
    expect(src).not.toMatch(/activeProvider/)
    expect(src).not.toMatch(/activeModel/)
    expect(src).toMatch(/retrySourceMessageIdFrom/)
    expect(src).toMatch(/executeLiaAuthoritativeRetry/)
  })

  it('does not contain duplicate Brain sequence (no direct requestLiaBrainDecisionForChatTurn nor chatTurnFactsFromSend in retry)', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = normalizeLineEndings(readFileSync(resolve(__dirname, './InteractiveArea.vue'), 'utf-8'))
    const retryFn = src.slice(src.indexOf('async function handleRetryMessage'))
    // Should not directly call resolver or build facts in retry; helper owns it
    expect(retryFn).not.toMatch(/resolveLiaAuthoritativeSendRoute/)
    expect(retryFn).not.toMatch(/chatTurnFactsFromSend/)
    // Should not mint directly in retry path
    expect(retryFn).not.toMatch(/crypto\.randomUUID/)
  })

  it('preserves retry analytics wiring', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = normalizeLineEndings(readFileSync(resolve(__dirname, './InteractiveArea.vue'), 'utf-8'))
    expect(src).toMatch(/trackChatMessageRetried/)
  })
})
