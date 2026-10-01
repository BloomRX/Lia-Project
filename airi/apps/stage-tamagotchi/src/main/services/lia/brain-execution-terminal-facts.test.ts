import type { LiaBrainTerminalObservationRecord, LiaBrainTerminalObservationSnapshot } from './brain-execution-terminal-facts'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { authoredSourceEntry, normalizeLineEndings } from '../../../test-helpers'
import { createLiaBrainCorrelationStore } from './brain-correlation-store'
import { deriveLiaBrainTerminalObservationFacts } from './brain-execution-terminal-facts'

/**
 * Phase 8.0D-10B-4D4C3B1: the focused proof of the pure terminal-observation
 * facts.
 *
 * The derivation is proven as PURE COUNTING only: one pass over the collection
 * the caller supplies, three counts, one fresh result. Nothing here wires the
 * derivation into production - it has zero production callers by design - and
 * nothing here interprets an outcome, joins a round, orders anything or adds a
 * total/boolean/per-round field.
 */

const REPO_ROOT = new URL('../../../../../../', import.meta.url)
const TERMINAL_FACTS = 'apps/stage-tamagotchi/src/main/services/lia/brain-execution-terminal-facts.ts'
const COMPOSITION = 'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-diagnostic-facts.ts'
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

/** The production files matching one pattern, sorted - the caller allowlist shape. */
function productionMatching(pattern: RegExp): string[] {
  return productionSources(BRAIN_ROOTS)
    .filter(relative => pattern.test(normalizeLineEndings(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
    .sort()
}

/** The production source of one repo-relative path. */
function readSource(relative: string): string {
  return normalizeLineEndings(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))
}

/** Code without comments - guards must only find the words in real code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** One terminal record, exactly as the structural contract declares it. */
function terminal(outcome: LiaBrainTerminalObservationRecord['outcome']): LiaBrainTerminalObservationRecord {
  return { outcome }
}

/** The REAL canonical store, driven directly - the production boundary. */
function realStore(maxEntries = 8) {
  let clock = 1_000
  return {
    store: createLiaBrainCorrelationStore({ maxEntries, now: () => clock, ttlMs: 900_000 }),
    advance: (milliseconds: number) => {
      clock += milliseconds
    },
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value))
      deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

describe('execution terminal facts - counts (Phase 8.0D-10B-4D4C3B1)', () => {
  it('a: an absent and an empty collection both read as zero retained observations', () => {
    const expected = {
      abandonedTerminalObservationCount: 0,
      failedTerminalObservationCount: 0,
      succeededTerminalObservationCount: 0,
    }

    expect(deriveLiaBrainTerminalObservationFacts({})).toEqual(expected)
    expect(deriveLiaBrainTerminalObservationFacts({ executionTerminals: [] })).toEqual(expected)
  })

  it('b/c/d: one observation per outcome counts exactly once', () => {
    expect(deriveLiaBrainTerminalObservationFacts({ executionTerminals: [terminal('succeeded')] })).toEqual({
      abandonedTerminalObservationCount: 0,
      failedTerminalObservationCount: 0,
      succeededTerminalObservationCount: 1,
    })
    expect(deriveLiaBrainTerminalObservationFacts({ executionTerminals: [terminal('failed')] })).toEqual({
      abandonedTerminalObservationCount: 0,
      failedTerminalObservationCount: 1,
      succeededTerminalObservationCount: 0,
    })
    expect(deriveLiaBrainTerminalObservationFacts({ executionTerminals: [terminal('abandoned')] })).toEqual({
      abandonedTerminalObservationCount: 1,
      failedTerminalObservationCount: 0,
      succeededTerminalObservationCount: 0,
    })
  })

  it('e: mixed observations count per outcome', () => {
    const facts = deriveLiaBrainTerminalObservationFacts({
      executionTerminals: [terminal('succeeded'), terminal('failed'), terminal('succeeded'), terminal('abandoned')],
    })

    expect(facts).toEqual({
      abandonedTerminalObservationCount: 1,
      failedTerminalObservationCount: 1,
      succeededTerminalObservationCount: 2,
    })
  })

  it('f: counts are order-independent', () => {
    const first: LiaBrainTerminalObservationSnapshot = {
      executionTerminals: [terminal('succeeded'), terminal('failed'), terminal('abandoned'), terminal('succeeded')],
    }
    const second: LiaBrainTerminalObservationSnapshot = {
      executionTerminals: [terminal('abandoned'), terminal('succeeded'), terminal('succeeded'), terminal('failed')],
    }

    expect(deriveLiaBrainTerminalObservationFacts(second)).toEqual(deriveLiaBrainTerminalObservationFacts(first))
    expect(deriveLiaBrainTerminalObservationFacts(first)).toEqual({
      abandonedTerminalObservationCount: 1,
      failedTerminalObservationCount: 1,
      succeededTerminalObservationCount: 2,
    })
  })

  it('g: an outcome outside the closed vocabulary contributes to none of the counts', () => {
    // This is an internal pure derivation, not a transport boundary: an
    // out-of-contract value is simply counted as none of the three outcomes -
    // it is never normalized into one of them and nothing is thrown.
    const foreign = ['cancelled', 'timeout', 'success', 'error', 'SUCCEEDED'].map(value =>
      ({ outcome: value }) as unknown as LiaBrainTerminalObservationRecord,
    )

    expect(deriveLiaBrainTerminalObservationFacts({ executionTerminals: foreign })).toEqual({
      abandonedTerminalObservationCount: 0,
      failedTerminalObservationCount: 0,
      succeededTerminalObservationCount: 0,
    })
    // A valid record in the same collection still counts normally.
    expect(deriveLiaBrainTerminalObservationFacts({ executionTerminals: [...foreign, terminal('failed')] })).toEqual({
      abandonedTerminalObservationCount: 0,
      failedTerminalObservationCount: 1,
      succeededTerminalObservationCount: 0,
    })
  })

  it('h: a terminal-only real-store snapshot counts with no request-start observation', () => {
    const { store } = realStore()
    store.recordExecutionTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })

    const snapshot = store.get('X')!
    // The snapshot really has no request-start observation to rely on...
    expect(snapshot.executions).toEqual([])
    expect(snapshot.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'R' }])
    // ...and the counting still works, because it needs none.
    expect(deriveLiaBrainTerminalObservationFacts(snapshot)).toEqual({
      abandonedTerminalObservationCount: 0,
      failedTerminalObservationCount: 1,
      succeededTerminalObservationCount: 0,
    })
  })

  it('i: a start-only real-store snapshot stays at zero - executions are never inspected', () => {
    const { store } = realStore()
    store.recordExecution({ conversationId: 'conversation-1', correlationId: 'X', modelId: 'openai/gpt-oss-120b', providerId: 'groq', roundId: 'A' })

    const snapshot = store.get('X')!
    expect(snapshot.executions).toHaveLength(1)
    expect(snapshot.executionTerminals).toEqual([])
    expect(deriveLiaBrainTerminalObservationFacts(snapshot)).toEqual({
      abandonedTerminalObservationCount: 0,
      failedTerminalObservationCount: 0,
      succeededTerminalObservationCount: 0,
    })
  })

  it('j: the REAL store canonicalizes first per round - the facts only count what it hands out', () => {
    const { store } = realStore()
    store.recordExecutionTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })
    store.recordExecutionTerminal({ correlationId: 'X', outcome: 'succeeded', roundId: 'R' })
    store.recordExecutionTerminal({ correlationId: 'X', outcome: 'abandoned', roundId: 'R' })

    // The store owns canonicalization: one record survives, the first one.
    expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'R' }])

    // The facts own counting: no dedupe happens here, and none is needed.
    expect(deriveLiaBrainTerminalObservationFacts(store.get('X')!)).toEqual({
      abandonedTerminalObservationCount: 0,
      failedTerminalObservationCount: 1,
      succeededTerminalObservationCount: 0,
    })
  })

  it('k: the REAL store counts several rounds independently', () => {
    const { store } = realStore()
    store.recordExecutionTerminal({ correlationId: 'X', outcome: 'succeeded', roundId: 'A' })
    store.recordExecutionTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'B' })
    store.recordExecutionTerminal({ correlationId: 'X', outcome: 'abandoned', roundId: 'C' })
    store.recordExecutionTerminal({ correlationId: 'X', outcome: 'succeeded', roundId: 'D' })

    expect(deriveLiaBrainTerminalObservationFacts(store.get('X')!)).toEqual({
      abandonedTerminalObservationCount: 1,
      failedTerminalObservationCount: 1,
      succeededTerminalObservationCount: 2,
    })
  })

  it('l: a structural record with a duplicated outcome is counted as often as it appears', () => {
    // No dedupe lives here on purpose: the canonical store is the layer that
    // guarantees one record per round, so this derivation must not silently
    // rewrite a collection it is handed.
    expect(deriveLiaBrainTerminalObservationFacts({ executionTerminals: [terminal('failed'), terminal('failed')] })).toEqual({
      abandonedTerminalObservationCount: 0,
      failedTerminalObservationCount: 2,
      succeededTerminalObservationCount: 0,
    })
  })
})

describe('execution terminal facts - purity (Phase 8.0D-10B-4D4C3B1)', () => {
  it('m: the derivation never edits the supplied collection or its records', () => {
    const snapshot = deepFreeze<LiaBrainTerminalObservationSnapshot>({
      executionTerminals: [terminal('succeeded'), terminal('failed'), terminal('abandoned')],
    })
    const before = JSON.stringify(snapshot)

    deriveLiaBrainTerminalObservationFacts(snapshot)

    expect(JSON.stringify(snapshot)).toBe(before)
    expect(Object.isFrozen(snapshot.executionTerminals)).toBe(true)
    expect(Object.isFrozen(snapshot.executionTerminals![0])).toBe(true)
  })

  it('n: every call returns a fresh, deeply equal result', () => {
    const snapshot: LiaBrainTerminalObservationSnapshot = { executionTerminals: [terminal('succeeded'), terminal('failed')] }

    const first = deriveLiaBrainTerminalObservationFacts(snapshot)
    const second = deriveLiaBrainTerminalObservationFacts(snapshot)

    expect(first).toEqual(second)
    expect(first).not.toBe(second)
  })

  it('o: mutating one result reaches neither the input nor a later derivation', () => {
    const snapshot: LiaBrainTerminalObservationSnapshot = { executionTerminals: [terminal('succeeded')] }
    const baseline = deriveLiaBrainTerminalObservationFacts(snapshot)
    const inputBefore = JSON.stringify(snapshot)

    const mutated = deriveLiaBrainTerminalObservationFacts(snapshot)
    mutated.succeededTerminalObservationCount = 99
    mutated.failedTerminalObservationCount = 99
    mutated.abandonedTerminalObservationCount = 99

    expect(deriveLiaBrainTerminalObservationFacts(snapshot)).toEqual(baseline)
    expect(JSON.stringify(snapshot)).toBe(inputBefore)
    expect(baseline.succeededTerminalObservationCount).toBe(1)
  })

  it('p: the result is exactly the three approved counts - no total, no boolean, no per-round field', () => {
    const facts = deriveLiaBrainTerminalObservationFacts({ executionTerminals: [terminal('abandoned')] })

    expect(Object.keys(facts).sort()).toEqual([
      'abandonedTerminalObservationCount',
      'failedTerminalObservationCount',
      'succeededTerminalObservationCount',
    ])
    // No total field: the total is exactly the sum of the three counts.
    expect('terminalObservationCount' in facts).toBe(false)
    expect('terminalCount' in facts).toBe(false)
    // No presence flags: each would be exactly `count > 0`.
    for (const boolean of ['succeededTerminalObserved', 'failedTerminalObserved', 'abandonedTerminalObserved'])
      expect(boolean in facts).toBe(false)
    // No per-round record and no raw collection in the result.
    for (const forbidden of ['roundId', 'executionTerminals', 'outcome', 'attempts'])
      expect(JSON.stringify(facts)).not.toContain(forbidden)
  })
})

describe('execution terminal facts - source guards (Phase 8.0D-10B-4D4C3B1)', () => {
  it('q: the accepted outcome vocabulary is exactly the three closed values', () => {
    const source = readSource(TERMINAL_FACTS)

    expect(source).toContain(`| 'succeeded'`)
    expect(source).toContain(`| 'failed'`)
    expect(source).toContain(`| 'abandoned'`)
    // Nothing else is an outcome here: no synonym, no translated label, no
    // upper-cased variant, no label from another layer is ever part of it.
    expect(source).not.toMatch(/cancelled|completed|finished|successful|failure|\berror\b|\btimeout\b/i)
  })

  it('r: the module imports nothing - no store, no adapter, no transport, no observer, no logger', () => {
    const code = stripComments(readSource(TERMINAL_FACTS))

    expect(code).not.toMatch(/^import /m)
    expect(code).not.toMatch(/from '/)
    expect(code).not.toMatch(/brain-correlation|brain-execution-identity|brain-diagnostic|observer|correlationService/)
  })

  it('s: the derivation stays pure - no state, no clock, no async, no output, no transport', () => {
    const source = readSource(TERMINAL_FACTS)
    const code = stripComments(source)

    // Counting vocabulary only: no interpretation of an outcome, no verdict,
    // no routing comparison and no completion claim.
    expect(source).not.toMatch(/fallback/i)
    expect(source).not.toMatch(/completed|completion|finished/i)
    expect(code).not.toMatch(/finalAttempt|winningAttempt|winner|\bfinal\b/)
    expect(code).not.toMatch(/sendSucceeded|sendFailed|sendOutcome/)
    expect(code).not.toMatch(/routeMatch|mismatch|expectedRoute|providerSelection|modelSelection/)
    // No write API, no observation trigger, no authority over execution.
    expect(code).not.toMatch(/recordDecision|recordExecution|\.observe\(/)
    expect(code).not.toMatch(/brainService|fallbackResolver|setPreferred|permission|toolCall|switch/i)
    // No state container, no clock, no async layer, no output.
    expect(code).not.toMatch(/new Map|new Set|WeakMap|WeakSet|cache|history/)
    expect(code).not.toMatch(/setInterval|setTimeout|Date\.now|performance\.now|Math\.random|timestamp/i)
    expect(code).not.toMatch(/\basync\b|\bawait\b|Promise|queueMicrotask/)
    expect(source).not.toMatch(/console\.|useLogg|logger|posthog|telemetry/i)
    // No transport of any kind.
    expect(code).not.toMatch(/eventa|ipcMain|ipcRenderer|BrowserWindow|\.emit\(|context\.on\(/)
    // Metadata only: no content, no credentials, no endpoints.
    expect(source).not.toMatch(/prompt|messages?|usage|credential|apiKey|baseURL/i)
  })

  it('t: the derivation has exactly ONE production caller - the unwired composition', () => {
    // Phase 8.0D-10B-4D4C3B2 adds that ONE caller: the pure single-snapshot
    // composition, which itself has no production caller. Wiring the counts
    // into the read path, the observer or the diagnostic output is a later
    // phase.
    expect(productionMatching(/deriveLiaBrainTerminalObservationFacts\(/)).toEqual([COMPOSITION, TERMINAL_FACTS])
  })
})
