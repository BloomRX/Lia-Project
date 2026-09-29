import type { LiaBrainRoutingDecision } from '@lia/core'

import type { LiaBrainExecutionObservationReport, LiaBrainExecutionTerminalReport } from '../../../shared/eventa'
import type { LiaBrainCorrelationDiagnosticFacts } from './brain-correlation-diagnostic-facts'
import type { LiaBrainCorrelationSnapshot, LiaBrainCorrelationSnapshotReader, LiaBrainEngineProviderLookup } from './brain-correlation-reader'
import type { LiaBrainExecutionIdentityFacts, LiaBrainExecutionIdentitySnapshot } from './brain-execution-identity-facts'
import type { LiaBrainTerminalObservationFacts, LiaBrainTerminalObservationSnapshot } from './brain-execution-terminal-facts'
import type { LiaBrainEngineProviderMapping } from './brain-expected-route'
import type { LiaBrainFinalSuccessfulExecutionFacts, LiaBrainFinalSuccessfulExecutionSnapshot } from './brain-final-successful-execution-facts'
import type { LiaBrainSendTerminalObservationFacts, LiaBrainSendTerminalObservationSnapshot } from './brain-send-terminal-facts'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createProductionBrainAutomaticPolicy, createProductionBrainCatalog, decideBrainRoute } from '@lia/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { composeLiaBrainCorrelationDiagnosticFacts } from './brain-correlation-diagnostic-facts'
import { createLiaBrainCorrelationStore } from './brain-correlation-store'
import { deriveLiaBrainExecutionIdentityFacts } from './brain-execution-identity-facts'
import { LIA_BRAIN_ENGINE_PROVIDER_MAPPING } from './brain-expected-route'

/**
 * Phase 8.0D-10B-4D4C3B2: the focused proof of the ONE-SNAPSHOT diagnostic
 * composition.
 *
 * The composition is proven as a READ + FOUR DELEGATIONS boundary only: exactly
 * one snapshot read, the explicit absence state when nothing live exists, and all
 * four approved derivations over the SAME snapshot object - otherwise nothing.
 * Nothing here adds an observer entry or an output line.
 *
 * Four narrow module doubles make the delegations observable (which object,
 * which arguments, how many calls) while the behavior under test stays the REAL
 * derivations: each double forwards to the actual implementation.
 */

const probes = vi.hoisted(() => ({
  identity: { inputs: [] as unknown[], mappings: [] as unknown[] },
  terminal: { argumentCounts: [] as number[], inputs: [] as unknown[] },
  send: { argumentCounts: [] as number[], inputs: [] as unknown[] },
  final: { argumentCounts: [] as number[], inputs: [] as unknown[] },
  initialRoute: { argumentCounts: [] as number[], inputs: [] as unknown[] },
}))

vi.mock('./brain-execution-identity-facts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./brain-execution-identity-facts')>()
  return {
    ...actual,
    deriveLiaBrainExecutionIdentityFacts(...args: Parameters<typeof actual.deriveLiaBrainExecutionIdentityFacts>) {
      probes.identity.inputs.push(args[0])
      probes.identity.mappings.push(args[1])
      return actual.deriveLiaBrainExecutionIdentityFacts(...args)
    },
  }
})

vi.mock('./brain-execution-terminal-facts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./brain-execution-terminal-facts')>()
  return {
    ...actual,
    deriveLiaBrainTerminalObservationFacts(...args: Parameters<typeof actual.deriveLiaBrainTerminalObservationFacts>) {
      probes.terminal.argumentCounts.push(args.length)
      probes.terminal.inputs.push(args[0])
      return actual.deriveLiaBrainTerminalObservationFacts(...args)
    },
  }
})

vi.mock('./brain-send-terminal-facts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./brain-send-terminal-facts')>()
  return {
    ...actual,
    deriveLiaBrainSendTerminalObservationFacts(...args: Parameters<typeof actual.deriveLiaBrainSendTerminalObservationFacts>) {
      probes.send.argumentCounts.push(args.length)
      probes.send.inputs.push(args[0])
      return actual.deriveLiaBrainSendTerminalObservationFacts(...args)
    },
  }
})

vi.mock('./brain-final-successful-execution-facts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./brain-final-successful-execution-facts')>()
  return {
    ...actual,
    deriveLiaBrainFinalSuccessfulExecutionFacts(...args: Parameters<typeof actual.deriveLiaBrainFinalSuccessfulExecutionFacts>) {
      probes.final.argumentCounts.push(args.length)
      probes.final.inputs.push(args[0])
      return actual.deriveLiaBrainFinalSuccessfulExecutionFacts(...args)
    },
  }
})

vi.mock('./brain-initial-route-facts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./brain-initial-route-facts')>()
  return {
    ...actual,
    deriveLiaBrainInitialRouteObservationFacts(...args: Parameters<typeof actual.deriveLiaBrainInitialRouteObservationFacts>) {
      probes.initialRoute.argumentCounts.push(args.length)
      probes.initialRoute.inputs.push(args[0])
      return actual.deriveLiaBrainInitialRouteObservationFacts(...args)
    },
  }
})

/** Clears the probes so one test's delegations cannot leak into the next. */
function resetProbes(): void {
  probes.identity.inputs.length = 0
  probes.identity.mappings.length = 0
  probes.terminal.argumentCounts.length = 0
  probes.terminal.inputs.length = 0
  probes.send.argumentCounts.length = 0
  probes.send.inputs.length = 0
  probes.final.argumentCounts.length = 0
  probes.final.inputs.length = 0
  probes.initialRoute.argumentCounts.length = 0
  probes.initialRoute.inputs.length = 0
}

beforeEach(resetProbes)

const REPO_ROOT = new URL('../../../../../../', import.meta.url)
const COMPOSITION = 'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-diagnostic-facts.ts'
const OBSERVER = 'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-observer.ts'
const BRAIN_ROOTS = ['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src', 'packages/lia-core/src']

/** `fileURLToPath` keeps the trailing separator of a directory URL. */
const REPO_PREFIX = `${fileURLToPath(REPO_ROOT).replace(/\/+$/, '')}/`

function productionSources(roots: string[]): string[] {
  const files: string[] = []
  for (const root of roots) {
    for (const entry of readdirSync(new URL(root, REPO_ROOT), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.'))
        continue
      files.push(`${entry.parentPath.slice(REPO_PREFIX.length)}/${entry.name}`)
    }
  }
  return files
}

/** The production files matching one pattern, sorted - the caller allowlist shape. */
function productionMatching(pattern: RegExp): string[] {
  return productionSources(BRAIN_ROOTS)
    .filter(relative => pattern.test(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
    .sort()
}

/** The production source of one repo-relative path. */
function readSource(relative: string): string {
  return readFileSync(new URL(relative, REPO_ROOT), 'utf-8')
}

/** Code without comments - guards must only find the words in real code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const GROQ_ENGINE_ID = 'groq'
const GROQ_MODEL_ID = 'openai/gpt-oss-120b'

/** The audited production decision, from the canonical router. */
function productionDecision(): LiaBrainRoutingDecision {
  const catalog = createProductionBrainCatalog()
  return decideBrainRoute({
    automaticPolicy: createProductionBrainAutomaticPolicy(),
    engines: catalog.engines,
    models: catalog.models,
    mode: 'automatic',
    requirement: { required: ['textInput', 'textOutput'] },
  })
}

/** The REAL canonical store, driven directly - the production snapshot source. */
function realStore(maxEntries = 8) {
  let clock = 1_000
  return {
    store: createLiaBrainCorrelationStore({ maxEntries, now: () => clock, ttlMs: 900_000 }),
    advance: (milliseconds: number) => {
      clock += milliseconds
    },
  }
}

function executionReport(correlationId: string, roundId: string): LiaBrainExecutionObservationReport {
  return {
    conversationId: 'conversation-1',
    correlationId,
    modelId: GROQ_MODEL_ID,
    providerId: GROQ_ENGINE_ID,
    roundId,
  }
}

function terminalReport(correlationId: string, roundId: string, outcome: LiaBrainExecutionTerminalReport['outcome']): LiaBrainExecutionTerminalReport {
  return { correlationId, outcome, roundId }
}

/** A structural snapshot double: one observed start, one terminal record. */
function snapshot(overrides: Partial<LiaBrainCorrelationSnapshot> = {}): LiaBrainCorrelationSnapshot {
  return { executions: [], executionTerminals: [], ...overrides }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value))
      deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

/** A recording structural reader double: serves snapshots, counts every read. */
function recordingReader(snapshots: Record<string, LiaBrainCorrelationSnapshot | undefined>) {
  const calls: string[] = []
  const reader = {
    get(correlationId: string): LiaBrainCorrelationSnapshot | undefined {
      calls.push(correlationId)
      return snapshots[correlationId]
    },
  } satisfies LiaBrainCorrelationSnapshotReader
  return { calls, reader }
}

/** The present branch of the composed union, with all siblings guaranteed. */
function observed(result: LiaBrainCorrelationDiagnosticFacts): {
  facts: LiaBrainExecutionIdentityFacts
  terminalFacts: LiaBrainTerminalObservationFacts
  sendTerminalFacts: LiaBrainSendTerminalObservationFacts
  finalSuccessfulExecutionFacts: LiaBrainFinalSuccessfulExecutionFacts
} {
  if (!('terminalFacts' in result))
    throw new Error('expected a present correlation')
  return { facts: result.facts, sendTerminalFacts: result.sendTerminalFacts, terminalFacts: result.terminalFacts, finalSuccessfulExecutionFacts: result.finalSuccessfulExecutionFacts }
}

const ZERO_TERMINALS: LiaBrainTerminalObservationFacts = {
  abandonedTerminalObservationCount: 0,
  failedTerminalObservationCount: 0,
  succeededTerminalObservationCount: 0,
}

describe('correlation diagnostic facts - one snapshot, five derivations (Phase 8.0D-10B-4D4C3B2)', () => {
  it('a/b/c/d: an absent correlation answers with its explicit absence state, after exactly ONE read and no derivation', () => {
    const { calls, reader } = recordingReader({})

    const result = composeLiaBrainCorrelationDiagnosticFacts(reader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)

    // A: the absence state is the whole answer - no fabricated collections and
    // no fabricated zero counts (that is why the absence branch carries no
    // terminal key at all).
    expect(result).toEqual({ facts: { status: 'correlationNotObserved' } })
    expect(Object.keys(result).sort()).toEqual(['facts'])
    expect('terminalFacts' in result).toBe(false)
    expect('sendTerminalFacts' in result).toBe(false)
    // B: exactly ONE read, with the key forwarded verbatim.
    expect(calls).toEqual(['X'])
    // C/D: no derivation ran - nothing was derived from nothing, and in
    // particular no empty send sibling was fabricated from a missing snapshot.
    expect(probes.identity.inputs).toHaveLength(0)
    expect(probes.identity.mappings).toHaveLength(0)
    expect(probes.terminal.inputs).toHaveLength(0)
    expect(probes.send.inputs).toHaveLength(0)
    expect(probes.final.inputs).toHaveLength(0)
  })

  it('e/p: a decision-only snapshot answers with its identity facts plus explicit zero counts', () => {
    const { store } = realStore()
    store.recordDecision('X', productionDecision())
    const live = store.get('X')!

    const result = composeLiaBrainCorrelationDiagnosticFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    const { facts, terminalFacts } = observed(result)

    expect(facts).toEqual(deriveLiaBrainExecutionIdentityFacts(live, LIA_BRAIN_ENGINE_PROVIDER_MAPPING))
    expect(facts.status).toBe('noExecutionObserved')
    if (facts.status !== 'noExecutionObserved')
      throw new Error('expected noExecutionObserved')
    expect(facts.attempts).toEqual([])
    expect(facts.expected).toEqual({ engineId: GROQ_ENGINE_ID, modelId: GROQ_MODEL_ID, providerId: GROQ_ENGINE_ID })
    // Present with an empty terminal collection is a FACT: three zeros, not an
    // absence - the key is there.
    expect(terminalFacts).toEqual(ZERO_TERMINALS)
    expect('terminalFacts' in result).toBe(true)
    // The send sibling is REQUIRED for a present correlation, and it is empty
    // because this snapshot retains no send-terminal observation.
    expect(observed(result).sendTerminalFacts).toEqual({})
    expect(Object.keys(observed(result).sendTerminalFacts)).toEqual([])
  })

  it('f: an execution-only snapshot keeps its attempts and reads zero terminals - no pending claim', () => {
    const { store } = realStore()
    store.recordExecution(executionReport('X', 'A'))
    const live = store.get('X')!

    const { facts, terminalFacts } = observed(composeLiaBrainCorrelationDiagnosticFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING))

    expect(facts.status).toBe('decisionNotObserved')
    expect(facts.attempts[0]!.roundId).toBe('A')
    expect(facts.attempts[0]!.arrivalIndex).toBe(0)
    expect(terminalFacts).toEqual(ZERO_TERMINALS)
    expect(facts).toEqual(deriveLiaBrainExecutionIdentityFacts(live, LIA_BRAIN_ENGINE_PROVIDER_MAPPING))
    expect(JSON.stringify(facts)).not.toMatch(/pending|incomplete|failure/i)
    expect(observed(composeLiaBrainCorrelationDiagnosticFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)).sendTerminalFacts).toEqual({})
  })

  it('g: a terminal-only snapshot keeps the identity status and counts the terminal - no new status', () => {
    const { store } = realStore()
    store.recordExecutionTerminal(terminalReport('X', 'R', 'failed'))
    const live = store.get('X')!

    const { facts, terminalFacts } = observed(composeLiaBrainCorrelationDiagnosticFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING))

    // The exact current identity result, unchanged by the terminal record.
    expect(facts).toEqual({ attempts: [], status: 'decisionNotObserved' })
    expect(Object.keys(facts).sort()).toEqual(['attempts', 'status'])
    expect(terminalFacts).toEqual({ ...ZERO_TERMINALS, failedTerminalObservationCount: 1 })
    expect(facts).toEqual(deriveLiaBrainExecutionIdentityFacts(live, LIA_BRAIN_ENGINE_PROVIDER_MAPPING))
    // A round terminal is NOT a send terminal: the send sibling stays empty.
    expect(observed(composeLiaBrainCorrelationDiagnosticFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)).sendTerminalFacts).toEqual({})
  })

  it('h: a matched start plus terminal counts the terminal without joining it into the attempt', () => {
    const { store } = realStore()
    store.recordExecution(executionReport('X', 'R'))
    store.recordExecutionTerminal(terminalReport('X', 'R', 'succeeded'))
    const live = store.get('X')!

    const { facts, terminalFacts } = observed(composeLiaBrainCorrelationDiagnosticFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING))

    expect(facts.status).toBe('decisionNotObserved')
    expect(facts.attempts.length).toBe(1)
    // The attempt is exactly the four approved identity fields - no outcome, no
    // terminal field, no join.
    expect(Object.keys(facts.attempts[0]!).sort()).toEqual(['arrivalIndex', 'modelId', 'providerId', 'roundId'])
    expect(facts.attempts[0]!.roundId).toBe('R')
    expect(terminalFacts).toEqual({ ...ZERO_TERMINALS, succeededTerminalObservationCount: 1 })
    expect(facts).toEqual(deriveLiaBrainExecutionIdentityFacts(live, LIA_BRAIN_ENGINE_PROVIDER_MAPPING))
    expect(JSON.stringify(facts)).not.toMatch(/outcome|succeeded|failed|abandoned/)
  })

  it('i: an unmatched terminal round never reaches the execution identity - zero mismatch fields', () => {
    const { store } = realStore()
    store.recordExecution(executionReport('X', 'A'))
    store.recordExecutionTerminal(terminalReport('X', 'B', 'abandoned'))
    const live = store.get('X')!

    const { facts, terminalFacts } = observed(composeLiaBrainCorrelationDiagnosticFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING))

    // Both sides are reported independently: the execution keeps its own round,
    // the terminal is counted once, and NOTHING compares the two.
    expect(facts.attempts[0]!.roundId).toBe('A')
    expect(facts.attempts.length).toBe(1)
    expect(terminalFacts).toEqual({ ...ZERO_TERMINALS, abandonedTerminalObservationCount: 1 })
    expect(facts).toEqual(deriveLiaBrainExecutionIdentityFacts(live, LIA_BRAIN_ENGINE_PROVIDER_MAPPING))
    expect(JSON.stringify(facts)).not.toMatch(/mismatch|join|unmatched/i)
    expect(Object.keys(facts).sort()).not.toContain('mismatch')
  })

  it('j: mixed terminal outcomes count per outcome and leave the identity side untouched', () => {
    const { store } = realStore()
    store.recordExecutionTerminal(terminalReport('X', 'R1', 'succeeded'))
    store.recordExecutionTerminal(terminalReport('X', 'R2', 'succeeded'))
    store.recordExecutionTerminal(terminalReport('X', 'R3', 'failed'))
    store.recordExecutionTerminal(terminalReport('X', 'R4', 'abandoned'))
    store.recordExecution(executionReport('X', 'R1'))
    const live = store.get('X')!

    const { facts, terminalFacts } = observed(composeLiaBrainCorrelationDiagnosticFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING))

    expect(terminalFacts).toEqual({
      abandonedTerminalObservationCount: 1,
      failedTerminalObservationCount: 1,
      succeededTerminalObservationCount: 2,
    })
    expect(facts).toEqual(deriveLiaBrainExecutionIdentityFacts(live, LIA_BRAIN_ENGINE_PROVIDER_MAPPING))
    expect(facts.attempts.length).toBe(1)
    expect(observed(composeLiaBrainCorrelationDiagnosticFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)).sendTerminalFacts).toEqual({})
  })

  it('send-only: a send-terminal-only snapshot keeps the identity status and projects the settlement', () => {
    for (const outcome of ['failed', 'succeeded'] as const) {
      const { store } = realStore()
      store.recordSendTerminal({ correlationId: 'X', outcome })

      const result = observed(composeLiaBrainCorrelationDiagnosticFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING))

      // No new identity status is invented for a send-only entry...
      expect(result.facts).toEqual({ attempts: [], status: 'decisionNotObserved' })
      expect(Object.keys(result.facts).sort()).toEqual(['attempts', 'status'])
      // ...the round counts read zero retained observations...
      expect(result.terminalFacts).toEqual(ZERO_TERMINALS)
      // ...and the send sibling carries exactly the one direct settlement.
      expect(result.sendTerminalFacts).toEqual({ sendTerminalOutcome: outcome })
      expect(Object.keys(result.sendTerminalFacts)).toEqual(['sendTerminalOutcome'])
    }
  })

  it('round + send: the two terminal domains coexist without being joined', () => {
    const succeededRound = realStore()
    succeededRound.store.recordExecutionTerminal(terminalReport('X', 'R', 'succeeded'))
    succeededRound.store.recordSendTerminal({ correlationId: 'X', outcome: 'failed' })

    const first = observed(composeLiaBrainCorrelationDiagnosticFacts(succeededRound.store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING))
    expect(first.terminalFacts).toEqual({ ...ZERO_TERMINALS, succeededTerminalObservationCount: 1 })
    expect(first.sendTerminalFacts).toEqual({ sendTerminalOutcome: 'failed' })
    // No mismatch, no contradiction, no anomaly field anywhere.
    expect(JSON.stringify(first)).not.toMatch(/mismatch|contradiction|anomaly|orphan/i)

    const abandonedRound = realStore()
    abandonedRound.store.recordExecutionTerminal(terminalReport('X', 'R', 'abandoned'))
    abandonedRound.store.recordSendTerminal({ correlationId: 'X', outcome: 'succeeded' })

    const second = observed(composeLiaBrainCorrelationDiagnosticFacts(abandonedRound.store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING))
    expect(second.terminalFacts).toEqual({ ...ZERO_TERMINALS, abandonedTerminalObservationCount: 1 })
    expect(second.sendTerminalFacts).toEqual({ sendTerminalOutcome: 'succeeded' })
  })

  it('mixed rounds + send: the counts and the settlement travel independently', () => {
    const { store } = realStore()
    store.recordExecutionTerminal(terminalReport('X', 'R1', 'succeeded'))
    store.recordExecutionTerminal(terminalReport('X', 'R2', 'succeeded'))
    store.recordExecutionTerminal(terminalReport('X', 'R3', 'failed'))
    store.recordExecutionTerminal(terminalReport('X', 'R4', 'abandoned'))
    store.recordSendTerminal({ correlationId: 'X', outcome: 'failed' })

    const result = observed(composeLiaBrainCorrelationDiagnosticFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING))

    expect(result.terminalFacts).toEqual({
      abandonedTerminalObservationCount: 1,
      failedTerminalObservationCount: 1,
      succeededTerminalObservationCount: 2,
    })
    expect(result.sendTerminalFacts).toEqual({ sendTerminalOutcome: 'failed' })
    // Nothing relates the two sides: the send sibling carries no round key.
    expect(Object.keys(result.sendTerminalFacts)).toEqual(['sendTerminalOutcome'])
  })

  it('first write wins: the composition reflects the store canonical settlement only', () => {
    const failedFirst = realStore()
    failedFirst.store.recordSendTerminal({ correlationId: 'X', outcome: 'failed' })
    failedFirst.store.recordSendTerminal({ correlationId: 'X', outcome: 'succeeded' })
    expect(observed(composeLiaBrainCorrelationDiagnosticFacts(failedFirst.store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)).sendTerminalFacts)
      .toEqual({ sendTerminalOutcome: 'failed' })

    const succeededFirst = realStore()
    succeededFirst.store.recordSendTerminal({ correlationId: 'X', outcome: 'succeeded' })
    succeededFirst.store.recordSendTerminal({ correlationId: 'X', outcome: 'failed' })
    expect(observed(composeLiaBrainCorrelationDiagnosticFacts(succeededFirst.store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)).sendTerminalFacts)
      .toEqual({ sendTerminalOutcome: 'succeeded' })
  })
})

describe('correlation diagnostic facts - the single-snapshot invariant (Phase 8.0D-10B-4D4C4-D2B3)', () => {
  it('k: ALL FIVE derivations receive the very object the ONE read returned', () => {
    const S = deepFreeze(snapshot({
      decision: productionDecision(),
      executionTerminals: [{ outcome: 'succeeded', roundId: 'A' }],
      executions: [{ modelId: GROQ_MODEL_ID, providerId: GROQ_ENGINE_ID, roundId: 'A' }],
    }))
    const { calls, reader } = recordingReader({ X: S })

    const result = composeLiaBrainCorrelationDiagnosticFacts(reader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)

    expect(calls).toEqual(['X'])
    expect(probes.identity.inputs).toHaveLength(1)
    expect(probes.terminal.inputs).toHaveLength(1)
    expect(probes.send.inputs).toHaveLength(1)
    expect(probes.final.inputs).toHaveLength(1)
    expect(probes.initialRoute.inputs).toHaveLength(1)
    expect(probes.identity.inputs[0]).toBe(S)
    expect(probes.terminal.inputs[0]).toBe(S)
    expect(probes.send.inputs[0]).toBe(S)
    expect(probes.final.inputs[0]).toBe(S)
    expect(probes.initialRoute.inputs[0]).toBe(S)
    expect(probes.identity.inputs[0]).toBe(probes.terminal.inputs[0])
    expect(probes.terminal.inputs[0]).toBe(probes.send.inputs[0])
    expect(probes.send.inputs[0]).toBe(probes.final.inputs[0])
    expect('terminalFacts' in result).toBe(true)
    expect('sendTerminalFacts' in result).toBe(true)
    expect('finalSuccessfulExecutionFacts' in result).toBe(true)
  })

  it('l: the mapping reaches ONLY the identity derivation, unchanged', () => {
    const S = deepFreeze(snapshot())
    const mapping: LiaBrainEngineProviderLookup = {
      providerIdForEngine: engineId => (engineId === GROQ_ENGINE_ID ? GROQ_ENGINE_ID : undefined),
    }
    const { reader } = recordingReader({ X: S })

    composeLiaBrainCorrelationDiagnosticFacts(reader, 'X', mapping)

    expect(probes.identity.mappings).toHaveLength(1)
    expect(probes.identity.mappings[0]).toBe(mapping)
    // All four factual derivations (terminal, send, final, initialRoute) are handed the snapshot and nothing else - no
    // mapping, no key, no second argument of any kind.
    expect(probes.terminal.argumentCounts).toEqual([1])
    expect(probes.send.argumentCounts).toEqual([1])
    expect(probes.final.argumentCounts).toEqual([1])
  })

  it('m/n: a present snapshot is read exactly once, and each derivation runs exactly once per call', () => {
    const S = deepFreeze(snapshot())
    const { calls, reader } = recordingReader({ X: S })

    composeLiaBrainCorrelationDiagnosticFacts(reader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)

    expect(calls).toEqual(['X'])
    expect(probes.identity.inputs).toHaveLength(1)
    expect(probes.terminal.inputs).toHaveLength(1)
    expect(probes.send.inputs).toHaveLength(1)
    expect(probes.final.inputs).toHaveLength(1)

    composeLiaBrainCorrelationDiagnosticFacts(reader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)

    expect(calls).toEqual(['X', 'X'])
    expect(probes.identity.inputs).toHaveLength(2)
    expect(probes.terminal.inputs).toHaveLength(2)
    expect(probes.send.inputs).toHaveLength(2)
    expect(probes.final.inputs).toHaveLength(2)
  })
})

describe('correlation diagnostic facts - composed output shape (Phase 8.0D-10B-4D4C3B2)', () => {
  it('o/q: the absence result carries no key beyond facts, and leaks neither the key nor any raw collection', () => {
    const { reader } = recordingReader({})

    const result = composeLiaBrainCorrelationDiagnosticFacts(reader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)

    expect(Object.keys(result).sort()).toEqual(['facts'])
    expect('correlationId' in result).toBe(false)
    const serialized = JSON.stringify(result)
    for (const forbidden of ['correlationId', 'snapshot', 'executions', 'executionTerminals', 'createdAt', 'roundId'])
      expect(serialized, forbidden).not.toContain(forbidden)
    expect(serialized).not.toContain('sendTerminal')
  })

  it('p/q: the present result carries exactly the five approved keys and no raw snapshot escape', () => {
    const { store } = realStore()
    store.recordExecutionTerminal(terminalReport('X', 'R', 'succeeded'))

    const result = composeLiaBrainCorrelationDiagnosticFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)

    expect(Object.keys(result).sort()).toEqual(['facts', 'finalSuccessfulExecutionFacts', 'initialRouteOverrideFacts', 'sendTerminalFacts', 'terminalFacts'])
    expect('correlationId' in result).toBe(false)
    expect(Object.keys(observed(result).terminalFacts).sort()).toEqual([
      'abandonedTerminalObservationCount',
      'failedTerminalObservationCount',
      'succeededTerminalObservationCount',
    ])
    // The send sibling is exactly the approved projection - and it is NEVER the
    // raw record the snapshot carries.
    expect(observed(result).sendTerminalFacts).toEqual({})
    expect(observed(result).sendTerminalFacts).not.toBe(store.get('X')!.sendTerminal)
    const serialized = JSON.stringify(result)
    for (const forbidden of ['correlationId', 'snapshot', 'executions', 'executionTerminals', 'createdAt'])
      expect(serialized, forbidden).not.toContain(forbidden)
    // No raw `sendTerminal` record escapes: only the derived sibling does.
    expect(serialized).not.toContain('\"sendTerminal\"')
  })

  it('raw escape: a retained send record reaches the output only as derived facts', () => {
    const { store } = realStore()
    store.recordSendTerminal({ correlationId: 'X', outcome: 'failed' })

    const result = composeLiaBrainCorrelationDiagnosticFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    const serialized = JSON.stringify(result)

    expect(Object.keys(result).sort()).toEqual(['facts', 'finalSuccessfulExecutionFacts', 'initialRouteOverrideFacts', 'sendTerminalFacts', 'terminalFacts'])
    expect(observed(result).sendTerminalFacts).toEqual({ sendTerminalOutcome: 'failed' })
    // The raw key exists ONLY inside the derived sibling path, never as the raw
    // record object, and no snapshot metadata travels.
    expect('sendTerminal' in result).toBe(false)
    for (const forbidden of ['correlationId', 'snapshot', 'createdAt', 'executionTerminals'])
      expect(serialized, forbidden).not.toContain(forbidden)
  })

  it('r: neither the composition nor the derivations edit the supplied snapshot', () => {
    const { store } = realStore()
    store.recordDecision('X', productionDecision())
    store.recordExecution(executionReport('X', 'A'))
    store.recordExecutionTerminal(terminalReport('X', 'A', 'failed'))
    // The frozen snapshot is the ONLY thing the read returns, so a mutation
    // anywhere on the read path would be a hard failure.
    const frozen = deepFreeze(store.get('X')!)
    const { reader } = recordingReader({ X: frozen })
    const before = JSON.stringify(frozen)

    const result = composeLiaBrainCorrelationDiagnosticFacts(reader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)

    expect(Object.isFrozen(frozen)).toBe(true)
    expect(JSON.stringify(frozen)).toBe(before)
    expect('terminalFacts' in result).toBe(true)
    expect(before).toContain('failed')
  })

  it('s: every call returns a fresh, deeply equal result - no cached singleton', () => {
    const { store } = realStore()
    store.recordDecision('X', productionDecision())
    const { reader } = recordingReader({ X: store.get('X') })

    const first = composeLiaBrainCorrelationDiagnosticFacts(reader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    const second = composeLiaBrainCorrelationDiagnosticFacts(reader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)

    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(first.facts).not.toBe(second.facts)
    expect(observed(first).terminalFacts).not.toBe(observed(second).terminalFacts)
    expect(observed(first).terminalFacts).toEqual(observed(second).terminalFacts)
    expect(observed(first).sendTerminalFacts).not.toBe(observed(second).sendTerminalFacts)
    expect(observed(first).sendTerminalFacts).toEqual(observed(second).sendTerminalFacts)
    expect(observed(first).finalSuccessfulExecutionFacts).not.toBe(observed(second).finalSuccessfulExecutionFacts)
    expect(observed(first).finalSuccessfulExecutionFacts).toEqual(observed(second).finalSuccessfulExecutionFacts)
  })

  it('the contracts line up: one reader-owned snapshot feeds ALL FIVE derivations, unchanged', () => {
    // Compile-time proofs: the reader-owned snapshot satisfies ALL FIVE
    // derivation inputs, and the reader-owned mapping type is exactly what the
    // identity derivation accepts - so the composition needs no adapter and no
    // clone, and the very same object can be handed to every derivation.
    const snapshotFitsIdentity: LiaBrainCorrelationSnapshot extends LiaBrainExecutionIdentitySnapshot ? true : false = true
    const snapshotFitsTerminal: LiaBrainCorrelationSnapshot extends LiaBrainTerminalObservationSnapshot ? true : false = true
    const snapshotFitsSend: LiaBrainCorrelationSnapshot extends LiaBrainSendTerminalObservationSnapshot ? true : false = true
    const snapshotFitsFinal: LiaBrainCorrelationSnapshot extends LiaBrainFinalSuccessfulExecutionSnapshot ? true : false = true
    const mappingFitsIdentity: LiaBrainEngineProviderLookup extends LiaBrainEngineProviderMapping ? true : false = true
    expect(snapshotFitsIdentity).toBe(true)
    expect(snapshotFitsTerminal).toBe(true)
    expect(snapshotFitsSend).toBe(true)
    expect(snapshotFitsFinal).toBe(true)
    expect(mappingFitsIdentity).toBe(true)

    // ...and the composed union encodes zero-vs-unknown structurally: a present
    // result missing ANY of the three members is not a composed result, the
    // absence state is the only absent member, and the present member is
    // reachable.
    const withoutTerminal: { facts: LiaBrainExecutionIdentityFacts } extends LiaBrainCorrelationDiagnosticFacts ? true : false = false
    const withoutSend: { facts: LiaBrainExecutionIdentityFacts, terminalFacts: LiaBrainTerminalObservationFacts } extends LiaBrainCorrelationDiagnosticFacts ? true : false = false
    const withoutFinal: { facts: LiaBrainExecutionIdentityFacts, terminalFacts: LiaBrainTerminalObservationFacts, sendTerminalFacts: LiaBrainSendTerminalObservationFacts } extends LiaBrainCorrelationDiagnosticFacts ? true : false = false
    const presentComplete: { facts: LiaBrainExecutionIdentityFacts, terminalFacts: LiaBrainTerminalObservationFacts, sendTerminalFacts: LiaBrainSendTerminalObservationFacts, finalSuccessfulExecutionFacts: LiaBrainFinalSuccessfulExecutionFacts } extends LiaBrainCorrelationDiagnosticFacts ? true : false = true
    const absentIsTheOnlyAbsence: { facts: { status: 'correlationNotObserved' } } extends LiaBrainCorrelationDiagnosticFacts ? true : false = true
    // The absence arm carries no sibling: each member belongs to exactly one arm.
    const absenceHasNoSend: { facts: { status: 'correlationNotObserved' }, sendTerminalFacts: LiaBrainSendTerminalObservationFacts } extends LiaBrainCorrelationDiagnosticFacts ? true : false = false
    const absenceHasNoFinal: { facts: { status: 'correlationNotObserved' }, finalSuccessfulExecutionFacts: LiaBrainFinalSuccessfulExecutionFacts } extends LiaBrainCorrelationDiagnosticFacts ? true : false = false
    expect(withoutTerminal).toBe(false)
    expect(withoutSend).toBe(false)
    expect(withoutFinal).toBe(false)
    expect(presentComplete).toBe(true)
    expect(absentIsTheOnlyAbsence).toBe(true)
    expect(absenceHasNoSend).toBe(false)
    expect(absenceHasNoFinal).toBe(false)
  })
})

describe('correlation diagnostic facts - source guards (Phase 8.0D-10B-4D4C3B2)', () => {
  const source = readSource(COMPOSITION)
  const code = stripComments(source)

  it('t: the composition is exactly the audited surface - one read, five delegations, no authority', () => {
    // The whole dependency surface: the reader's structural contracts, the five
    // approved derivations and nothing else.
    expect(code.match(/^import .*$/gm)).toEqual([
      `import type { LiaBrainCorrelationSnapshotReader, LiaBrainEngineProviderLookup } from './brain-correlation-reader'`,
      `import type { LiaBrainExecutionIdentityFacts } from './brain-execution-identity-facts'`,
      `import type { LiaBrainTerminalObservationFacts } from './brain-execution-terminal-facts'`,
      `import type { LiaBrainFinalSuccessfulExecutionFacts } from './brain-final-successful-execution-facts'`,
      `import type { LiaBrainInitialRouteObservationFacts } from './brain-initial-route-facts'`,
      `import type { LiaBrainSendTerminalObservationFacts } from './brain-send-terminal-facts'`,
      `import { deriveLiaBrainExecutionIdentityFacts } from './brain-execution-identity-facts'`,
      `import { deriveLiaBrainTerminalObservationFacts } from './brain-execution-terminal-facts'`,
      `import { deriveLiaBrainFinalSuccessfulExecutionFacts } from './brain-final-successful-execution-facts'`,
      `import { deriveLiaBrainInitialRouteObservationFacts } from './brain-initial-route-facts'`,
      `import { deriveLiaBrainSendTerminalObservationFacts } from './brain-send-terminal-facts'`,
    ])

    // Exactly ONE read, of the key it was handed, and no inspection of a handle.
    expect(code.match(/\.get\(/g)).toHaveLength(1)
    expect(code).toMatch(/correlationReader\.get\(correlationId\)/)
    expect(code).not.toMatch(/\.size\b|\.entries\(|\.keys\(|\.values\(/)

    // The trusted mapping VALUE stays out: the mapping arrives as an argument,
    // and the expected-route foundation is never named here.
    expect(code).not.toMatch(/LIA_BRAIN_ENGINE_PROVIDER_MAPPING|brain-expected-route|providerIdForEngine|'groq'|openai\/gpt-oss/)

    // The second read helper is never used - that would be a second read.
    expect(code).not.toMatch(/readLiaBrainExecutionIdentityFacts/)

    // The exported surface is exactly the composed union and the composition.
    expect([...code.matchAll(/^export (?:const|function|interface|type) (\w+)/gm)].map(match => match[1])).toEqual([
      'LiaBrainCorrelationDiagnosticFacts',
      'composeLiaBrainCorrelationDiagnosticFacts',
    ])

    // The runtime slice: one read into one local snapshot, five delegations over
    // THAT object, and no raw collection named in the returned construction.
    const runtime = code.slice(code.indexOf('export function composeLiaBrainCorrelationDiagnosticFacts'))
    expect(runtime).toMatch(/deriveLiaBrainExecutionIdentityFacts\(snapshot, mapping\)/)
    expect(runtime).toMatch(/deriveLiaBrainTerminalObservationFacts\(snapshot\)/)
    expect(runtime).toMatch(/deriveLiaBrainSendTerminalObservationFacts\(snapshot\)/)
    expect(runtime).toMatch(/deriveLiaBrainFinalSuccessfulExecutionFacts\(snapshot\)/)
    expect(runtime).not.toMatch(/executionTerminals|executions|decision|roundId|sendTerminal\b/)
    // Exactly FIVE delegations, each over the SAME local snapshot - no clone,
    // no reconstructed snapshot, no second read helper.
    expect(runtime.match(/deriveLiaBrain\w+\(snapshot[,)]/g)).toHaveLength(5)
    expect(runtime).not.toMatch(/structuredClone|JSON\.parse|JSON\.stringify|\.\.\.snapshot/)

    // No store, no service, no observer, no diagnostic layer, no logger, no
    // state, no clock, no async surface, no transport.
    expect(code).not.toMatch(/brain-correlation-store|brain-correlation-service|createLiaBrainCorrelation|LiaBrainCorrelationStore\b|LiaBrainCorrelationService\b/)
    expect(code).not.toMatch(/brain-correlation-observer|brain-diagnostic-log|LiaBrainDiagnosticEntry|LiaBrainCorrelationReadFacts|formatLiaBrainDiagnosticEntry/)
    expect(code).not.toMatch(/new Map|new Set|WeakMap|WeakSet|\bcache\b|\bhistory\b/)
    expect(code).not.toMatch(/from ['"](?:node:)?(?:fs|net|https?|child_process|dns|dgram|timers)['/]|\bfetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage/)

    // The forbidden semantics of this phase, re-checked against the module.
    for (const forbidden of [
      /fallback/i,
      /finalAttempt|winningAttempt|winner/,
      /sendSucceeded|sendFailed|sendOutcome|anySucceeded|allFailed/,
      /completed|completion|finished|pending/i,
      /routeMatch|mismatch|contradiction|anomaly|orphan/i,
      /recordDecision|recordExecution|recordSendTerminal/,
      /\.observe\(/,
      /eventa|ipcMain|ipcRenderer|\.emit\(/,
      /console\.|useLogg|logger|telemetry/i,
      /setInterval|setTimeout|Date\.now|performance\.now|Math\.random/,
      /\basync\b|\bawait\b|Promise|queueMicrotask/,
      /prompt|messages?|usage|credential|apiKey|baseURL/i,
    ])
      expect(code, String(forbidden)).not.toMatch(forbidden)
    // The composition names the sibling FIELD, never the projected outcome
    // value: it receives the pure result structurally.
    expect(code).not.toMatch(/sendTerminalOutcome/)
    expect(code).toMatch(/sendTerminalFacts: deriveLiaBrainSendTerminalObservationFacts\(snapshot\)/)
    expect(code).toMatch(/finalSuccessfulExecutionFacts: deriveLiaBrainFinalSuccessfulExecutionFacts\(snapshot\)/)
  })

  it('u: the composition has exactly ONE production caller - the diagnostic observer', () => {
    // It exists in exactly ONE production module - its own.
    expect(productionSources(BRAIN_ROOTS).filter(relative => relative.includes('brain-correlation-diagnostic-facts'))).toEqual([COMPOSITION])
    // The function has exactly two production occurrences: its own declaration
    // and the ONE call in the observer (Phase 8.0D-10B-4D4C3B2-B2).
    expect(productionMatching(/composeLiaBrainCorrelationDiagnosticFacts\(/)).toEqual([COMPOSITION, OBSERVER])
    expect(productionMatching(/(?<!function )composeLiaBrainCorrelationDiagnosticFacts\(/)).toEqual([OBSERVER])
    // ...and exactly one other production module names the module at all.
    expect(productionMatching(/brain-correlation-diagnostic-facts/)).toEqual([OBSERVER])

    // The deferred layers stay exactly where they were: the diagnostic line, the
    // store, the service, the read adapter and the composition entry do not know
    // the composed type, and printing the counts is a later phase.
    for (const relative of [
      'apps/stage-tamagotchi/src/main/services/lia/brain-diagnostic-log.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-store.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-reader.ts',
      'apps/stage-tamagotchi/src/main/index.ts',
    ]) {
      expect(stripComments(readSource(relative)), relative)
        .not
        .toMatch(/brain-correlation-diagnostic-facts|composeLiaBrainCorrelationDiagnosticFacts/)
    }
  })
})

describe('lia correlation diagnostic facts - initialRouteOverride sibling (Phase 8.0D-10B-4D4C4-D2B7)', () => {
  it('absent correlation returns ONLY facts with correlationNotObserved and no sibling', () => {
    const { store } = realStore()
    const result: any = composeLiaBrainCorrelationDiagnosticFacts(store, 'missing', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    expect(result).toEqual({ facts: { status: 'correlationNotObserved' } })
    expect(Object.keys(result).sort()).toEqual(['facts'])
    expect('initialRouteOverrideFacts' in result).toBe(false)
    expect('terminalFacts' in result).toBe(false)
    expect('sendTerminalFacts' in result).toBe(false)
    expect('finalSuccessfulExecutionFacts' in result).toBe(false)
  })

  it('present snapshot always has initialRouteOverrideFacts', () => {
    const { store } = realStore()
    store.recordDecision('X', productionDecision())
    const result: any = composeLiaBrainCorrelationDiagnosticFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    expect('initialRouteOverrideFacts' in result).toBe(true)
    expect(result.initialRouteOverrideFacts).toEqual({ status: 'initialRouteOverrideNotObserved' })
    store.recordSendTerminal({ correlationId: 'Y', outcome: 'succeeded', initialRouteOverride: null })
    const result2: any = composeLiaBrainCorrelationDiagnosticFacts(store, 'Y', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    expect(result2.initialRouteOverrideFacts).toEqual({ status: 'noInitialRouteOverride' })
    store.recordSendTerminal({ correlationId: 'Z', outcome: 'succeeded', initialRouteOverride: { providerId: 'groq', modelId: 'm' } })
    const result3: any = composeLiaBrainCorrelationDiagnosticFacts(store, 'Z', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    expect(result3.initialRouteOverrideFacts).toEqual({ status: 'initialRouteOverrideObserved', providerId: 'groq', modelId: 'm' })
  })

  it('route sibling does not change other four factual siblings', () => {
    const { store } = realStore()
    store.recordDecision('X', productionDecision())
    store.recordExecution({ correlationId: 'X', conversationId: 'c', roundId: 'r', providerId: 'p', modelId: 'm' })
    store.recordExecutionTerminal({ correlationId: 'X', roundId: 'r', outcome: 'succeeded' })
    store.recordSendTerminal({ correlationId: 'X', outcome: 'succeeded' })
    const withoutRoute: any = composeLiaBrainCorrelationDiagnosticFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    const { store: store2 } = realStore()
    store2.recordDecision('X', productionDecision())
    store2.recordExecution({ correlationId: 'X', conversationId: 'c', roundId: 'r', providerId: 'p', modelId: 'm' })
    store2.recordExecutionTerminal({ correlationId: 'X', roundId: 'r', outcome: 'succeeded' })
    store2.recordSendTerminal({ correlationId: 'X', outcome: 'succeeded', initialRouteOverride: { providerId: 'groq', modelId: 'm' } })
    const withRoute: any = composeLiaBrainCorrelationDiagnosticFacts(store2, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    expect(withRoute.facts).toEqual(withoutRoute.facts)
    expect(withRoute.terminalFacts).toEqual(withoutRoute.terminalFacts)
    expect(withRoute.sendTerminalFacts).toEqual(withoutRoute.sendTerminalFacts)
    expect(withRoute.finalSuccessfulExecutionFacts).toEqual(withoutRoute.finalSuccessfulExecutionFacts)
    expect(withoutRoute.initialRouteOverrideFacts).toEqual({ status: 'initialRouteOverrideNotObserved' })
    expect(withRoute.initialRouteOverrideFacts).toEqual({ status: 'initialRouteOverrideObserved', providerId: 'groq', modelId: 'm' })
  })

  it('no comparison between siblings', () => {
    const { store } = realStore()
    store.recordDecision('X', productionDecision())
    store.recordSendTerminal({ correlationId: 'X', outcome: 'succeeded', initialRouteOverride: { providerId: 'anthropic', modelId: 'claude-3' } })
    const result: any = composeLiaBrainCorrelationDiagnosticFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    expect(result.facts.status).not.toBe('routeMatched')
    expect(result.initialRouteOverrideFacts.status).toBe('initialRouteOverrideObserved')
    expect(JSON.stringify(result)).not.toContain('routeMatched')
    expect(JSON.stringify(result)).not.toContain('mismatch')
    expect(JSON.stringify(result)).not.toContain('divergence')
  })
})

