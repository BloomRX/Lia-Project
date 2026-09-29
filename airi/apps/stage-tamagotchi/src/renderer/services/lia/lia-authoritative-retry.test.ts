// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { groqBrainDescriptors } from '@lia/core'

import { widgetToolReferences } from '../../stores/tools'

import { executeLiaAuthoritativeRetry } from './lia-authoritative-retry'

const mocks = vi.hoisted(() => ({
  requestDecision: vi.fn(),
  hasApiKey: vi.fn(),
}))

vi.mock('./brain-shadow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./brain-shadow')>()
  return {
    ...actual,
    requestLiaBrainDecisionForChatTurn: mocks.requestDecision,
  }
})

vi.mock('../../stores/lia/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/lia/provider')>()
  return {
    ...actual,
    useLiaProviderStore: () => ({
      hasApiKey: mocks.hasApiKey,
    }),
  }
})

function makeAutomaticSelected() {
  const { engines, models } = groqBrainDescriptors()
  return {
    status: 'automatic' as const,
    selection: {
      status: 'selected' as const,
      route: { engine: engines[0]!, model: models[0]! },
    },
  }
}

const MINTED = '1f9d6a1e-0000-4000-8000-000000000099'
let mintedIndex = 0
const MINTED_IDS = [MINTED, '1f9d6a1e-0000-4000-8000-000000000100']

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requestDecision.mockResolvedValue(makeAutomaticSelected())
  mocks.hasApiKey.mockResolvedValue(true)
  mintedIndex = 0
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => MINTED_IDS[mintedIndex++] ?? `minted-${mintedIndex}`)
})

describe('lia authoritative retry (Phase 8.0D-10B-4D4C4-D2B6 corrective)', () => {
  it('exactly one correlationId and same for Brain and retry', async () => {
    const retry = vi.fn().mockResolvedValue({})
    const mint = vi.fn(() => MINTED)
    await executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 1, sourceMessageId: 'u1', reasoning: false, tools: [...widgetToolReferences] },
      { retry, mintCorrelationId: mint },
    )
    expect(mint).toHaveBeenCalledTimes(1)
    expect(mocks.requestDecision).toHaveBeenCalledTimes(1)
    const [req] = mocks.requestDecision.mock.calls[0] as [{ correlationId: string, facts: unknown }]
    expect(req.correlationId).toBe(MINTED)
    const [payload] = retry.mock.calls[0] as [Record<string, unknown>]
    expect(payload.correlationId).toBe(MINTED)
  })

  it('facts: hasImageInput=false, usesTools=true, reasoningRequested exact', async () => {
    const retry = vi.fn().mockResolvedValue({})
    await executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 1, sourceMessageId: 'u1', reasoning: false, tools: [...widgetToolReferences] },
      { retry, mintCorrelationId: () => MINTED },
    )
    const [req] = mocks.requestDecision.mock.calls[0] as [{ facts: Record<string, unknown> }]
    expect(req.facts).toEqual({ hasImageInput: false, reasoningRequested: false, usesTools: true })
    // reasoning true variant
    vi.clearAllMocks()
    mocks.requestDecision.mockResolvedValue(makeAutomaticSelected())
    await executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 1, sourceMessageId: 'u1', reasoning: true, tools: [...widgetToolReferences] },
      { retry: vi.fn().mockResolvedValue({}), mintCorrelationId: () => MINTED },
    )
    const [req2] = mocks.requestDecision.mock.calls[0] as [{ facts: Record<string, unknown> }]
    expect(req2.facts.reasoningRequested).toBe(true)
  })

  it('reasoning frozen false and true forwarded to retry', async () => {
    for (const reasoning of [false, true] as const) {
      vi.clearAllMocks()
      mocks.requestDecision.mockResolvedValue(makeAutomaticSelected())
      const retry = vi.fn().mockResolvedValue({})
      await executeLiaAuthoritativeRetry(
        { sessionId: 's1', index: 2, sourceMessageId: 'u2', reasoning, tools: [...widgetToolReferences] },
        { retry, mintCorrelationId: () => MINTED },
      )
      const [payload] = retry.mock.calls[0] as [Record<string, unknown>]
      expect(payload.reasoning).toBe(reasoning)
    }
  })

  it('authority awaited: deferred Brain blocks retry', async () => {
    let resolveBrain!: (v: unknown) => void
    mocks.requestDecision.mockImplementation(() => new Promise(res => { resolveBrain = res as unknown as (v: unknown) => void }))
    const retry = vi.fn().mockResolvedValue({})
    const pending = executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 1, sourceMessageId: 'u1', reasoning: false, tools: [...widgetToolReferences] },
      { retry, mintCorrelationId: () => MINTED },
    )
    await new Promise(r => setTimeout(r, 10))
    expect(mocks.requestDecision).toHaveBeenCalledTimes(1)
    expect(retry).toHaveBeenCalledTimes(0)
    resolveBrain(makeAutomaticSelected())
    await pending
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('actual selected route forwarded exactly', async () => {
    const retry = vi.fn().mockResolvedValue({})
    mocks.requestDecision.mockResolvedValue(makeAutomaticSelected())
    await executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 1, sourceMessageId: 'u1', reasoning: false, tools: [...widgetToolReferences] },
      { retry, mintCorrelationId: () => MINTED },
    )
    const [payload] = retry.mock.calls[0] as [Record<string, unknown>]
    expect(payload.routeOverride).toEqual({ providerId: 'groq', modelId: 'openai/gpt-oss-120b' })
    expect(Object.keys(payload.routeOverride as object).sort()).toEqual(['modelId', 'providerId'])
  })

  it('undefined/non-routable route omitted but retry still happens', async () => {
    mocks.requestDecision.mockResolvedValue({ status: 'modeUnspecified' })
    const retry = vi.fn().mockResolvedValue({})
    await executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 1, sourceMessageId: 'u1', reasoning: false, tools: [...widgetToolReferences] },
      { retry, mintCorrelationId: () => MINTED },
    )
    const [payload] = retry.mock.calls[0] as [Record<string, unknown>]
    expect(payload).not.toHaveProperty('routeOverride')
    expect(payload.correlationId).toBe(MINTED)
  })

  it('Brain failure degrades: retry still called without routeOverride', async () => {
    mocks.requestDecision.mockRejectedValue(new Error('brain fail'))
    const retry = vi.fn().mockResolvedValue({})
    await executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 1, sourceMessageId: 'u1', reasoning: false, tools: [...widgetToolReferences] },
      { retry, mintCorrelationId: () => MINTED },
    )
    const [payload] = retry.mock.calls[0] as [Record<string, unknown>]
    expect(payload).not.toHaveProperty('routeOverride')
    expect(payload.correlationId).toBe(MINTED)
  })

  it('credential false degrades: routable candidate but hasApiKey false → no routeOverride and hasApiKey called with providerId', async () => {
    mocks.requestDecision.mockResolvedValue(makeAutomaticSelected())
    mocks.hasApiKey.mockResolvedValue(false)
    const retry = vi.fn().mockResolvedValue({})
    await executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 1, sourceMessageId: 'u1', reasoning: false, tools: [...widgetToolReferences] },
      { retry, mintCorrelationId: () => MINTED },
    )
    const [payload] = retry.mock.calls[0] as [Record<string, unknown>]
    expect(payload).not.toHaveProperty('routeOverride')
    expect(mocks.hasApiKey).toHaveBeenCalledTimes(1)
    expect(mocks.hasApiKey).toHaveBeenCalledWith('groq')
  })

  it('tools snapshot frozen: same tools in facts and payload', async () => {
    const tools = [...widgetToolReferences]
    const retry = vi.fn().mockResolvedValue({})
    await executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 1, sourceMessageId: 'u1', reasoning: false, tools },
      { retry, mintCorrelationId: () => MINTED },
    )
    const [req] = mocks.requestDecision.mock.calls[0] as [{ facts: Record<string, unknown> }]
    expect(req.facts.usesTools).toBe(true)
    const [payload] = retry.mock.calls[0] as [{ tools: typeof tools }]
    expect(payload.tools).toEqual(widgetToolReferences)
    // mutate original after capture should not affect already sent payload (snapshot)
    tools.push({ name: 'evil' } as never)
    expect(payload.tools).not.toContainEqual({ name: 'evil' })
  })

  it('new logical-send identity: retry payload correlation not original id and contains sourceMessageId', async () => {
    const retry = vi.fn().mockResolvedValue({})
    await executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 3, sourceMessageId: 'u1', reasoning: false, tools: [...widgetToolReferences] },
      { retry, mintCorrelationId: () => MINTED },
    )
    const [payload] = retry.mock.calls[0] as [Record<string, unknown>]
    expect(payload.correlationId).toBe(MINTED)
    expect(payload.correlationId).not.toBe('u1')
    expect(payload.sourceMessageId).toBe('u1')
    expect(payload.index).toBe(3)
    expect(payload.sessionId).toBe('s1')
  })

  it('does not mutate input', async () => {
    const input = { sessionId: 's1', index: 1, sourceMessageId: 'u1', reasoning: false as boolean, tools: [...widgetToolReferences] }
    const snapshot = JSON.stringify(input)
    const retry = vi.fn().mockResolvedValue({})
    await executeLiaAuthoritativeRetry(input, { retry, mintCorrelationId: () => MINTED })
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
