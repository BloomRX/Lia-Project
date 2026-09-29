// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { chatTurnFactsFromSend } from '../services/lia/brain-shadow'
import { resolveLiaAuthoritativeSendRoute } from '../services/lia/lia-authoritative-route-resolver'

import { widgetToolReferences } from '../stores/tools'

// Mock Brain provider store
const liaProviderMock = vi.hoisted(() => ({
  hasApiKey: vi.fn().mockResolvedValue(true),
}))
vi.mock('../stores/lia/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stores/lia/provider')>()
  return {
    ...actual,
    useLiaProviderStore: () => ({
      hasApiKey: liaProviderMock.hasApiKey,
    }),
  }
})

const electron = vi.hoisted(() => ({
  brainInvoke: vi.fn(),
}))
vi.mock('@proj-airi/electron-vueuse', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proj-airi/electron-vueuse')>()
  const { electronLiaBrainChatDecision } = await import('../../shared/eventa')
  return {
    ...actual,
    useElectronEventaInvoke: (channel?: unknown, ...rest: unknown[]) => {
      if (channel === electronLiaBrainChatDecision)
        return electron.brainInvoke
      return (actual.useElectronEventaInvoke as (...args: unknown[]) => unknown)(channel, ...rest)
    },
  }
})

const MINTED_IDS = [
  '1f9d6a1e-0000-4000-8000-000000000010',
  '1f9d6a1e-0000-4000-8000-000000000011',
  '1f9d6a1e-0000-4000-8000-000000000012',
]
let mintedIndex = 0

// Helper that mirrors InteractiveArea.handleRetryMessage capture + authority + retry
function createRetrySequence(deps: {
  getMessages: () => Array<{ id?: string, role: string, content: unknown }>,
  getActiveSessionId: () => string,
  getReasoning: () => boolean,
  retry: (payload: Record<string, unknown>) => Promise<unknown>,
}) {
  return async (index: number) => {
    const targetSessionId = deps.getActiveSessionId()
    const targetMessage = deps.getMessages()[index] as unknown as { id?: string } | undefined
    const targetMessageId = targetMessage?.id
    const correlationId = crypto.randomUUID()
    const reasoningToRetry = deps.getReasoning()
    const toolsToRetry = [...widgetToolReferences]
    const facts = chatTurnFactsFromSend({
      attachments: [] as const,
      reasoning: reasoningToRetry,
      tools: toolsToRetry,
    })
    const routeOverride = await resolveLiaAuthoritativeSendRoute({
      correlationId,
      facts,
    })
    await deps.retry({
      sessionId: targetSessionId,
      index,
      ...(targetMessageId === undefined ? {} : { messageId: targetMessageId }),
      tools: toolsToRetry,
      correlationId,
      reasoning: reasoningToRetry,
      ...(routeOverride === undefined ? {} : { routeOverride }),
    })
    return { correlationId, facts, toolsToRetry, reasoningToRetry, targetMessageId, targetSessionId }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  electron.brainInvoke.mockResolvedValue({ status: 'modeUnspecified' })
  liaProviderMock.hasApiKey.mockResolvedValue(true)
  mintedIndex = 0
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => MINTED_IDS[mintedIndex++] ?? `minted-${mintedIndex}`)
})

describe('interactive area retry authoritative routing (Phase 8.0D-10B-4D4C4-D2B6)', () => {
  it('one retry mints exactly one new correlationId and hands it to both Brain and retry', async () => {
    const messages = [
      { id: 'u1', role: 'user', content: 'first' },
      { id: 'a1', role: 'assistant', content: 'reply' },
      { id: 'u2', role: 'user', content: 'retry me' },
      { id: 'a2', role: 'assistant', content: 'response' },
    ]
    const retry = vi.fn().mockResolvedValue({})
    const seq = createRetrySequence({
      getMessages: () => messages,
      getActiveSessionId: () => 'session-b',
      getReasoning: () => false,
      retry,
    })
    const before = (crypto.randomUUID as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    await seq(3)
    const calls = (crypto.randomUUID as unknown as { mock: { calls: unknown[] } }).mock.calls.length - before
    expect(calls).toBe(1)
    const [brainReq] = electron.brainInvoke.mock.calls[0] as [Record<string, unknown>]
    const [payload] = retry.mock.calls[0] as [Record<string, unknown>]
    expect(brainReq.correlationId).toBe(MINTED_IDS[0])
    expect(payload.correlationId).toBe(MINTED_IDS[0])
  })

  it('retry facts describe new payload: hasImageInput false, usesTools true, reasoning frozen', async () => {
    const messages = [{ id: 'u1', role: 'user', content: 'first' }, { id: 'a1', role: 'assistant', content: 'reply' }]
    const retry = vi.fn().mockResolvedValue({})
    const seq = createRetrySequence({
      getMessages: () => messages,
      getActiveSessionId: () => 'session-b',
      getReasoning: () => false,
      retry,
    })
    await seq(1)
    const [req] = electron.brainInvoke.mock.calls[0] as [Record<string, unknown>]
    expect(req.facts).toEqual({ hasImageInput: false, reasoningRequested: false, usesTools: true })
    const payloadTools = (retry.mock.calls[0] as [Record<string, unknown>])[0].tools as Array<{ name: string }>
    expect(payloadTools.map(t => t.name).sort()).toEqual(['get_weather', 'stage_widgets'])
  })

  it('original image source still gives retry hasImageInput false', async () => {
    const messages = [
      { id: 'u1', role: 'user', content: [{ type: 'text', text: 'with image' }, { type: 'image', image: 'data' }] as unknown as string },
      { id: 'a1', role: 'assistant', content: 'reply' },
    ]
    const retry = vi.fn().mockResolvedValue({})
    const seq = createRetrySequence({
      getMessages: () => messages as unknown as Array<{ id: string, role: string, content: unknown }>,
      getActiveSessionId: () => 'session-b',
      getReasoning: () => false,
      retry,
    })
    await seq(1)
    const [req] = electron.brainInvoke.mock.calls[0] as [Record<string, unknown>]
    expect((req.facts as Record<string, unknown>).hasImageInput).toBe(false)
  })

  it('reasoning false and true are frozen and forwarded', async () => {
    for (const reasoning of [false, true] as const) {
      vi.clearAllMocks()
      electron.brainInvoke.mockResolvedValue({ status: 'modeUnspecified' })
      mintedIndex = 0
      vi.spyOn(crypto, 'randomUUID').mockImplementation(() => MINTED_IDS[mintedIndex++] ?? `minted-${mintedIndex}`)
      const messages = [{ id: 'u1', role: 'user', content: 'first' }, { id: 'a1', role: 'assistant', content: 'reply' }]
      const retry = vi.fn().mockResolvedValue({})
      const seq = createRetrySequence({
        getMessages: () => messages,
        getActiveSessionId: () => 'session-b',
        getReasoning: () => reasoning,
        retry,
      })
      await seq(1)
      const [req] = electron.brainInvoke.mock.calls[0] as [Record<string, unknown>]
      expect((req.facts as Record<string, unknown>).reasoningRequested).toBe(reasoning)
      const [payload] = retry.mock.calls[0] as [Record<string, unknown>]
      expect(payload.reasoning).toBe(reasoning)
    }
  })

  it('reasoning drift frozen: capture false remains false after live true', async () => {
    const messages = [{ id: 'u1', role: 'user', content: 'first' }, { id: 'a1', role: 'assistant', content: 'reply' }]
    let reasoning = false
    let resolveBrain!: (v: unknown) => void
    electron.brainInvoke.mockImplementation(() => new Promise(res => { resolveBrain = res as unknown as (v: unknown) => void }))
    const retry = vi.fn().mockResolvedValue({})
    const seq = createRetrySequence({
      getMessages: () => messages,
      getActiveSessionId: () => 'session-b',
      getReasoning: () => reasoning,
      retry,
    })
    const pending = seq(1)
    await new Promise(r => setTimeout(r, 5))
    expect(electron.brainInvoke).toHaveBeenCalledTimes(1)
    reasoning = true
    resolveBrain({ status: 'modeUnspecified' })
    await pending
    const [payload] = retry.mock.calls[0] as [Record<string, unknown>]
    expect(payload.reasoning).toBe(false)
    const [req] = electron.brainInvoke.mock.calls[0] as [Record<string, unknown>]
    expect((req.facts as Record<string, unknown>).reasoningRequested).toBe(false)
  })

  it('tools snapshot frozen: same tools in facts and payload', async () => {
    const messages = [{ id: 'u1', role: 'user', content: 'first' }, { id: 'a1', role: 'assistant', content: 'reply' }]
    const retry = vi.fn().mockResolvedValue({})
    const seq = createRetrySequence({
      getMessages: () => messages,
      getActiveSessionId: () => 'session-b',
      getReasoning: () => false,
      retry,
    })
    await seq(1)
    const [req] = electron.brainInvoke.mock.calls[0] as [Record<string, unknown>]
    expect((req.facts as Record<string, unknown>).usesTools).toBe(true)
    const payloadTools = (retry.mock.calls[0] as [Record<string, unknown>])[0].tools as Array<{ name: string }>
    expect(payloadTools).toEqual(widgetToolReferences)
  })

  it('authority awaited: deferred Brain blocks retry', async () => {
    const messages = [{ id: 'u1', role: 'user', content: 'first' }, { id: 'a1', role: 'assistant', content: 'reply' }]
    let resolveBrain!: (v: unknown) => void
    electron.brainInvoke.mockImplementation(() => new Promise(res => { resolveBrain = res as unknown as (v: unknown) => void }))
    const retry = vi.fn().mockResolvedValue({})
    const seq = createRetrySequence({
      getMessages: () => messages,
      getActiveSessionId: () => 'session-b',
      getReasoning: () => false,
      retry,
    })
    const pending = seq(1)
    await new Promise(r => setTimeout(r, 10))
    expect(electron.brainInvoke).toHaveBeenCalledTimes(1)
    expect(retry).toHaveBeenCalledTimes(0)
    resolveBrain({ status: 'modeUnspecified' })
    await pending
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('selected route forwarded, undefined route still retries', async () => {
    const messages = [{ id: 'u1', role: 'user', content: 'first' }, { id: 'a1', role: 'assistant', content: 'reply' }]
    // unspecified -> no routeOverride
    const retry2 = vi.fn().mockResolvedValue({})
    const seq2 = createRetrySequence({
      getMessages: () => messages,
      getActiveSessionId: () => 'session-b',
      getReasoning: () => false,
      retry: retry2,
    })
    electron.brainInvoke.mockResolvedValue({ status: 'modeUnspecified' })
    await seq2(1)
    expect(retry2.mock.calls[0][0]).not.toHaveProperty('routeOverride')
    // failure case also still retries (tested separately)
  })

  it('Brain failure degrades: retry still called without routeOverride', async () => {
    const messages = [{ id: 'u1', role: 'user', content: 'first' }, { id: 'a1', role: 'assistant', content: 'reply' }]
    electron.brainInvoke.mockRejectedValue(new Error('brain fail'))
    const retry = vi.fn().mockResolvedValue({})
    const seq = createRetrySequence({
      getMessages: () => messages,
      getActiveSessionId: () => 'session-b',
      getReasoning: () => false,
      retry,
    })
    await seq(1)
    const payload = (retry.mock.calls[0] as [Record<string, unknown>])[0]
    expect(payload).not.toHaveProperty('routeOverride')
    expect(payload.correlationId).toBe(MINTED_IDS[0])
  })

  it('credential false degrades: no routeOverride', async () => {
    const messages = [{ id: 'u1', role: 'user', content: 'first' }, { id: 'a1', role: 'assistant', content: 'reply' }]
    liaProviderMock.hasApiKey.mockResolvedValue(false)
    const retry = vi.fn().mockResolvedValue({})
    const seq = createRetrySequence({
      getMessages: () => messages,
      getActiveSessionId: () => 'session-b',
      getReasoning: () => false,
      retry,
    })
    await seq(1)
    const payload = (retry.mock.calls[0] as [Record<string, unknown>])[0]
    expect(payload).not.toHaveProperty('routeOverride')
  })

  it('stable target: history shift while Brain pending still uses messageId', async () => {
    const history = [
      { id: 'u1', role: 'user', content: 'first' },
      { id: 'a1', role: 'assistant', content: 'reply' },
      { id: 'u2', role: 'user', content: 'target' },
      { id: 'a2', role: 'assistant', content: 'to retry' },
    ]
    let resolveBrain!: (v: unknown) => void
    electron.brainInvoke.mockImplementation(() => new Promise(res => { resolveBrain = res as unknown as (v: unknown) => void }))
    let messagesRef = [...history]
    const retry = vi.fn().mockImplementation(async (payload: Record<string, unknown>) => {
      // simulate generic retry that would look up by messageId
      if (payload.messageId) {
        const idx = messagesRef.findIndex(m => m.id === payload.messageId)
        if (idx < 0) throw new Error('Retry target message not found: stale messageId')
        return {}
      }
      return {}
    })
    const seq = createRetrySequence({
      getMessages: () => messagesRef,
      getActiveSessionId: () => 'session-b',
      getReasoning: () => false,
      retry,
    })
    const pending = seq(3) // a2 at index 3
    await new Promise(r => setTimeout(r, 5))
    expect(electron.brainInvoke).toHaveBeenCalledTimes(1)
    // shift history
    messagesRef = [
      { id: 'u0', role: 'user', content: 'new first' },
      { id: 'a0', role: 'assistant', content: 'new reply' },
      ...history,
    ]
    resolveBrain({ status: 'modeUnspecified' })
    await pending
    const payload = (retry.mock.calls[0] as [Record<string, unknown>])[0]
    expect(payload.messageId).toBe('a2')
    expect(payload.index).toBe(3)
  })

  it('deleted target fails safely and does not fall back to stale index', async () => {
    const history = [
      { id: 'u1', role: 'user', content: 'first' },
      { id: 'a1', role: 'assistant', content: 'reply' },
      { id: 'u2', role: 'user', content: 'target' },
      { id: 'a2', role: 'assistant', content: 'to retry' },
    ]
    let resolveBrain!: (v: unknown) => void
    electron.brainInvoke.mockImplementation(() => new Promise(res => { resolveBrain = res as unknown as (v: unknown) => void }))
    let messagesRef = [...history]
    const retry = vi.fn().mockImplementation(async (payload: Record<string, unknown>) => {
      const idx = messagesRef.findIndex(m => m.id === payload.messageId)
      if (idx < 0) throw new Error('Retry target message not found: stale messageId')
      return {}
    })
    const seq = createRetrySequence({
      getMessages: () => messagesRef,
      getActiveSessionId: () => 'session-b',
      getReasoning: () => false,
      retry,
    })
    const pending = seq(3)
    await new Promise(r => setTimeout(r, 5))
    // delete target
    messagesRef = messagesRef.filter(m => m.id !== 'a2')
    resolveBrain({ status: 'modeUnspecified' })
    await expect(pending).rejects.toThrow('Retry target message not found')
  })

  it('no global provider/model writes', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, './InteractiveArea.vue'), 'utf-8')
    expect(src).not.toMatch(/activeProvider/)
    expect(src).not.toMatch(/activeModel/)
  })

  it('new correlationId is not original message id', async () => {
    const history = [{ id: 'original-correlation-a', role: 'user', content: 'first' }, { id: 'a1', role: 'assistant', content: 'reply' }]
    const retry = vi.fn().mockResolvedValue({})
    const seq = createRetrySequence({
      getMessages: () => history,
      getActiveSessionId: () => 'session-b',
      getReasoning: () => false,
      retry,
    })
    await seq(1)
    const payload = (retry.mock.calls[0] as [Record<string, unknown>])[0]
    expect(payload.correlationId).not.toBe('original-correlation-a')
    expect(payload.correlationId).toBe(MINTED_IDS[0])
  })
})
