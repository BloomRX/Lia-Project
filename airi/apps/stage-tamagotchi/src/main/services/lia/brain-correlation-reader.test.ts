import type {
  LiaBrainAutomaticSelection,
  LiaBrainCapabilities,
  LiaBrainEngineDescriptor,
  LiaBrainModelDescriptor,
  LiaBrainPreferredResolution,
  LiaBrainRoutingDecision,
} from '@lia/core'

import type { LiaBrainCorrelationReadFacts, LiaBrainCorrelationSnapshotReader, LiaBrainEngineProviderLookup } from './brain-correlation-reader'
import type { LiaBrainCorrelationEntry, LiaBrainCorrelationStore } from './brain-correlation-store'
import type { LiaBrainExecutionIdentitySnapshot, LiaObservedExecutionIdentity } from './brain-execution-identity-facts'
import type { LiaBrainEngineProviderMapping } from './brain-expected-route'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createProductionBrainAutomaticPolicy, createProductionBrainCatalog, decideBrainRoute } from '@lia/core'
import { describe, expect, it } from 'vitest'

import { readLiaBrainExecutionIdentityFacts } from './brain-correlation-reader'
import { createLiaBrainCorrelationStore } from './brain-correlation-store'
import { LIA_BRAIN_ENGINE_PROVIDER_MAPPING } from './brain-expected-route'

/**
 * Phase 8.0D-10B-4C3A: the focused proof of the correlation snapshot reader.
 *
 * The reader is proven as an ADAPTER only: one snapshot read, handed to the
 * already-proven pure identity-facts layer, whose states come back unchanged.
 * Nothing here reads a store in production, nothing wires the reader into the
 * application, and no aggregate fact, verdict or execution authority is
 * introduced.
 */

const CAPABILITIES: LiaBrainCapabilities = {
  audioInput: false,
  audioOutput: false,
  imageInput: false,
  realtime: false,
  reasoning: true,
  textInput: true,
  textOutput: true,
  toolCalling: true,
  videoInput: false,
}

const REQUIREMENT = { required: ['textInput', 'textOutput'] } as const

const GROQ_ENGINE_ID = 'groq'
const GROQ_MODEL_ID = 'openai/gpt-oss-120b'
const GROQ_EXPECTED = { engineId: GROQ_ENGINE_ID, modelId: GROQ_MODEL_ID, providerId: GROQ_ENGINE_ID }

function engine(overrides: Partial<LiaBrainEngineDescriptor> = {}): LiaBrainEngineDescriptor {
  return {
    availability: 'available',
    capabilities: { ...CAPABILITIES },
    id: GROQ_ENGINE_ID,
    modelIds: [GROQ_MODEL_ID],
    name: 'Groq',
    ...overrides,
  }
}

function model(overrides: Partial<LiaBrainModelDescriptor> = {}): LiaBrainModelDescriptor {
  return {
    capabilities: { ...CAPABILITIES },
    engineId: GROQ_ENGINE_ID,
    id: GROQ_MODEL_ID,
    name: 'GPT-OSS 120B',
    ...overrides,
  }
}

function automatic(selection: LiaBrainAutomaticSelection): LiaBrainRoutingDecision {
  return { selection, status: 'automatic' }
}

function manual(resolution: LiaBrainPreferredResolution): LiaBrainRoutingDecision {
  return { readiness: { status: 'ready' }, resolution, status: 'manual' }
}

/** The automatic decision of the audited production route, from the canonical router. */
function productionAutomaticDecision(): LiaBrainRoutingDecision {
  const catalog = createProductionBrainCatalog()
  return decideBrainRoute({
    automaticPolicy: createProductionBrainAutomaticPolicy(),
    engines: catalog.engines,
    models: catalog.models,
    mode: 'automatic',
    requirement: REQUIREMENT,
  })
}

function attempt(overrides: Partial<LiaObservedExecutionIdentity> = {}): LiaObservedExecutionIdentity {
  return { modelId: GROQ_MODEL_ID, providerId: GROQ_ENGINE_ID, roundId: 'A', ...overrides }
}

/** A recording structural reader double: feeds snapshots, records every key asked for. */
function recordingReader(snapshots: Record<string, LiaBrainExecutionIdentitySnapshot | undefined>) {
  const calls: string[] = []
  const reader = {
    get(correlationId: string): LiaBrainExecutionIdentitySnapshot | undefined {
      calls.push(correlationId)
      return snapshots[correlationId]
    },
  } satisfies LiaBrainCorrelationSnapshotReader
  return { calls, reader }
}

/** A recording mapping double: resolves from a table, records every engine asked for. */
function recordingMapping(table: Record<string, string>) {
  const received: string[] = []
  const mapping = {
    providerIdForEngine(engineId: string): string | undefined {
      received.push(engineId)
      return table[engineId]
    },
  } satisfies LiaBrainEngineProviderLookup
  return { mapping, received }
}

/** The REAL ephemeral store, with an injected clock the test drives. */
function realStore(maxEntries = 8) {
  let clock = 1_000
  const store = createLiaBrainCorrelationStore({ maxEntries, now: () => clock, ttlMs: 900_000 })
  return {
    store,
    advance: (milliseconds: number) => {
      clock += milliseconds
    },
  }
}

function report(correlationId: string, roundId: string, providerId = 'groq', modelId = GROQ_MODEL_ID) {
  return { conversationId: 'conversation-1', correlationId, modelId, providerId, roundId }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value))
      deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

describe('correlation snapshot reader - result states (Phase 8.0D-10B-4C3A)', () => {
  it('a: an absent correlation reads as correlationNotObserved, and the key is forwarded verbatim', () => {
    const { calls, reader } = recordingReader({})

    const outcome = readLiaBrainExecutionIdentityFacts(reader, 'logical-send-opaque\t key', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)

    expect(outcome).toEqual({ status: 'correlationNotObserved' })
    // The key is used ONLY as an opaque lookup key: no parsing, no trimming,
    // no prefixing, no synthesis.
    expect(calls).toEqual(['logical-send-opaque\t key'])
  })

  it('b: an executions-only snapshot stays decisionNotObserved, with its attempts preserved', () => {
    const { reader } = recordingReader({
      X: { executions: [attempt(), attempt({ roundId: 'B', providerId: 'unknown' })] },
    })

    expect(readLiaBrainExecutionIdentityFacts(reader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)).toEqual({
      attempts: [
        { arrivalIndex: 0, modelId: GROQ_MODEL_ID, providerId: 'groq', roundId: 'A' },
        { arrivalIndex: 1, modelId: GROQ_MODEL_ID, providerId: 'unknown', roundId: 'B' },
      ],
      status: 'decisionNotObserved',
    })
  })

  it('c: a decision-only snapshot stays noExecutionObserved, with the trusted expected route', () => {
    const { reader } = recordingReader({ X: { decision: productionAutomaticDecision(), executions: [] } })

    expect(readLiaBrainExecutionIdentityFacts(reader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)).toEqual({
      attempts: [],
      expected: GROQ_EXPECTED,
      status: 'noExecutionObserved',
    })
  })

  it('d: a non-route decision stays noBrainRouteSelected - executions are not turned into an error', () => {
    const nonRoute: LiaBrainRoutingDecision[] = [
      { status: 'disabled' },
      { status: 'modeUnspecified' },
      automatic({ status: 'noCandidates' }),
      automatic({ status: 'noPolicyMatch' }),
      automatic({ ref: { engineId: GROQ_ENGINE_ID, modelId: GROQ_MODEL_ID }, status: 'ambiguous' }),
      manual({ status: 'noPreference' }),
      manual({ engine: engine(), status: 'resolvedEngine' }),
    ]

    for (const decision of nonRoute) {
      const { reader } = recordingReader({ X: { decision, executions: [attempt()] } })
      const outcome = readLiaBrainExecutionIdentityFacts(reader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
      expect(outcome, JSON.stringify(decision)).toEqual({
        attempts: [{ arrivalIndex: 0, modelId: GROQ_MODEL_ID, providerId: GROQ_ENGINE_ID, roundId: 'A' }],
        status: 'noBrainRouteSelected',
      })
      expect(outcome).not.toHaveProperty('expected')
    }
  })

  it('e: an unmapped selected engine stays engineMappingMissing, without querying anything', () => {
    const { received, mapping } = recordingMapping({})
    const decision = manual({
      engine: engine({ id: 'brain-engine' }),
      model: model({ engineId: 'brain-engine', id: 'brain-model-x' }),
      status: 'resolvedModel',
    })
    const { reader } = recordingReader({ X: { decision, executions: [attempt()] } })

    expect(readLiaBrainExecutionIdentityFacts(reader, 'X', mapping)).toEqual({
      attempts: [{ arrivalIndex: 0, modelId: GROQ_MODEL_ID, providerId: GROQ_ENGINE_ID, roundId: 'A' }],
      engineId: 'brain-engine',
      modelId: 'brain-model-x',
      status: 'engineMappingMissing',
    })
    // The mapping was consulted with the trusted engine id only - no provider
    // registry, no execution identity and no second attempt to resolve it.
    expect(received).toEqual(['brain-engine'])
  })

  it('f/g/h/i/j/k: a complete snapshot returns the exact per-attempt facts, unchanged and unwrapped', () => {
    const observed = [
      attempt({ roundId: 'A' }),
      attempt({ roundId: 'B', providerId: 'anthropic' }),
      attempt({ roundId: 'C', modelId: `${GROQ_MODEL_ID}-preview` }),
      attempt({ roundId: 'A' }),
    ]
    const { reader } = recordingReader({ X: { decision: productionAutomaticDecision(), executions: observed } })

    const outcome = readLiaBrainExecutionIdentityFacts(reader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    expect(outcome.status).toBe('attemptIdentityFacts')
    if (outcome.status !== 'attemptIdentityFacts')
      throw new Error('expected attemptIdentityFacts')

    // G: the expected route comes from the trusted decision + mapping.
    expect(outcome.expected).toEqual(GROQ_EXPECTED)
    // H/I: the observed order is preserved and each attempt keeps its own index.
    expect(outcome.attempts.map(fact => fact.roundId)).toEqual(['A', 'B', 'C', 'A'])
    expect(outcome.attempts.map(fact => fact.arrivalIndex)).toEqual([0, 1, 2, 3])
    // J/K: the two equality facts, per attempt, never combined.
    expect(outcome.attempts.map(fact => [fact.providerIdentityEqual, fact.modelIdentityEqual]))
      .toEqual([[true, true], [false, true], [true, false], [true, true]])
    // No extra reader-derived field: the facts shape is exactly the 4C2B one.
    expect(Object.keys(outcome).sort()).toEqual(['attempts', 'expected', 'status'])
    for (const fact of outcome.attempts)
      expect(Object.keys(fact).sort()).toEqual(['arrivalIndex', 'modelId', 'modelIdentityEqual', 'providerId', 'providerIdentityEqual', 'roundId'])
  })
})

describe('correlation snapshot reader - the real store (Phase 8.0D-10B-4C3A)', () => {
  it('l/m: the real store entries are read before the TTL, and read factually at the TTL boundary', () => {
    const { store, advance } = realStore()
    store.recordDecision('X', productionAutomaticDecision())
    store.recordExecution(report('X', 'A'))

    // L: still live just before the boundary.
    advance(899_999)
    const live = readLiaBrainExecutionIdentityFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    expect(live.status).toBe('attemptIdentityFacts')
    if (live.status !== 'attemptIdentityFacts')
      throw new Error('expected attemptIdentityFacts')
    expect(live.expected).toEqual(GROQ_EXPECTED)
    expect(live.attempts.map(fact => fact.roundId)).toEqual(['A'])

    // M: exactly at the boundary the entry is gone - and that is ALL it means.
    advance(1)
    expect(readLiaBrainExecutionIdentityFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING))
      .toEqual({ status: 'correlationNotObserved' })
  })

  it('n: after expiry, a fresh report for the same key reads as a fresh snapshot', () => {
    const { store, advance } = realStore()
    store.recordDecision('X', productionAutomaticDecision())
    store.recordExecution(report('X', 'A'))
    advance(900_000)
    expect(readLiaBrainExecutionIdentityFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING))
      .toEqual({ status: 'correlationNotObserved' })

    // A new logical send reusing the key starts over: one attempt, index 0, and
    // no decision recorded yet - the reader reports exactly that.
    store.recordExecution(report('X', 'B', 'anthropic', 'claude-x'))
    const fresh = readLiaBrainExecutionIdentityFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    expect(fresh.status).toBe('decisionNotObserved')
    if (fresh.status !== 'decisionNotObserved')
      throw new Error('expected decisionNotObserved')
    expect(fresh.attempts.map(fact => [fact.roundId, fact.arrivalIndex, fact.providerId]))
      .toEqual([['B', 0, 'anthropic']])
    expect(fresh).not.toHaveProperty('expected')
  })

  it('o/p: capacity eviction is read factually - the evicted key reads as not observed, the retained key keeps its facts', () => {
    const { store } = realStore(1)
    store.recordDecision('X', productionAutomaticDecision())
    store.recordExecution(report('X', 'A'))

    // O: the oldest key is evicted by the next key at capacity.
    store.recordExecution(report('Y', 'A'))
    expect(readLiaBrainExecutionIdentityFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING))
      .toEqual({ status: 'correlationNotObserved' })

    // P: the retained key still produces its own factual state.
    store.recordDecision('Y', productionAutomaticDecision())
    const retained = readLiaBrainExecutionIdentityFacts(store, 'Y', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    expect(retained.status).toBe('attemptIdentityFacts')
    if (retained.status !== 'attemptIdentityFacts')
      throw new Error('expected attemptIdentityFacts')
    expect(retained.expected).toEqual(GROQ_EXPECTED)
    expect(retained.attempts.map(fact => [fact.roundId, fact.arrivalIndex, fact.providerIdentityEqual, fact.modelIdentityEqual]))
      .toEqual([['A', 0, true, true]])
  })

  it('structural compatibility: the REAL store satisfies the structural reader contract, with no adapter', () => {
    // Type-only proof: the concrete store is assignable to the structural
    // contract, without either production API being changed.
    const storeIsSnapshotReader: LiaBrainCorrelationStore extends LiaBrainCorrelationSnapshotReader ? true : false = true
    const trustedMappingFitsLookup: LiaBrainEngineProviderMapping extends LiaBrainEngineProviderLookup ? true : false = true
    expect(storeIsSnapshotReader).toBe(true)
    expect(trustedMappingFitsLookup).toBe(true)

    // Runtime proof: the store OBJECT is handed to the reader directly.
    const { store } = realStore()
    store.recordDecision('X', productionAutomaticDecision())
    store.recordExecution(report('X', 'A'))
    const asEntry: LiaBrainCorrelationEntry | undefined = store.get('X')
    expect(asEntry).toBeDefined()

    expect(readLiaBrainExecutionIdentityFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)).toMatchObject({
      expected: GROQ_EXPECTED,
      status: 'attemptIdentityFacts',
    })
    // ...and a mapping typed as the trusted contract is accepted as-is.
    expect(readLiaBrainExecutionIdentityFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING satisfies LiaBrainEngineProviderMapping))
      .toMatchObject({ status: 'attemptIdentityFacts' })
  })
})

describe('correlation snapshot reader - read count, failure and purity (Phase 8.0D-10B-4C3A)', () => {
  it('q/r: exactly ONE read per call, with the exact key, and no second lookup', () => {
    const { calls, reader } = recordingReader({
      X: { decision: productionAutomaticDecision(), executions: [attempt(), attempt({ roundId: 'B' })] },
    })

    const outcome = readLiaBrainExecutionIdentityFacts(reader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)

    expect(calls).toEqual(['X'])
    expect(calls).toHaveLength(1)
    expect(outcome.status).toBe('attemptIdentityFacts')
    expect(outcome.attempts).toHaveLength(2)
    // The facts came from the ONE snapshot: still exactly one read.
    expect(calls).toHaveLength(1)
  })

  it('s/t: an absent snapshot never consults the mapping, a present selected one consults it once', () => {
    const absent = recordingMapping({ groq: 'groq' })
    const absentReader = recordingReader({})
    expect(readLiaBrainExecutionIdentityFacts(absentReader.reader, 'X', absent.mapping))
      .toEqual({ status: 'correlationNotObserved' })
    expect(absent.received).toEqual([])

    const present = recordingMapping({ groq: 'groq' })
    const presentReader = recordingReader({ X: { decision: productionAutomaticDecision(), executions: [attempt()] } })
    expect(readLiaBrainExecutionIdentityFacts(presentReader.reader, 'X', present.mapping))
      .toMatchObject({ expected: GROQ_EXPECTED, status: 'attemptIdentityFacts' })
    expect(present.received).toEqual(['groq'])
  })

  it('u: a thrown read error propagates unchanged - this foundation hides no defect', () => {
    const error = new Error('snapshot storage exploded')
    const throwingReader: LiaBrainCorrelationSnapshotReader = {
      get() {
        throw error
      },
    }

    let caught: unknown
    try {
      readLiaBrainExecutionIdentityFacts(throwingReader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    }
    catch (thrown) {
      caught = thrown
    }
    expect(caught).toBe(error)
  })

  it('v: an error thrown by the mapping facts propagates unchanged as well', () => {
    const error = new Error('trusted mapping exploded')
    const throwingMapping: LiaBrainEngineProviderLookup = {
      providerIdForEngine() {
        throw error
      },
    }
    const { reader } = recordingReader({ X: { decision: productionAutomaticDecision(), executions: [attempt()] } })

    let caught: unknown
    try {
      readLiaBrainExecutionIdentityFacts(reader, 'X', throwingMapping)
    }
    catch (thrown) {
      caught = thrown
    }
    expect(caught).toBe(error)
  })

  it('w/x/y: frozen real-shaped inputs work, nothing is mutated, and repeated reads are equivalent', () => {
    const snapshot = deepFreeze<LiaBrainExecutionIdentitySnapshot>({
      decision: productionAutomaticDecision(),
      executions: [attempt(), attempt({ roundId: 'B', providerId: 'unknown' })],
    })
    const mapping = deepFreeze<LiaBrainEngineProviderLookup>({ providerIdForEngine: engineId => (engineId === GROQ_ENGINE_ID ? GROQ_ENGINE_ID : undefined) })
    const snapshotBefore = JSON.stringify(snapshot)
    const { reader } = recordingReader({ X: snapshot })

    const first = readLiaBrainExecutionIdentityFacts(reader, 'X', mapping)
    const second = readLiaBrainExecutionIdentityFacts(reader, 'X', mapping)

    // W/X: the frozen snapshot and the mapping survive both reads unchanged.
    expect(JSON.stringify(snapshot)).toBe(snapshotBefore)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(mapping)).toBe(true)
    expect(snapshot.executions.map(entry => entry.providerId)).toEqual(['groq', 'unknown'])
    // Y: equivalent facts on every read, freshly built.
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(first).toMatchObject({
      attempts: [
        { arrivalIndex: 0, providerIdentityEqual: true },
        { arrivalIndex: 1, modelIdentityEqual: true, providerIdentityEqual: false },
      ],
      expected: GROQ_EXPECTED,
      status: 'attemptIdentityFacts',
    })
  })

  it('no aggregate interpretation: the reader exposes the facts states, nothing more', () => {
    const states: LiaBrainCorrelationReadFacts[] = [
      readLiaBrainExecutionIdentityFacts(recordingReader({}).reader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING),
      readLiaBrainExecutionIdentityFacts(recordingReader({ X: { executions: [attempt()] } }).reader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING),
    ]
    expect(states.map(state => state.status)).toEqual(['correlationNotObserved', 'decisionNotObserved'])

    for (const aggregate of ['anyAttempt', 'firstAttempt', 'finalAttempt', 'fallback', 'expectedRouteObserved', 'attemptCount', 'preferredAttempt', 'chosenAttempt', 'aggregateEquality', 'verdict', 'recommendation', 'winner', 'score'])
      expect(JSON.stringify(states), aggregate).not.toMatch(new RegExp(aggregate, 'i'))
  })
})

const REPO_ROOT = new URL('../../../../../../', import.meta.url)
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

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

/** Code without comments - guards must only find the words in real code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const BRAIN_ROOTS = ['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src', 'packages/lia-core/src']
const READER = 'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-reader.ts'
const IDENTITY_FACTS = 'apps/stage-tamagotchi/src/main/services/lia/brain-execution-identity-facts.ts'
const EXPECTED_ROUTE = 'apps/stage-tamagotchi/src/main/services/lia/brain-expected-route.ts'

function productionMatching(pattern: RegExp): string[] {
  return productionSources(BRAIN_ROOTS)
    .filter(relative => pattern.test(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
    .sort()
}

describe('correlation snapshot reader - authority and isolation invariants (Phase 8.0D-10B-4C3A)', () => {
  const source = stripComments(readSource('./brain-correlation-reader.ts'))

  it('z: exactly ONE production caller - the diagnostic observer, and no application/lifecycle caller', () => {
    // Phase 8.0D-10B-4C4A evolves the 4C3A "zero callers" state into an explicit
    // allowlist of exactly one: the tiny main-side diagnostic observer, which
    // only invokes the read path and discards the result.
    expect(productionMatching(/brain-correlation-reader/)).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-observer.ts',
    ])

    for (const relative of [
      'apps/stage-tamagotchi/src/main/index.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-decision-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-execution-report-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-service.ts',
      'apps/stage-tamagotchi/src/renderer/main.ts',
      'apps/stage-tamagotchi/src/renderer/services/lia/brain-shadow.ts',
      'apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue',
    ]) {
      expect(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8')), relative)
        .not
        .toMatch(/brain-correlation-reader|readLiaBrainExecutionIdentityFacts/)
    }
  })

  it('aa: exactly ONE production correlation reader, and it only reads - once, by key', () => {
    // The shipped invariant was ZERO readers. This phase evolves it narrowly to
    // exactly ONE legitimate read adapter, and nothing else in production may
    // call `.get(`/`.size` on a correlation handle.
    expect(productionMatching(/\w*[Cc]orrelation\w*\.(?:get\(|size\b)/)).toEqual([READER])

    // ...and that module is a READER only: one `get(...)`, no size, no writes.
    expect(source.match(/\.get\(/g)).toHaveLength(1)
    expect(source).toMatch(/correlationReader\.get\(correlationId\)/)
    expect(source).not.toMatch(/\.size|recordDecision\(|recordExecution\(/)
    // No iteration of store internals, and no retention of a snapshot.
    expect(source).not.toMatch(/\.entries\(|\.keys\(|for \(const|new Map|new Set/)
    expect(source).not.toMatch(/^(?:let|var) /m)
  })

  it('ab: the identity-facts caller allowlist is exactly this ONE pure production caller', () => {
    expect(productionMatching(/brain-execution-identity-facts/)).toEqual([READER])
    // It reuses the facts layer - it does not re-implement any of it.
    expect(source).toContain(`import { deriveLiaBrainExecutionIdentityFacts } from './brain-execution-identity-facts'`)
    expect(source.match(/deriveLiaBrainExecutionIdentityFacts\(/g)).toHaveLength(1)
    for (const duplicated of ['selectedLiaBrainRoute', 'arrivalIndex:', 'providerIdentityEqual:', 'modelIdentityEqual:', 'engineMappingMissing', 'noExecutionObserved', 'noBrainRouteSelected', 'attemptIdentityFacts'])
      expect(source, duplicated).not.toContain(duplicated)
  })

  it('ac: the expected-route FUNCTION caller allowlist stays exactly the identity-facts module', () => {
    // Since 8.0D-10B-4C4A the diagnostic observer references the module to
    // consume the trusted mapping VALUE - it is not a caller. The function-call
    // allowlist is what must stay exactly one module (the declaration itself is
    // excluded by the `function ` lookbehind).
    expect(productionMatching(/(?<!function )expectedExecutionRouteForBrainDecision\(/)).toEqual([IDENTITY_FACTS])
    expect(productionMatching(/brain-expected-route/)).not.toContain(READER)
    expect(productionMatching(/brain-expected-route/)).not.toContain(EXPECTED_ROUTE)
    // The dependency chain is strictly linear: reader -> facts -> expected route.
    expect(source).not.toMatch(/brain-expected-route|expectedExecutionRouteForBrainDecision|LIA_BRAIN_ENGINE_PROVIDER_MAPPING/)
  })

  it('ad: no aggregate interpretation vocabulary or fields anywhere in the reader', () => {
    for (const forbidden of ['anyAttempt', 'firstAttempt', 'finalAttempt', 'fallbackObserved', 'expectedRouteObserved', 'attemptCount', 'preferredAttempt', 'chosenAttempt', 'routeIdentityEqual', 'attemptMatches', 'aggregate', 'verdict', 'recommendation', 'winner', 'score'])
      expect(source, forbidden).not.toMatch(new RegExp(forbidden, 'i'))
    expect(source).not.toMatch(/mismatch|divergence|aligned/i)
    const comparisonPattern = /executionMatches|matchesExecution|decisionVsExecution|executionVsDecision|comparisonState|pendingComparison|compareBrain|brainVsExecution|liaBrainComparison|executionObservationMatches|brainDecisionComparison|decisionMatches|matchStatus|comparisonResult|diagnosticVerdict/i
    expect(source).not.toMatch(comparisonPattern)
  })

  it('ae: no IPC, no provider execution, no config mutation, no timers, no I/O, no logging', () => {
    // The whole dependency surface: the pure facts layer and nothing else.
    expect(source.match(/^import .*$/gm)).toEqual([
      `import type { LiaBrainExecutionIdentityFacts, LiaBrainExecutionIdentitySnapshot } from './brain-execution-identity-facts'`,
      `import { deriveLiaBrainExecutionIdentityFacts } from './brain-execution-identity-facts'`,
    ])
    expect(source).not.toMatch(/brain-correlation-store|brain-correlation-service|createLiaBrainCorrelation|LiaBrainCorrelationEntry/)

    expect(source).not.toMatch(/eventa|defineEventa|defineInvokeEventa|defineInvokeHandler|ipcMain|ipcRenderer|BrowserWindow|\.emit\(/)
    expect(source).not.toMatch(/decideBrainRoute|LiaBrainService|automaticPolicy|liaProductConfig|updateLiaProductConfig|setPreferred/)
    expect(source).not.toMatch(/getChatProviderInstance|useProviderStore|activeProvider|activeModel|providersStore|createOpenAI|defineProvider|createProductionBrainCatalog|LIA_MODEL_CATALOG/)
    expect(source).not.toMatch(/fallback|retry|permission|toolCall|switch|override/i)
    expect(source).not.toMatch(/setInterval|setTimeout|queueMicrotask|Date\.now|Math\.random|await /)
    expect(source).not.toMatch(/from ['"](?:node:)?(?:fs|net|https?|child_process|dns|dgram|timers)['/]|\bfetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage/)
    expect(source).not.toMatch(/console\.|^(?:process\.|globalThis\.)/m)

    // The exported surface is exactly the audited one.
    expect([...source.matchAll(/^export (?:const|function|interface|type) (\w+)/gm)].map(match => match[1])).toEqual([
      'LiaBrainCorrelationSnapshotReader',
      'LiaBrainEngineProviderLookup',
      'LiaBrainCorrelationReadFacts',
      'readLiaBrainExecutionIdentityFacts',
    ])
  })
})
