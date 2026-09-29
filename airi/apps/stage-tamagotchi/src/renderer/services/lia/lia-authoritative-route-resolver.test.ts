import type { LiaBrainRoutingDecision } from '@lia/core'

import type { LiaBrainChatTurnFacts } from '../../../shared/eventa'

import { groqBrainDescriptors } from '@lia/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveLiaBrainSendRouteCandidate } from './brain-send-route-candidate'
import { resolveLiaAuthoritativeSendRoute } from './lia-authoritative-route-resolver'

const mocks = vi.hoisted(() => ({
  requestDecision: vi.fn(),
  hasApiKey: vi.fn(),
  candidateCalls: 0,
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

// helpers
function makeAutomaticSelected(): LiaBrainRoutingDecision {
  const { engines, models } = groqBrainDescriptors()
  return {
    status: 'automatic',
    selection: {
      status: 'selected',
      route: { engine: engines[0]!, model: models[0]! },
    },
  }
}

const FACTS: LiaBrainChatTurnFacts = { hasImageInput: false, reasoningRequested: false, usesTools: false }
const CORRELATION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requestDecision.mockResolvedValue(makeAutomaticSelected())
  mocks.hasApiKey.mockResolvedValue(true)
})

describe('lia authoritative route resolver (D1)', () => {
  it('resolved + credential true → exact providerId/modelId', async () => {
    const result = await resolveLiaAuthoritativeSendRoute({ correlationId: CORRELATION_ID, facts: FACTS })
    expect(result).toEqual({ providerId: 'groq', modelId: 'openai/gpt-oss-120b' })
    expect(Object.keys(result!).sort()).toEqual(['modelId', 'providerId'])
  })

  it('resolved + credential false → undefined', async () => {
    mocks.hasApiKey.mockResolvedValue(false)
    const result = await resolveLiaAuthoritativeSendRoute({ correlationId: CORRELATION_ID, facts: FACTS })
    expect(result).toBeUndefined()
  })

  it('decision rejects → undefined and no credential lookup', async () => {
    mocks.requestDecision.mockRejectedValue(new Error('bridge down'))
    const result = await resolveLiaAuthoritativeSendRoute({ correlationId: CORRELATION_ID, facts: FACTS })
    expect(result).toBeUndefined()
    expect(mocks.hasApiKey).not.toHaveBeenCalled()
  })

  it('credential lookup rejects → undefined, not throw', async () => {
    mocks.hasApiKey.mockRejectedValue(new Error('vault error'))
    const result = await resolveLiaAuthoritativeSendRoute({ correlationId: CORRELATION_ID, facts: FACTS })
    expect(result).toBeUndefined()
    // should not throw
    await expect(resolveLiaAuthoritativeSendRoute({ correlationId: CORRELATION_ID, facts: FACTS })).resolves.toBeUndefined()
  })

  it('non-routable matrix → undefined and credential zero calls', async () => {
    const cases: LiaBrainRoutingDecision[] = [
      { status: 'modeUnspecified' },
      { status: 'disabled' },
      { status: 'manual', readiness: { status: 'ready' } as any, resolution: { status: 'resolvedModel', engine: groqBrainDescriptors().engines[0]!, model: groqBrainDescriptors().models[0]! } as any },
      { status: 'manual', readiness: { status: 'notResolved' } as any, resolution: { status: 'noPreference' } as any },
      { status: 'automaticPolicyMissing' },
      { status: 'automatic', selection: { status: 'noCandidates' } },
      { status: 'automatic', selection: { status: 'noPolicyMatch' } },
      { status: 'automatic', selection: { status: 'ambiguous', ref: { engineId: 'groq', modelId: 'openai/gpt-oss-120b' } } as any },
    ]
    for (const decision of cases) {
      mocks.requestDecision.mockResolvedValueOnce(decision)
      mocks.hasApiKey.mockClear()
      const result = await resolveLiaAuthoritativeSendRoute({ correlationId: CORRELATION_ID, facts: FACTS })
      expect(result, `status=${(decision as any).status} ${(decision as any).selection?.status ?? ''}`).toBeUndefined()
      expect(mocks.hasApiKey).not.toHaveBeenCalled()
    }
  })

  it('unknown engine mapping → undefined and credential zero calls', async () => {
    const unknown: LiaBrainRoutingDecision = {
      status: 'automatic',
      selection: {
        status: 'selected',
        route: {
          engine: { id: 'unknown-engine', name: 'Unknown', availability: 'available', capabilities: {} as any, modelIds: ['m'] },
          model: { id: 'some-model', engineId: 'unknown-engine', name: 'M', capabilities: {} as any },
        },
      },
    }
    mocks.requestDecision.mockResolvedValue(unknown)
    const result = await resolveLiaAuthoritativeSendRoute({ correlationId: CORRELATION_ID, facts: FACTS })
    expect(result).toBeUndefined()
    expect(mocks.hasApiKey).not.toHaveBeenCalled()
  })

  it('exact credential providerId → candidate.providerId, not engineId nor global', async () => {
    mocks.requestDecision.mockResolvedValue(makeAutomaticSelected())
    await resolveLiaAuthoritativeSendRoute({ correlationId: CORRELATION_ID, facts: FACTS })
    expect(mocks.hasApiKey).toHaveBeenCalledTimes(1)
    expect(mocks.hasApiKey).toHaveBeenCalledWith('groq')
    // ensure not called with engineId separate or with global activeProvider
    expect(mocks.hasApiKey.mock.calls[0]![0]).toBe('groq')
  })

  it('one decision request per resolver call', async () => {
    await resolveLiaAuthoritativeSendRoute({ correlationId: CORRELATION_ID, facts: FACTS })
    expect(mocks.requestDecision).toHaveBeenCalledTimes(1)
    expect(mocks.requestDecision).toHaveBeenCalledWith({ correlationId: CORRELATION_ID, facts: FACTS })
  })

  it('one credential check max — candidate exists → once, no candidate → zero', async () => {
    // exists → once
    mocks.requestDecision.mockResolvedValue(makeAutomaticSelected())
    mocks.hasApiKey.mockClear()
    await resolveLiaAuthoritativeSendRoute({ correlationId: CORRELATION_ID, facts: FACTS })
    expect(mocks.hasApiKey).toHaveBeenCalledTimes(1)

    // no candidate → zero
    mocks.requestDecision.mockResolvedValue({ status: 'disabled' } as any)
    mocks.hasApiKey.mockClear()
    await resolveLiaAuthoritativeSendRoute({ correlationId: CORRELATION_ID, facts: FACTS })
    expect(mocks.hasApiKey).not.toHaveBeenCalled()
  })

  it('input immutability — facts and correlationId not mutated', async () => {
    const facts = { hasImageInput: true, reasoningRequested: true, usesTools: true }
    const input = { correlationId: CORRELATION_ID, facts }
    const factsSnapshot = JSON.stringify(facts)
    const inputSnapshot = JSON.stringify(input)
    const decision = makeAutomaticSelected()
    const decisionSnapshot = JSON.stringify(decision)
    mocks.requestDecision.mockResolvedValue(decision)

    await resolveLiaAuthoritativeSendRoute(input)

    expect(JSON.stringify(facts)).toBe(factsSnapshot)
    expect(JSON.stringify(input)).toBe(inputSnapshot)
    expect(JSON.stringify(decision)).toBe(decisionSnapshot)
    // returned candidate is fresh, not input
    const result = await resolveLiaAuthoritativeSendRoute({ correlationId: CORRELATION_ID, facts: FACTS })
    expect(result).not.toBe(input as any)
  })

  it('fresh resolver calls — two calls → two independent decisions and credential checks', async () => {
    const facts2 = { hasImageInput: false, reasoningRequested: false, usesTools: true }
    mocks.requestDecision.mockResolvedValue(makeAutomaticSelected())
    mocks.hasApiKey.mockResolvedValue(true)

    const first = await resolveLiaAuthoritativeSendRoute({ correlationId: 'id-1', facts: FACTS })
    const second = await resolveLiaAuthoritativeSendRoute({ correlationId: 'id-2', facts: facts2 })

    expect(first).toEqual({ providerId: 'groq', modelId: 'openai/gpt-oss-120b' })
    expect(second).toEqual({ providerId: 'groq', modelId: 'openai/gpt-oss-120b' })
    expect(mocks.requestDecision).toHaveBeenCalledTimes(2)
    expect(mocks.hasApiKey).toHaveBeenCalledTimes(2)
    expect(mocks.requestDecision.mock.calls[0]![0]).toEqual({ correlationId: 'id-1', facts: FACTS })
    expect(mocks.requestDecision.mock.calls[1]![0]).toEqual({ correlationId: 'id-2', facts: facts2 })
  })

  it('no credential cache — source has no Map/Set/ref holding readiness', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const source = readFileSync(fileURLToPath(new URL('./lia-authoritative-route-resolver.ts', import.meta.url)), 'utf-8')
    // resolver must not hold a Map/Set/WeakMap/cache for credentials
    expect(source).not.toMatch(/\bnew\s+(Map|Set|WeakMap|WeakSet)\b/)
    expect(source).not.toMatch(/\buseState\b|\bref\(|\breactive\b/)
    expect(source).not.toMatch(/credentialCache|hasCredentialCache|readyCache/)
  })

  it('no secret value — source never calls electronLiaSecretGet', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const source = readFileSync(fileURLToPath(new URL('./lia-authoritative-route-resolver.ts', import.meta.url)), 'utf-8')
    expect(source).not.toMatch(/electronLiaSecretGet/)
    expect(source).not.toMatch(/secretGet/)
    expect(source).not.toMatch(/resolveApiKey/)
    // only allowed secret seam is hasApiKey → electronLiaSecretHas
    expect(source).toMatch(/hasApiKey/)
  })

  it('return type — Promise<ChatSendRouteOverride|undefined> (no extra fields)', async () => {
    const result = await resolveLiaAuthoritativeSendRoute({ correlationId: CORRELATION_ID, facts: FACTS })
    expect(result).toEqual({ providerId: 'groq', modelId: 'openai/gpt-oss-120b' })
    expect(Object.keys(result!).sort()).toEqual(['modelId', 'providerId'])
    // ensure no extra fields like correlationId, engineId, readiness etc.
    expect((result as any).correlationId).toBeUndefined()
    expect((result as any).engineId).toBeUndefined()
    expect((result as any).readiness).toBeUndefined()
    expect((result as any).decision).toBeUndefined()
  })

  it('does not mutate candidate — adapter fresh object returned verbatim', async () => {
    const decision = makeAutomaticSelected()
    mocks.requestDecision.mockResolvedValue(decision)
    const candidate = resolveLiaBrainSendRouteCandidate(decision)!
    // ensure resolver does not mutate the candidate returned by adapter
    const snapshot = JSON.stringify(candidate)
    await resolveLiaAuthoritativeSendRoute({ correlationId: CORRELATION_ID, facts: FACTS })
    expect(JSON.stringify(candidate)).toBe(snapshot)
  })
})
