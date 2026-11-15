import type { LiaBrainFinalSuccessfulExecutionFacts } from './brain-final-successful-execution-facts'
import type { LiaBrainInitialRouteObservationFacts } from './brain-initial-route-facts'
import type { LiaBrainRouteConformanceFacts } from './brain-route-conformance-facts'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { authoredSourceEntry, normalizeLineEndings } from '../../../test-helpers'
import { deriveLiaBrainRouteConformanceFacts } from './brain-route-conformance-facts'

/**
 * Phase 8.0D-10B-4D4C4-D2B10: the focused proof of the pure route-conformance
 * facts.
 *
 * The derivation is proven as a PURE FACTS-TO-FACTS projection only: the full
 * 3 x 7 = 21 source-state truth table, the four identity relations of the one
 * comparable pair, and the purity/independence of the returned value.
 *
 * The 21 expected results are written out as literals rather than recomputed
 * from the same rule the derivation uses, so this file is an independent oracle:
 * a derivation that changed its rule would fail here instead of silently
 * re-deriving the new answer on both sides of the assertion.
 */

const REPO_ROOT = new URL('../../../../../../', import.meta.url)
const ROUTE_CONFORMANCE_FACTS = 'apps/stage-tamagotchi/src/main/services/lia/brain-route-conformance-facts.ts'
const FINAL_FACTS = 'apps/stage-tamagotchi/src/main/services/lia/brain-final-successful-execution-facts.ts'
const BRAIN_ROOTS = ['apps/stage-tamagotchi/src']

/** `fileURLToPath` keeps the trailing separator of a directory URL. */
const REPO_ROOT_PATH = fileURLToPath(REPO_ROOT)

function productionSources(roots: string[]): string[] {
  const files: string[] = []
  for (const root of roots) {
    for (const entry of readdirSync(new URL(root, REPO_ROOT), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.'))
        continue
      const authored = authoredSourceEntry(REPO_ROOT_PATH, entry)
      if (!authored)
        continue
      files.push(authored.relativePosix)
    }
  }
  return files
}

/** Production files whose RAW content matches - the same rule the repo-wide ownership allowlists use. */
function productionMatching(pattern: RegExp): string[] {
  return productionSources(BRAIN_ROOTS)
    .filter(relative => pattern.test(normalizeLineEndings(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
    .sort()
}

/** Reads a sibling module, resolved against THIS file (the observer test convention). */
function readSource(relative: string): string {
  return normalizeLineEndings(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8'))
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value))
      deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

/* -------------------------------------------------------------------------- */
/* The 3 initial-route states, in source order.                                */
/* -------------------------------------------------------------------------- */

const INITIAL_NOT_OBSERVED: LiaBrainInitialRouteObservationFacts = { status: 'initialRouteOverrideNotObserved' }
const NO_INITIAL_ROUTE: LiaBrainInitialRouteObservationFacts = { status: 'noInitialRouteOverride' }
const INITIAL_OBSERVED: LiaBrainInitialRouteObservationFacts = {
  modelId: 'llama-3.3-70b',
  providerId: 'groq',
  status: 'initialRouteOverrideObserved',
}

/** The three initial-route states, in the order the upstream union declares them. */
const INITIAL_STATES: ReadonlyArray<{ label: string, facts: LiaBrainInitialRouteObservationFacts, observed: boolean }> = [
  { facts: INITIAL_NOT_OBSERVED, label: 'initialRouteOverrideNotObserved', observed: false },
  { facts: NO_INITIAL_ROUTE, label: 'noInitialRouteOverride', observed: false },
  { facts: INITIAL_OBSERVED, label: 'initialRouteOverrideObserved', observed: true },
]

/* -------------------------------------------------------------------------- */
/* The 7 final-execution states, in source order.                              */
/* -------------------------------------------------------------------------- */

const FINAL_NOT_OBSERVED: LiaBrainFinalSuccessfulExecutionFacts = { status: 'sendTerminalNotObserved' }
const FINAL_SEND_FAILED: LiaBrainFinalSuccessfulExecutionFacts = { status: 'sendFailed' }
const FINAL_NO_SUCCEEDED_ROUND: LiaBrainFinalSuccessfulExecutionFacts = { status: 'noSucceededRoundObserved' }
const FINAL_MULTIPLE_ROUNDS: LiaBrainFinalSuccessfulExecutionFacts = { status: 'multipleSucceededRoundTerminalsObserved' }
const FINAL_NO_EXECUTION: LiaBrainFinalSuccessfulExecutionFacts = { roundId: 'R1', status: 'succeededRoundExecutionNotObserved' }
const FINAL_MULTIPLE_EXECUTIONS: LiaBrainFinalSuccessfulExecutionFacts = { roundId: 'R1', status: 'multipleExecutionsForSucceededRoundObserved' }
const FINAL_OBSERVED: LiaBrainFinalSuccessfulExecutionFacts = {
  executionArrivalIndex: 0,
  modelId: 'llama-3.3-70b',
  providerId: 'groq',
  roundId: 'R1',
  status: 'finalSuccessfulExecutionObserved',
}

/** The seven final-execution states, in the order the upstream union declares them. */
const FINAL_STATES: ReadonlyArray<{ label: string, facts: LiaBrainFinalSuccessfulExecutionFacts, observed: boolean }> = [
  { facts: FINAL_NOT_OBSERVED, label: 'sendTerminalNotObserved', observed: false },
  { facts: FINAL_SEND_FAILED, label: 'sendFailed', observed: false },
  { facts: FINAL_NO_SUCCEEDED_ROUND, label: 'noSucceededRoundObserved', observed: false },
  { facts: FINAL_MULTIPLE_ROUNDS, label: 'multipleSucceededRoundTerminalsObserved', observed: false },
  { facts: FINAL_NO_EXECUTION, label: 'succeededRoundExecutionNotObserved', observed: false },
  { facts: FINAL_MULTIPLE_EXECUTIONS, label: 'multipleExecutionsForSucceededRoundObserved', observed: false },
  { facts: FINAL_OBSERVED, label: 'finalSuccessfulExecutionObserved', observed: true },
]

/* -------------------------------------------------------------------------- */
/* The complete 21-cell expected truth table, written out literally.           */
/* -------------------------------------------------------------------------- */

/** Both sides unknown: 2 x 6 = 12 cells. */
const BOTH_UNAVAILABLE = {
  initialRouteOverrideNotObserved: [
    { finalUnavailableReason: 'sendTerminalNotObserved', initialUnavailableReason: 'initialRouteOverrideNotObserved', status: 'routeComparisonUnavailable', unavailableSide: 'both' },
    { finalUnavailableReason: 'sendFailed', initialUnavailableReason: 'initialRouteOverrideNotObserved', status: 'routeComparisonUnavailable', unavailableSide: 'both' },
    { finalUnavailableReason: 'noSucceededRoundObserved', initialUnavailableReason: 'initialRouteOverrideNotObserved', status: 'routeComparisonUnavailable', unavailableSide: 'both' },
    { finalUnavailableReason: 'multipleSucceededRoundTerminalsObserved', initialUnavailableReason: 'initialRouteOverrideNotObserved', status: 'routeComparisonUnavailable', unavailableSide: 'both' },
    { finalUnavailableReason: 'succeededRoundExecutionNotObserved', initialUnavailableReason: 'initialRouteOverrideNotObserved', status: 'routeComparisonUnavailable', unavailableSide: 'both' },
    { finalUnavailableReason: 'multipleExecutionsForSucceededRoundObserved', initialUnavailableReason: 'initialRouteOverrideNotObserved', status: 'routeComparisonUnavailable', unavailableSide: 'both' },
  ],
  noInitialRouteOverride: [
    { finalUnavailableReason: 'sendTerminalNotObserved', initialUnavailableReason: 'noInitialRouteOverride', status: 'routeComparisonUnavailable', unavailableSide: 'both' },
    { finalUnavailableReason: 'sendFailed', initialUnavailableReason: 'noInitialRouteOverride', status: 'routeComparisonUnavailable', unavailableSide: 'both' },
    { finalUnavailableReason: 'noSucceededRoundObserved', initialUnavailableReason: 'noInitialRouteOverride', status: 'routeComparisonUnavailable', unavailableSide: 'both' },
    { finalUnavailableReason: 'multipleSucceededRoundTerminalsObserved', initialUnavailableReason: 'noInitialRouteOverride', status: 'routeComparisonUnavailable', unavailableSide: 'both' },
    { finalUnavailableReason: 'succeededRoundExecutionNotObserved', initialUnavailableReason: 'noInitialRouteOverride', status: 'routeComparisonUnavailable', unavailableSide: 'both' },
    { finalUnavailableReason: 'multipleExecutionsForSucceededRoundObserved', initialUnavailableReason: 'noInitialRouteOverride', status: 'routeComparisonUnavailable', unavailableSide: 'both' },
  ],
} as const

/** Initial known, final unknown: 6 cells, in final-state order. */
const FINAL_SIDE_UNAVAILABLE = [
  { finalUnavailableReason: 'sendTerminalNotObserved', status: 'routeComparisonUnavailable', unavailableSide: 'final' },
  { finalUnavailableReason: 'sendFailed', status: 'routeComparisonUnavailable', unavailableSide: 'final' },
  { finalUnavailableReason: 'noSucceededRoundObserved', status: 'routeComparisonUnavailable', unavailableSide: 'final' },
  { finalUnavailableReason: 'multipleSucceededRoundTerminalsObserved', status: 'routeComparisonUnavailable', unavailableSide: 'final' },
  { finalUnavailableReason: 'succeededRoundExecutionNotObserved', status: 'routeComparisonUnavailable', unavailableSide: 'final' },
  { finalUnavailableReason: 'multipleExecutionsForSucceededRoundObserved', status: 'routeComparisonUnavailable', unavailableSide: 'final' },
] as const

/** Final known, initial unknown: 2 cells. */
const INITIAL_SIDE_UNAVAILABLE: Record<string, { initialUnavailableReason: 'initialRouteOverrideNotObserved' | 'noInitialRouteOverride', status: 'routeComparisonUnavailable', unavailableSide: 'initial' }> = {
  initialRouteOverrideNotObserved: { initialUnavailableReason: 'initialRouteOverrideNotObserved', status: 'routeComparisonUnavailable', unavailableSide: 'initial' },
  noInitialRouteOverride: { initialUnavailableReason: 'noInitialRouteOverride', status: 'routeComparisonUnavailable', unavailableSide: 'initial' },
}

/** The one comparable cell, with identical identities on both sides. */
const COMPARABLE_MATCHED: LiaBrainRouteConformanceFacts = {
  modelMatches: true,
  providerMatches: true,
  status: 'routeIdentityMatched',
}

/**
 * The hand-written expectation for one cell. Every branch is a literal declared
 * above, so this function only SELECTS an oracle - it never computes one.
 */
function expectedCell(initialLabel: string, finalIndex: number, finalObserved: boolean, initialObserved: boolean): LiaBrainRouteConformanceFacts {
  if (initialObserved && finalObserved)
    return COMPARABLE_MATCHED
  if (initialObserved)
    return FINAL_SIDE_UNAVAILABLE[finalIndex]!
  if (finalObserved)
    return INITIAL_SIDE_UNAVAILABLE[initialLabel]!
  return BOTH_UNAVAILABLE[initialLabel as keyof typeof BOTH_UNAVAILABLE][finalIndex]
}

describe('route conformance facts - the complete 3 x 7 truth table (Phase 8.0D-10B-4D4C4-D2B10)', () => {
  it('the state space really is 3 x 7 = 21 cells, with exactly one comparable pair', () => {
    expect(INITIAL_STATES).toHaveLength(3)
    expect(FINAL_STATES).toHaveLength(7)
    expect(INITIAL_STATES.filter(state => state.observed)).toHaveLength(1)
    expect(FINAL_STATES.filter(state => state.observed)).toHaveLength(1)
    expect(new Set(INITIAL_STATES.map(state => state.label)).size).toBe(3)
    expect(new Set(FINAL_STATES.map(state => state.label)).size).toBe(7)
    // 12 both-unavailable + 6 final-side + 2 initial-side + 1 comparable.
    expect(12 + 6 + 2 + 1).toBe(21)
  })

  for (const initial of INITIAL_STATES) {
    for (const [finalIndex, final] of FINAL_STATES.entries()) {
      it(`${initial.label} x ${final.label}`, () => {
        const expected = expectedCell(initial.label, finalIndex, final.observed, initial.observed)
        const result = deriveLiaBrainRouteConformanceFacts(initial.facts, final.facts)

        // The whole cell, exactly - every value and no extra key.
        expect(result).toEqual(expected)
        expect(Object.keys(result).sort()).toEqual(Object.keys(expected).sort())

        // No cell ever carries an identity, a round key or an arrival index.
        for (const forbidden of ['providerId', 'modelId', 'roundId', 'executionArrivalIndex', 'initialProviderId', 'finalProviderId', 'initialModelId', 'finalModelId'])
          expect(result, forbidden).not.toHaveProperty(forbidden)
      })
    }
  }
})

describe('route conformance facts - unavailability side vocabulary (Phase 8.0D-10B-4D4C4-D2B10)', () => {
  it('initial unavailable + final unavailable -> unavailableSide is BOTH, with both reasons', () => {
    expect(deriveLiaBrainRouteConformanceFacts(INITIAL_NOT_OBSERVED, FINAL_NOT_OBSERVED)).toEqual({
      finalUnavailableReason: 'sendTerminalNotObserved',
      initialUnavailableReason: 'initialRouteOverrideNotObserved',
      status: 'routeComparisonUnavailable',
      unavailableSide: 'both',
    })
    expect(deriveLiaBrainRouteConformanceFacts(NO_INITIAL_ROUTE, FINAL_SEND_FAILED)).toEqual({
      finalUnavailableReason: 'sendFailed',
      initialUnavailableReason: 'noInitialRouteOverride',
      status: 'routeComparisonUnavailable',
      unavailableSide: 'both',
    })
  })

  it('initial unavailable + final observed -> unavailableSide is INITIAL only, and the known final identity is not duplicated', () => {
    for (const initial of INITIAL_STATES.filter(state => !state.observed)) {
      const result = deriveLiaBrainRouteConformanceFacts(initial.facts, FINAL_OBSERVED)
      expect(result).toEqual({
        initialUnavailableReason: initial.label,
        status: 'routeComparisonUnavailable',
        unavailableSide: 'initial',
      })
      expect(result).not.toHaveProperty('finalUnavailableReason')
    }
  })

  it('initial observed + final unavailable -> unavailableSide is FINAL only', () => {
    for (const final of FINAL_STATES.filter(state => !state.observed)) {
      const result = deriveLiaBrainRouteConformanceFacts(INITIAL_OBSERVED, final.facts)
      expect(result).toEqual({
        finalUnavailableReason: final.label,
        status: 'routeComparisonUnavailable',
        unavailableSide: 'final',
      })
      expect(result).not.toHaveProperty('initialUnavailableReason')
    }
  })

  it('both observed -> comparable, and no unavailability vocabulary appears', () => {
    const result = deriveLiaBrainRouteConformanceFacts(INITIAL_OBSERVED, FINAL_OBSERVED)
    expect(result.status).toBe('routeIdentityMatched')
    expect(result).not.toHaveProperty('unavailableSide')
    expect(result).not.toHaveProperty('initialUnavailableReason')
    expect(result).not.toHaveProperty('finalUnavailableReason')
  })

  it('every unavailable result names at least one side and exactly its reason(s)', () => {
    for (const initial of INITIAL_STATES) {
      for (const final of FINAL_STATES) {
        const result = deriveLiaBrainRouteConformanceFacts(initial.facts, final.facts)
        if (result.status !== 'routeComparisonUnavailable')
          continue
        expect(['initial', 'final', 'both']).toContain(result.unavailableSide)
        if (result.unavailableSide === 'initial') {
          expect(typeof result.initialUnavailableReason).toBe('string')
          expect(result).not.toHaveProperty('finalUnavailableReason')
        }
        if (result.unavailableSide === 'final') {
          expect(typeof result.finalUnavailableReason).toBe('string')
          expect(result).not.toHaveProperty('initialUnavailableReason')
        }
        if (result.unavailableSide === 'both') {
          expect(typeof result.initialUnavailableReason).toBe('string')
          expect(typeof result.finalUnavailableReason).toBe('string')
        }
      }
    }
  })

  it('no reason is ever a bare observed state - unavailability never borrows an identity state', () => {
    for (const initial of INITIAL_STATES) {
      for (const final of FINAL_STATES) {
        const result = deriveLiaBrainRouteConformanceFacts(initial.facts, final.facts)
        if (result.status !== 'routeComparisonUnavailable')
          continue
        const reasons: string[] = []
        if ('initialUnavailableReason' in result)
          reasons.push(result.initialUnavailableReason)
        if ('finalUnavailableReason' in result)
          reasons.push(result.finalUnavailableReason)
        expect(reasons.length).toBeGreaterThan(0)
        expect(reasons).not.toContain('initialRouteOverrideObserved')
        expect(reasons).not.toContain('finalSuccessfulExecutionObserved')
      }
    }
  })

  it('the two initial absence states stay distinct and are never collapsed into one reason', () => {
    const notObserved = deriveLiaBrainRouteConformanceFacts(INITIAL_NOT_OBSERVED, FINAL_OBSERVED)
    const observedAbsent = deriveLiaBrainRouteConformanceFacts(NO_INITIAL_ROUTE, FINAL_OBSERVED)
    expect(notObserved).not.toEqual(observedAbsent)
    expect('initialUnavailableReason' in notObserved && notObserved.initialUnavailableReason).toBe('initialRouteOverrideNotObserved')
    expect('initialUnavailableReason' in observedAbsent && observedAbsent.initialUnavailableReason).toBe('noInitialRouteOverride')
  })

  it('an observed-absent initial route is NOT reported as a difference against a known final identity', () => {
    const result = deriveLiaBrainRouteConformanceFacts(NO_INITIAL_ROUTE, FINAL_OBSERVED)
    expect(result.status).toBe('routeComparisonUnavailable')
    expect(result.status).not.toBe('routeIdentityDiffered')
    expect(result.status).not.toBe('routeIdentityMatched')
  })

  it('a non-unique final execution is never compared, even with a known initial identity', () => {
    const multipleRounds = deriveLiaBrainRouteConformanceFacts(INITIAL_OBSERVED, FINAL_MULTIPLE_ROUNDS)
    const multipleExecutions = deriveLiaBrainRouteConformanceFacts(INITIAL_OBSERVED, FINAL_MULTIPLE_EXECUTIONS)
    for (const result of [multipleRounds, multipleExecutions]) {
      expect(result.status).toBe('routeComparisonUnavailable')
      expect(result.status).not.toBe('routeIdentityDiffered')
      expect(result.status).not.toBe('routeIdentityMatched')
    }
    expect('finalUnavailableReason' in multipleRounds && multipleRounds.finalUnavailableReason).toBe('multipleSucceededRoundTerminalsObserved')
    expect('finalUnavailableReason' in multipleExecutions && multipleExecutions.finalUnavailableReason).toBe('multipleExecutionsForSucceededRoundObserved')
  })
})

describe('route conformance facts - the four identity relations (Phase 8.0D-10B-4D4C4-D2B10)', () => {
  const initialFacts = (providerId: string, modelId: string): LiaBrainInitialRouteObservationFacts => ({
    modelId,
    providerId,
    status: 'initialRouteOverrideObserved',
  })
  const finalFacts = (providerId: string, modelId: string): LiaBrainFinalSuccessfulExecutionFacts => ({
    executionArrivalIndex: 2,
    modelId,
    providerId,
    roundId: 'R1',
    status: 'finalSuccessfulExecutionObserved',
  })

  it('same provider + same model -> routeIdentityMatched with both booleans true', () => {
    expect(deriveLiaBrainRouteConformanceFacts(initialFacts('groq', 'llama-3.3-70b'), finalFacts('groq', 'llama-3.3-70b'))).toEqual({
      modelMatches: true,
      providerMatches: true,
      status: 'routeIdentityMatched',
    })
  })

  it('same provider + different model -> routeIdentityDiffered with providerMatches only', () => {
    expect(deriveLiaBrainRouteConformanceFacts(initialFacts('groq', 'llama-3.3-70b'), finalFacts('groq', 'llama-3.1-8b'))).toEqual({
      modelMatches: false,
      providerMatches: true,
      status: 'routeIdentityDiffered',
    })
  })

  it('different provider + same model -> routeIdentityDiffered with modelMatches only', () => {
    expect(deriveLiaBrainRouteConformanceFacts(initialFacts('groq', 'llama-3.3-70b'), finalFacts('openai', 'llama-3.3-70b'))).toEqual({
      modelMatches: true,
      providerMatches: false,
      status: 'routeIdentityDiffered',
    })
  })

  it('different provider + different model -> routeIdentityDiffered with both booleans false', () => {
    expect(deriveLiaBrainRouteConformanceFacts(initialFacts('groq', 'llama-3.3-70b'), finalFacts('openai', 'gpt-oss-120b'))).toEqual({
      modelMatches: false,
      providerMatches: false,
      status: 'routeIdentityDiffered',
    })
  })

  it('the three differing relations are distinct results, and none of them is a match', () => {
    const base = initialFacts('groq', 'llama-3.3-70b')
    const partialModel = deriveLiaBrainRouteConformanceFacts(base, finalFacts('groq', 'llama-3.1-8b'))
    const partialProvider = deriveLiaBrainRouteConformanceFacts(base, finalFacts('openai', 'llama-3.3-70b'))
    const total = deriveLiaBrainRouteConformanceFacts(base, finalFacts('openai', 'gpt-oss-120b'))
    expect(partialModel).not.toEqual(partialProvider)
    expect(partialModel).not.toEqual(total)
    expect(partialProvider).not.toEqual(total)
    for (const result of [partialModel, partialProvider, total]) {
      expect(result.status).toBe('routeIdentityDiffered')
      expect(result).not.toEqual({ modelMatches: true, providerMatches: true, status: 'routeIdentityDiffered' })
    }
  })

  it('a differing identity is not a match, and a match never reports a difference', () => {
    const matched = deriveLiaBrainRouteConformanceFacts(initialFacts('groq', 'm'), finalFacts('groq', 'm'))
    const differed = deriveLiaBrainRouteConformanceFacts(initialFacts('groq', 'm'), finalFacts('groq', 'n'))
    expect(matched.status).toBe('routeIdentityMatched')
    expect(differed.status).toBe('routeIdentityDiffered')
    expect(matched.status).not.toBe(differed.status)
  })

  it('the comparison is symmetric in its operands but never reorders them', () => {
    const forward = deriveLiaBrainRouteConformanceFacts(initialFacts('groq', 'a'), finalFacts('openai', 'b'))
    const backward = deriveLiaBrainRouteConformanceFacts(initialFacts('openai', 'b'), finalFacts('groq', 'a'))
    expect(forward).toEqual(backward)
    expect(forward).toEqual({ modelMatches: false, providerMatches: false, status: 'routeIdentityDiffered' })
  })
})

describe('route conformance facts - exact string equality only (Phase 8.0D-10B-4D4C4-D2B10)', () => {
  const initialFacts = (providerId: string, modelId: string): LiaBrainInitialRouteObservationFacts => ({
    modelId,
    providerId,
    status: 'initialRouteOverrideObserved',
  })
  const finalFacts = (providerId: string, modelId: string): LiaBrainFinalSuccessfulExecutionFacts => ({
    executionArrivalIndex: 0,
    modelId,
    providerId,
    roundId: 'R1',
    status: 'finalSuccessfulExecutionObserved',
  })

  it('provider case is not folded: groq and Groq differ', () => {
    expect(deriveLiaBrainRouteConformanceFacts(initialFacts('groq', 'm'), finalFacts('Groq', 'm'))).toEqual({
      modelMatches: true,
      providerMatches: false,
      status: 'routeIdentityDiffered',
    })
  })

  it('model case is not folded: model-a and MODEL-A differ', () => {
    expect(deriveLiaBrainRouteConformanceFacts(initialFacts('p', 'model-a'), finalFacts('p', 'MODEL-A'))).toEqual({
      modelMatches: false,
      providerMatches: true,
      status: 'routeIdentityDiffered',
    })
  })

  it('surrounding whitespace is not folded: "model-a" and " model-a" differ', () => {
    expect(deriveLiaBrainRouteConformanceFacts(initialFacts('p', 'model-a'), finalFacts('p', ' model-a'))).toEqual({
      modelMatches: false,
      providerMatches: true,
      status: 'routeIdentityDiffered',
    })
    expect(deriveLiaBrainRouteConformanceFacts(initialFacts('p', 'model-a'), finalFacts('p', 'model-a '))).toEqual({
      modelMatches: false,
      providerMatches: true,
      status: 'routeIdentityDiffered',
    })
  })

  it('a prefix or substring is not an alias: llama-3 and llama-3.3-70b differ', () => {
    expect(deriveLiaBrainRouteConformanceFacts(initialFacts('p', 'llama-3'), finalFacts('p', 'llama-3.3-70b'))).toEqual({
      modelMatches: false,
      providerMatches: true,
      status: 'routeIdentityDiffered',
    })
  })

  it('two empty strings are equal to each other - equality is mechanical, not semantic', () => {
    expect(deriveLiaBrainRouteConformanceFacts(initialFacts('', ''), finalFacts('', ''))).toEqual({
      modelMatches: true,
      providerMatches: true,
      status: 'routeIdentityMatched',
    })
  })

  it('no result ever normalizes an identity into another one', () => {
    const result = deriveLiaBrainRouteConformanceFacts(initialFacts('groq', 'model-a'), finalFacts('Groq', 'MODEL-A'))
    expect(result).toEqual({ modelMatches: false, providerMatches: false, status: 'routeIdentityDiffered' })
  })
})

describe('route conformance facts - purity (Phase 8.0D-10B-4D4C4-D2B10)', () => {
  const initial = (): LiaBrainInitialRouteObservationFacts => ({
    modelId: 'llama-3.3-70b',
    providerId: 'groq',
    status: 'initialRouteOverrideObserved',
  })
  const final = (): LiaBrainFinalSuccessfulExecutionFacts => ({
    executionArrivalIndex: 1,
    modelId: 'gpt-oss-120b',
    providerId: 'openai',
    roundId: 'R1',
    status: 'finalSuccessfulExecutionObserved',
  })

  it('deep-frozen inputs are accepted and are not mutated', () => {
    const frozenInitial = deepFreeze(initial())
    const frozenFinal = deepFreeze(final())
    const beforeInitial = JSON.stringify(frozenInitial)
    const beforeFinal = JSON.stringify(frozenFinal)

    // A mutation attempt on a frozen input throws in strict mode; the derivation
    // must not attempt one.
    expect(() => deriveLiaBrainRouteConformanceFacts(frozenInitial, frozenFinal)).not.toThrow()

    expect(JSON.stringify(frozenInitial)).toBe(beforeInitial)
    expect(JSON.stringify(frozenFinal)).toBe(beforeFinal)
    expect(Object.isFrozen(frozenInitial)).toBe(true)
    expect(Object.isFrozen(frozenFinal)).toBe(true)
  })

  it('unavailable results also leave deep-frozen inputs untouched', () => {
    const frozenInitial = deepFreeze<LiaBrainInitialRouteObservationFacts>({ status: 'noInitialRouteOverride' })
    const frozenFinal = deepFreeze<LiaBrainFinalSuccessfulExecutionFacts>({ roundId: 'R9', status: 'succeededRoundExecutionNotObserved' })
    expect(() => deriveLiaBrainRouteConformanceFacts(frozenInitial, frozenFinal)).not.toThrow()
    expect(frozenFinal).toEqual({ roundId: 'R9', status: 'succeededRoundExecutionNotObserved' })
  })

  it('repeated derivation is deterministic', () => {
    const first = deriveLiaBrainRouteConformanceFacts(initial(), final())
    const second = deriveLiaBrainRouteConformanceFacts(initial(), final())
    const third = deriveLiaBrainRouteConformanceFacts(initial(), final())
    expect(second).toEqual(first)
    expect(third).toEqual(first)
  })

  it('every returned object is fresh - no cached singleton', () => {
    const first = deriveLiaBrainRouteConformanceFacts(initial(), final())
    const second = deriveLiaBrainRouteConformanceFacts(initial(), final())
    expect(second).not.toBe(first)
    expect(second).toEqual(first)
  })

  it('the result shares no object with either input', () => {
    const initialFacts = initial()
    const finalFacts = final()
    const result = deriveLiaBrainRouteConformanceFacts(initialFacts, finalFacts) as Record<string, unknown>
    for (const value of Object.values(result))
      expect(typeof value).not.toBe('object')
    expect(result).not.toBe(initialFacts)
    expect(result).not.toBe(finalFacts)
  })

  it('the result carries no raw snapshot, no identity and no duplicated field', () => {
    const result = deriveLiaBrainRouteConformanceFacts(initial(), final())
    const serialized = JSON.stringify(result)
    for (const forbidden of [
      'providerId',
      'modelId',
      'roundId',
      'executionArrivalIndex',
      'groq',
      'openai',
      'llama-3.3-70b',
      'gpt-oss-120b',
      'snapshot',
      'executions',
      'executionTerminals',
      'decision',
      'correlationId',
      'initialRouteOverride',
    ])
      expect(serialized, forbidden).not.toContain(forbidden)
  })

  it('an unavailable result carries only status, side and reason(s)', () => {
    const result = deriveLiaBrainRouteConformanceFacts(NO_INITIAL_ROUTE, FINAL_SEND_FAILED)
    expect(Object.keys(result).sort()).toEqual([
      'finalUnavailableReason',
      'initialUnavailableReason',
      'status',
      'unavailableSide',
    ])
  })

  it('the derivation is synchronous and returns a plain object', () => {
    const result = deriveLiaBrainRouteConformanceFacts(INITIAL_OBSERVED, FINAL_OBSERVED)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(result).not.toBeInstanceOf(Promise)
  })
})

describe('route conformance facts - source guards (Phase 8.0D-10B-4D4C4-D2B10)', () => {
  const source = readSource('./brain-route-conformance-facts.ts')
  const code = stripComments(source)

  it('the dependency surface is exactly two TYPE imports and nothing else', () => {
    expect(code.match(/^import .*$/gm)).toEqual([
      `import type { LiaBrainFinalSuccessfulExecutionFacts } from './brain-final-successful-execution-facts'`,
      `import type { LiaBrainInitialRouteObservationFacts } from './brain-initial-route-facts'`,
    ])
    // Both are type-only: this module has no runtime dependency at all.
    expect(code).not.toMatch(/^import (?!type )/m)
  })

  it('the exported surface is exactly the fact type and the derivation', () => {
    expect([...code.matchAll(/^export (?:const|function|interface|type) (\w+)/gm)].map(match => match[1])).toEqual([
      'LiaBrainRouteConformanceFacts',
      'deriveLiaBrainRouteConformanceFacts',
    ])
  })

  it('the reason vocabularies are DERIVED structurally, never re-declared', () => {
    expect(code).toMatch(/type LiaBrainInitialRouteUnavailableReason\s*=\s*Exclude<LiaBrainInitialRouteObservationFacts, \{ status: 'initialRouteOverrideObserved' \}>\['status'\]/)
    expect(code).toMatch(/type LiaBrainFinalExecutionUnavailableReason\s*=\s*Exclude<LiaBrainFinalSuccessfulExecutionFacts, \{ status: 'finalSuccessfulExecutionObserved' \}>\['status'\]/)
    // Neither alias is exported: it is an internal structural detail.
    expect(code).not.toMatch(/^export type LiaBrain(?:InitialRoute|FinalExecution)UnavailableReason/m)
  })

  it('it reaches no store, reader, observer, transport, channel or environment', () => {
    for (const forbidden of [
      /brain-correlation-store/,
      /brain-correlation-reader/,
      /brain-correlation-service/,
      /brain-correlation-observer/,
      /brain-diagnostic-log/,
      /brain-expected-route/,
      /LiaBrainCorrelation/,
      /electronLiaBrain/,
      /eventa|defineEventa|ipcMain|ipcRenderer|BrowserWindow/,
      /LIA_BRAIN_ENGINE_PROVIDER_MAPPING|providerIdForEngine/,
      /new Map|new Set|WeakMap|WeakSet|\bcache\b|\bhistory\b/,
      /from ['"](?:node:)?(?:fs|net|https?|child_process|dns|dgram|timers)['/]/,
      /\bfetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage/,
      /console\.|useLogg|logger|telemetry/i,
      /setInterval|setTimeout|Date\.now|performance\.now|Math\.random/,
      /\basync\b|\bawait\b|\bPromise\b|queueMicrotask/,
      /\.observe\(|recordDecision|recordExecution|recordSendTerminal/,
    ])
      expect(code, String(forbidden)).not.toMatch(forbidden)
  })

  it('it performs no normalization, no assertion and no defensive repair', () => {
    for (const forbidden of [/\.trim\(/, /\.toLowerCase\(/, /\.toUpperCase\(/, /\.slice\(/, /\.replace\(/, /\.split\(/, /\bisRecord\b/, /\bJSON\./, /structuredClone/, /\bas \w/])
      expect(code, String(forbidden)).not.toMatch(forbidden)
  })

  it('the equality is raw === on the two identity components, and the only two === in the module', () => {
    expect(code).toMatch(/initialRouteOverrideFacts\.providerId === finalSuccessfulExecutionFacts\.providerId/)
    expect(code).toMatch(/initialRouteOverrideFacts\.modelId === finalSuccessfulExecutionFacts\.modelId/)
    expect(code.match(/===/g)).toHaveLength(2)
  })

  it('availability is read from the two discriminants directly, with no assertion', () => {
    expect(code).toMatch(/initialRouteOverrideFacts\.status !== 'initialRouteOverrideObserved'/)
    expect(code).toMatch(/finalSuccessfulExecutionFacts\.status !== 'finalSuccessfulExecutionObserved'/)
    expect(code).not.toMatch(/\bas \{|as unknown/)
  })

  it('it never names a judgement word or an upstream send-level term', () => {
    for (const forbidden of [
      /fallback/i,
      /\bretry/i,
      /\bcatalog\b/i,
      /mapping/i,
      /winner|finalAttempt|winningAttempt/,
      /routeMatch|mismatch|contradiction|anomaly|orphan/i,
      /violation|noncompliant|incorrect|degraded|unexpected|\bwrong\b|\bbad\b|\bbroken\b|\brejected\b/i,
      /sendFailed|sendSucceeded|sendTerminalObserved|sendTerminalOutcome|sendTerminal/,
    ])
      expect(source, String(forbidden)).not.toMatch(forbidden)
  })

  it('it never reads a raw snapshot field - only the two facts it is handed', () => {
    expect(source).not.toMatch(/snapshot\.\w+|\.initialRouteOverride\b|\.executionTerminals\b|\.sendTerminal\b|\.executions\b|\.decision\b|\.createdAt\b/)
    // Its only property reads are the two discriminants and the four identity
    // components - twelve reads in total, in source order, and nothing else.
    expect(code.match(/\b(?:initialRouteOverrideFacts|finalSuccessfulExecutionFacts)\.\w+/g)).toEqual([
      'initialRouteOverrideFacts.status',
      'finalSuccessfulExecutionFacts.status',
      'finalSuccessfulExecutionFacts.status',
      'initialRouteOverrideFacts.status',
      'initialRouteOverrideFacts.status',
      'initialRouteOverrideFacts.status',
      'finalSuccessfulExecutionFacts.status',
      'finalSuccessfulExecutionFacts.status',
      'initialRouteOverrideFacts.providerId',
      'finalSuccessfulExecutionFacts.providerId',
      'initialRouteOverrideFacts.modelId',
      'finalSuccessfulExecutionFacts.modelId',
    ])
    // Which is to say: exactly three distinct property names are ever read.
    const readProperties = new Set(
      (code.match(/\b(?:initialRouteOverrideFacts|finalSuccessfulExecutionFacts)\.(\w+)/g) ?? [])
        .map(read => read.slice(read.lastIndexOf('.') + 1)),
    )
    expect([...readProperties].sort()).toEqual(['modelId', 'providerId', 'status'])
  })

  it('the module does not expand any repo-wide production vocabulary ownership allowlist', () => {
    // These are the exact patterns the existing listener/service/store guards run
    // over RAW production source. The new file must appear in NONE of them.
    for (const pattern of [
      /sendTerminalOutcome|sendTerminalObserved|sendSucceeded|sendFailed/,
      /sendTerminalObserved|sendSucceeded|sendFailed/,
      /sendTerminalOutcome|sendTerminalObserved/,
      /sendTerminalObserved/,
      /sendTerminalOutcome/,
      /recordSendTerminal/,
      /recordExecutionTerminal\(/,
      /electronLiaBrain|LiaBrainChatDecision|brain-shadow|LiaBrainCorrelation/,
      /correlationObserver\.observe\(/,
    ]) {
      expect(productionMatching(pattern), String(pattern)).not.toContain(ROUTE_CONFORMANCE_FACTS)
    }
    // The upstream module keeps its exclusive ownership of the send-level
    // vocabulary, unchanged by this phase.
    expect(productionMatching(/sendTerminalObserved|sendSucceeded|sendFailed/)).toEqual([FINAL_FACTS])
  })

  it('the dependency is linear: neither upstream module knows this layer exists', () => {
    expect(readSource('./brain-initial-route-facts.ts')).not.toMatch(/brain-route-conformance-facts|LiaBrainRouteConformanceFacts/)
    expect(readSource('./brain-final-successful-execution-facts.ts')).not.toMatch(/brain-route-conformance-facts|LiaBrainRouteConformanceFacts/)
    expect(stripComments(readSource('./brain-initial-route-facts.ts'))).toMatch(/deriveLiaBrainInitialRouteObservationFacts/)
    expect(stripComments(readSource('./brain-final-successful-execution-facts.ts'))).toMatch(/deriveLiaBrainFinalSuccessfulExecutionFacts/)
  })

  it('this module has exactly ONE production caller - the composition', () => {
    expect(productionMatching(/deriveLiaBrainRouteConformanceFacts/)).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-diagnostic-facts.ts',
      ROUTE_CONFORMANCE_FACTS,
    ])
  })
})
