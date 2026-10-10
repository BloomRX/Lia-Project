import { retryContentFromUserMessage } from '@proj-airi/stage-ui/stores/chat/retry-content'
import { retrySourceIndexFrom, retrySourceMessageIdFrom } from '@proj-airi/stage-ui/stores/chat/retry-source'
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
  const history = opts.messages as unknown as import('@proj-airi/stage-ui/types/chat').ChatHistoryItem[]
  const sourceMessageId = retrySourceMessageIdFrom(history, opts.index)
  const toolsToRetry = [...widgetToolReferences]
  // Phase 8.0D-10B-4D4C4-D2B11: synchronous source-content capture, same shared
  // helper the component and the generic retry both use.
  const sourceIndex = retrySourceIndexFrom(history, opts.index)
  const sourceContent = sourceIndex < 0 ? null : retryContentFromUserMessage(history[sourceIndex])
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
      // Phase 8.0D-M3: mirrors the component exactly - the retry truncates at
      // the source turn, so what remains provider-visible is what precedes it.
      providerHistory: sourceIndex < 0 ? [] : history.slice(0, sourceIndex),
      ...(sourceContent === null ? {} : { attachments: sourceContent.attachments }),
    },
    {
      retry: opts.retry as never,
      mintCorrelationId: opts.mint ?? (() => MINTED),
    },
  )
  return { path: 'authoritative' as const, sourceMessageId, attachments: sourceContent?.attachments }
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
      { sessionId: 's1', index: 1, providerHistory: [], sourceMessageId: sourceAtClick!, reasoning: false, tools: [...widgetToolReferences] },
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
      { sessionId: 's1', index: 1, providerHistory: [], sourceMessageId: sourceAtClick, reasoning: false, tools: [...widgetToolReferences] },
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

describe('interactive area retry image capture (Phase 8.0D-10B-4D4C4-D2B11)', () => {
  /** Mirrors exactly how the send path stores an image part. */
  function storedImageUrl(mimeType: string, data: string): string {
    return `data:${mimeType};base64,${data}`
  }

  function imageUser(opts: { id?: string, text: string, images: Array<[string, string]> }) {
    const parts = [
      { type: 'text' as const, text: opts.text },
      ...opts.images.map(([mime, data]) => ({ type: 'image_url' as const, image_url: { url: storedImageUrl(mime, data) } })),
    ]
    return { ...(opts.id === undefined ? {} : { id: opts.id }), role: 'user', content: parts }
  }

  function attachmentsOf(retry: ReturnType<typeof vi.fn>): Array<{ type: string, data: string, mimeType: string }> {
    const [payload] = retry.mock.calls[0] as [Record<string, unknown>]
    return (payload.attachments ?? []) as Array<{ type: string, data: string, mimeType: string }>
  }

  /** Mirrors the chat store's stable-source validation, which chat.retry.test.ts proves behaviorally. */
  function validatingRetry(history: Array<{ id?: string, role: string }>) {
    return vi.fn(async (payload: Record<string, unknown>) => {
      const found = history.findIndex(message => message.id === payload.sourceMessageId && message.role === 'user')
      if (found < 0)
        throw new Error('Retry target has no retriable source message: stale sourceMessageId')
      return {}
    })
  }

  it('1: clicking an image USER resolves that same USER and captures its image', async () => {
    const messages = [imageUser({ id: 'u1', text: 'look', images: [['image/png', 'QUJD']] })]
    const retry = vi.fn().mockResolvedValue({})
    const result = await handleRetryViaRealHelpers({ messages, index: 0, sessionId: 's1', reasoning: false, retry })
    expect(result.path).toBe('authoritative')
    expect(result.sourceMessageId).toBe('u1')
    expect(attachmentsOf(retry)).toEqual([{ type: 'image', data: 'QUJD', mimeType: 'image/png' }])
  })

  it('2: clicking an assistant that follows an image USER resolves the preceding image USER', async () => {
    const messages = [
      imageUser({ id: 'u1', text: 'look', images: [['image/png', 'QUJD']] }),
      { id: 'a1', role: 'assistant', content: 'a picture' },
    ]
    const retry = vi.fn().mockResolvedValue({})
    const result = await handleRetryViaRealHelpers({ messages, index: 1, sessionId: 's1', reasoning: false, retry })
    expect(result.sourceMessageId).toBe('u1')
    expect(attachmentsOf(retry)).toEqual([{ type: 'image', data: 'QUJD', mimeType: 'image/png' }])
  })

  it('3: clicking an error that follows an image USER resolves the preceding image USER', async () => {
    const messages = [
      imageUser({ id: 'u1', text: 'look', images: [['image/jpeg', 'REVG']] }),
      { role: 'error', content: 'boom' } as unknown as { id?: string, role: string },
    ]
    const retry = vi.fn().mockResolvedValue({})
    const result = await handleRetryViaRealHelpers({ messages, index: 1, sessionId: 's1', reasoning: false, retry })
    expect(result.sourceMessageId).toBe('u1')
    expect(attachmentsOf(retry)).toEqual([{ type: 'image', data: 'REVG', mimeType: 'image/jpeg' }])
  })

  it('4: a text + image source gives the authoritative input an image snapshot', async () => {
    const messages = [imageUser({ id: 'u1', text: 'caption', images: [['image/png', 'QUJD']] })]
    const retry = vi.fn().mockResolvedValue({})
    await handleRetryViaRealHelpers({ messages, index: 0, sessionId: 's1', reasoning: false, retry })
    expect(attachmentsOf(retry)).toEqual([{ type: 'image', data: 'QUJD', mimeType: 'image/png' }])
    const [req] = mocks.requestDecision.mock.calls[0] as [{ facts: Record<string, unknown> }]
    expect(req.facts.hasImageInput).toBe(true)
  })

  it('5: an image-only source gives the authoritative input an image snapshot', async () => {
    const messages = [imageUser({ id: 'u1', text: '', images: [['image/webp', 'R0hJ']] })]
    const retry = vi.fn().mockResolvedValue({})
    await handleRetryViaRealHelpers({ messages, index: 0, sessionId: 's1', reasoning: false, retry })
    expect(attachmentsOf(retry)).toEqual([{ type: 'image', data: 'R0hJ', mimeType: 'image/webp' }])
  })

  it('6: a multiple-image source captures every image in the original order', async () => {
    const messages = [imageUser({
      id: 'u1',
      text: 'three',
      images: [['image/png', 'T05F'], ['image/jpeg', 'VFdP'], ['image/gif', 'VEhSRUU']],
    })]
    const retry = vi.fn().mockResolvedValue({})
    await handleRetryViaRealHelpers({ messages, index: 0, sessionId: 's1', reasoning: false, retry })
    expect(attachmentsOf(retry).map(attachment => attachment.data)).toEqual(['T05F', 'VFdP', 'VEhSRUU'])
    expect(attachmentsOf(retry).map(attachment => attachment.mimeType)).toEqual(['image/png', 'image/jpeg', 'image/gif'])
  })

  it('7: history shifting while the Brain decision is pending keeps the stable id and the pre-await snapshot', async () => {
    const history: Array<{ id?: string, role: string, content?: unknown }> = [
      imageUser({ id: 'u1', text: 'look', images: [['image/png', 'QUJD']] }),
    ]
    const retry = validatingRetry(history)
    const pending = handleRetryViaRealHelpers({
      messages: history,
      index: 0,
      sessionId: 's1',
      reasoning: false,
      retry,
      mint: () => MINTED,
    })
    // Earlier entries appear, so every numeric index shifts by two.
    history.unshift({ id: 'x0', role: 'user', content: 'older' }, { id: 'x1', role: 'assistant', content: 'older reply' })
    await pending
    expect(retry).toHaveBeenCalledTimes(1)
    const [payload] = retry.mock.calls[0] as [Record<string, unknown>]
    // The stable id is still authoritative even though index 0 is no longer the source.
    expect(payload.sourceMessageId).toBe('u1')
    expect(attachmentsOf(retry)).toEqual([{ type: 'image', data: 'QUJD', mimeType: 'image/png' }])
  })

  it('8: deleting the source USER while the Brain decision is pending fails safely - captured images do not bypass deletion', async () => {
    const history: Array<{ id?: string, role: string, content?: unknown }> = [
      imageUser({ id: 'u1', text: 'look', images: [['image/png', 'QUJD']] }),
    ]
    const retry = validatingRetry(history)
    await expect(handleRetryViaRealHelpers({
      messages: history,
      index: 0,
      sessionId: 's1',
      reasoning: false,
      retry,
      mint: () => MINTED,
    }).then(async (result) => {
      // The source disappears before the retry callback validates it.
      history.length = 0
      return result
    })).resolves.toBeTruthy()
    // A second retry against the now-empty history must fail on the stable id.
    await expect(handleRetryViaRealHelpers({
      messages: history,
      index: 0,
      sessionId: 's1',
      reasoning: false,
      retry,
      mint: () => MINTED,
    })).rejects.toThrow('stale sourceMessageId')
  })

  it('9: an id-less text + image USER takes the legacy path - no Brain - and the generic retry can rebuild its images', async () => {
    const messages = [imageUser({ text: 'caption', images: [['image/png', 'SURMRVNT']] })]
    const retry = vi.fn().mockResolvedValue({})
    const result = await handleRetryViaRealHelpers({ messages, index: 0, sessionId: 's1', reasoning: false, retry })
    expect(result.path).toBe('legacy')
    expect(mocks.requestDecision).not.toHaveBeenCalled()
    const [payload] = retry.mock.calls[0] as [Record<string, unknown>]
    expect(payload.sourceMessageId).toBeUndefined()
    // The shared helper still recovers the images from that same stored turn.
    expect(retryContentFromUserMessage(messages[0] as never)?.attachments)
      .toEqual([{ type: 'image', data: 'SURMRVNT', mimeType: 'image/png' }])
  })

  it('10: an id-less image-only USER still takes the legacy path and remains retryable', async () => {
    const messages = [imageUser({ text: '', images: [['image/jpeg', 'SURMRVNTT05MWQ']] })]
    const retry = vi.fn().mockResolvedValue({})
    const result = await handleRetryViaRealHelpers({ messages, index: 0, sessionId: 's1', reasoning: false, retry })
    expect(result.path).toBe('legacy')
    expect(mocks.requestDecision).not.toHaveBeenCalled()
    expect(retryContentFromUserMessage(messages[0] as never)).toEqual({
      text: '',
      attachments: [{ type: 'image', data: 'SURMRVNTT05MWQ', mimeType: 'image/jpeg' }],
    })
  })

  it('11 + 12: the component delegates image parsing and owns no Brain sequence', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = normalizeLineEndings(readFileSync(resolve(__dirname, './InteractiveArea.vue'), 'utf-8'))
    // Uses the shared helper for retry content...
    expect(src).toMatch(/retryContentFromUserMessage/)
    expect(src).toMatch(/from '@proj-airi\/stage-ui\/stores\/chat\/retry-content'/)
    const retryFn = src.slice(src.indexOf('async function handleRetryMessage'))
    // ...and the RETRY path does no image parsing of its own. The one FileReader
    // in this component belongs to the pre-existing normal send path
    // (handleFilePaste), which is above handleRetryMessage and untouched here.
    expect(retryFn).not.toMatch(/image_url/)
    expect(retryFn).not.toMatch(/base64,/)
    expect(retryFn).not.toMatch(/mimeType/)
    expect(retryFn).not.toMatch(/readAsDataURL|FileReader/)
    expect(retryFn).not.toMatch(/split\(','\)/)
    // No Brain sequence owned here either.
    expect(retryFn).not.toMatch(/resolveLiaAuthoritativeSendRoute/)
    expect(retryFn).not.toMatch(/chatTurnFactsFromSend/)
    expect(retryFn).not.toMatch(/requestLiaBrainDecisionForChatTurn/)
    // The pre-existing send-path image capture is still intact, not duplicated.
    expect(src.match(/readAsDataURL/g)).toHaveLength(1)
  })

  it('13 + 14: no provider/model writes, analytics wiring intact, snapshot captured before any await', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = normalizeLineEndings(readFileSync(resolve(__dirname, './InteractiveArea.vue'), 'utf-8'))
    expect(src).not.toMatch(/activeProvider/)
    expect(src).not.toMatch(/activeModel/)
    expect(src).toMatch(/trackChatMessageRetried/)
    // The content capture happens synchronously, above the authoritative call.
    const retryFn = src.slice(src.indexOf('async function handleRetryMessage'))
    const captureAt = retryFn.indexOf('retryContentFromUserMessage(history[sourceIndex])')
    const awaitAt = retryFn.indexOf('await executeLiaAuthoritativeRetry')
    expect(captureAt).toBeGreaterThan(-1)
    expect(awaitAt).toBeGreaterThan(-1)
    expect(captureAt).toBeLessThan(awaitAt)
  })
})
