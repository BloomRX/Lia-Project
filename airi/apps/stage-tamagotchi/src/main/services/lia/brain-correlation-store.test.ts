import type { LiaBrainRoutingDecision } from '@lia/core'

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
    expect(Object.keys(snapshot).sort()).toEqual(['correlationId', 'createdAt', 'decision', 'executions'])
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
    expect(entry.match(/correlationStore: deps\.liaBrainCorrelation/g)).toHaveLength(2)
  })

  it('ai: the store introduces no transport of its own', () => {
    const source = stripComments(storeSource())

    // No Eventa/IPC surface, no channel tag: the contract import is TYPE-ONLY
    // (the five-field report shape) and nothing here can send or receive.
    expect(source).toMatch(/import type \{ LiaBrainExecutionObservationReport \} from '\.\.\/\.\.\/\.\.\/shared\/eventa'/)
    expect(source).not.toMatch(/defineEventa|defineInvokeEventa|defineInvokeHandler|ipcMain|ipcRenderer|BrowserWindow|\.emit\(/)
    expect(source).not.toMatch(/eventa:(?:invoke|event):lia:brain/)

    // And the production Brain channel allowlist is unchanged by this phase.
    const tags = new Set<string>()
    for (const relative of productionSources(['apps/stage-tamagotchi/src', 'packages/lia-core/src', 'packages/stage-ui/src', 'packages/core-agent/src'])) {
      for (const match of readFileSync(new URL(relative, REPO_ROOT), 'utf-8').matchAll(/eventa:(?:invoke|event):lia:brain[^'"]*/g))
        tags.add(match[0])
    }
    expect([...tags].sort()).toEqual([
      'eventa:event:lia:brain:execution-observation',
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
    expect(source.match(/export /g)?.length).toBe(4)
  })
})
