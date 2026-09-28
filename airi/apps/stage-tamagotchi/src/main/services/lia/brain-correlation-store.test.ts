import type { LiaBrainRoutingDecision } from '@lia/core'

import type { LiaBrainExecutionTerminalReport, LiaBrainSendTerminalReport } from '../../../shared/eventa'
import type { LiaBrainCorrelationStore, LiaBrainExecutionTerminalRecord, LiaBrainSendTerminalRecord } from './brain-correlation-store'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createLiaBrainCorrelationStore } from './brain-correlation-store'

/**
 * Phase 8.0D-10B-4B1: the ephemeral correlation store.
 *
 * Real store, real pruning, injected clock - no mocks, because the module has
 * no dependencies to mock. The invariants pinned here: bounded, ephemeral,
 * deterministic, order-independent, fact-only, and wired to nothing.
 */

interface DecisionOverrides {
  engineId?: string
  modelId?: string
  mode?: string
  status?: string
}

/** A canonical-shaped decision. Only identity fields differ between cases. */
function decision(overrides: DecisionOverrides = {}): LiaBrainRoutingDecision {
  return {
    id: 'decision-1',
    mode: overrides.mode ?? 'automatic',
    readiness: { status: 'ready' },
    required: ['textInput', 'textOutput'],
    selection: {
      engine: { id: overrides.engineId ?? 'groq' },
      model: { id: overrides.modelId ?? 'openai/gpt-oss-120b' },
      status: 'selected',
    },
    status: overrides.status ?? 'automatic',
  } as unknown as LiaBrainRoutingDecision
}

/** One five-field execution report, exactly as the main handler sanitizes it. */
function report(overrides: Partial<Record<'correlationId' | 'conversationId' | 'roundId' | 'providerId' | 'modelId', string>> = {}) {
  return {
    correlationId: overrides.correlationId ?? 'X',
    conversationId: overrides.conversationId ?? 'conversation-1',
    roundId: overrides.roundId ?? 'round-a',
    providerId: overrides.providerId ?? 'mock-provider',
    modelId: overrides.modelId ?? 'gpt-test',
  }
}

/** One serialized terminal report, exactly as the future main ingress will deliver it. */
function terminalReport(correlationId: string, roundId: string, outcome: 'succeeded' | 'failed' | 'abandoned'): LiaBrainExecutionTerminalReport {
  return { correlationId, outcome, roundId }
}

/** One serialized send-terminal report, exactly as the future main ingress will deliver it. */
function sendReport(correlationId: string, outcome: 'succeeded' | 'failed'): LiaBrainSendTerminalReport {
  return { correlationId, outcome }
}

/** A store whose clock the test drives by hand. */
function clockedStore(options: { maxEntries?: number, ttlMs?: number } = {}) {
  let current = 1_000
  const store = createLiaBrainCorrelationStore({
    maxEntries: options.maxEntries ?? 8,
    ttlMs: options.ttlMs ?? 1_000,
    now: () => current,
  })
  return {
    store,
    advance: (ms: number) => {
      current += ms
    },
  }
}

const REPO_ROOT = new URL('../../../../../../', import.meta.url)
/** `fileURLToPath` keeps the trailing separator of a directory URL. */
const REPO_PREFIX = `${fileURLToPath(REPO_ROOT).replace(/\/+$/, '')}/`

/** Every production (non-test) `.ts`/`.vue` file under the repo-relative roots. */
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

/** Production sources whose content matches the pattern, in stable order. */
function productionSourcesMatching(roots: string[], pattern: RegExp): string[] {
  return productionSources(roots)
    .filter(relative => pattern.test(readFileSync(new URL(relative, REPO_ROOT), 'utf-8')))
    .sort()
}

function storeSource(): string {
  return readFileSync(new URL('./brain-correlation-store.ts', import.meta.url), 'utf-8')
}

/** Code without comments - the vocabulary guards only look at real code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('lia brain correlation store - basics (Phase 8.0D-10B-4B1)', () => {
  it('a/b/c/d/e: entries are created by key, and share one entry per key', () => {
    const { store } = clockedStore()

    // A: nothing recorded, nothing retained.
    expect(store.size).toBe(0)
    expect(store.get('X')).toBeUndefined()

    // B: a decision creates exactly one entry.
    store.recordDecision('X', decision())
    expect(store.size).toBe(1)

    // C: an execution creates exactly one entry of its own.
    store.recordExecution(report({ correlationId: 'Y' }))
    expect(store.size).toBe(2)

    // D: the same id fills ONE entry with both facts.
    store.recordExecution(report({ correlationId: 'X', roundId: 'round-1' }))
    store.recordDecision('X', decision())
    expect(store.size).toBe(2)
    expect(store.get('X')?.decision).toBeDefined()
    expect(store.get('X')?.executions).toHaveLength(1)

    // E: distinct keys stay independent.
    expect(store.get('Y')?.decision).toBeUndefined()
    expect(store.get('X')?.executions[0]?.roundId).toBe('round-1')
    expect(store.get('Y')?.executions[0]?.correlationId).toBe('Y')
  })

  it('f: the snapshot exposes only the allowed factual fields', () => {
    const { store } = clockedStore()
    store.recordDecision('X', decision())
    store.recordExecution(report({ correlationId: 'X' }))

    const snapshot = store.get('X')!
    expect(Object.keys(snapshot).sort()).toEqual(['correlationId', 'createdAt', 'decision', 'executionTerminals', 'executions'])
    // 8.0D-10B-4C2A: the terminal collection is a required factual field - a
    // live entry always exposes it, empty until a round settles.
    expect(snapshot.executionTerminals).toEqual([])
    expect(snapshot.correlationId).toBe('X')
    expect(typeof snapshot.createdAt).toBe('number')
    // The decision is the canonical domain object, returned unchanged.
    expect(snapshot.decision).toEqual(decision())
    // Every execution is exactly the five reported identities.
    for (const execution of snapshot.executions)
      expect(Object.keys(execution).sort()).toEqual(['conversationId', 'correlationId', 'modelId', 'providerId', 'roundId'])
  })

  it('f2: an unusable key is ignored, and nothing else is stored', () => {
    const { store } = clockedStore()

    // One convention, documented: a non-string or empty key reads as "no key".
    store.recordDecision('', decision())
    store.recordDecision(undefined as unknown as string, decision())
    store.recordDecision(null as unknown as string, decision())
    store.recordExecution(report({ correlationId: '' }))
    store.recordExecution(undefined as unknown as never)
    store.recordExecution({ ...report(), correlationId: 42 as unknown as string })

    expect(store.size).toBe(0)
    expect(store.get('')).toBeUndefined()

    // A key that is not a string cannot smuggle an entry in either.
    store.recordDecision('X', decision())
    expect(store.get(42 as unknown as string)).toBeUndefined()
    expect(store.size).toBe(1)
  })

  it('option validation: invalid bounds fail immediately and deterministically', () => {
    const invalid = [
      { maxEntries: 0, ttlMs: 1 },
      { maxEntries: -1, ttlMs: 1 },
      { maxEntries: 1.5, ttlMs: 1 },
      { maxEntries: Number.NaN, ttlMs: 1 },
      { maxEntries: Number.POSITIVE_INFINITY, ttlMs: 1 },
      { maxEntries: '8' as unknown as number, ttlMs: 1 },
      { maxEntries: 8, ttlMs: 0 },
      { maxEntries: 8, ttlMs: -5 },
      { maxEntries: 8, ttlMs: Number.NaN },
      { maxEntries: 8, ttlMs: Number.POSITIVE_INFINITY },
      { maxEntries: 8, ttlMs: '1000' as unknown as number },
      { maxEntries: 8, ttlMs: 1_000, now: 5 as unknown as () => number },
    ]

    for (const options of invalid) {
      expect(() => createLiaBrainCorrelationStore(options as never)).toThrowError(TypeError)
    }
    // The messages are the deterministic part callers can rely on.
    expect(() => createLiaBrainCorrelationStore({ maxEntries: 0, ttlMs: 1 }))
      .toThrowError('Lia brain correlation store: maxEntries must be a positive finite integer')
    expect(() => createLiaBrainCorrelationStore({ maxEntries: 1, ttlMs: 0 }))
      .toThrowError('Lia brain correlation store: ttlMs must be a positive finite number')
    expect(() => createLiaBrainCorrelationStore({ maxEntries: 1, ttlMs: 1, now: null as unknown as () => number }))
      .toThrowError('Lia brain correlation store: now must be a function when provided')

    // And valid bounds still build a working store.
    expect(createLiaBrainCorrelationStore({ maxEntries: 1, ttlMs: 1 }).size).toBe(0)
  })
})

describe('lia brain correlation store - first decision wins (Phase 8.0D-10B-4B1)', () => {
  it('g/h/i/j: a repeated decision never replaces, merges or moves anything', () => {
    const { store } = clockedStore()
    const first = decision({ engineId: 'groq', modelId: 'openai/gpt-oss-120b' })
    const second = decision({ engineId: 'anthropic', modelId: 'claude-x', mode: 'manual', status: 'manual' })

    // G: the first trusted decision is stored.
    store.recordDecision('X', first)
    expect(store.get('X')?.decision).toBe(first)

    // J: executions recorded before the collision stay exactly as they were.
    store.recordExecution(report({ correlationId: 'X', roundId: 'round-a', providerId: 'groq', modelId: 'openai/gpt-oss-120b' }))
    const beforeCollision = store.get('X')!.executions

    store.recordDecision('X', second)

    // H: the stored decision is still the first one - not merged, not compared.
    expect(store.get('X')?.decision).toBe(first)
    expect(store.get('X')?.decision).not.toEqual(second)
    // I: the collision created no second entry.
    expect(store.size).toBe(1)
    // J: the executions are untouched.
    expect(store.get('X')!.executions).toEqual(beforeCollision)
    expect(store.get('X')!.executions[0]?.roundId).toBe('round-a')
  })

  it('the first decision wins even when the key was first seen by an execution', () => {
    const { store } = clockedStore()
    const first = decision({ engineId: 'groq' })
    const second = decision({ engineId: 'anthropic' })

    store.recordExecution(report({ correlationId: 'X' }))
    // Nothing to fill yet - the entry exists without a decision.
    expect(store.get('X')?.decision).toBeUndefined()

    store.recordDecision('X', first)
    expect(store.get('X')?.decision).toBe(first)

    // From then on it can never change.
    store.recordDecision('X', second)
    expect(store.get('X')?.decision).toBe(first)
  })
})

describe('lia brain correlation store - execution attempts (Phase 8.0D-10B-4B1)', () => {
  it('k/l/m/n/o/p: attempts append in arrival order, undeduplicated and verbatim', () => {
    const { store } = clockedStore()
    store.recordDecision('X', decision())

    store.recordExecution(report({ correlationId: 'X', roundId: 'A', providerId: 'groq', modelId: 'openai/gpt-oss-120b' }))
    store.recordExecution(report({ correlationId: 'X', roundId: 'B', providerId: 'anthropic', modelId: 'claude-x' }))

    const executions = store.get('X')!.executions
    // K: both attempts are stored.
    expect(executions).toHaveLength(2)
    // L: arrival order is preserved - no sorting.
    expect(executions.map(execution => execution.roundId)).toEqual(['A', 'B'])
    // M/N: the shared key and the distinct rounds are preserved.
    expect(new Set(executions.map(execution => execution.correlationId))).toEqual(new Set(['X']))
    expect(new Set(executions.map(execution => execution.roundId)).size).toBe(2)
    // O: provider/model identities are stored verbatim.
    expect(executions.map(execution => [execution.providerId, execution.modelId])).toEqual([
      ['groq', 'openai/gpt-oss-120b'],
      ['anthropic', 'claude-x'],
    ])

    // P: no dedupe policy yet - an identical report recorded twice is kept twice.
    store.recordExecution(report({ correlationId: 'X', roundId: 'A', providerId: 'groq', modelId: 'openai/gpt-oss-120b' }))
    expect(store.get('X')!.executions).toHaveLength(3)
    expect(store.get('X')!.executions.map(execution => execution.roundId)).toEqual(['A', 'B', 'A'])
  })
})

describe('lia brain correlation store - arrival order (Phase 8.0D-10B-4B1)', () => {
  const factsOf = (entry: { decision?: LiaBrainRoutingDecision, executions: Array<Record<string, unknown>> } | undefined) => ({
    decision: entry?.decision,
    executions: entry?.executions,
  })

  it('q/r: both arrival orders converge on the same facts', () => {
    const { store: decisionFirst } = clockedStore()
    const { store: executionsFirst } = clockedStore()

    const attempts = [
      report({ correlationId: 'X', roundId: 'A', providerId: 'groq', modelId: 'openai/gpt-oss-120b' }),
      report({ correlationId: 'X', roundId: 'B', providerId: 'anthropic', modelId: 'claude-x' }),
    ]

    // Q: decision, then the two attempts.
    decisionFirst.recordDecision('X', decision())
    for (const attempt of attempts)
      decisionFirst.recordExecution(attempt)

    // R: the two attempts, then the decision.
    for (const attempt of attempts)
      executionsFirst.recordExecution(attempt)
    executionsFirst.recordDecision('X', decision())

    expect(factsOf(executionsFirst.get('X'))).toEqual(factsOf(decisionFirst.get('X')))
    expect(factsOf(decisionFirst.get('X')).executions?.map(execution => execution.roundId)).toEqual(['A', 'B'])
    // Only the creation timestamp may differ, and only because arrival differed
    // in wall-clock terms - each store's clock is its own.
    expect(typeof decisionFirst.get('X')!.createdAt).toBe('number')
    expect(typeof executionsFirst.get('X')!.createdAt).toBe('number')
  })
})

describe('lia brain correlation store - TTL (Phase 8.0D-10B-4B1)', () => {
  it('s/t/u/v: expiry is lazy, exact, and removes the entry everywhere', () => {
    const { store, advance } = clockedStore({ ttlMs: 1_000 })
    store.recordDecision('X', decision())
    store.recordExecution(report({ correlationId: 'X' }))

    // S: alive strictly before the TTL.
    advance(999)
    expect(store.get('X')).toBeDefined()
    expect(store.size).toBe(1)

    // T: expired exactly AT the TTL boundary (age >= ttlMs).
    advance(1)
    expect(store.get('X')).toBeUndefined()

    // U: gone from reads - decision and executions included.
    expect(store.get('X')).toBeUndefined()

    // V: and from size, as soon as a public operation touches the store.
    expect(store.size).toBe(0)
    // Repeated reads stay stable (pruning is idempotent).
    expect(store.size).toBe(0)
  })

  it('v2: expiry is not extended by later reports', () => {
    const { store, advance } = clockedStore({ ttlMs: 1_000 })
    store.recordDecision('X', decision())

    // A stream of untrusted reports must not keep the entry alive forever: the
    // age is measured from creation, not from the last write.
    for (let i = 0; i < 11; i += 1) {
      advance(90)
      store.recordExecution(report({ correlationId: 'X', roundId: `round-${i}` }))
    }

    // 990ms of repeated activity, then past the TTL from creation.
    expect(store.get('X')?.executions).toHaveLength(11)
    advance(10)
    expect(store.get('X')).toBeUndefined()
    expect(store.size).toBe(0)
  })

  it('w/x: the same key after expiry starts a fresh entry with no leaked state', () => {
    const { store, advance } = clockedStore({ ttlMs: 500 })
    const oldDecision = decision({ engineId: 'groq' })
    const newDecision = decision({ engineId: 'anthropic' })

    store.recordDecision('X', oldDecision)
    store.recordExecution(report({ correlationId: 'X', roundId: 'A' }))
    advance(500)
    expect(store.size).toBe(0)

    // W: a later event with the same key creates a NEW entry.
    store.recordExecution(report({ correlationId: 'X', roundId: 'C', providerId: 'anthropic' }))
    expect(store.size).toBe(1)

    // X: no old decision and no old attempts leaked into it - and the FIRST
    // decision of the fresh entry is the new one.
    expect(store.get('X')?.decision).toBeUndefined()
    expect(store.get('X')?.executions.map(execution => execution.roundId)).toEqual(['C'])
    store.recordDecision('X', newDecision)
    expect(store.get('X')?.decision).toBe(newDecision)
    expect(store.get('X')?.executions).toHaveLength(1)
  })
})

describe('lia brain correlation store - capacity (Phase 8.0D-10B-4B1)', () => {
  it('y/z/aa: the bound holds and eviction drops the OLDEST live entry', () => {
    const { store, advance } = clockedStore({ maxEntries: 3, ttlMs: 100_000 })

    for (const key of ['A', 'B', 'C']) {
      advance(10)
      store.recordDecision(key, decision())
    }
    // Y: never more than the bound.
    expect(store.size).toBe(3)

    advance(10)
    store.recordExecution(report({ correlationId: 'D' }))

    // Z + AA: deterministic, creation-ordered eviction - the oldest is gone.
    expect(store.size).toBe(3)
    expect(store.get('A')).toBeUndefined()
    expect(['B', 'C', 'D'].map(key => store.get(key) !== undefined)).toEqual([true, true, true])
    // Eviction is never a ranking: the surviving entries keep their own facts.
    expect(store.get('D')?.executions).toHaveLength(1)
    expect(store.get('B')?.decision).toBeDefined()
  })

  it('ab: updating an existing key never evicts another entry', () => {
    const { store, advance } = clockedStore({ maxEntries: 2, ttlMs: 100_000 })
    advance(10)
    store.recordDecision('A', decision())
    advance(10)
    store.recordExecution(report({ correlationId: 'B' }))

    // Every kind of update on a live key - including the ignored repeat of a
    // decision - leaves the other entry alone.
    for (let i = 0; i < 5; i += 1) {
      advance(10)
      store.recordExecution(report({ correlationId: 'A', roundId: `round-${i}` }))
      store.recordDecision('A', decision({ engineId: 'anthropic' }))
      store.recordExecution(report({ correlationId: 'B', roundId: `round-b-${i}` }))
    }

    expect(store.size).toBe(2)
    expect(store.get('A')?.executions).toHaveLength(5)
    expect(store.get('B')?.executions).toHaveLength(6)
    expect(store.get('A')?.decision?.selection?.engine?.id).toBe('groq')
  })

  it('ac: expired entries are pruned before capacity is enforced', () => {
    const { store, advance } = clockedStore({ maxEntries: 2, ttlMs: 100 })
    store.recordDecision('A', decision())
    store.recordExecution(report({ correlationId: 'B' }))

    // Both entries are dead by now - the new key must not evict a LIVE entry
    // to make room for itself.
    advance(100)
    store.recordExecution(report({ correlationId: 'C' }))

    expect(store.size).toBe(1)
    expect(store.get('A')).toBeUndefined()
    expect(store.get('B')).toBeUndefined()
    expect(store.get('C')?.executions).toHaveLength(1)

    // And with the bounded map emptied, the next two keys simply fill it.
    advance(10)
    store.recordDecision('D', decision())
    advance(10)
    store.recordDecision('E', decision())
    expect(store.size).toBe(2)
    expect(store.get('D')).toBeDefined()
    expect(store.get('E')).toBeDefined()
  })
})

describe('lia brain correlation store - mutation isolation (Phase 8.0D-10B-4B1)', () => {
  it('ad/ae/af: callers cannot reach into the stored state', () => {
    const { store } = clockedStore()
    store.recordDecision('X', decision())
    store.recordExecution(report({ correlationId: 'X', roundId: 'A' }))

    const snapshot = store.get('X')!
    // AD: mutating the returned array does not mutate the store.
    snapshot.executions.push(report({ correlationId: 'X', roundId: 'hijacked' }))
    snapshot.executions.length = 0
    // AE: mutating a returned report does not mutate the store.
    const firstRead = store.get('X')!.executions[0]!
    firstRead.roundId = 'mutated'
    firstRead.providerId = 'mutated-provider'

    // AF: the next read is intact.
    const after = store.get('X')!.executions
    expect(after).toHaveLength(1)
    expect(after[0]).toEqual(report({ correlationId: 'X', roundId: 'A' }))

    // The stored entry itself is fresh on every read.
    expect(store.get('X')).not.toBe(store.get('X'))
    expect(store.get('X')!.executions).not.toBe(store.get('X')!.executions)

    // And a report object handed IN cannot be used to reach the stored state
    // either: the store keeps its own copy.
    const incoming = report({ correlationId: 'Y', roundId: 'in' })
    store.recordExecution(incoming)
    incoming.roundId = 'changed-after-recording'
    expect(store.get('Y')!.executions[0]?.roundId).toBe('in')
  })
})

describe('lia brain correlation store - terminal round outcomes (Phase 8.0D-10B-4C2A)', () => {
  /** The canonical terminal collection of one entry, flattened for assertions. */
  function settled(store: ReturnType<typeof createLiaBrainCorrelationStore>, correlationId: string): string[] {
    return store.get(correlationId)!.executionTerminals.map(record => `${record.roundId}/${record.outcome}`)
  }

  it('41: a fresh decision-only or execution-only entry exposes an empty terminal collection', () => {
    const { store } = clockedStore()

    store.recordDecision('decision-only', decision())
    store.recordExecution(report({ correlationId: 'execution-only' }))

    for (const key of ['decision-only', 'execution-only']) {
      const snapshot = store.get(key)!
      // Required empty array - never absent, never undefined: "nothing settled
      // yet" is a fact of its own.
      expect(snapshot.executionTerminals).toEqual([])
      expect(Object.keys(snapshot)).toContain('executionTerminals')
    }
  })

  it('42: a terminal-first write is a normal entry - decision absent, no execution invented', () => {
    const { store } = clockedStore()

    store.recordExecutionTerminal(terminalReport('X', 'round-a', 'failed'))

    expect(store.size).toBe(1)
    const snapshot = store.get('X')!
    // The terminal may be the very first thing known about a logical send.
    expect(snapshot.decision).toBeUndefined()
    expect(snapshot.executions).toEqual([])
    expect(snapshot.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'round-a' }])
    // Exactly the two fields - the correlation id is not duplicated inside.
    expect(Object.keys(snapshot.executionTerminals[0]!).sort()).toEqual(['outcome', 'roundId'])
  })

  it('43: all three outcomes are stored verbatim, with no translation or normalization', () => {
    const { store } = clockedStore()

    store.recordExecutionTerminal(terminalReport('X', 'round-a', 'succeeded'))
    store.recordExecutionTerminal(terminalReport('X', 'round-b', 'failed'))
    store.recordExecutionTerminal(terminalReport('X', 'round-c', 'abandoned'))

    expect(settled(store, 'X')).toEqual(['round-a/succeeded', 'round-b/failed', 'round-c/abandoned'])
  })

  it('44/45: the first terminal outcome per round wins - repeats and conflicts append nothing', () => {
    const { store } = clockedStore()

    // The conflicting sequence: the fact that settled first is the fact kept.
    store.recordExecutionTerminal(terminalReport('X', 'round-r', 'failed'))
    store.recordExecutionTerminal(terminalReport('X', 'round-r', 'succeeded'))
    store.recordExecutionTerminal(terminalReport('X', 'round-r', 'abandoned'))
    // A repeated identical outcome appends nothing either.
    store.recordExecutionTerminal(terminalReport('X', 'round-s', 'succeeded'))
    store.recordExecutionTerminal(terminalReport('X', 'round-s', 'succeeded'))

    expect(settled(store, 'X')).toEqual(['round-r/failed', 'round-s/succeeded'])
    expect(store.get('X')!.executionTerminals).toHaveLength(2)
    // Immutable factual history: no overwrite, no conflict error, no reorder.
    expect(store.get('X')!.executionTerminals[0]).toEqual({ outcome: 'failed', roundId: 'round-r' })
  })

  it('46: different rounds keep first-observed arrival order, never sorted', () => {
    const { store } = clockedStore()

    // Deliberately not alphabetical: the stored order is arrival, not ranking.
    store.recordExecutionTerminal(terminalReport('X', 'round-c', 'failed'))
    store.recordExecutionTerminal(terminalReport('X', 'round-a', 'succeeded'))
    store.recordExecutionTerminal(terminalReport('X', 'round-b', 'abandoned'))

    expect(settled(store, 'X')).toEqual(['round-c/failed', 'round-a/succeeded', 'round-b/abandoned'])
  })

  it('47: terminal before execution start keeps both facts and synthesizes no identity', () => {
    const { store } = clockedStore()

    store.recordExecutionTerminal(terminalReport('X', 'round-a', 'failed'))
    // Nothing to read an identity from - and nothing is invented.
    expect(store.get('X')!.executions).toEqual([])

    store.recordExecution(report({ correlationId: 'X', roundId: 'round-a' }))

    const snapshot = store.get('X')!
    expect(snapshot.executions).toEqual([report({ correlationId: 'X', roundId: 'round-a' })])
    // The terminal record is untouched and still carries only its two fields.
    expect(snapshot.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'round-a' }])
    expect(Object.keys(snapshot.executionTerminals[0]!).sort()).toEqual(['outcome', 'roundId'])
  })

  it('48: execution before terminal keeps both facts and never touches the execution record', () => {
    const { store } = clockedStore()

    store.recordExecution(report({ correlationId: 'X', roundId: 'round-a', providerId: 'groq' }))
    store.recordExecutionTerminal(terminalReport('X', 'round-a', 'succeeded'))

    const snapshot = store.get('X')!
    expect(snapshot.executions).toEqual([report({ correlationId: 'X', roundId: 'round-a', providerId: 'groq' })])
    expect(snapshot.executionTerminals).toEqual([{ outcome: 'succeeded', roundId: 'round-a' }])
    // The outcome was NOT attached to the execution report: the two factual
    // collections stay separate.
    expect(Object.keys(snapshot.executions[0]!).sort()).toEqual(['conversationId', 'correlationId', 'modelId', 'providerId', 'roundId'])
  })

  it('49/50: terminal and decision coexist in either arrival order, first decision still wins', () => {
    const terminalFirst = clockedStore().store
    terminalFirst.recordExecutionTerminal(terminalReport('X', 'round-a', 'abandoned'))
    terminalFirst.recordDecision('X', decision({ engineId: 'groq' }))
    terminalFirst.recordDecision('X', decision({ engineId: 'anthropic' }))

    const decisionFirst = clockedStore().store
    decisionFirst.recordDecision('X', decision({ engineId: 'groq' }))
    decisionFirst.recordExecutionTerminal(terminalReport('X', 'round-a', 'abandoned'))

    for (const store of [terminalFirst, decisionFirst]) {
      expect(store.get('X')!.decision?.selection?.engine?.id).toBe('groq')
      expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'abandoned', roundId: 'round-a' }])
    }
  })

  it('51: a terminal with no matching start - none, or another round - is accepted without a join', () => {
    const { store } = clockedStore()

    // No executions at all.
    store.recordExecutionTerminal(terminalReport('X', 'round-a', 'succeeded'))
    // A start for a DIFFERENT round only.
    store.recordExecution(report({ correlationId: 'X', roundId: 'round-other' }))
    // And a terminal for a round that never started.
    store.recordExecutionTerminal(terminalReport('X', 'round-never-started', 'failed'))

    const snapshot = store.get('X')!
    expect(snapshot.executions.map(execution => execution.roundId)).toEqual(['round-other'])
    expect(settled(store, 'X')).toEqual(['round-a/succeeded', 'round-never-started/failed'])
  })

  it('52: the terminal collection is copy-safe on both directions', () => {
    const { store } = clockedStore()
    store.recordExecutionTerminal(terminalReport('X', 'round-a', 'failed'))

    const snapshot = store.get('X')!
    // Mutating the returned array does not reach the entry.
    snapshot.executionTerminals.push({ outcome: 'succeeded', roundId: 'hijacked' })
    // Mutating a returned record does not reach the entry either.
    snapshot.executionTerminals[0]!.outcome = 'succeeded'
    snapshot.executionTerminals[0]!.roundId = 'mutated'

    const after = store.get('X')!.executionTerminals
    expect(after).toEqual([{ outcome: 'failed', roundId: 'round-a' }])
    expect(store.get('X')!.executionTerminals).not.toBe(store.get('X')!.executionTerminals)

    // And the object handed IN is copied too.
    const incoming = terminalReport('X', 'round-b', 'failed')
    store.recordExecutionTerminal(incoming)
    incoming.outcome = 'succeeded'
    incoming.roundId = 'changed-after-recording'
    expect(store.get('X')!.executionTerminals[1]).toEqual({ outcome: 'failed', roundId: 'round-b' })
  })

  it('53: a terminal-first write establishes createdAt, and later terminals never extend the lifetime', () => {
    const { store, advance } = clockedStore({ ttlMs: 1_000 })

    store.recordExecutionTerminal(terminalReport('X', 'round-a', 'succeeded'))
    const createdAt = store.get('X')!.createdAt

    // A stream of later terminal reports must not keep the entry alive: the age
    // is measured from creation, exactly like every other write.
    for (let i = 0; i < 9; i += 1) {
      advance(100)
      store.recordExecutionTerminal(terminalReport('X', `round-${i}`, 'failed'))
    }

    expect(store.get('X')!.createdAt).toBe(createdAt)
    expect(store.get('X')!.executionTerminals).toHaveLength(10)
    // 900ms of activity, then the original boundary is crossed.
    advance(100)
    expect(store.get('X')).toBeUndefined()
    expect(store.size).toBe(0)
  })

  it('54: mixed writes are anchored to the FIRST write, not to the newest fact', () => {
    const { store, advance } = clockedStore({ ttlMs: 1_000 })

    // T0 terminal A, T1 execution A, T2 terminal B, T3 decision.
    store.recordExecutionTerminal(terminalReport('X', 'round-a', 'succeeded'))
    const createdAt = store.get('X')!.createdAt
    advance(10)
    store.recordExecution(report({ correlationId: 'X', roundId: 'round-a' }))
    advance(10)
    store.recordExecutionTerminal(terminalReport('X', 'round-b', 'failed'))
    advance(10)
    store.recordDecision('X', decision())

    // Alive one tick before T0 + TTL...
    advance(969)
    expect(store.get('X')!.createdAt).toBe(createdAt)
    expect(store.get('X')!.executionTerminals).toHaveLength(2)
    // ...and expired exactly at the boundary of the entry's creation.
    advance(1)
    expect(store.get('X')).toBeUndefined()
    expect(store.size).toBe(0)
  })

  it('55: after expiry a terminal write starts a fresh entry - old facts are not resurrected', () => {
    const { store, advance } = clockedStore({ ttlMs: 500 })

    store.recordDecision('X', decision())
    store.recordExecution(report({ correlationId: 'X', roundId: 'round-old' }))
    store.recordExecutionTerminal(terminalReport('X', 'round-old', 'succeeded'))
    advance(500)
    expect(store.size).toBe(0)

    store.recordExecutionTerminal(terminalReport('X', 'round-new', 'failed'))

    expect(store.size).toBe(1)
    const snapshot = store.get('X')!
    expect(snapshot.decision).toBeUndefined()
    expect(snapshot.executions).toEqual([])
    expect(snapshot.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'round-new' }])
  })

  it('56: terminal-only correlations take part in the same capacity eviction', () => {
    const { store, advance } = clockedStore({ maxEntries: 2, ttlMs: 100_000 })

    advance(10)
    store.recordExecutionTerminal(terminalReport('A', 'round-a', 'failed'))
    advance(10)
    store.recordExecutionTerminal(terminalReport('B', 'round-b', 'succeeded'))

    expect(store.size).toBe(2)

    advance(10)
    store.recordExecutionTerminal(terminalReport('C', 'round-c', 'abandoned'))

    // The oldest live entry goes, exactly as for decisions and executions: no
    // terminal-specific quota, no ranking.
    expect(store.size).toBe(2)
    expect(store.get('A')).toBeUndefined()
    expect(settled(store, 'B')).toEqual(['round-b/succeeded'])
    expect(settled(store, 'C')).toEqual(['round-c/abandoned'])
  })

  it('57: many terminal rounds under ONE key are still ONE entry', () => {
    const { store } = clockedStore({ maxEntries: 2, ttlMs: 100_000 })

    for (let i = 0; i < 20; i += 1)
      store.recordExecutionTerminal(terminalReport('X', `round-${i}`, 'succeeded'))

    // Terminal records never count as entries of their own.
    expect(store.size).toBe(1)
    expect(store.get('X')!.executionTerminals).toHaveLength(20)
    expect(store.get('X')!.executionTerminals.map(record => record.roundId)).toEqual(
      Array.from({ length: 20 }, (_, i) => `round-${i}`),
    )
  })

  it('60: the two collections are deliberately different - duplicates preserved vs first outcome wins', () => {
    const { store } = clockedStore()
    const duplicate = report({ correlationId: 'X', roundId: 'round-a' })

    // Execution starts: every report is preserved, verbatim and in order.
    store.recordExecution(duplicate)
    store.recordExecution(duplicate)
    // Terminal outcomes: one factual outcome per round, duplicates dropped.
    store.recordExecutionTerminal(terminalReport('X', 'round-a', 'failed'))
    store.recordExecutionTerminal(terminalReport('X', 'round-a', 'failed'))

    const snapshot = store.get('X')!
    expect(snapshot.executions).toHaveLength(2)
    expect(snapshot.executionTerminals).toHaveLength(1)
  })

  it('21: the store is a trusted internal API - an out-of-vocabulary value is stored, not normalized', () => {
    const { store } = clockedStore()

    // The type only permits the three outcomes; the main IPC sanitizer owns
    // hostile payload validation LATER. A value forced through a cast is kept
    // verbatim - this store never rewrites a fact into `completed`/`settled`.
    store.recordExecutionTerminal({ correlationId: 'X', outcome: 'cancelled', roundId: 'round-a' } as unknown as LiaBrainExecutionTerminalReport)

    expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'cancelled', roundId: 'round-a' }])
  })

  it('f2: an unusable key or round key is ignored, and nothing else is stored', () => {
    const { store } = clockedStore()

    store.recordExecutionTerminal(terminalReport('', 'round-a', 'failed'))
    store.recordExecutionTerminal({ correlationId: undefined, outcome: 'failed', roundId: 'round-a' } as unknown as LiaBrainExecutionTerminalReport)
    store.recordExecutionTerminal(terminalReport('X', '', 'failed'))
    store.recordExecutionTerminal({ correlationId: 'X', outcome: 'failed', roundId: undefined } as unknown as LiaBrainExecutionTerminalReport)
    store.recordExecutionTerminal(undefined as unknown as LiaBrainExecutionTerminalReport)

    expect(store.size).toBe(0)
    expect(store.get('X')).toBeUndefined()
  })

  it('58/59: the terminal path adds no transport, no observer, no vocabulary and no second store', () => {
    const source = stripComments(storeSource())

    // No transport of any kind, and no observer trigger: the store still writes
    // facts only, and current dual-trigger semantics are untouched. (The module
    // path of the TYPE-ONLY contract import is the one legitimate mention of the
    // contract module - the guard names the transport SURFACE, exactly like the
    // pre-existing `ai` guard does.)
    expect(source).not.toMatch(/defineEventa|defineInvokeEventa|defineInvokeHandler|ipcMain|ipcRenderer|BrowserWindow|\bemit\(|correlationObserver|\.observe\(/)
    expect(source).not.toMatch(/eventa:(?:invoke|event):lia:brain/)
    // No diagnostic logger either.
    expect(source).not.toMatch(/console\.|@guiiai\/logg|logger|telemetry|posthog/i)
    // No aggregate/verdict vocabulary, in any casing.
    expect(source).not.toMatch(/finalAttempt|winningAttempt|fallbackObserved|fallbackCount|sendSucceeded|routeMatch|mismatch|divergence|aligned|anyAttempt|verdict|score|recommendation/i)
    // No execution authority on the terminal path.
    expect(source).not.toMatch(/setProvider|setModel|activeProvider|activeModel|liaProductConfig|automaticPolicy|permission/i)
    // The terminal record itself carries exactly two fields and the closed
    // outcome vocabulary - no identity was added to it, and nothing is inferred.
    const terminalRecord = storeSource().slice(
      storeSource().indexOf('export interface LiaBrainExecutionTerminalRecord {'),
      storeSource().indexOf('export interface LiaBrainCorrelationEntry {'),
    )
    const terminalRecordCode = stripComments(terminalRecord)
    expect(terminalRecordCode.match(/^\s{2}(\w+):/gm)).toEqual(['  roundId:', '  outcome:'])
    expect(terminalRecordCode.replace(/\s+/g, ' ')).toContain('outcome: | \'succeeded\' | \'failed\' | \'abandoned\'')
    for (const forbidden of ['providerId', 'modelId', 'engineId', 'conversationId', 'turnIndex'])
      expect(terminalRecordCode).not.toContain(forbidden)
    // No chronology machinery: the terminal contract carries no arrival index.
    expect(source).not.toMatch(/arrivalIndex/)
    // The canonical store remains singular: no second terminal store, no cache.
    expect(productionSourcesMatching(
      ['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src', 'packages/lia-core/src'],
      /createLiaBrainTerminalStore|terminalCorrelationStore|terminalCache|executionTerminalStore/,
    )).toEqual([])
  })
})

describe('lia brain correlation store - terminal report API shape (Phase 8.0D-10B-4C2A-F)', () => {
  it('a: both writers take exactly ONE serialized report object - no positional pair', () => {
    // Compile-time proofs: each method has a single parameter, and that
    // parameter IS the shared serialized report type (mutually assignable, so
    // the method accepts the whole report and requires nothing narrower).
    type ExecutionParameters = Parameters<LiaBrainCorrelationStore['recordExecution']>
    type TerminalParameters = Parameters<LiaBrainCorrelationStore['recordExecutionTerminal']>

    const executionTakesOneArgument: ExecutionParameters['length'] extends 1 ? true : false = true
    const terminalTakesOneArgument: TerminalParameters['length'] extends 1 ? true : false = true
    const executionArgumentIsTheReport: ExecutionParameters[0] extends LiaBrainExecutionObservationReport ? true : false = true
    const terminalArgumentIsTheReport: TerminalParameters[0] extends LiaBrainExecutionTerminalReport ? true : false = true
    const theWholeReportIsTheArgument: LiaBrainExecutionTerminalReport extends TerminalParameters[0] ? true : false = true

    expect({ executionArgumentIsTheReport, executionTakesOneArgument, terminalArgumentIsTheReport, terminalTakesOneArgument, theWholeReportIsTheArgument })
      .toEqual({ executionArgumentIsTheReport: true, executionTakesOneArgument: true, terminalArgumentIsTheReport: true, terminalTakesOneArgument: true, theWholeReportIsTheArgument: true })

    // The stored record stays store-owned and two-field: the report's
    // correlationId is not part of it (the entry already holds the key).
    const storedRecordHasNoKey: 'correlationId' extends keyof LiaBrainExecutionTerminalRecord ? false : true = true
    expect(storedRecordHasNoKey).toBe(true)

    // And the shape works at runtime: the report is accepted as-is and only its
    // two terminal facts are retained.
    const { store } = clockedStore()
    store.recordExecutionTerminal(terminalReport('X', 'round-a', 'failed'))
    expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'round-a' }])
  })

  it('b: the store consumes the shared contract TYPE-ONLY, with both methods symmetric', () => {
    const source = storeSource()
    const code = stripComments(source)

    // ONE type-only import carries both serialized report types; no value,
    // channel constant or imported module of that contract is referenced.
    expect(code).toMatch(/import type \{ LiaBrainExecutionObservationReport, LiaBrainExecutionTerminalReport, LiaBrainSendTerminalReport \} from '\.\.\/\.\.\/\.\.\/shared\/eventa'/)
    expect(code.match(/from '\.\.\/\.\.\/\.\.\/shared\/eventa'/g)).toHaveLength(1)
    expect(code).not.toMatch(/defineEventa|electronLiaBrain/)

    // The two writers are declared the same way: one report-object argument.
    expect(code).toMatch(/recordExecution: \(report: LiaBrainExecutionObservationReport\) => void/)
    expect(code).toMatch(/recordExecutionTerminal: \(report: LiaBrainExecutionTerminalReport\) => void/)
    // No positional-pair variant survives anywhere in the module.
    expect(code).not.toMatch(/recordExecutionTerminal: \(\s*\w+:\s*string,/)
    expect(code).not.toMatch(/recordExecutionTerminal\([^)]*,\s*(?:terminal|record)\b/)
  })
})

describe('lia brain correlation store - isolation invariants (Phase 8.0D-10B-4B1)', () => {
  it('ag/ah/al: nothing in production imports, constructs or selects through the store', () => {
    const storeReferences = productionSourcesMatching(
      ['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src', 'packages/lia-core/src'],
      /brain-correlation-store|createLiaBrainCorrelationStore|LiaBrainCorrelationStore/,
    )
    // AG: no handler records into it. AL: no provider-selection module can even
    // name it. Since 8.0D-10B-4B2 the composition entry legitimately MATERIALIZES
    // the store, but only through the dedicated lifecycle service factory - the
    // store module and that factory are the only production references.
    expect(storeReferences).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-store.ts',
    ])
    // The pure store factory itself is CALLED in exactly ONE production module
    // (a doc comment naming it is not a call site, so comments are stripped).
    const factoryCallSites = productionSources(['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src', 'packages/lia-core/src'])
      .filter(relative => /(?<!function )createLiaBrainCorrelationStore\(/.test(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
      .sort()
    expect(factoryCallSites).toEqual(['apps/stage-tamagotchi/src/main/services/lia/brain-correlation-service.ts'])

    // Phase 8.0D-10B-4B3 wires the two producers into the canonical SERVICE,
    // so the invariant becomes the narrow one: neither handler reaches the
    // STORE module, and each only writes its own side.
    const bridge = stripComments(readFileSync(new URL('./brain-decision-service.ts', import.meta.url), 'utf-8'))
    expect(bridge).not.toMatch(/brain-correlation-store|createLiaBrainCorrelationStore|LiaBrainCorrelationStore/)
    expect(bridge.match(/correlationStore\.recordDecision\(/g)).toHaveLength(1)
    expect(bridge).not.toMatch(/correlationStore\.(?:recordExecution|get|size)/)
    const handler = stripComments(readFileSync(new URL('./brain-execution-report-service.ts', import.meta.url), 'utf-8'))
    expect(handler).not.toMatch(/brain-correlation-store|createLiaBrainCorrelationStore|LiaBrainCorrelationStore/)
    expect(handler.match(/correlationStore\.recordExecution\(/g)).toHaveLength(1)
    expect(handler).not.toMatch(/correlationStore\.(?:recordDecision|get|size)/)
    // The composition entry never reaches the STORE module either - it owns the
    // service handle and injects it (8.0D-10B-4B3).
    const entry = readFileSync(new URL('../../index.ts', import.meta.url), 'utf-8')
    expect(entry).not.toMatch(/brain-correlation-store|createLiaBrainCorrelationStore|LiaBrainCorrelationStore/)
    // 8.0D-10B-4D4C2B2 added the third injection of that ONE handle (the
    // terminal ingress), and 8.0D-10B-4D4C4-B3B2 the fourth (the send-terminal
    // ingress): both are created over the SAME canonical store - no second store.
    expect(entry.match(/correlationStore: deps\.liaBrainCorrelation/g)).toHaveLength(4)
  })

  it('ai: the store introduces no transport of its own', () => {
    const source = stripComments(storeSource())

    // No Eventa/IPC surface, no channel tag: the contract import is TYPE-ONLY
    // (the five-field report shape) and nothing here can send or receive.
    expect(source).toMatch(/import type \{ LiaBrainExecutionObservationReport, LiaBrainExecutionTerminalReport, LiaBrainSendTerminalReport \} from '\.\.\/\.\.\/\.\.\/shared\/eventa'/)
    expect(source).not.toMatch(/defineEventa|defineInvokeEventa|defineInvokeHandler|ipcMain|ipcRenderer|BrowserWindow|\.emit\(/)
    expect(source).not.toMatch(/eventa:(?:invoke|event):lia:brain/)

    // And the production Brain channel allowlist is the four-channel set
    // (8.0D-10B-4D4C1 added the one-way terminal report, 8.0D-10B-4D4C4-B2 the
    // one-way logical-send terminal report).
    const tags = new Set<string>()
    for (const relative of productionSources(['apps/stage-tamagotchi/src', 'packages/lia-core/src', 'packages/stage-ui/src', 'packages/core-agent/src'])) {
      for (const match of readFileSync(new URL(relative, REPO_ROOT), 'utf-8').matchAll(/eventa:(?:invoke|event):lia:brain[^'"]*/g))
        tags.add(match[0])
    }
    expect([...tags].sort()).toEqual([
      'eventa:event:lia:brain:execution-observation',
      'eventa:event:lia:brain:execution-terminal-observation',
      'eventa:event:lia:brain:send-terminal-observation',
      'eventa:invoke:lia:brain:chat-decision',
    ])
  })

  it('aj: the request-start observer registration count is still exactly one', () => {
    const stageRoots = ['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src']

    // The installer is CALLED in exactly one production file, and the generic
    // seam is registered from exactly one production file.
    expect(productionSourcesMatching(stageRoots, /(?<!function )registerLiaBrainExecutionObserver\(/))
      .toEqual(['apps/stage-tamagotchi/src/renderer/main.ts'])
    expect(productionSourcesMatching(stageRoots, /(?<!function )registerChatRequestStartedObserver\(/))
      .toEqual(['apps/stage-tamagotchi/src/renderer/services/lia/execution-reporter.ts'])
    // The execution-report handler still has its one registration site too.
    expect(productionSourcesMatching(stageRoots, /(?<!function )registerLiaBrainExecutionReportHandler\(/))
      .toEqual(['apps/stage-tamagotchi/src/main/index.ts'])
  })

  it('ak: stage-ui and core-agent stay Brain-blind to the store', () => {
    const brainPattern = /electronLiaBrain|LiaBrainExecutionObservation|execution-observation|LiaBrainChatDecision|brain-shadow|observeLiaBrainDecisionForChatTurn|LiaBrainCorrelation|brain-correlation-store/
    expect(productionSourcesMatching(['packages/stage-ui/src'], brainPattern)).toEqual([])
    expect(productionSourcesMatching(['packages/core-agent/src'], brainPattern)).toEqual([])
  })

  it('am: the store knows no comparison vocabulary and holds no execution authority', () => {
    const source = stripComments(storeSource())

    // AM: facts only. Nothing interprets whether a decision and an execution
    // agree - and nothing is pre-labelled for a future comparison.
    expect(source).not.toMatch(/match|mismatch|divergence|aligned|winner|score|expected|actual|compare|agreement|verdict/i)
    // No execution authority of any kind.
    expect(source).not.toMatch(/decide\(|LiaBrainService|brainRequirementForChatTurn|automaticPolicy|liaProductConfig|updateLiaProductConfig|fallback|retry|permission|tools\b/)
    // No environment, network, filesystem or long-lived-timer surface.
    expect(source).not.toMatch(/setInterval|setTimeout|queueMicrotask|process\.on|from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram|timers)['/]/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios|localStorage|sessionStorage/)
    // Privacy: no chat payload, credential or provider object can enter.
    expect(source).not.toMatch(/text|messages|attachments|apiKey|api_key|secret|baseURL|chatProvider|vault/i)

    // The store's own API is the whole surface: no backing map is exported.
    expect(source).toMatch(/export function createLiaBrainCorrelationStore/)
    expect(source).toMatch(/export interface LiaBrainCorrelationStore /)
    // 8.0D-10B-4C2A added exactly ONE export (the two-field round terminal
    // record type) and 8.0D-10B-4D4C4-B3A adds exactly one more - the one-field
    // logical-send terminal record type. No other export exists.
    expect(source.match(/export /g)?.length).toBe(6)
  })
})

describe('lia brain correlation store - logical send terminal fact (Phase 8.0D-10B-4D4C4-B3A)', () => {
  const BRAIN_ROOTS = ['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src', 'packages/lia-core/src']

  /** The retained send-level settlement of one entry, flattened for assertions. */
  function sendSettlement(store: ReturnType<typeof createLiaBrainCorrelationStore>, correlationId: string): string | undefined {
    return store.get(correlationId)?.sendTerminal?.outcome
  }

  it('62: a send terminal may be the very FIRST fact of a correlation', () => {
    const { store } = clockedStore()

    store.recordSendTerminal(sendReport('X', 'failed'))

    expect(store.size).toBe(1)
    const snapshot = store.get('X')!
    // A normal entry, with the canonical defaults of one that has no decision
    // and no round data: nothing was invented to accompany the send fact.
    expect(snapshot.correlationId).toBe('X')
    expect(snapshot.decision).toBeUndefined()
    expect(snapshot.executions).toEqual([])
    expect(snapshot.executionTerminals).toEqual([])
    expect(snapshot.sendTerminal).toEqual({ outcome: 'failed' })
    // Exactly the ONE field - the entry already holds the key, and a logical
    // send fact carries no round, attempt, provider or model.
    expect(Object.keys(snapshot.sendTerminal!).sort()).toEqual(['outcome'])
  })

  it('63: a send terminal joins an existing entry without disturbing its facts', () => {
    const withDecision = clockedStore().store
    withDecision.recordDecision('X', decision({ engineId: 'groq' }))
    const decisionBefore = withDecision.get('X')!
    withDecision.recordSendTerminal(sendReport('X', 'failed'))
    const decisionAfter = withDecision.get('X')!

    expect(decisionAfter.decision).toEqual(decisionBefore.decision)
    expect(decisionAfter.decision).toEqual(decision({ engineId: 'groq' }))
    expect(decisionAfter.sendTerminal).toEqual({ outcome: 'failed' })
    expect(decisionAfter.createdAt).toBe(decisionBefore.createdAt)
    expect(withDecision.size).toBe(1)

    const withExecution = clockedStore().store
    withExecution.recordExecution(report({ correlationId: 'X', roundId: 'round-a' }))
    withExecution.recordSendTerminal(sendReport('X', 'succeeded'))

    expect(withExecution.get('X')!.executions).toEqual([report({ correlationId: 'X', roundId: 'round-a' })])
    expect(withExecution.get('X')!.executionTerminals).toEqual([])
    expect(withExecution.get('X')!.sendTerminal).toEqual({ outcome: 'succeeded' })
    expect(withExecution.size).toBe(1)
  })

  it('64: the same duplicate is ignored semantically - one record, no list, no error', () => {
    const { store } = clockedStore()

    // Duplicates and conflicts are tolerated traffic: no throw, no warning, no
    // retry and no conflict state exists on this path.
    expect(() => {
      store.recordSendTerminal(sendReport('X', 'failed'))
      store.recordSendTerminal(sendReport('X', 'failed'))
    }).not.toThrow()

    const snapshot = store.get('X')!
    expect(snapshot.sendTerminal).toEqual({ outcome: 'failed' })
    // Singular by construction: the second report grew nothing anywhere.
    expect(Object.keys(snapshot.sendTerminal!).sort()).toEqual(['outcome'])
    expect(store.size).toBe(1)
  })

  it('65: the first accepted send outcome wins in BOTH directions', () => {
    const failedFirst = clockedStore().store
    failedFirst.recordSendTerminal(sendReport('X', 'failed'))
    failedFirst.recordSendTerminal(sendReport('X', 'succeeded'))

    const succeededFirst = clockedStore().store
    succeededFirst.recordSendTerminal(sendReport('X', 'succeeded'))
    succeededFirst.recordSendTerminal(sendReport('X', 'failed'))

    // A: failed -> succeeded stays failed. B: succeeded -> failed stays
    // succeeded. The settlement of a send is never resolved by last write, and
    // the loser of the race rewrites nothing.
    expect(sendSettlement(failedFirst, 'X')).toBe('failed')
    expect(sendSettlement(succeededFirst, 'X')).toBe('succeeded')
  })

  it('66: distinct correlations keep independent settlements', () => {
    const { store } = clockedStore()

    store.recordSendTerminal(sendReport('X', 'succeeded'))
    store.recordSendTerminal(sendReport('Y', 'failed'))

    expect(store.size).toBe(2)
    expect(sendSettlement(store, 'X')).toBe('succeeded')
    expect(sendSettlement(store, 'Y')).toBe('failed')
  })

  it('67: a round that succeeded and a send that failed coexist, verbatim', () => {
    const { store } = clockedStore()

    // The audit proved this combination can be legitimate: the store records
    // both facts and normalizes neither.
    store.recordExecutionTerminal(terminalReport('X', 'round-a', 'succeeded'))
    store.recordSendTerminal(sendReport('X', 'failed'))

    const snapshot = store.get('X')!
    expect(snapshot.executionTerminals).toEqual([{ outcome: 'succeeded', roundId: 'round-a' }])
    expect(snapshot.sendTerminal).toEqual({ outcome: 'failed' })
    expect(store.size).toBe(1)
  })

  it('68: a round abandoned and a send that succeeded coexist, verbatim', () => {
    const { store } = clockedStore()

    store.recordExecutionTerminal(terminalReport('X', 'round-a', 'abandoned'))
    store.recordSendTerminal(sendReport('X', 'succeeded'))

    const snapshot = store.get('X')!
    expect(snapshot.executionTerminals).toEqual([{ outcome: 'abandoned', roundId: 'round-a' }])
    expect(snapshot.sendTerminal).toEqual({ outcome: 'succeeded' })
  })

  it('69: a send terminal first, then round data - both facts survive', () => {
    const { store } = clockedStore()

    store.recordSendTerminal(sendReport('X', 'failed'))
    store.recordExecution(report({ correlationId: 'X', roundId: 'round-a' }))
    store.recordExecutionTerminal(terminalReport('X', 'round-a', 'succeeded'))

    const snapshot = store.get('X')!
    expect(snapshot.sendTerminal).toEqual({ outcome: 'failed' })
    expect(snapshot.executions.map(execution => execution.roundId)).toEqual(['round-a'])
    expect(snapshot.executionTerminals).toEqual([{ outcome: 'succeeded', roundId: 'round-a' }])
  })

  it('70: round data first, then a send terminal - nothing is rewritten or joined', () => {
    const { store } = clockedStore()

    store.recordDecision('X', decision({ engineId: 'groq' }))
    store.recordExecution(report({ correlationId: 'X', roundId: 'round-a', providerId: 'groq' }))
    store.recordExecutionTerminal(terminalReport('X', 'round-a', 'failed'))
    store.recordSendTerminal(sendReport('X', 'succeeded'))

    const snapshot = store.get('X')!
    expect(snapshot.decision).toEqual(decision({ engineId: 'groq' }))
    expect(snapshot.executions).toEqual([report({ correlationId: 'X', roundId: 'round-a', providerId: 'groq' })])
    expect(snapshot.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'round-a' }])
    expect(snapshot.sendTerminal).toEqual({ outcome: 'succeeded' })
    // The send fact borrowed nothing from the round it did not settle: no
    // roundId, no provider, no attempt count appears beside the outcome.
    expect(Object.keys(snapshot.sendTerminal!).sort()).toEqual(['outcome'])
  })

  it('71: a send terminal never refreshes createdAt of an existing entry', () => {
    const { store, advance } = clockedStore({ ttlMs: 1_000 })

    store.recordDecision('X', decision())
    const createdAt = store.get('X')!.createdAt

    // A stream of later send settlements cannot keep the entry alive: age is
    // measured from creation, exactly like every other write.
    for (let i = 0; i < 9; i += 1) {
      advance(100)
      store.recordSendTerminal(sendReport('X', i % 2 === 0 ? 'failed' : 'succeeded'))
    }

    expect(store.get('X')!.createdAt).toBe(createdAt)
    expect(sendSettlement(store, 'X')).toBe('failed')
    advance(100)
    expect(store.get('X')).toBeUndefined()
    expect(store.size).toBe(0)
  })

  it('72: a send-first entry establishes createdAt once, and no later fact family refreshes it', () => {
    const { store, advance } = clockedStore({ ttlMs: 1_000 })

    store.recordSendTerminal(sendReport('X', 'succeeded'))
    const createdAt = store.get('X')!.createdAt

    advance(10)
    store.recordDecision('X', decision())
    advance(10)
    store.recordExecution(report({ correlationId: 'X', roundId: 'round-a' }))
    advance(10)
    store.recordExecutionTerminal(terminalReport('X', 'round-a', 'failed'))

    expect(store.get('X')!.createdAt).toBe(createdAt)
    advance(969)
    expect(store.get('X')!.createdAt).toBe(createdAt)
    expect(store.size).toBe(1)
    advance(1)
    expect(store.get('X')).toBeUndefined()
    expect(store.size).toBe(0)
  })

  it('73: the send terminal shares the entry lifetime - no second TTL, no extension', () => {
    const { store, advance } = clockedStore({ ttlMs: 500 })

    // A send-terminal-only entry expires from its own creation, like any other.
    store.recordSendTerminal(sendReport('X', 'failed'))
    advance(499)
    expect(sendSettlement(store, 'X')).toBe('failed')
    advance(1)
    expect(store.get('X')).toBeUndefined()
    expect(store.size).toBe(0)

    // And a send terminal written to an EXISTING entry does not extend it.
    store.recordDecision('Y', decision())
    advance(250)
    store.recordSendTerminal(sendReport('Y', 'succeeded'))
    advance(249)
    expect(sendSettlement(store, 'Y')).toBe('succeeded')
    advance(1)
    expect(store.get('Y')).toBeUndefined()
    expect(store.size).toBe(0)
  })

  it('74: send-terminal-only entries take part in the SAME capacity eviction', () => {
    const { store, advance } = clockedStore({ maxEntries: 2, ttlMs: 100_000 })

    advance(10)
    store.recordSendTerminal(sendReport('A', 'failed'))
    advance(10)
    store.recordSendTerminal(sendReport('B', 'succeeded'))
    expect(store.size).toBe(2)

    advance(10)
    store.recordDecision('C', decision())
    // The oldest live entry goes, exactly as for decisions and rounds: the send
    // terminal earned no quota, no ranking and no second map of its own.
    expect(store.size).toBe(2)
    expect(store.get('A')).toBeUndefined()
    expect(sendSettlement(store, 'B')).toBe('succeeded')

    // Updating an existing key with a send terminal evicts nothing either.
    advance(10)
    store.recordSendTerminal(sendReport('B', 'failed'))
    expect(store.size).toBe(2)
    expect(sendSettlement(store, 'B')).toBe('succeeded')
    expect(sendSettlement(store, 'C')).toBeUndefined()
  })

  it('75: the snapshot send terminal is copy-safe against hostile casts', () => {
    const { store } = clockedStore()
    store.recordSendTerminal(sendReport('X', 'failed'))

    const returned = store.get('X')!.sendTerminal!
    returned.outcome = 'succeeded'
    const hostile = returned as unknown as Record<string, unknown>
    delete hostile.outcome
    hostile.roundId = 'hijacked'
    hostile.attemptCount = 7

    expect(store.get('X')!.sendTerminal).toEqual({ outcome: 'failed' })
    expect(Object.keys(store.get('X')!.sendTerminal!)).toEqual(['outcome'])

    // Replacing the returned object does not reach the entry either, and every
    // read hands out a fresh object - never a shared internal reference.
    store.get('X')!.sendTerminal = { outcome: 'succeeded' }
    expect(sendSettlement(store, 'X')).toBe('failed')
    expect(store.get('X')!.sendTerminal).not.toBe(store.get('X')!.sendTerminal)
  })

  it('76: the incoming report is never mutated - a frozen input still records', () => {
    const { store } = clockedStore()
    const incoming: LiaBrainSendTerminalReport = Object.freeze({ correlationId: 'X', outcome: 'failed' })

    store.recordSendTerminal(incoming)

    expect(sendSettlement(store, 'X')).toBe('failed')
    expect(Object.isFrozen(incoming)).toBe(true)
    expect(incoming).toEqual({ correlationId: 'X', outcome: 'failed' })

    // And mutating the caller's object afterwards cannot reach the retained
    // fact: the store kept its own copy.
    const mutable = sendReport('Y', 'succeeded')
    store.recordSendTerminal(mutable)
    mutable.outcome = 'failed'
    mutable.correlationId = 'changed-after-recording'
    expect(sendSettlement(store, 'Y')).toBe('succeeded')
    expect(store.get('changed-after-recording')).toBeUndefined()
  })

  it('77: the retained send terminal is exactly the one factual field - nothing hidden inside', () => {
    const { store } = clockedStore()
    store.recordSendTerminal(sendReport('X', 'failed'))

    const record = store.get('X')!.sendTerminal!
    expect(Object.keys(record)).toEqual(['outcome'])
    expect(Object.keys(store.get('X')!).sort())
      .toEqual(['correlationId', 'createdAt', 'executionTerminals', 'executions', 'sendTerminal'])

    // Compile-time proofs: the stored record is store-owned (the entry already
    // holds the key), carries no round or attempt identity, and its outcome
    // vocabulary is the closed transport one - `abandoned` is a ROUND fact and
    // cannot be a send fact.
    const recordHasNoKey: 'correlationId' extends keyof LiaBrainSendTerminalRecord ? false : true = true
    const recordHasNoRound: 'roundId' extends keyof LiaBrainSendTerminalRecord ? false : true = true
    const outcomeIsClosed: LiaBrainSendTerminalRecord['outcome'] extends 'succeeded' | 'failed' ? true : false = true
    const abandonedIsNotASendOutcome: 'abandoned' extends LiaBrainSendTerminalRecord['outcome'] ? false : true = true
    expect({ abandonedIsNotASendOutcome, outcomeIsClosed, recordHasNoKey, recordHasNoRound })
      .toEqual({ abandonedIsNotASendOutcome: true, outcomeIsClosed: true, recordHasNoKey: true, recordHasNoRound: true })
  })

  it('78: an entry without a send settlement has the key truly ABSENT', () => {
    const { store } = clockedStore()

    store.recordDecision('decision-only', decision())
    store.recordExecution(report({ correlationId: 'execution-only' }))
    store.recordExecutionTerminal(terminalReport('round-only', 'round-a', 'abandoned'))

    for (const key of ['decision-only', 'execution-only', 'round-only']) {
      const snapshot = store.get(key)!
      // Absent, not `undefined`: a missing send settlement means only that none
      // is retained - the snapshot is never padded to a fixed shape, and the
      // absent key means nothing about the send itself.
      expect('sendTerminal' in snapshot).toBe(false)
      expect(Object.hasOwn(snapshot, 'sendTerminal')).toBe(false)
      expect(Object.keys(snapshot)).not.toContain('sendTerminal')
      expect(snapshot.sendTerminal).toBeUndefined()
    }
    // For an absent (or expired) correlation there is no snapshot at all.
    expect(store.get('never-seen')).toBeUndefined()
  })

  it('79: the optional field added no required default to the existing shapes', () => {
    const { store } = clockedStore()

    store.recordDecision('decision-only', decision())
    store.recordExecution(report({ correlationId: 'execution-only' }))
    store.recordExecutionTerminal(terminalReport('round-only', 'round-a', 'abandoned'))

    // The pre-existing key lists are exactly what they were before this phase:
    // the optional contract stays meaningful instead of being written out.
    expect(Object.keys(store.get('execution-only')!).sort()).toEqual(['correlationId', 'createdAt', 'executionTerminals', 'executions'])
    expect(Object.keys(store.get('round-only')!).sort()).toEqual(['correlationId', 'createdAt', 'executionTerminals', 'executions'])
    expect(Object.keys(store.get('decision-only')!).sort()).toEqual(['correlationId', 'createdAt', 'decision', 'executionTerminals', 'executions'])
  })

  it('30/31: the three streams stay independent - no join, no causality, no orphans', () => {
    const { store } = clockedStore()

    // A send terminal with no round data at all is a complete, valid fact...
    store.recordSendTerminal(sendReport('send-only', 'failed'))
    // ...and round data with no send terminal is equally valid: nothing is
    // synthesized beside it and nothing is marked invalid.
    store.recordExecution(report({ correlationId: 'round-only', roundId: 'round-a' }))
    store.recordExecutionTerminal(terminalReport('round-only', 'round-a', 'succeeded'))

    expect(store.get('send-only')!.sendTerminal).toEqual({ outcome: 'failed' })
    expect(store.get('send-only')!.executions).toEqual([])
    expect(store.get('send-only')!.executionTerminals).toEqual([])
    expect(store.get('round-only')!.executions).toHaveLength(1)
    expect(store.get('round-only')!.executionTerminals).toHaveLength(1)
    expect('sendTerminal' in store.get('round-only')!).toBe(false)
  })

  it('37: both fact orders converge on the same retained facts', () => {
    const forward = clockedStore().store
    forward.recordDecision('X', decision())
    forward.recordExecution(report({ correlationId: 'X', roundId: 'round-a' }))
    forward.recordExecutionTerminal(terminalReport('X', 'round-a', 'succeeded'))
    forward.recordSendTerminal(sendReport('X', 'failed'))

    const backward = clockedStore().store
    backward.recordSendTerminal(sendReport('X', 'failed'))
    backward.recordExecutionTerminal(terminalReport('X', 'round-a', 'succeeded'))
    backward.recordExecution(report({ correlationId: 'X', roundId: 'round-a' }))
    backward.recordDecision('X', decision())

    const facts = (store: ReturnType<typeof createLiaBrainCorrelationStore>) => {
      const snapshot = store.get('X')!
      return {
        decision: snapshot.decision,
        executions: snapshot.executions.map(execution => `${execution.roundId}/${execution.providerId}`),
        executionTerminals: snapshot.executionTerminals.map(record => `${record.roundId}/${record.outcome}`),
        sendTerminal: snapshot.sendTerminal,
      }
    }

    expect(facts(forward)).toEqual(facts(backward))
    expect(facts(forward)).toEqual({
      decision: decision(),
      executions: ['round-a/mock-provider'],
      executionTerminals: ['round-a/succeeded'],
      sendTerminal: { outcome: 'failed' },
    })
  })

  it('41/42/43/80: the writer is a pure fact write - no sanitizer, no transport, no observer, one site', () => {
    const source = storeSource()
    const code = stripComments(source)

    // The store is NOT the IPC sanitizer: hostile-payload tolerance belongs to
    // the (future) main ingress, so no tolerant-read helper exists here.
    expect(code).not.toMatch(/isRecord|readString|readNumber|normalize/)
    // No transport, no channel constant and no observer trigger of its own.
    expect(code).not.toMatch(/defineEventa|electronLiaBrain|ipcMain|ipcRenderer|\.emit\(|correlationObserver|\.observe\(/)
    expect(code).not.toMatch(/eventa:(?:invoke|event):lia:brain/)

    // The writer takes ONE serialized report - the shared TYPE, type-only.
    expect(code).toMatch(/recordSendTerminal: \(report: LiaBrainSendTerminalReport\) => void/)
    expect(code).not.toMatch(/electronLiaBrainSendTerminalObservation/)

    // B3A shipped the method with ZERO production callers; 8.0D-10B-4D4C4-B3B1
    // evolves that allowlist honestly to exactly ONE - the trusted main ingress
    // that sanitizes the renderer payload and forwards it. Nothing else calls
    // it: no renderer, no listener, no composition entry, no observer.
    expect(productionSourcesMatching(BRAIN_ROOTS, /recordSendTerminal/)).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-store.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-service.ts',
    ])
    expect(productionSourcesMatching(BRAIN_ROOTS, /\.recordSendTerminal\(/))
      .toEqual(['apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-service.ts'])
  })

  it('15-19/59: the send terminal record carries no round, identity, attempt, error or content vocabulary', () => {
    const source = storeSource()
    const block = stripComments(source.slice(
      source.indexOf('export interface LiaBrainSendTerminalRecord {'),
      source.indexOf('export interface LiaBrainCorrelationStore {'),
    ))

    expect(block.match(/^\s{2}(\w+):/gm)).toEqual(['  outcome:'])
    for (const forbidden of ['correlationId', 'roundId', 'attemptIndex', 'attemptCount', 'providerId', 'modelId', 'engineId', 'error', 'message', 'stack', 'failureStage', 'prompt', 'usage', 'tools', 'url', 'credential', 'sentAt', 'durationMs'])
      expect(block).not.toContain(forbidden)

    // Singular by construction, and the store stays the ONE canonical one.
    expect(productionSourcesMatching(BRAIN_ROOTS, /sendTerminals|logicalSendTerminals|terminalHistory|sendTerminalStore|recordSendTerminals/)).toEqual([])
    // 8.0D-10B-4D4C4-B4B4: the TWO production owners of the projected field name
    // are the pure send-facts module and the diagnostic formatter; the store
    // itself still never names it, and the distinct term `sendTerminalObserved`
    // exists nowhere in production.
    expect(productionSourcesMatching(BRAIN_ROOTS, /sendTerminalOutcome/))
      .toEqual([
        'apps/stage-tamagotchi/src/main/services/lia/brain-diagnostic-log.ts',
        'apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-facts.ts',
      ])
    expect(productionSourcesMatching(BRAIN_ROOTS, /sendTerminalObserved/)).toEqual([])
    expect(stripComments(source)).not.toMatch(/sendTerminalOutcome|sendTerminalObserved/)

    // 55/56/57/58: no fallback, final, winner or completion derivation, and no
    // authority can act on the settlement the store retains.
    expect(stripComments(source)).not.toMatch(/fallback|finalAttempt|winningAttempt|winner|sendSucceeded|sendFailed|sendCompleted|completion|completed|finished|priority|preferred/)
    expect(stripComments(source)).not.toMatch(/setProvider|setModel|activeProvider|automaticPolicy|permission|updateLiaProductConfig/)
  })

  it('44/45/46/47/81/82/83: no fourth trigger, no main listener, no ingress, FOUR channels, THREE triggers', () => {
    // 45/46/81: B3A froze the fourth channel with NO main consumer at all;
    // 8.0D-10B-4D4C4-B3B2 evolves that honestly to exactly ONE - the transport
    // listener - and to no second main module naming the channel. There is
    // still no store-level consumer beyond the ingress it forwards to.
    expect(productionSourcesMatching(['apps/stage-tamagotchi/src/main'], /electronLiaBrainSendTerminalObservation|send-terminal-observation/))
      .toEqual(['apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-listener.ts'])

    // 47/48/49/50/51: the observer, the identity facts and the round-terminal
    // facts do not know the field yet. The reader no longer belongs to this list:
    // 8.0D-10B-4D4C4-B4B1 widened its SNAPSHOT contract to carry the raw record
    // structurally (a carriage boundary only). The composition left the list in
    // 8.0D-10B-4D4C4-B4B3: it now delegates to the pure send projection and carries
    // the derived sibling - while still printing nothing and still owning no
    // send-level vocabulary of its own. The formatter left the list in
    // 8.0D-10B-4D4C4-B4B4: it now prints the optional send outcome as the final
    // quoted field.
    for (const relative of [
      './brain-correlation-observer.ts',
      './brain-execution-terminal-facts.ts',
      './brain-execution-identity-facts.ts',
    ])
      expect(stripComments(readFileSync(new URL(relative, import.meta.url), 'utf-8')), relative).not.toMatch(/sendTerminal/)

    // 52/53/54: the transport, the Stage seam and Core Agent still know nothing
    // about the stored field - the frozen layers are untouched (B2 included).
    for (const relative of [
      '../../../shared/eventa/index.ts',
      '../../../renderer/main.ts',
      '../../../renderer/services/lia/send-terminal-reporter.ts',
    ])
      expect(readFileSync(new URL(relative, import.meta.url), 'utf-8'), relative).not.toMatch(/sendTerminal|LiaBrainSendTerminalRecord/)
    expect(productionSourcesMatching(['packages/stage-ui/src', 'packages/core-agent/src'], /sendTerminal|LiaBrainSendTerminalRecord/)).toEqual([])

    // 82: the Brain channel allowlist is still exactly the FOUR known channels.
    const tags = new Set<string>()
    for (const relative of productionSources(BRAIN_ROOTS)) {
      for (const match of readFileSync(new URL(relative, REPO_ROOT), 'utf-8').matchAll(/eventa:(?:invoke|event):lia:brain[^'"]*/g))
        tags.add(match[0])
    }
    expect([...tags].sort()).toEqual([
      'eventa:event:lia:brain:execution-observation',
      'eventa:event:lia:brain:execution-terminal-observation',
      'eventa:event:lia:brain:send-terminal-observation',
      'eventa:invoke:lia:brain:chat-decision',
    ])

    // 44/83: the main observer trigger allowlist is still exactly THREE.
    expect(productionSourcesMatching(BRAIN_ROOTS, /correlationObserver\.observe\(/)).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-decision-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-execution-report-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-execution-terminal-report-service.ts',
    ])
  })
})
