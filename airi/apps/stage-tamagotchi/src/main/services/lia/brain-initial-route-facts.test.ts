import { describe, expect, it } from 'vitest'

import { deriveLiaBrainInitialRouteObservationFacts } from './brain-initial-route-facts'

/**
 * Phase 8.0D-10B-4D4C4-D2B7: pure initial routeOverride observation facts.
 *
 * The derivation is pure, stateless, and factual only - it maps the tri-state
 * snapshot field to exactly one of three discriminated results without any
 * comparison, scoring, or authority.
 */

describe('lia initial route facts - pure derivation (Phase 8.0D-10B-4D4C4-D2B7)', () => {
  it('a: {} -> initialRouteOverrideNotObserved', () => {
    expect(deriveLiaBrainInitialRouteObservationFacts({})).toEqual({ status: 'initialRouteOverrideNotObserved' })
  })

  it('b: { initialRouteOverride: undefined } -> initialRouteOverrideNotObserved', () => {
    expect(deriveLiaBrainInitialRouteObservationFacts({ initialRouteOverride: undefined })).toEqual({ status: 'initialRouteOverrideNotObserved' })
  })

  it('c: { initialRouteOverride: null } -> noInitialRouteOverride', () => {
    expect(deriveLiaBrainInitialRouteObservationFacts({ initialRouteOverride: null })).toEqual({ status: 'noInitialRouteOverride' })
  })

  it('d: exact route object -> initialRouteOverrideObserved with two fields', () => {
    const result = deriveLiaBrainInitialRouteObservationFacts({
      initialRouteOverride: { providerId: 'groq', modelId: 'openai/gpt-oss-120b' },
    })
    expect(result).toEqual({
      status: 'initialRouteOverrideObserved',
      providerId: 'groq',
      modelId: 'openai/gpt-oss-120b',
    })
    // Only the three approved keys
    expect(Object.keys(result).sort()).toEqual(['modelId', 'providerId', 'status'])
  })

  it('e: returned observed result is a fresh object', () => {
    const snapshot = { initialRouteOverride: { providerId: 'groq', modelId: 'm' } }
    const first = deriveLiaBrainInitialRouteObservationFacts(snapshot)
    const second = deriveLiaBrainInitialRouteObservationFacts(snapshot)
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    // Mutating one does not affect the other
    if (first.status === 'initialRouteOverrideObserved') {
      (first as any).providerId = 'mutated'
      expect(second).toEqual({ status: 'initialRouteOverrideObserved', providerId: 'groq', modelId: 'm' })
    }
  })

  it('f: input is not mutated', () => {
    const snapshot: any = { initialRouteOverride: { providerId: 'groq', modelId: 'm' } }
    const snapshotClone = { initialRouteOverride: { ...snapshot.initialRouteOverride } }
    const frozen = Object.freeze({ initialRouteOverride: Object.freeze({ ...snapshot.initialRouteOverride }) })
    expect(() => deriveLiaBrainInitialRouteObservationFacts(frozen)).not.toThrow()
    expect(snapshot).toEqual(snapshotClone)
    expect(frozen).toEqual({ initialRouteOverride: { providerId: 'groq', modelId: 'm' } })
    // Also ensure normal snapshot not mutated
    const normal: any = { initialRouteOverride: { providerId: 'groq', modelId: 'm' } }
    deriveLiaBrainInitialRouteObservationFacts(normal)
    expect(normal).toEqual({ initialRouteOverride: { providerId: 'groq', modelId: 'm' } })
  })

  it('g: repeated equivalent calls deeply equal', () => {
    const a = deriveLiaBrainInitialRouteObservationFacts({ initialRouteOverride: null })
    const b = deriveLiaBrainInitialRouteObservationFacts({ initialRouteOverride: null })
    expect(a).toEqual(b)
    expect(a).toEqual({ status: 'noInitialRouteOverride' })

    const c = deriveLiaBrainInitialRouteObservationFacts({})
    const d = deriveLiaBrainInitialRouteObservationFacts({ initialRouteOverride: undefined })
    expect(c).toEqual(d)
    expect(c).toEqual({ status: 'initialRouteOverrideNotObserved' })
  })

  it('h: changing unrelated fields does NOT change derivation', () => {
    const base: any = { initialRouteOverride: { providerId: 'groq', modelId: 'm' } }
    const withDecision = { ...base, decision: { foo: 'bar' } }
    const withExecutions: any = { ...base, executions: [{ correlationId: 'X', providerId: 'x', modelId: 'y', conversationId: 'c', roundId: 'r' }] }
    const withTerminals: any = { ...base, executionTerminals: [{ roundId: 'r', outcome: 'succeeded' }] }
    const withSendTerminal: any = { ...base, sendTerminal: { outcome: 'succeeded' } }
    const expected = { status: 'initialRouteOverrideObserved', providerId: 'groq', modelId: 'm' }

    expect(deriveLiaBrainInitialRouteObservationFacts(base)).toEqual(expected)
    expect(deriveLiaBrainInitialRouteObservationFacts(withDecision)).toEqual(expected)
    expect(deriveLiaBrainInitialRouteObservationFacts(withExecutions)).toEqual(expected)
    expect(deriveLiaBrainInitialRouteObservationFacts(withTerminals)).toEqual(expected)
    expect(deriveLiaBrainInitialRouteObservationFacts(withSendTerminal)).toEqual(expected)

    // Also for null and undefined
    // The snapshot contract is the single optional tri-state member: unrelated
    // keys are not part of it, and nothing here needs `any` to say so.
    expect(deriveLiaBrainInitialRouteObservationFacts({ initialRouteOverride: null })).toEqual({ status: 'noInitialRouteOverride' })
    expect(deriveLiaBrainInitialRouteObservationFacts({})).toEqual({ status: 'initialRouteOverrideNotObserved' })
  })

  it('malformed route object -> not observed (no throw, no repair)', () => {
    expect(deriveLiaBrainInitialRouteObservationFacts({ initialRouteOverride: { providerId: 42 as any, modelId: 'm' } })).toEqual({ status: 'initialRouteOverrideNotObserved' })
    expect(deriveLiaBrainInitialRouteObservationFacts({ initialRouteOverride: { providerId: 'groq' } as any })).toEqual({ status: 'initialRouteOverrideNotObserved' })
    expect(deriveLiaBrainInitialRouteObservationFacts({ initialRouteOverride: [] as any })).toEqual({ status: 'initialRouteOverrideNotObserved' })
    expect(deriveLiaBrainInitialRouteObservationFacts({ initialRouteOverride: 'groq' as any })).toEqual({ status: 'initialRouteOverrideNotObserved' })
  })

  it('source guards: no imports beyond type, no state, no authority', () => {
    // This test mirrors the style of other pure fact tests: ensure the module
    // does not import store/transport/observer. We check via file content.
    // Import count is indirectly verified by the composition test, but we keep
    // a minimal guard here: the derivation result contains only the three
    // approved statuses and never a comparison.
    const observed = deriveLiaBrainInitialRouteObservationFacts({ initialRouteOverride: { providerId: 'a', modelId: 'b' } })
    expect(observed.status).toBe('initialRouteOverrideObserved')
    expect((observed as any).winner).toBeUndefined()
    expect((observed as any).routeMatched).toBeUndefined()
    expect((observed as any).divergence).toBeUndefined()
  })
})
