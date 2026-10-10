import { brainRequirementForChatTurn, createProductionBrainAutomaticPolicy, createProductionBrainCatalog, decideBrainRoute, groqBrainDescriptors } from '@lia/core'
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

/**
 * Deterministic ids, all in the real UUID shape `crypto.randomUUID` is typed
 * as - including the overflow fallback, so the spy is never widened to `string`
 * to make a fixture fit.
 */
type MintedUuid = ReturnType<typeof crypto.randomUUID>

const MINTED: MintedUuid = '1f9d6a1e-0000-4000-8000-000000000099'
let mintedIndex = 0
const MINTED_IDS: MintedUuid[] = [MINTED, '1f9d6a1e-0000-4000-8000-000000000100']
const MINTED_OVERFLOW: MintedUuid = '1f9d6a1e-0000-4000-8000-0000000000ff'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requestDecision.mockResolvedValue(makeAutomaticSelected())
  mocks.hasApiKey.mockResolvedValue(true)
  mintedIndex = 0
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => MINTED_IDS[mintedIndex++] ?? MINTED_OVERFLOW)
})

describe('lia authoritative retry (Phase 8.0D-10B-4D4C4-D2B6 corrective)', () => {
  it('exactly one correlationId and same for Brain and retry', async () => {
    const retry = vi.fn().mockResolvedValue({})
    const mint = vi.fn(() => MINTED)
    await executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 1, providerHistory: [], sourceMessageId: 'u1', reasoning: false, tools: [...widgetToolReferences] },
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
      { sessionId: 's1', index: 1, providerHistory: [], sourceMessageId: 'u1', reasoning: false, tools: [...widgetToolReferences] },
      { retry, mintCorrelationId: () => MINTED },
    )
    const [req] = mocks.requestDecision.mock.calls[0] as [{ facts: Record<string, unknown> }]
    expect(req.facts).toEqual({ hasImageInput: false, reasoningRequested: false, usesTools: true })
    // reasoning true variant
    vi.clearAllMocks()
    mocks.requestDecision.mockResolvedValue(makeAutomaticSelected())
    await executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 1, providerHistory: [], sourceMessageId: 'u1', reasoning: true, tools: [...widgetToolReferences] },
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
        { sessionId: 's1', index: 2, providerHistory: [], sourceMessageId: 'u2', reasoning, tools: [...widgetToolReferences] },
        { retry, mintCorrelationId: () => MINTED },
      )
      const [payload] = retry.mock.calls[0] as [Record<string, unknown>]
      expect(payload.reasoning).toBe(reasoning)
    }
  })

  it('authority awaited: deferred Brain blocks retry', async () => {
    let resolveBrain!: (v: unknown) => void
    mocks.requestDecision.mockImplementation(
      () => new Promise((res) => {
        resolveBrain = res as unknown as (v: unknown) => void
      }),
    )
    const retry = vi.fn().mockResolvedValue({})
    const pending = executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 1, providerHistory: [], sourceMessageId: 'u1', reasoning: false, tools: [...widgetToolReferences] },
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
      { sessionId: 's1', index: 1, providerHistory: [], sourceMessageId: 'u1', reasoning: false, tools: [...widgetToolReferences] },
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
      { sessionId: 's1', index: 1, providerHistory: [], sourceMessageId: 'u1', reasoning: false, tools: [...widgetToolReferences] },
      { retry, mintCorrelationId: () => MINTED },
    )
    const [payload] = retry.mock.calls[0] as [Record<string, unknown>]
    expect(payload).not.toHaveProperty('routeOverride')
    expect(payload.correlationId).toBe(MINTED)
  })

  it('brain failure degrades: retry still called without routeOverride', async () => {
    mocks.requestDecision.mockRejectedValue(new Error('brain fail'))
    const retry = vi.fn().mockResolvedValue({})
    await executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 1, providerHistory: [], sourceMessageId: 'u1', reasoning: false, tools: [...widgetToolReferences] },
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
      { sessionId: 's1', index: 1, providerHistory: [], sourceMessageId: 'u1', reasoning: false, tools: [...widgetToolReferences] },
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
      { sessionId: 's1', index: 1, providerHistory: [], sourceMessageId: 'u1', reasoning: false, tools },
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
      { sessionId: 's1', index: 3, providerHistory: [], sourceMessageId: 'u1', reasoning: false, tools: [...widgetToolReferences] },
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
    const input = { sessionId: 's1', index: 1, providerHistory: [], sourceMessageId: 'u1', reasoning: false as boolean, tools: [...widgetToolReferences] }
    const snapshot = JSON.stringify(input)
    const retry = vi.fn().mockResolvedValue({})
    await executeLiaAuthoritativeRetry(input, { retry, mintCorrelationId: () => MINTED })
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

describe('lia authoritative retry image fidelity (Phase 8.0D-10B-4D4C4-D2B11)', () => {
  const IMAGES = [
    { type: 'image' as const, data: 'QUJD', mimeType: 'image/png' },
    { type: 'image' as const, data: 'REVG', mimeType: 'image/jpeg' },
  ]

  function factsOf(): Record<string, unknown> {
    const [req] = mocks.requestDecision.mock.calls[0] as [{ facts: Record<string, unknown> }]
    return req.facts
  }

  let currentRetry: ReturnType<typeof vi.fn>

  async function run(input: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
    currentRetry = vi.fn().mockResolvedValue({})
    await executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 1, providerHistory: [], sourceMessageId: 'u1', reasoning: false, tools: [], ...input } as never,
      { retry: currentRetry, mintCorrelationId: () => MINTED, ...overrides } as never,
    )
    return currentRetry
  }

  it('case A: a text-only retry reports hasImageInput=false', async () => {
    await run({})
    expect(factsOf().hasImageInput).toBe(false)
  })

  it('case A2: an explicitly empty attachment snapshot reports hasImageInput=false', async () => {
    await run({ attachments: [] })
    expect(factsOf().hasImageInput).toBe(false)
  })

  it('case B: text + one image reports hasImageInput=true', async () => {
    await run({ attachments: [IMAGES[0]] })
    expect(factsOf().hasImageInput).toBe(true)
  })

  it('case C: an image-only retry reports hasImageInput=true', async () => {
    await run({ attachments: [IMAGES[0]] })
    expect(factsOf()).toEqual({ hasImageInput: true, reasoningRequested: false, usesTools: false })
  })

  it('case D: multiple images report hasImageInput=true', async () => {
    await run({ attachments: IMAGES })
    expect(factsOf().hasImageInput).toBe(true)
  })

  it('e + F + G + H: the exact snapshot - values, order, data and MIME - reaches the retry', async () => {
    const retry = await run({ attachments: IMAGES })
    expect(retry.mock.calls[0]![0]).toMatchObject({
      attachments: [
        { type: 'image', data: 'QUJD', mimeType: 'image/png' },
        { type: 'image', data: 'REVG', mimeType: 'image/jpeg' },
      ],
    })
  })

  it('case E2: a repeated image is forwarded twice, in order', async () => {
    const repeated = [IMAGES[0], IMAGES[0], IMAGES[1]]
    const retry = await run({ attachments: repeated })
    const forwarded = (retry.mock.calls[0]![0] as { attachments: typeof IMAGES }).attachments
    expect(forwarded.map(attachment => attachment.data)).toEqual(['QUJD', 'QUJD', 'REVG'])
  })

  it('case I: the caller mutating the attachment ARRAY while the Brain decision is pending cannot change the retry', async () => {
    const caller = [{ ...IMAGES[0]! }]
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const resolveRoute = vi.fn(async () => {
      await gate
      return undefined
    })
    currentRetry = vi.fn().mockResolvedValue({})
    const pending = executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 1, providerHistory: [], sourceMessageId: 'u1', reasoning: false, tools: [], attachments: caller } as never,
      { retry: currentRetry, resolveRoute, mintCorrelationId: () => MINTED } as never,
    )
    // Brain decision is now in flight: mutate the caller's own array.
    caller.push({ type: 'image', data: 'SU5KRUNURUQ', mimeType: 'image/png' })
    caller.length = 0
    release()
    await pending
    expect((currentRetry.mock.calls[0]![0] as { attachments: typeof IMAGES }).attachments)
      .toEqual([{ type: 'image', data: 'QUJD', mimeType: 'image/png' }])
  })

  it('case J: the caller replacing or editing an attachment OBJECT while the Brain decision is pending cannot change the retry', async () => {
    const caller = [{ ...IMAGES[0]! }, { ...IMAGES[1]! }]
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const resolveRoute = vi.fn(async () => {
      await gate
      return undefined
    })
    currentRetry = vi.fn().mockResolvedValue({})
    const pending = executeLiaAuthoritativeRetry(
      { sessionId: 's1', index: 1, providerHistory: [], sourceMessageId: 'u1', reasoning: false, tools: [], attachments: caller } as never,
      { retry: currentRetry, resolveRoute, mintCorrelationId: () => MINTED } as never,
    )
    caller[0]!.data = 'T1ZFUldSSVRURU4'
    caller[0]!.mimeType = 'image/gif'
    caller[1] = { type: 'image', data: 'UkVQTEFDRUQ', mimeType: 'image/bmp' }
    release()
    await pending
    expect((currentRetry.mock.calls[0]![0] as { attachments: typeof IMAGES }).attachments).toEqual(IMAGES)
  })

  it('case S: the Brain request carries no image data, MIME, data URL or user text', async () => {
    await run({ attachments: IMAGES })
    const [request] = mocks.requestDecision.mock.calls[0] as [Record<string, unknown>]
    const serialized = JSON.stringify(request)
    for (const leaked of ['QUJD', 'REVG', 'image/png', 'image/jpeg', 'base64', 'data:', 'mimeType', 'attachments'])
      expect(serialized).not.toContain(leaked)
    // The only image-related fact that crosses the boundary.
    expect(factsOf()).toEqual({ hasImageInput: true, reasoningRequested: false, usesTools: false })
  })

  it('case M2: the same minted correlationId reaches both the Brain request and the image-bearing retry', async () => {
    const retry = await run({ attachments: IMAGES })
    const [request] = mocks.requestDecision.mock.calls[0] as [{ correlationId: string }]
    expect(request.correlationId).toBe(MINTED)
    expect((retry.mock.calls[0]![0] as { correlationId: string }).correlationId).toBe(MINTED)
  })

  it('case O2: a selected route is still forwarded unchanged alongside the image snapshot', async () => {
    const retry = await run({ attachments: IMAGES })
    expect(retry.mock.calls[0]![0]).toHaveProperty('routeOverride')
    expect((retry.mock.calls[0]![0] as { attachments: unknown[] }).attachments).toEqual(IMAGES)
  })

  it('case P2: a non-routable decision still retries with the image snapshot and no routeOverride', async () => {
    mocks.requestDecision.mockResolvedValue({ status: 'modeUnspecified' })
    const retry = await run({ attachments: IMAGES })
    expect(retry.mock.calls[0]![0]).not.toHaveProperty('routeOverride')
    expect((retry.mock.calls[0]![0] as { attachments: unknown[] }).attachments).toEqual(IMAGES)
  })

  it('case Q2: a Brain failure still degrades to a retry that keeps the image snapshot', async () => {
    mocks.requestDecision.mockRejectedValue(new Error('brain unavailable'))
    const retry = await run({ attachments: IMAGES })
    expect(retry).toHaveBeenCalledTimes(1)
    expect(retry.mock.calls[0]![0]).not.toHaveProperty('routeOverride')
    expect((retry.mock.calls[0]![0] as { attachments: unknown[] }).attachments).toEqual(IMAGES)
  })
})

/**
 * Phase 8.0D-M1 gate 8: a retried image turn keeps its image AND keeps
 * resolving the vision route.
 *
 * Only the IPC boundary is mocked. The decision it returns is computed by the
 * REAL catalog, policy, requirement derivation and decision layer from the
 * facts the retry actually derived, so the chain under test - frozen snapshot
 * -> facts -> real Brain routing -> routeOverride -> outgoing retry - is real
 * end to end.
 */
describe('multimodal retry (Phase 8.0D-M1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requestDecision.mockImplementation(async (input: { facts: { hasImageInput: boolean, reasoningRequested: boolean, usesTools: boolean } }) => {
      const { engines, models } = createProductionBrainCatalog()
      return decideBrainRoute({
        automaticPolicy: createProductionBrainAutomaticPolicy(),
        engines,
        mode: 'automatic',
        models,
        requirement: brainRequirementForChatTurn(input.facts),
      })
    })
    mocks.hasApiKey.mockResolvedValue(true)
  })

  it('gate 8: the retried turn carries the same image and resolves the vision route', async () => {
    const attachments = [{ type: 'image' as const, data: 'aW1hZ2U=', mimeType: 'image/png' }]
    const retry = vi.fn(async (_payload: unknown) => {})

    await executeLiaAuthoritativeRetry(
      {
        attachments,
        index: 3,
        providerHistory: [],
        reasoning: false,
        sessionId: 'session-1',
        sourceMessageId: 'message-1',
        tools: [],
      },
      { retry },
    )

    expect(retry).toHaveBeenCalledTimes(1)
    const payload = retry.mock.calls[0]![0] as { attachments?: unknown, routeOverride?: unknown }
    // The image itself is carried, byte-identical.
    expect(payload.attachments).toEqual(attachments)
    // ...and the turn resolved to the vision route, not the text brain.
    expect(payload.routeOverride).toEqual({ modelId: 'qwen/qwen3.8-27b', providerId: 'groq' })
    // The fact that drove it really described an image turn.
    expect(mocks.requestDecision.mock.calls[0]![0].facts.hasImageInput).toBe(true)
  })

  it('gate 8b: a retried text-only turn does not promote the vision route', async () => {
    const retry = vi.fn(async (_payload: unknown) => {})

    await executeLiaAuthoritativeRetry(
      { index: 3, providerHistory: [], reasoning: false, sessionId: 'session-1', sourceMessageId: 'message-1', tools: [] },
      { retry },
    )

    const payload = retry.mock.calls[0]![0] as { routeOverride?: unknown }
    expect(payload.routeOverride).toEqual({ modelId: 'openai/gpt-oss-120b', providerId: 'groq' })
    expect(mocks.requestDecision.mock.calls[0]![0].facts.hasImageInput).toBe(false)
  })
  /**
   * Phase 8.0D-M3 gate 8c: the requirement describes the EFFECTIVE provider
   * prompt, not just the current turn.
   *
   * A retried TEXT-ONLY turn whose still-provider-visible history carries an
   * image is an image turn, because that image is part of the same request. It
   * must resolve the vision route - sending it to a text-only model while the
   * request carries an image is exactly the Windows failure.
   */
  it('gate 8c: a text-only retry over image history still resolves the vision route', async () => {
    const retry = vi.fn(async (_payload: unknown) => {})
    const historyWithImage = [
      { role: 'system' as const, content: 'persona' },
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'earlier picture' },
          { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,ZWFybGllcg==' } },
        ],
      },
      { role: 'assistant' as const, content: 'I can see it' },
    ]

    await executeLiaAuthoritativeRetry(
      { index: 3, providerHistory: historyWithImage as never, reasoning: false, sessionId: 'session-1', sourceMessageId: 'message-1', tools: [] },
      { retry },
    )

    // The consequence first: without the effective-history contribution this
    // text-only turn resolves the TEXT brain while the request it sends still
    // carries the historical image - the exact Windows failure.
    const payload = retry.mock.calls[0]![0] as { routeOverride?: unknown }
    expect(payload.routeOverride).toEqual({ modelId: 'qwen/qwen3.8-27b', providerId: 'groq' })
    // And the fact that drove it.
    expect(mocks.requestDecision.mock.calls[0]![0].facts.hasImageInput).toBe(true)
  })

  /**
   * Phase 8.0D-M3 gate 8d: the converse, and the agreement proof.
   *
   * The same history with its image turn provider-EXCLUDED (a failed send that
   * is still on screen) is NOT an image turn, because that image is not being
   * sent. Routing and projection have to reach the same answer.
   */
  it('gate 8d: excluded failed image history does not promote the vision route', async () => {
    const retry = vi.fn(async (_payload: unknown) => {})
    const historyWithExcludedImage = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'failed picture' },
          { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,ZmFpbGVk' } },
        ],
        excludedFromProviderContext: true,
      },
      { role: 'error' as const, content: 'Too many images provided' },
    ]

    await executeLiaAuthoritativeRetry(
      { index: 3, providerHistory: historyWithExcludedImage as never, reasoning: false, sessionId: 'session-1', sourceMessageId: 'message-1', tools: [] },
      { retry },
    )

    expect(mocks.requestDecision.mock.calls[0]![0].facts.hasImageInput).toBe(false)
    const payload = retry.mock.calls[0]![0] as { routeOverride?: unknown }
    expect(payload.routeOverride).toEqual({ modelId: 'openai/gpt-oss-120b', providerId: 'groq' })
  })
})
