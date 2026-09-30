import type {
  LiaBrainAutomaticSelection,
  LiaBrainCapabilities,
  LiaBrainEngineDescriptor,
  LiaBrainModelDescriptor,
  LiaBrainPreferredResolution,
  LiaBrainRoutingDecision,
} from '@lia/core'

import type { LiaBrainCorrelationReadFacts, LiaBrainCorrelationSnapshot, LiaBrainCorrelationSnapshotReader, LiaBrainEngineProviderLookup, LiaObservedExecutionTerminal, LiaObservedSendTerminal } from './brain-correlation-reader'
import type { LiaBrainCorrelationEntry, LiaBrainCorrelationStore } from './brain-correlation-store'
import type { LiaBrainExecutionIdentitySnapshot, LiaObservedExecutionIdentity } from './brain-execution-identity-facts'
import type { LiaBrainEngineProviderMapping } from './brain-expected-route'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createProductionBrainAutomaticPolicy, createProductionBrainCatalog, decideBrainRoute } from '@lia/core'
import { describe, expect, it } from 'vitest'

import { repoRelativePosix } from '../../../test-helpers'
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

/**
 * A recording structural reader double: feeds snapshots, records every key
 * asked for. The value type is the reader's OWN snapshot contract, so a double
 * may carry the raw terminal collection a canonical entry stores.
 */
function recordingReader(snapshots: Record<string, LiaBrainCorrelationSnapshot | undefined>) {
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
const REPO_ROOT_PATH = fileURLToPath(REPO_ROOT)

function productionSources(roots: string[]): string[] {
  const files: string[] = []
  for (const root of roots) {
    for (const entry of readdirSync(new URL(root, REPO_ROOT), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.'))
        continue
      files.push(`${repoRelativePosix(REPO_ROOT_PATH, entry.parentPath)}/${entry.name}`)
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
const COMPOSITION = 'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-diagnostic-facts.ts'
const IDENTITY_FACTS = 'apps/stage-tamagotchi/src/main/services/lia/brain-execution-identity-facts.ts'
const EXPECTED_ROUTE = 'apps/stage-tamagotchi/src/main/services/lia/brain-expected-route.ts'

function productionMatching(pattern: RegExp): string[] {
  return productionSources(BRAIN_ROOTS)
    .filter(relative => pattern.test(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
    .sort()
}

describe('correlation snapshot reader - terminal records stop at the snapshot (Phase 8.0D-10B-4D4C3A-F)', () => {
  /** One raw terminal record, exactly as the snapshot contract declares it. */
  function terminal(roundId: string, outcome: 'succeeded' | 'failed' | 'abandoned'): LiaObservedExecutionTerminal {
    return { outcome, roundId }
  }

  /** One raw send-terminal record, exactly as the snapshot contract declares it. */
  function sendTerminal(outcome: 'succeeded' | 'failed'): LiaObservedSendTerminal {
    return { outcome }
  }

  /** A structural snapshot double: the facts minimum plus an OPTIONAL collection. */
  function snapshot(executions: LiaObservedExecutionIdentity[], terminals?: readonly LiaObservedExecutionTerminal[]) {
    return {
      decision: productionAutomaticDecision(),
      executions,
      ...(terminals === undefined ? {} : { executionTerminals: terminals }),
    }
  }

  function read(reader: LiaBrainCorrelationSnapshotReader): LiaBrainCorrelationReadFacts {
    return readLiaBrainExecutionIdentityFacts(reader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
  }

  it('ap: the snapshot contract admits the raw terminal records and stays a facts snapshot', () => {
    // Type-level proof: BOTH raw collections are OPTIONAL on this boundary...
    const bare = { executions: [attempt({ roundId: 'A' })] } satisfies LiaBrainCorrelationSnapshot
    const carried = {
      decision: productionAutomaticDecision(),
      executions: [attempt({ roundId: 'A' })],
      executionTerminals: [terminal('R', 'failed')],
      sendTerminal: sendTerminal('failed'),
    } satisfies LiaBrainCorrelationSnapshot

    // ...and all three remain the structural minimum the pure facts layer consumes.
    const asIdentityInput: LiaBrainExecutionIdentitySnapshot[] = [bare, carried]
    expect(asIdentityInput).toHaveLength(2)

    // The ROUND record is exactly the two-field store shape, nothing else.
    const records: readonly LiaObservedExecutionTerminal[] = carried.executionTerminals
    expect(records).toEqual([{ outcome: 'failed', roundId: 'R' }])
    expect(Object.keys(records[0]!).sort()).toEqual(['outcome', 'roundId'])

    // The SEND record is exactly the ONE-field store shape, nothing else - and
    // its vocabulary is exactly the two transport settlements.
    const carriedSend: LiaObservedSendTerminal = carried.sendTerminal
    expect(carriedSend).toEqual({ outcome: 'failed' })
    expect(Object.keys(carriedSend)).toEqual(['outcome'])
    const settlements: LiaObservedSendTerminal[] = [sendTerminal('succeeded'), sendTerminal('failed')]
    expect(settlements).toEqual([{ outcome: 'succeeded' }, { outcome: 'failed' }])
  })

  it('aq: the REAL store snapshot is consumable as the reader snapshot - terminal-only entry', () => {
    const { store } = realStore()
    store.recordExecutionTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })

    // No adapter, no copy layer: what the canonical store hands out IS the
    // reader's structural contract, and the store itself is a valid reader.
    const snapshot: LiaBrainCorrelationSnapshot = store.get('X')!
    const asReader: LiaBrainCorrelationSnapshotReader = store

    // Snapshot-boundary evidence: the raw record is the one 4D4C2A froze...
    expect(snapshot.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'R' }])
    // ...while the read output is the identity answer and nothing terminal.
    const outcome = readLiaBrainExecutionIdentityFacts(asReader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    expect(outcome).toEqual({ attempts: [], status: 'decisionNotObserved' })
    expect('executionTerminals' in outcome).toBe(false)
  })

  it('ar: the REAL store snapshot carries start and terminal side by side, still read as facts', () => {
    const { store } = realStore()
    store.recordDecision('X', productionAutomaticDecision())
    store.recordExecution(report('X', 'R'))
    store.recordExecutionTerminal({ correlationId: 'X', outcome: 'succeeded', roundId: 'R' })

    const snapshot: LiaBrainCorrelationSnapshot = store.get('X')!
    expect(snapshot.executionTerminals).toEqual([{ outcome: 'succeeded', roundId: 'R' }])
    expect(snapshot.executions).toHaveLength(1)

    // The attempt is reported as an identity fact: the matching terminal record
    // is NOT joined into it, and no terminal key appears anywhere.
    const outcome = readLiaBrainExecutionIdentityFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    expect(outcome.status).toBe('attemptIdentityFacts')
    expect(Object.keys(outcome).sort()).toEqual(['attempts', 'expected', 'status'])
    for (const fact of (outcome as { attempts: Record<string, unknown>[] }).attempts) {
      expect(Object.keys(fact).sort()).toEqual(['arrivalIndex', 'modelId', 'modelIdentityEqual', 'providerId', 'providerIdentityEqual', 'roundId'])
      expect(fact).not.toHaveProperty('outcome')
    }
  })

  it('as: a present correlation answers WITHOUT a terminal key - decision-only and execution-only', () => {
    const decisionOnly = recordingReader({ X: { decision: productionAutomaticDecision(), executions: [] } }).reader
    const executionOnly = recordingReader({ X: { executions: [attempt({ roundId: 'A' })] } }).reader

    const decisionOnlyOutcome = read(decisionOnly)
    expect(decisionOnlyOutcome.status).toBe('noExecutionObserved')
    expect(Object.keys(decisionOnlyOutcome).sort()).toEqual(['attempts', 'expected', 'status'])
    expect('executionTerminals' in decisionOnlyOutcome).toBe(false)

    const executionOnlyOutcome = read(executionOnly)
    expect(executionOnlyOutcome.status).toBe('decisionNotObserved')
    expect(Object.keys(executionOnlyOutcome).sort()).toEqual(['attempts', 'status'])
    expect('executionTerminals' in executionOnlyOutcome).toBe(false)
  })

  it('at: a terminal-only snapshot answers exactly like an EMPTY one - no synthesized attempt', () => {
    const terminalOnly = recordingReader({ X: { executions: [], executionTerminals: [terminal('R', 'failed')] } }).reader
    const empty = recordingReader({ X: { executions: [] } }).reader

    const outcome = read(terminalOnly)
    expect(outcome).toEqual(read(empty))
    expect(outcome).toEqual({ attempts: [], status: 'decisionNotObserved' })
    expect('executionTerminals' in outcome).toBe(false)
  })

  it('au: start plus matching terminal answers exactly like the start alone', () => {
    const matched = recordingReader({ X: snapshot([attempt({ roundId: 'R' })], [terminal('R', 'succeeded')]) }).reader
    const startOnly = recordingReader({ X: snapshot([attempt({ roundId: 'R' })]) }).reader

    const outcome = read(matched)
    expect(outcome).toEqual(read(startOnly))
    // No outcome was attached to the attempt and no terminal field leaked.
    expect(JSON.stringify(outcome)).not.toMatch(/terminal|outcome|succeeded/i)
    expect('executionTerminals' in outcome).toBe(false)
  })

  it('av: an unmatched terminal round is inert beside an unrelated execution start', () => {
    const unmatched = recordingReader({ X: snapshot([attempt({ roundId: 'A' })], [terminal('B', 'abandoned')]) }).reader
    const startOnly = recordingReader({ X: snapshot([attempt({ roundId: 'A' })]) }).reader

    const outcome = read(unmatched)
    // Identity output is based ONLY on execution A: no mismatch, no orphan, no
    // label for B.
    expect(outcome).toEqual(read(startOnly))
    expect((outcome as { attempts: { roundId: string }[] }).attempts.map(fact => fact.roundId)).toEqual(['A'])
    expect(JSON.stringify(outcome)).not.toMatch(/mismatch|orphan|abandoned|terminal/i)
  })

  it('aw: every terminal variant is inert - all outcomes, several rounds, empty or absent', () => {
    const executions = [attempt({ roundId: 'A' }), attempt({ roundId: 'B', providerId: 'anthropic' })]
    const baseline = read(recordingReader({ X: snapshot(executions) }).reader)

    for (const terminals of [
      [],
      [terminal('A', 'succeeded')],
      [terminal('A', 'failed')],
      [terminal('B', 'abandoned')],
      [terminal('A', 'succeeded'), terminal('B', 'failed'), terminal('C', 'abandoned')],
    ]) {
      const outcome = read(recordingReader({ X: snapshot(executions, terminals) }).reader)
      expect(outcome).toEqual(baseline)
      expect('executionTerminals' in outcome).toBe(false)
      expect(JSON.stringify(outcome)).not.toMatch(/terminal|succeeded|failed|abandoned|count|latest|fallback/i)
    }
  })

  it('ax: an absent correlation keeps its exact single-key answer', () => {
    const { calls, reader } = recordingReader({})

    const outcome = readLiaBrainExecutionIdentityFacts(reader, 'missing', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)

    expect(outcome).toEqual({ status: 'correlationNotObserved' })
    expect(Object.keys(outcome)).toEqual(['status'])
    expect('executionTerminals' in outcome).toBe(false)
    expect(calls).toEqual(['missing'])
  })

  it('ay: the reader ends at the snapshot - runtime never touches the terminal collection', () => {
    const source = stripComments(readSource('./brain-correlation-reader.ts'))
    const runtime = source.slice(source.indexOf('export function readLiaBrainExecutionIdentityFacts'))

    // Runtime implementation: zero terminal vocabulary - the collection is not
    // read, copied, mapped, filtered or counted.
    expect(runtime).not.toMatch(/executionTerminals|roundId|outcome|terminal/i)
    // No terminal helper of any kind anywhere in the module.
    expect(source).not.toMatch(/copyObservedExecutionTerminals|readTerminals|terminalCopy|terminalMap|terminal\w*\.(?:map|filter|reduce|find|sort)\(/)
    // The carriage lives in the type contract alone: one snapshot field and one
    // record shape per raw collection - the round terminal's `outcome` and the
    // send terminal's own `outcome` (Phase 8.0D-10B-4D4C4-B4B1), and nothing in
    // the executable path.
    expect(source.match(/executionTerminals/g)).toHaveLength(1)
    expect(source.match(/roundId/g)).toHaveLength(1)
    expect(source.match(/outcome/g)).toHaveLength(2)
  })
})

describe('send-terminal carriage does not touch the identity facts (Phase 8.0D-10B-4D4C4-B4B1)', () => {
  /** One raw send-terminal record, exactly as the snapshot contract declares it. */
  function sendTerminal(outcome: 'succeeded' | 'failed'): LiaObservedSendTerminal {
    return { outcome }
  }

  /** The SAME snapshot with only the send terminal varied - everything else fixed. */
  function withSendTerminal(send?: LiaObservedSendTerminal) {
    return {
      decision: productionAutomaticDecision(),
      executions: [attempt({ roundId: 'A' }), attempt({ roundId: 'B', providerId: 'anthropic' })],
      executionTerminals: [{ outcome: 'failed', roundId: 'A' } as LiaObservedExecutionTerminal],
      ...(send === undefined ? {} : { sendTerminal: send }),
    }
  }

  function readSnapshot(snapshot: LiaBrainCorrelationSnapshot): LiaBrainCorrelationReadFacts {
    const { calls, reader } = recordingReader({ X: snapshot })
    const outcome = readLiaBrainExecutionIdentityFacts(reader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    expect(calls).toEqual(['X'])
    return outcome
  }

  it('az: absent, succeeded and failed send terminals derive deeply equal identity facts', () => {
    const baseline = readSnapshot(withSendTerminal())
    expect(baseline.status).toBe('attemptIdentityFacts')

    for (const send of [sendTerminal('succeeded'), sendTerminal('failed')]) {
      const derived = readSnapshot(withSendTerminal(send))
      // The raw carriage is inert: the identity facts cannot tell the three
      // snapshots apart, and no send-derived state was invented.
      expect(derived).toEqual(baseline)
      expect(JSON.stringify(derived)).not.toMatch(/sendTerminal/)
    }
  })

  it('ba: no send vocabulary escapes, and the read result keys stay the identity ones', () => {
    for (const send of [undefined, sendTerminal('succeeded'), sendTerminal('failed')]) {
      const outcome = readSnapshot(withSendTerminal(send))

      // Exact-key proof first: the opaque ids below may legitimately contain any
      // string, so the leak claim is made structurally, not by a broad regex.
      expect(Object.keys(outcome).sort()).toEqual(['attempts', 'expected', 'status'])
      for (const fact of (outcome as { attempts: Record<string, unknown>[] }).attempts) {
        expect(Object.keys(fact).sort()).toEqual(['arrivalIndex', 'modelId', 'modelIdentityEqual', 'providerId', 'providerIdentityEqual', 'roundId'])
        expect('outcome' in fact).toBe(false)
        expect('sendTerminal' in fact).toBe(false)
      }
      for (const forbidden of ['sendTerminal', 'sendTerminalOutcome', 'sendTerminalFacts', 'executionTerminals'])
        expect(outcome).not.toHaveProperty(forbidden)
      expect(JSON.stringify(outcome)).not.toMatch(/sendTerminal/)
    }
  })

  it('bb: the REAL store hands out the send terminal it retains, and the read stays identity-only', () => {
    const failedStore = realStore()
    failedStore.store.recordSendTerminal({ correlationId: 'X', outcome: 'failed' })

    // No adapter, no wrapper: what the canonical store hands out IS the reader's
    // widened structural contract, send terminal included.
    const snapshot: LiaBrainCorrelationSnapshot = failedStore.store.get('X')!
    expect(snapshot.sendTerminal).toEqual({ outcome: 'failed' })
    expect(Object.keys(snapshot.sendTerminal!)).toEqual(['outcome'])
    expect(snapshot.executions).toEqual([])
    expect(snapshot.executionTerminals).toEqual([])

    // A send-terminal-only entry is NOT a decision and NOT an attempt: the
    // identity answer is the factual "nothing was observed" one, with no send
    // field anywhere in it.
    const outcome = readLiaBrainExecutionIdentityFacts(failedStore.store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    expect(outcome).toEqual({ attempts: [], status: 'decisionNotObserved' })
    expect(Object.keys(outcome).sort()).toEqual(['attempts', 'status'])
    expect('sendTerminal' in outcome).toBe(false)

    // The succeeded variant of the very same carriage answers identically.
    const succeededStore = realStore()
    succeededStore.store.recordSendTerminal({ correlationId: 'X', outcome: 'succeeded' })
    const succeededSnapshot: LiaBrainCorrelationSnapshot = succeededStore.store.get('X')!
    expect(succeededSnapshot.sendTerminal).toEqual({ outcome: 'succeeded' })
    expect(readLiaBrainExecutionIdentityFacts(succeededStore.store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING))
      .toEqual(outcome)
  })

  it('bc: a present entry WITHOUT a send terminal keeps working, with no own key required', () => {
    const { store } = realStore()
    store.recordDecision('X', productionAutomaticDecision())
    store.recordExecution(report('X', 'A'))

    const snapshot: LiaBrainCorrelationSnapshot = store.get('X')!
    expect('sendTerminal' in snapshot).toBe(false)
    expect(Object.hasOwn(snapshot, 'sendTerminal')).toBe(false)

    const outcome = readLiaBrainExecutionIdentityFacts(store, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    expect(outcome.status).toBe('attemptIdentityFacts')
    expect(Object.keys(outcome).sort()).toEqual(['attempts', 'expected', 'status'])
    expect('sendTerminal' in outcome).toBe(false)
  })

  it('bd: the supplied send terminal is never edited, and a frozen snapshot is accepted', () => {
    const frozen = deepFreeze(withSendTerminal(sendTerminal('failed')))
    const { reader } = recordingReader({ X: frozen })

    expect(() => readLiaBrainExecutionIdentityFacts(reader, 'X', LIA_BRAIN_ENGINE_PROVIDER_MAPPING)).not.toThrow()
    expect(frozen.sendTerminal).toEqual({ outcome: 'failed' })
    expect(Object.keys(frozen.sendTerminal)).toEqual(['outcome'])
    expect(frozen.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'A' }])
  })

  it('be: the send vocabulary stops at the description - runtime never names it', () => {
    const source = stripComments(readSource('./brain-correlation-reader.ts'))
    const runtime = source.slice(source.indexOf('export function readLiaBrainExecutionIdentityFacts'))

    // The executable slice mentions neither the record nor the field nor any
    // settlement word: nothing here reads, copies, maps, filters or emits it.
    expect(runtime).not.toMatch(/sendTerminal|LiaObservedSendTerminal|outcome|succeeded|failed/i)
    expect(runtime).not.toMatch(/send/i)
    // The read path stays exactly one get into one local, one absence branch and
    // one delegation.
    expect(runtime.match(/\.get\(/g)).toHaveLength(1)
    expect(runtime).toMatch(/correlationReader\.get\(correlationId\)/)
    expect(runtime).toMatch(/return \{ status: 'correlationNotObserved' \}/)
    expect(runtime).toMatch(/return deriveLiaBrainExecutionIdentityFacts\(snapshot, mapping\)/)
    // Exactly ONE `get` in the whole module, and no store/size/write reach.
    expect(source.match(/\.get\(/g)).toHaveLength(1)
    expect(source).not.toMatch(/\.size|recordDecision\(|recordExecution\(|recordSendTerminal\(/)

    // The carriage itself is declared exactly twice - the contract field and the
    // type it names - and the type is reader-owned (one field, one union).
    expect(source.match(/sendTerminal/g)).toEqual(['sendTerminal'])
    expect(source.match(/LiaObservedSendTerminal/g)).toHaveLength(2)
    expect(source).toMatch(/export interface LiaObservedSendTerminal \{\s*outcome:\s*\| 'succeeded'\s*\| 'failed'\s*\}/)
    expect(source).toMatch(/sendTerminal\?: LiaObservedSendTerminal/)

    // The record shape is exactly ONE field, in the closed transport vocabulary:
    // no key, no round, no attempt, no identity, no timing, no error and no
    // lifecycle word (symbols are declared by name, never reached for).
    const declarationStart = source.indexOf('export interface LiaObservedSendTerminal {')
    const sendBlock = source.slice(declarationStart, source.indexOf('}', declarationStart))
    expect(sendBlock.match(/\b(\w+):/g)).toEqual(['outcome:'])
    for (const forbidden of ['correlationId', 'roundId', 'attemptIndex', 'attemptCount', 'providerId', 'modelId', 'engineId', 'abandoned', 'cancelled', 'superseded', 'completed', 'pending', 'timestamp', 'error'])
      expect(sendBlock).not.toContain(forbidden)
  })
})

describe('correlation snapshot reader - authority and isolation invariants (Phase 8.0D-10B-4C3A)', () => {
  const source = stripComments(readSource('./brain-correlation-reader.ts'))

  it('z: the production references are the diagnostic observer and the unwired composition', () => {
    // Phase 8.0D-10B-4C4A evolves the 4C3A "zero callers" state into an explicit
    // allowlist of exactly one: the tiny main-side diagnostic observer, which
    // only invokes the read path and discards the result. Phase 8.0D-10B-4D4C3B2
    // adds the second, UNWIRED reference: the single-snapshot composition names
    // this adapter's structural contracts.
    expect(productionMatching(/brain-correlation-reader/)).toEqual([
      COMPOSITION,
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

  it('aa: the production correlation readers are this adapter and the unwired composition', () => {
    // The shipped invariant was ZERO readers. The 4C3A phase evolved it narrowly
    // to exactly ONE legitimate read adapter; 8.0D-10B-4D4C3B2 adds the second
    // LEGITIMATE read owner (the composed one-read boundary), which has no
    // production caller yet - and nothing else may call `.get(`/`.size` on a
    // correlation handle.
    expect(productionMatching(/\w*[Cc]orrelation\w*\.(?:get\(|size\b)/)).toEqual([COMPOSITION, READER])

    // ...and that module is a READER only: one `get(...)`, no size, no writes.
    expect(source.match(/\.get\(/g)).toHaveLength(1)
    expect(source).toMatch(/correlationReader\.get\(correlationId\)/)
    expect(source).not.toMatch(/\.size|recordDecision\(|recordExecution\(/)
    // No iteration of store internals, and no retention of a snapshot.
    expect(source).not.toMatch(/\.entries\(|\.keys\(|for \(const|new Map|new Set/)
    expect(source).not.toMatch(/^(?:let|var) /m)
  })

  it('ab: the identity-facts caller allowlist is this read adapter plus the unwired composition', () => {
    // Phase 8.0D-10B-4D4C3B2 adds the second, unwired consumer: the
    // single-snapshot composition delegates to the same pure facts layer.
    expect(productionMatching(/brain-execution-identity-facts/)).toEqual([COMPOSITION, READER])
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

    // The exported surface is exactly the audited one - the 4C3A members plus the
    // three reader-owned TYPE declarations 8.0D-10B-4D4C3A/4D4C4-B4B1 introduce
    // for the raw SNAPSHOT contract (no runtime function, no terminal-output
    // type, no new read API, and no second reader).
    expect([...source.matchAll(/^export (?:const|function|interface|type) (\w+)/gm)].map(match => match[1])).toEqual([
      'LiaObservedExecutionTerminal',
      'LiaObservedSendTerminal',
      'LiaBrainCorrelationSnapshot',
      'LiaBrainCorrelationSnapshotReader',
      'LiaBrainEngineProviderLookup',
      'LiaBrainCorrelationReadFacts',
      'readLiaBrainExecutionIdentityFacts',
    ])
  })
})
