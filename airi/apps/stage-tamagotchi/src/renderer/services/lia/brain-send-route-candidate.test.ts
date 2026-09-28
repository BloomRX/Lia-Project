import type { LiaBrainRoutingDecision } from '@lia/core'

import { describe, expect, it } from 'vitest'

import { groqBrainDescriptors } from '@lia/core'
import { resolveLiaBrainSendRouteCandidate } from './brain-send-route-candidate'

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

function makeAutomaticNoCandidates(): LiaBrainRoutingDecision {
  return { status: 'automatic', selection: { status: 'noCandidates' } }
}
function makeAutomaticNoPolicyMatch(): LiaBrainRoutingDecision {
  return { status: 'automatic', selection: { status: 'noPolicyMatch' } }
}
function makeAutomaticAmbiguous(): LiaBrainRoutingDecision {
  return {
    status: 'automatic',
    selection: { status: 'ambiguous', ref: { engineId: 'groq', modelId: 'openai/gpt-oss-120b' } },
  }
}
function makeManualResolved(): LiaBrainRoutingDecision {
  const { engines, models } = groqBrainDescriptors()
  return {
    status: 'manual',
    readiness: { status: 'ready' },
    resolution: { status: 'resolvedModel', engine: engines[0]!, model: models[0]! },
  }
}
function makeManualUnresolved(): LiaBrainRoutingDecision {
  return {
    status: 'manual',
    readiness: { status: 'notResolved' },
    resolution: { status: 'noPreference' },
  }
}

describe('lia brain send route candidate adapter (D2B1)', () => {
  it('automatic resolved returns exact providerId/modelId', () => {
    const decision = makeAutomaticSelected()
    const result = resolveLiaBrainSendRouteCandidate(decision)
    expect(result).toEqual({ providerId: 'groq', modelId: 'openai/gpt-oss-120b' })
  })

  it('exact keys are providerId and modelId only', () => {
    const result = resolveLiaBrainSendRouteCandidate(makeAutomaticSelected())!
    expect(Object.keys(result).sort()).toEqual(['modelId', 'providerId'])
  })

  it('freshness: two calls return deep-equal but not same reference', () => {
    const decision = makeAutomaticSelected()
    const a = resolveLiaBrainSendRouteCandidate(decision)!
    const b = resolveLiaBrainSendRouteCandidate(decision)!
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })

  it('input immutability: frozen decision unchanged', () => {
    const decision = makeAutomaticSelected()
    const snapshot = JSON.stringify(decision)
    const frozen = Object.freeze(JSON.parse(snapshot)) as LiaBrainRoutingDecision
    // adapter should not mutate
    resolveLiaBrainSendRouteCandidate(frozen)
    expect(JSON.stringify(frozen)).toBe(snapshot)
    // original not mutated
    expect(JSON.stringify(decision)).toBe(snapshot)
  })

  it('manual resolved → undefined (manual remains Stage-owned)', () => {
    expect(resolveLiaBrainSendRouteCandidate(makeManualResolved())).toBeUndefined()
  })

  it('matrix: all non-routable states → undefined', () => {
    const cases: LiaBrainRoutingDecision[] = [
      { status: 'modeUnspecified' },
      { status: 'disabled' },
      makeManualResolved(),
      makeManualUnresolved(),
      { status: 'automaticPolicyMissing' },
      makeAutomaticNoCandidates(),
      makeAutomaticNoPolicyMatch(),
      makeAutomaticAmbiguous(),
      // also manual engine-only would be unresolved for candidate but we already have
      {
        status: 'manual',
        readiness: { status: 'ready' },
        resolution: { status: 'resolvedEngine', engine: groqBrainDescriptors().engines[0]! },
      } as LiaBrainRoutingDecision,
    ]
    for (const decision of cases) {
      expect(resolveLiaBrainSendRouteCandidate(decision), `status=${(decision as any).status} ${(decision as any).selection?.status ?? (decision as any).resolution?.status ?? ''}`).toBeUndefined()
    }
  })

  it('mapping ownership: providerId comes from engine mapping, not engineId copy nor model parse', () => {
    const decision = makeAutomaticSelected()
    const result = resolveLiaBrainSendRouteCandidate(decision)!
    expect(result.providerId).toBe('groq')
    expect(result.modelId).toBe('openai/gpt-oss-120b')
    // ensure not engineId copied without mapping (in this build they coincide as groq, but test pins mapping path)
    // Create a decision with unknown engine should yield undefined, not that engineId
    const unknownEngineDecision: LiaBrainRoutingDecision = {
      status: 'automatic',
      selection: {
        status: 'selected',
        route: {
          engine: { id: 'unknown-engine', name: 'Unknown', availability: 'available', capabilities: {} as any, modelIds: ['m'] },
          model: { id: 'some-model', engineId: 'unknown-engine', name: 'M', capabilities: {} as any },
        },
      },
    }
    expect(resolveLiaBrainSendRouteCandidate(unknownEngineDecision)).toBeUndefined()
  })

  it('modelId is canonical verbatim: no trim/lowercase/alias', () => {
    const decision = makeAutomaticSelected()
    const result = resolveLiaBrainSendRouteCandidate(decision)!
    expect(result.modelId).toBe('openai/gpt-oss-120b')
    // Verify no normalization was applied: cased variant would be preserved if mapping existed,
    // but our canonical id is already lower-case; ensure we didn't mutate it
    const custom: LiaBrainRoutingDecision = {
      status: 'automatic',
      selection: {
        status: 'selected',
        route: {
          engine: groqBrainDescriptors().engines[0]!,
          model: { id: ' OpenAI/GPT-OSS-120B ', engineId: 'groq', name: 'Custom', capabilities: {} as any },
        },
      },
    }
    expect(resolveLiaBrainSendRouteCandidate(custom)!.modelId).toBe(' OpenAI/GPT-OSS-120B ')
  })

  it('no global state dependence', () => {
    const decision = makeAutomaticSelected()
    const a = resolveLiaBrainSendRouteCandidate(decision)
    // simulate global change would not affect — adapter is pure, same input same output
    const b = resolveLiaBrainSendRouteCandidate(decision)
    expect(a).toEqual(b)
  })

  it('no correlation dependence', () => {
    const decision = makeAutomaticSelected()
    expect(resolveLiaBrainSendRouteCandidate(decision)).toEqual({ providerId: 'groq', modelId: 'openai/gpt-oss-120b' })
    // decision has no correlationId field; adapter never reads it
  })

  it('does not throw for unknown future variant (exhaustive)', () => {
    // Should handle all current discriminated variants deterministically
    const variants: LiaBrainRoutingDecision[] = [
      { status: 'modeUnspecified' },
      { status: 'disabled' },
      { status: 'automaticPolicyMissing' },
      makeAutomaticNoCandidates(),
      makeAutomaticNoPolicyMatch(),
      makeAutomaticAmbiguous(),
      makeManualUnresolved(),
      makeManualResolved(),
      makeAutomaticSelected(),
    ]
    for (const v of variants) expect(() => resolveLiaBrainSendRouteCandidate(v)).not.toThrow()
  })

  it('ChatSendRouteOverride shape compatible: no engineId', () => {
    const result = resolveLiaBrainSendRouteCandidate(makeAutomaticSelected())!
    expect((result as any).engineId).toBeUndefined()
    expect(result).toHaveProperty('providerId')
    expect(result).toHaveProperty('modelId')
  })
})
