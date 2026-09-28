import type {
  LiaBrainAutomaticSelection,
  LiaBrainCapabilities,
  LiaBrainEngineDescriptor,
  LiaBrainModelDescriptor,
  LiaBrainPreferredResolution,
  LiaBrainRoutingDecision,
} from '@lia/core'

import type { LiaBrainCorrelationObserver, LiaBrainDiagnosticEntry } from './brain-correlation-observer'
import type { LiaBrainCorrelationSnapshotReader } from './brain-correlation-reader'
import type { LiaBrainExecutionIdentityFacts, LiaBrainExecutionIdentitySnapshot, LiaObservedExecutionIdentity } from './brain-execution-identity-facts'
import type { LiaBrainTerminalObservationFacts } from './brain-execution-terminal-facts'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createProductionBrainAutomaticPolicy, createProductionBrainCatalog, decideBrainRoute } from '@lia/core'
import { createContainer, provide, resolve } from 'injeca'
import { describe, expect, it, vi } from 'vitest'

import { createLiaBrainCorrelationObserver } from './brain-correlation-observer'
import { createLiaBrainCorrelationService } from './brain-correlation-service'
import { createLiaBrainCorrelationStore } from './brain-correlation-store'
import { formatLiaBrainDiagnosticEntry } from './brain-diagnostic-log'
import { LIA_BRAIN_ENGINE_PROVIDER_MAPPING } from './brain-expected-route'

/**
 * Phase 8.0D-10B-4C4A: the focused proof of the main-side diagnostic observer.
 *
 * The observer is proven as an INVOCATION + ISOLATION adapter only: one
 * delegated read per observation, the trusted mapping supplied by the observer
 * itself, the factual result discarded, and every read/derive failure contained.
 * Nothing here registers the observer, calls it from a producer, or adds any
 * output, retention or authority.
 *
 * Two narrow module doubles make the failure modes deterministic: the trusted
 * mapping is wrapped so its consultation is observable (and can be made to
 * throw), and the read adapter is wrapped so the delegation itself is observable
 * (and its derivation can be made to throw). Both delegate to the REAL
 * implementations otherwise.
 */

/** Type-only compatibility proof: the concrete store IS the structural contract. */
type LiaBrainCorrelationStoreAsReader = ReturnType<typeof createLiaBrainCorrelationStore> extends LiaBrainCorrelationSnapshotReader ? true : false

const probes = vi.hoisted(() => ({
  mapping: {
    received: [] as string[],
    throwOn: undefined as string | undefined,
  },
  // Phase 8.0D-10B-4D4C3B2-B2: the composition delegation seam. The observer now
  // hands the read handle, the opaque key and the trusted mapping to the
  // composition - so the probes record exactly those three arguments, plus the
  // composed value the real implementation returned (the entry must forward
  // THAT value's members by reference).
  composition: {
    calls: [] as string[],
    error: undefined as Error | undefined,
    mappings: [] as unknown[],
    readers: [] as unknown[],
    returned: [] as unknown[],
  },
}))

vi.mock('./brain-expected-route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./brain-expected-route')>()
  return {
    ...actual,
    LIA_BRAIN_ENGINE_PROVIDER_MAPPING: {
      providerIdForEngine(engineId: string): string | undefined {
        probes.mapping.received.push(engineId)
        if (probes.mapping.throwOn === engineId)
          throw new Error('trusted mapping exploded')
        return actual.LIA_BRAIN_ENGINE_PROVIDER_MAPPING.providerIdForEngine(engineId)
      },
    },
  }
})

vi.mock('./brain-correlation-diagnostic-facts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./brain-correlation-diagnostic-facts')>()
  return {
    ...actual,
    composeLiaBrainCorrelationDiagnosticFacts: (
      ...args: Parameters<typeof actual.composeLiaBrainCorrelationDiagnosticFacts>
    ) => {
      probes.composition.calls.push(args[1])
      probes.composition.readers.push(args[0])
      probes.composition.mappings.push(args[2])
      if (probes.composition.error !== undefined)
        throw probes.composition.error
      const composed = actual.composeLiaBrainCorrelationDiagnosticFacts(...args)
      probes.composition.returned.push(composed)
      return composed
    },
  }
})

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

/** The audited production decision, from the canonical router. */
function productionDecision(): LiaBrainRoutingDecision {
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

/** A recording structural reader double: serves snapshots, counts every read. */
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

/** Loads the observer factory with the module doubles in place. */
async function loadObserver(
  reader: LiaBrainCorrelationSnapshotReader,
  log?: (entry: LiaBrainDiagnosticEntry) => void,
): Promise<LiaBrainCorrelationObserver> {
  const { createLiaBrainCorrelationObserver } = await import('./brain-correlation-observer')
  // Phase 8.0D-10B-4D2A: the callback is OPTIONAL and only present when a test
  // supplies one - exactly the production shape (which never does).
  return createLiaBrainCorrelationObserver({ correlationReader: reader, ...(log === undefined ? {} : { log }) })
}

/**
 * A REAL Injeca container wired EXACTLY like the composition entry (Phase
 * 8.0D-10B-4C4B), over the REAL production factories - same provider ids, same
 * dependency declaration, same build shape. Nothing is adapted or wrapped.
 */
function createTestContainer() {
  const container = createContainer()
  const observedReaders: LiaBrainCorrelationSnapshotReader[] = []
  const liaBrainCorrelation = provide(container, 'services:lia-brain-correlation', () => createLiaBrainCorrelationService())
  const liaBrainCorrelationObserver = provide(container, 'services:lia-brain-correlation-observer', {
    dependsOn: { liaBrainCorrelation },
    build: ({ dependsOn }) => {
      observedReaders.push(dependsOn.liaBrainCorrelation)
      return createLiaBrainCorrelationObserver({ correlationReader: dependsOn.liaBrainCorrelation })
    },
  })

  return {
    async resolved() {
      const { correlation, observer } = await resolve(container, { correlation: liaBrainCorrelation, observer: liaBrainCorrelationObserver })
      return {
        builds: observedReaders,
        correlation,
        observer,
        observedReaders,
        providerIds: [...container.providers.keys()].sort((a, b) => a.localeCompare(b)),
        get delegations() {
          return probes.composition.calls
        },
        resolveAgain: () => resolve(container, { correlation: liaBrainCorrelation, observer: liaBrainCorrelationObserver }),
      }
    },
  }
}

/**
 * One entry, narrowed to the present arm: both siblings guaranteed. Since
 * 8.0D-10B-4D4C4-B4B3 the present composed value carries `sendTerminalFacts` too,
 * and the observer forwards it untouched - so the sibling is part of the entry.
 */
function presentEntry(entry: LiaBrainDiagnosticEntry): {
  facts: LiaBrainExecutionIdentityFacts
  terminalFacts: LiaBrainTerminalObservationFacts
  sendTerminalFacts: LiaBrainSendTerminalObservationFacts
} {
  if (!('terminalFacts' in entry))
    throw new Error('expected a present correlation entry')
  return { facts: entry.facts, sendTerminalFacts: entry.sendTerminalFacts, terminalFacts: entry.terminalFacts }
}

/** The present arm of a composed value a delegation returned, narrowed once. */
function composedPresent(index = 0): {
  facts: LiaBrainExecutionIdentityFacts
  terminalFacts: LiaBrainTerminalObservationFacts
  sendTerminalFacts: LiaBrainSendTerminalObservationFacts
} {
  const composed = probes.composition.returned[index]
  if (typeof composed !== 'object' || composed === null || !('terminalFacts' in composed))
    throw new Error('expected a present composed value')
  return composed as {
    facts: LiaBrainExecutionIdentityFacts
    terminalFacts: LiaBrainTerminalObservationFacts
    sendTerminalFacts: LiaBrainSendTerminalObservationFacts
  }
}

/** Clears the probes so one test's observations cannot leak into the next. */
function resetProbes(): void {
  probes.mapping.received.length = 0
  probes.mapping.throwOn = undefined
  probes.composition.calls.length = 0
  probes.composition.error = undefined
  probes.composition.mappings.length = 0
  probes.composition.readers.length = 0
  probes.composition.returned.length = 0
}

describe('correlation observer - contract and invocation (Phase 8.0D-10B-4C4A)', () => {
  it('a/b: the factory exposes exactly one method, and observing returns nothing', async () => {
    resetProbes()
    const { reader } = recordingReader({})
    const observer = await loadObserver(reader)

    // A: the whole public surface is `observe` - no getters, no state, no facts.
    expect(Object.keys(observer)).toEqual(['observe'])
    expect(typeof observer.observe).toBe('function')

    // B: the observation returns undefined (not facts, not a promise).
    expect(observer.observe('X')).toBeUndefined()
  })

  it('c/d: one observation delegates exactly one read, with the key forwarded verbatim', async () => {
    resetProbes()
    const opaqueKey = '  logical-send/..\tX-9  '
    const { calls, reader } = recordingReader({
      [opaqueKey]: { decision: productionDecision(), executions: [attempt()] },
    })
    const observer = await loadObserver(reader)

    observer.observe(opaqueKey)

    // C: the read adapter was invoked once with that exact key...
    expect(probes.composition.calls).toEqual([opaqueKey])
    // ...and the single snapshot read happened exactly once.
    expect(calls).toEqual([opaqueKey])
    // D: nothing trimmed, prefixed, parsed or synthesized.
    expect(calls[0]).toBe(opaqueKey)
  })

  it('composition delegation: exactly ONE call per observation, with the exact three arguments', async () => {
    resetProbes()
    const opaqueKey = '  logical-send/..\tX-9  '
    const { reader } = recordingReader({ [opaqueKey]: { executions: [attempt()] } })
    const observer = await loadObserver(reader)

    observer.observe(opaqueKey)

    // Exactly one delegation, carrying the key verbatim...
    expect(probes.composition.calls).toEqual([opaqueKey])
    expect(probes.composition.calls[0]).toBe(opaqueKey)
    // ...the EXACT reader object the observer was built over...
    expect(probes.composition.readers).toHaveLength(1)
    expect(probes.composition.readers[0]).toBe(reader)
    // ...and the exact trusted mapping VALUE, unconverted and unwrapped.
    expect(probes.composition.mappings).toHaveLength(1)
    expect(probes.composition.mappings[0]).toBe(LIA_BRAIN_ENGINE_PROVIDER_MAPPING)

    // A second observation composes a second time - never a remembered value.
    observer.observe(opaqueKey)
    expect(probes.composition.calls).toEqual([opaqueKey, opaqueKey])
    expect(probes.composition.mappings).toHaveLength(2)
  })

  it('the manual route form is observed the same way, even when its engine needs configuration', async () => {
    resetProbes()
    const manualDecision = manual({
      engine: engine({ availability: 'configurationRequired' }),
      model: model(),
      status: 'resolvedModel',
    })
    const { calls, reader } = recordingReader({ X: { decision: manualDecision, executions: [attempt()] } })
    const observer = await loadObserver(reader)

    expect(observer.observe('X')).toBeUndefined()
    // Readiness is not consulted here: the explicit route still resolves its
    // trusted engine, so the mapping is consulted exactly as for automatic.
    expect(probes.mapping.received).toEqual([GROQ_ENGINE_ID])
    expect(calls).toEqual(['X'])
  })

  it('a decision without a selected route is observed without consulting the mapping', async () => {
    resetProbes()
    const { calls, reader } = recordingReader({
      X: { decision: automatic({ status: 'noCandidates' }), executions: [attempt()] },
    })
    const observer = await loadObserver(reader)

    expect(observer.observe('X')).toBeUndefined()
    // No route was selected, so there is no engine to map - and the observation
    // still succeeds (nothing to observe is not a failure).
    expect(probes.mapping.received).toEqual([])
    expect(calls).toEqual(['X'])
  })

  it('e: the TRUSTED production mapping reaches the existing reader', async () => {
    resetProbes()
    const { reader } = recordingReader({ X: { decision: productionDecision(), executions: [attempt()] } })
    const observer = await loadObserver(reader)

    observer.observe('X')

    // The observer supplied the immutable production mapping, and the reader
    // consulted it with the trusted selected engine id.
    expect(probes.mapping.received).toEqual([GROQ_ENGINE_ID])
  })
})

describe('correlation observer - the factual result is discarded (Phase 8.0D-10B-4C4A)', () => {
  it('f/g/h/i: every factual state is discarded, and nothing is retained', async () => {
    resetProbes()
    const snapshots: Record<string, LiaBrainExecutionIdentitySnapshot | undefined> = {
      // G: executions only -> decisionNotObserved.
      X: { executions: [attempt()] },
      // H: decision only -> noExecutionObserved.
      Y: { decision: productionDecision(), executions: [] },
      // I: decision + attempts -> attemptIdentityFacts.
      Z: { decision: productionDecision(), executions: [attempt(), attempt({ roundId: 'B', providerId: 'unknown' })] },
      // F: absent -> correlationNotObserved (the key simply has no snapshot).
    }
    const { calls, reader } = recordingReader(snapshots)
    const observer = await loadObserver(reader)

    for (const correlationId of ['X', 'Y', 'Z', 'absent']) {
      expect(observer.observe(correlationId), correlationId).toBeUndefined()
      // Exactly one read per observation - the result cannot cause a second.
      expect(calls.filter(key => key === correlationId), correlationId).toHaveLength(1)
    }
    expect(calls).toEqual(['X', 'Y', 'Z', 'absent'])
    // Nothing about the observer itself changed: still one method, no state.
    expect(Object.keys(observer)).toEqual(['observe'])
    // The snapshots handed in were not mutated by observing them.
    expect(snapshots.Z?.executions.map(entry => entry.roundId)).toEqual(['A', 'B'])
    expect(snapshots.Y?.decision?.status).toBe('automatic')
  })
})

describe('correlation observer - failure isolation (Phase 8.0D-10B-4C4A)', () => {
  it('j: a throwing reader does not escape, and is not retried', async () => {
    resetProbes()
    const calls: string[] = []
    const throwingReader: LiaBrainCorrelationSnapshotReader = {
      get(correlationId: string): LiaBrainExecutionIdentitySnapshot | undefined {
        calls.push(correlationId)
        throw new Error('snapshot storage exploded')
      },
    }
    const observer = await loadObserver(throwingReader)

    expect(() => observer.observe('X')).not.toThrow()
    expect(observer.observe('X')).toBeUndefined()
    // N: no retry - exactly one read per observation, two observations total.
    expect(calls).toEqual(['X', 'X'])
    expect(probes.composition.calls).toEqual(['X', 'X'])
  })

  it('k: a throwing trusted mapping does not escape', async () => {
    resetProbes()
    const { calls, reader } = recordingReader({ X: { decision: productionDecision(), executions: [attempt()] } })
    const observer = await loadObserver(reader)
    probes.mapping.throwOn = GROQ_ENGINE_ID

    expect(() => observer.observe('X')).not.toThrow()
    // The mapping really was consulted (and threw), so this is that failure.
    expect(probes.mapping.received).toEqual([GROQ_ENGINE_ID])
    // Still exactly one read: the failure produced no second read, and the
    // observation reported nothing.
    expect(calls).toEqual(['X'])
  })

  it('l: a throwing derivation/read path does not escape', async () => {
    resetProbes()
    const { calls, reader } = recordingReader({ X: { decision: productionDecision(), executions: [attempt()] } })
    const observer = await loadObserver(reader)
    probes.composition.error = new Error('derivation exploded')

    expect(() => observer.observe('X')).not.toThrow()
    expect(observer.observe('X')).toBeUndefined()
    // The delegation still happens once per observation: the failure is INSIDE
    // the read path, never a read-path bypass or a second code path...
    expect(probes.composition.calls).toEqual(['X', 'X'])
    // ...and nothing was retried: the injected failure aborted before the
    // adapter could reach the memory, and no attempt was made to read again.
    expect(calls).toEqual([])
  })

  it('m/n: a failure leaves the observer exactly as it was - no state, no second code path', async () => {
    resetProbes()
    const { reader } = recordingReader({ X: { executions: [attempt()] } })
    const observer = await loadObserver(reader)
    const before = Object.keys(observer)

    probes.composition.error = new Error('isolated')
    observer.observe('X')
    probes.composition.error = undefined
    observer.observe('X')

    expect(Object.keys(observer)).toEqual(before)
    expect(before).toEqual(['observe'])
    expect(probes.composition.calls).toEqual(['X', 'X'])
  })
})

describe('correlation observer - the real store (Phase 8.0D-10B-4C4A)', () => {
  function realStore() {
    return createLiaBrainCorrelationStore({ maxEntries: 8, ttlMs: 900_000 })
  }

  function report(correlationId: string, roundId: string, providerId = 'groq', modelId = GROQ_MODEL_ID) {
    return { conversationId: 'conversation-1', correlationId, modelId, providerId, roundId }
  }

  it('o/p/s: the real store satisfies the structural dependency, and a complete snapshot is observable', async () => {
    resetProbes()
    const store = realStore()

    // O: type-only compatibility proof - the concrete store IS the structural
    // contract the observer accepts, with no adapter and no API change.
    const storeIsSnapshotReader: LiaBrainCorrelationStoreAsReader = true
    expect(storeIsSnapshotReader).toBe(true)
    const asReader: LiaBrainCorrelationSnapshotReader = store
    const observer = await loadObserver(asReader)

    store.recordDecision('X', productionDecision())
    store.recordExecution(report('X', 'A'))
    const before = JSON.stringify(store.get('X'))

    expect(observer.observe('X')).toBeUndefined()
    // P: the observation ran against the real entry (mapping consulted with the
    // trusted engine id)...
    expect(probes.mapping.received).toEqual([GROQ_ENGINE_ID])
    // S: ...and the stored snapshot is byte-for-byte untouched.
    expect(JSON.stringify(store.get('X'))).toBe(before)
    expect(store.get('X')?.executions.map(execution => execution.roundId)).toEqual(['A'])
  })

  it('q/r/s: incomplete snapshots on either side, in either arrival order, are observable', async () => {
    resetProbes()
    const store = realStore()
    const observer = await loadObserver(store)

    // Q: executions-first - the entry exists with attempts and no decision yet.
    store.recordExecution(report('X', 'A'))
    expect(observer.observe('X')).toBeUndefined()
    expect(store.get('X')?.decision).toBeUndefined()
    expect(store.get('X')?.executions).toHaveLength(1)

    // R: decision-first - the entry exists with the decision and no attempts.
    store.recordDecision('Y', productionDecision())
    expect(observer.observe('Y')).toBeUndefined()
    expect(store.get('Y')?.decision).toBeDefined()
    expect(store.get('Y')?.executions).toHaveLength(0)

    // S: neither snapshot was altered by being observed.
    expect(store.get('X')?.executions.map(execution => execution.roundId)).toEqual(['A'])
    expect(store.get('Y')?.executions).toEqual([])
  })
})

describe('correlation observer - no retention, no inspection, synchrony (Phase 8.0D-10B-4C4A)', () => {
  it('t/u: no state is remembered - every observation re-reads the CURRENT store state', async () => {
    resetProbes()
    const snapshots: Record<string, LiaBrainExecutionIdentitySnapshot | undefined> = {
      X: { executions: [attempt()] },
      Y: { decision: productionDecision(), executions: [] },
    }
    const { calls, reader } = recordingReader(snapshots)
    const observer = await loadObserver(reader)

    observer.observe('X')
    observer.observe('Y')
    // T: observing a different key leaves nothing behind to query - the
    // observer exposes only `observe`, and no getter can answer "what did you
    // see for X?".
    expect(Object.keys(observer)).toEqual(['observe'])

    // U: the state changed underneath; the next observation reads the NEW state
    // (the read is the only source of truth - nothing was cached).
    snapshots.X = { decision: productionDecision(), executions: [attempt(), attempt({ roundId: 'B' })] }
    observer.observe('X')
    expect(calls).toEqual(['X', 'Y', 'X'])
    expect(probes.composition.calls).toEqual(['X', 'Y', 'X'])
    // A further observation of the same key reads again - never served from a
    // remembered result.
    observer.observe('X')
    expect(calls).toEqual(['X', 'Y', 'X', 'X'])
  })

  it('aa/ab: observe is synchronous and returns immediately', async () => {
    resetProbes()
    const { reader } = recordingReader({ X: { decision: productionDecision(), executions: [attempt()] } })
    const observer = await loadObserver(reader)

    // AA: a plain synchronous function - not an async function.
    expect(observer.observe.constructor.name).toBe('Function')
    expect(observer.observe.constructor.name).not.toBe('AsyncFunction')

    // AB: the value is undefined IMMEDIATELY - there is nothing to await, and
    // the delegated read already happened by the time it returned.
    const returned = observer.observe('X')
    expect(returned).toBeUndefined()
    expect(returned).not.toBeInstanceOf(Promise)
    expect(probes.composition.calls).toEqual(['X'])
  })

  it('v/w/x/y/z: the source may forward the composed facts but never interprets them', () => {
    const source = stripComments(readSource('./brain-correlation-observer.ts'))

    // Phase 8.0D-10B-4D4C3B2-B2: the composed value is handed off by REFERENCE
    // to the optional callback - assigned to exactly one local, spread into the
    // module's own entry shape, and never dereferenced.
    expect(source).toContain('const diagnosticFacts = composeLiaBrainCorrelationDiagnosticFacts(correlationReader, correlationId, LIA_BRAIN_ENGINE_PROVIDER_MAPPING)')
    expect(source).toContain('log?.({ correlationId, ...diagnosticFacts })')
    // Exactly ONE composition call site and ONE forward call site.
    expect(source.match(/composeLiaBrainCorrelationDiagnosticFacts\(/g)).toHaveLength(1)
    expect(source.match(/log\?\.\(/g)).toHaveLength(1)
    // The identity-only read is gone from this module; the composition owns the
    // ONE read and BOTH derivations.
    expect(source).not.toMatch(/readLiaBrainExecutionIdentityFacts|deriveLiaBrain/)
    expect(source).not.toMatch(/\bresult\b|\boutcome\b|\bsnapshot\b/)
    // V: the composed members are never READ: no property access on them, no
    // status inspection and no state branching at all.
    expect(source).not.toMatch(/diagnosticFacts\.|\bfacts\./)
    expect(source).not.toMatch(/status/i)
    expect(source).not.toMatch(/\bif\b|\bswitch\b|\belse\b|\?\?/)
    // The ONLY optional chaining is the callback call itself - not a branch on
    // any composed value.
    expect(source.match(/\?\./g)).toHaveLength(1)
    expect(source).not.toMatch(/facts\?\.|attempts\?\.|expected\?\./)
    // W: no attempt iteration or reading.
    expect(source).not.toMatch(/attempts|\.map\(|\.filter\(|for \(/)
    // X/Y: no equality fact and no individual terminal count is ever named.
    expect(source).not.toMatch(/providerIdentityEqual|modelIdentityEqual|TerminalObservationCount/)
    // Z: nothing is destructured out of the composed value - the ONLY
    // destructuring is the injected dependencies (reader + optional callback).
    expect(source.match(/const \{/g)).toHaveLength(1)
    expect(source).toContain('const { correlationReader, log } = params')
    // 8.0D-10B-4D4C4-B4B3: the send sibling travels by the SAME spread - the
    // observer neither names the sibling nor the projected outcome value, and it
    // needed no production edit to forward it.
    expect(source).not.toMatch(/sendTerminalFacts|sendTerminalOutcome/)
  })

  it('the source retains nothing, writes nothing itself and uses no async API', () => {
    const source = stripComments(readSource('./brain-correlation-observer.ts'))

    for (const forbidden of ['new Map', 'new Set', 'history', 'cache', 'pending', 'lastResult', 'lastFacts', 'debounce', 'ttl'])
      expect(source, forbidden).not.toMatch(new RegExp(forbidden, 'i'))
    // AC: no Promise, microtask or timer API exists.
    expect(source).not.toMatch(/setTimeout|setInterval|queueMicrotask|Promise|async |await /)
    // The bindings are the injected dependencies plus the single factual local
    // that is handed off immediately: nothing else is ever assigned, so nothing
    // can hold observed data past the call.
    expect(source.match(/^\s*(?:const|let|var) /gm)).toHaveLength(2)

    // No output of any kind - the module calls an injected callback and nothing
    // else: no logger import, no console, no stream, no emitter, no transport.
    expect(source).not.toMatch(/console\.|process\.stdout|useLogg|@guiiai\/logg|logger|telemetry|\.emit\(/)
    expect(source).not.toMatch(/eventa|defineEventa|defineInvokeEventa|defineInvokeHandler|ipcMain|ipcRenderer|BrowserWindow/)
    expect(source).not.toMatch(/from ['"](?:node:)?(?:fs|net|https?|dns|dgram|child_process)['/]|\bfetch\(|XMLHttpRequest|WebSocket/)
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
const OBSERVER = 'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-observer.ts'
const COMPOSITION = 'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-diagnostic-facts.ts'
const DIAGNOSTIC_LOG = 'apps/stage-tamagotchi/src/main/services/lia/brain-diagnostic-log.ts'
const READER = 'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-reader.ts'
const IDENTITY_FACTS = 'apps/stage-tamagotchi/src/main/services/lia/brain-execution-identity-facts.ts'
const EXPECTED_ROUTE = 'apps/stage-tamagotchi/src/main/services/lia/brain-expected-route.ts'
const TERMINAL_PRODUCER = 'apps/stage-tamagotchi/src/main/services/lia/brain-execution-terminal-report-service.ts'
const SEND_PRODUCER = 'apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-service.ts'

function productionMatching(pattern: RegExp): string[] {
  return productionSources(BRAIN_ROOTS)
    .filter(relative => pattern.test(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
    .sort()
}

describe('correlation observer - caller allowlists and authority (Phase 8.0D-10B-4C4A)', () => {
  const source = stripComments(readSource('./brain-correlation-observer.ts'))

  it('ad: the reader keeps its two production references, and the observer only names its TYPE', () => {
    // Phase 8.0D-10B-4D4C3B2 introduced the single-snapshot composition; Phase
    // 8.0D-10B-4D4C3B2-B2 wires the observer to it, so the observer no longer
    // calls the identity-only read at all.
    expect(productionMatching(/brain-correlation-reader/)).toEqual([COMPOSITION, OBSERVER])
    expect(source).toContain(`import type { LiaBrainCorrelationSnapshotReader } from './brain-correlation-reader'`)
    expect(source).not.toMatch(/readLiaBrainExecutionIdentityFacts/)
  })

  it('ad2: the identity-only read has NO production caller left - only its own definition', () => {
    // Phase 8.0D-10B-4D4C3B2-B2: the observer migrated to the composition, which
    // owns the read. The tested/frozen public reader API stays exactly where it
    // is - it simply has no production caller anymore.
    expect(productionMatching(/readLiaBrainExecutionIdentityFacts\(/)).toEqual([READER])
    expect(productionMatching(/(?<!function )readLiaBrainExecutionIdentityFacts\(/)).toEqual([])
  })

  it('ad3: the composed read boundary has exactly ONE production caller - this observer', () => {
    // The module is named by this observer only, and its ONE call site is here.
    expect(productionMatching(/brain-correlation-diagnostic-facts/)).toEqual([OBSERVER])
    expect(productionMatching(/composeLiaBrainCorrelationDiagnosticFacts\(/)).toEqual([COMPOSITION, OBSERVER])
    expect(productionMatching(/(?<!function )composeLiaBrainCorrelationDiagnosticFacts\(/)).toEqual([OBSERVER])
    expect(source).toContain(`import { composeLiaBrainCorrelationDiagnosticFacts } from './brain-correlation-diagnostic-facts'`)
    expect(source.match(/composeLiaBrainCorrelationDiagnosticFacts\(/g)).toHaveLength(1)
  })

  it('ae: the direct correlation read allowlist is the reader module plus the unwired composition', () => {
    // Phase 8.0D-10B-4D4C3B2's composition owns the ONE read of a composed
    // result; it has no production caller yet.
    expect(productionMatching(/\w*[Cc]orrelation\w*\.(?:get\(|size\b)/)).toEqual([COMPOSITION, READER])
    // The observer never touches the memory itself: no `.get(`, no size.
    expect(source).not.toMatch(/\.get\(|\.size/)
  })

  it('af: the identity-facts caller allowlist is the reader plus the unwired composition', () => {
    expect(productionMatching(/brain-execution-identity-facts/)).toEqual([COMPOSITION, READER])
    expect(source).not.toMatch(/brain-execution-identity-facts|deriveLiaBrainExecutionIdentityFacts/)
  })

  it('ag: the expected-route FUNCTION call allowlist is still exactly the identity-facts module', () => {
    // The declaring module is excluded by the `function ` lookbehind, exactly as
    // the shipped factory guards do.
    expect(productionMatching(/(?<!function )expectedExecutionRouteForBrainDecision\(/)).toEqual([IDENTITY_FACTS])
    expect(source).not.toMatch(/expectedExecutionRouteForBrainDecision\(|selectedLiaBrainRoute/)
  })

  it('ah: the trusted mapping VALUE has exactly the intended consumers', () => {
    // Its owning module (the declaration) plus its consumers — observer, expected-route (re-export), renderer adapter, and shared owner.
    expect(productionMatching(/LIA_BRAIN_ENGINE_PROVIDER_MAPPING/)).toEqual([OBSERVER, EXPECTED_ROUTE, 'apps/stage-tamagotchi/src/renderer/services/lia/brain-send-route-candidate.ts', 'apps/stage-tamagotchi/src/shared/lia/brain-engine-provider-mapping.ts'].sort())
    // The observer imports the VALUE and passes it through - it never rebuilds
    // a table, never resolves a provider and never names a vendor identity.
    expect(source).toContain(`import { LIA_BRAIN_ENGINE_PROVIDER_MAPPING } from './brain-expected-route'`)
    // Exactly twice: the import and the single pass-through into the reader.
    expect(source.match(/LIA_BRAIN_ENGINE_PROVIDER_MAPPING/g)).toHaveLength(2)
    expect(source).not.toMatch(/providerIdForEngine|'groq'|openai\/gpt-oss/)

    for (const forbidden of [
      'apps/stage-tamagotchi/src/main/index.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-decision-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-execution-report-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-service.ts',
      'apps/stage-tamagotchi/src/renderer/main.ts',
    ]) {
      expect(stripComments(readFileSync(new URL(forbidden, REPO_ROOT), 'utf-8')), forbidden)
        .not
        .toMatch(/LIA_BRAIN_ENGINE_PROVIDER_MAPPING/)
    }
  })

  it('zero authority: the observer cannot reach Brain, providers, config or any execution surface', () => {
    // The whole dependency surface: the reader's structural TYPE, the composed
    // result TYPE and its ONE composition dependency, plus the trusted mapping
    // value - nothing else. (Phase 8.0D-10B-4D4C3B2-B2 replaces the old
    // identity-only read import with the composition, so the observer can no
    // longer read or derive anything itself.)
    // (8.0D-10B-4D4C4-B4B3 adds NOTHING here: the send sibling is forwarded by
    // the spread, so the observer never names the pure send module or its type.)
    expect(source.match(/^import .*$/gm)).toEqual([
      `import type { LiaBrainCorrelationDiagnosticFacts } from './brain-correlation-diagnostic-facts'`,
      `import type { LiaBrainCorrelationSnapshotReader } from './brain-correlation-reader'`,
      `import { composeLiaBrainCorrelationDiagnosticFacts } from './brain-correlation-diagnostic-facts'`,
      `import { LIA_BRAIN_ENGINE_PROVIDER_MAPPING } from './brain-expected-route'`,
    ])

    // No Brain service, no decision call, no policy or config write.
    expect(source).not.toMatch(/LiaBrainService|decide\(|automaticPolicy|liaProductConfig|updateLiaProductConfig|setPreferred/)
    // No provider/model resolution or selection.
    expect(source).not.toMatch(/getChatProviderInstance|useProviderStore|activeProvider|activeModel|providersStore|createOpenAI|defineProvider|createProductionBrainCatalog/)
    // No fallback, retry, tools or permissions.
    expect(source).not.toMatch(/fallback|retry|permission|toolCall|switch|override/i)
    // No timers, no I/O, no network, no filesystem.
    expect(source).not.toMatch(/from ['"](?:node:)?(?:fs|net|https?|child_process|dns|dgram|timers)['/]|\bfetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage/)
    // No correlation memory naming either: the dependency is structural. (The
    // factory patterns keep their call parens so this module's OWN
    // `createLiaBrainCorrelationObserver(` cannot be mistaken for a store or
    // service factory - the same convention the shipped guards use.)
    expect(source).not.toMatch(/brain-correlation-store|brain-correlation-service|createLiaBrainCorrelation(?:Store|Service)\(|LiaBrainCorrelationStore\b|LiaBrainCorrelationService\b/)

    // The exported surface is exactly the audited one - the observer contract,
    // the structured diagnostic entry of 8.0D-10B-4D2A and its factory.
    expect([...source.matchAll(/^export (?:const|function|interface|type) (\w+)/gm)].map(match => match[1])).toEqual([
      'LiaBrainCorrelationObserver',
      'LiaBrainDiagnosticEntry',
      'createLiaBrainCorrelationObserver',
    ])
  })
})

const DECISION_PRODUCER = 'apps/stage-tamagotchi/src/main/services/lia/brain-decision-service.ts'
const EXECUTION_PRODUCER = 'apps/stage-tamagotchi/src/main/services/lia/brain-execution-report-service.ts'

describe('correlation observer - lifecycle ownership and dual trigger (Phase 8.0D-10B-4C4C)', () => {
  it('ai: the module references are the composition entry plus the four TYPE-ONLY producers, and the entry never observes', () => {
    // Phase 8.0D-10B-4C4B gives the observer its ONE canonical lifecycle owner;
    // Phase 8.0D-10B-4C4C adds the two producers, which know only the contract
    // TYPE and the one trigger; 8.0D-10B-4D2B adds the diagnostic log adapter,
    // which knows only the entry TYPE; 8.0D-10B-4D4C4-B4B5 adds the fourth
    // producer - the send-terminal ingress - which knows only the same TYPE
    // and the one trigger. None of them creates or constructs one.
    expect(productionMatching(/brain-correlation-observer/)).toEqual([
      'apps/stage-tamagotchi/src/main/index.ts',
      DECISION_PRODUCER,
      DIAGNOSTIC_LOG,
      EXECUTION_PRODUCER,
      TERMINAL_PRODUCER,
      SEND_PRODUCER,
    ])
    // The adapter's coupling is TYPE-ONLY: it imports the entry contract and
    // never the module's value surface (no factory, no reader, no mapping).
    const adapter = stripComments(readFileSync(new URL(DIAGNOSTIC_LOG, REPO_ROOT), 'utf-8'))
    expect(adapter).toContain(`import type { LiaBrainDiagnosticEntry } from './brain-correlation-observer'`)
    expect(adapter).not.toMatch(/createLiaBrainCorrelationObserver|brain-correlation-reader|brain-execution-identity-facts|brain-expected-route|brain-correlation-store|brain-correlation-service/)
    // A. FACTORY ownership stays exactly the composition entry (the `function `
    // lookbehind excludes the factory's own declaration, so this counts CALLs).
    expect(productionMatching(/(?<!function )createLiaBrainCorrelationObserver\(/)).toEqual([
      'apps/stage-tamagotchi/src/main/index.ts',
    ])

    // B. The observer is triggered by EXACTLY the four producers - the callers
    // that performed a successful diagnostic write first (Phase
    // 8.0D-10B-4D4C4-B4B5 adds the fourth: the send-terminal ingress).
    expect(productionMatching(/\.observe\(/)).toEqual([
      DECISION_PRODUCER,
      EXECUTION_PRODUCER,
      TERMINAL_PRODUCER,
      SEND_PRODUCER,
    ])
    for (const producer of [DECISION_PRODUCER, EXECUTION_PRODUCER, TERMINAL_PRODUCER, SEND_PRODUCER]) {
      const source = stripComments(readFileSync(new URL(producer, REPO_ROOT), 'utf-8'))
      // Type-only coupling + exactly one bare trigger statement.
      // The producers know the CONTRACT type only - never the diagnostic entry
      // of 8.0D-10B-4D2A, never the factory, never a logger.
      expect(source, producer).toContain(`import type { LiaBrainCorrelationObserver } from './brain-correlation-observer'`)
      expect(source, producer).not.toMatch(/LiaBrainDiagnosticEntry|log\?:|\(entry\)/)
      expect(source.match(/correlationObserver\.\w+/g), producer).toEqual(['correlationObserver.observe'])
      expect(source, producer).not.toMatch(/createLiaBrainCorrelationObserver|brain-correlation-reader|LIA_BRAIN_ENGINE_PROVIDER_MAPPING|brain-expected-route|brain-execution-identity-facts/)
    }

    // The correlation service, the read adapter and every renderer layer stay
    // entirely observer-blind - and the entry itself only composes it.
    for (const relative of [
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-reader.ts',
      'apps/stage-tamagotchi/src/renderer/main.ts',
      'apps/stage-tamagotchi/src/renderer/services/lia/brain-shadow.ts',
      'apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue',
    ]) {
      expect(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8')), relative)
        .not
        .toMatch(/brain-correlation-observer|createLiaBrainCorrelationObserver|\.observe\(/)
    }

    // The owner performs composition only: the factory call, the dependency
    // declaration and the boot materialization - never a read, a fact or an
    // observation.
    const entry = stripComments(readFileSync(new URL('apps/stage-tamagotchi/src/main/index.ts', REPO_ROOT), 'utf-8'))
    expect(entry).toContain(`import { createLiaBrainCorrelationObserver } from './services/lia/brain-correlation-observer'`)
    expect(entry.match(/createLiaBrainCorrelationObserver\(/g)).toHaveLength(1)
    expect(entry).toContain('const liaBrainCorrelationObserver = injeca.provide(\'services:lia-brain-correlation-observer\', {')
    // (whitespace is normalized first so these stay literal shape checks -
    // no line-break regex gymnastics, no backtracking)
    const entryCode = entry.replace(/\s+/g, ' ')
    // The provider still receives the canonical correlation reader; since
    // 8.0D-10B-4D2B it also hands over the BUILD-SELECTED log callback.
    expect(entryCode).toContain('dependsOn: { liaBrainCorrelation }, build: ({ dependsOn }) => createLiaBrainCorrelationObserver({ correlationReader: dependsOn.liaBrainCorrelation, log: selectLiaBrainDiagnosticLog(import.meta.env.DEV), })')
    expect(entryCode).toContain('dependsOn: { liaBrainCorrelationObserver }, callback: (deps) => { void deps.liaBrainCorrelationObserver')
    // The entry OWNS the observer but never TRIGGERS it: no observe call, no
    // fact naming, no mapping and no snapshot read.
    expect(entry).not.toMatch(/\.observe\(|LIA_BRAIN_ENGINE_PROVIDER_MAPPING|readLiaBrainExecutionIdentityFacts|providerIdentityEqual|modelIdentityEqual/)
    expect(entry).not.toMatch(/recordDecision|recordExecution|\w*[Cc]orrelation\w*\.(?:get\(|size\b)/)

    // All FOUR producers receive the SAME lifecycle handle - four injections,
    // one observer, no second instance anywhere in the composition.
    expect(entryCode).toContain('correlationObserver: deps.liaBrainCorrelationObserver,')
    expect(entry.match(/correlationObserver: deps\.liaBrainCorrelationObserver/g)).toHaveLength(4)
  })

  it('k/l/m/n/o/p/q: the lifecycle provider owns ONE observer instance per container', async () => {
    resetProbes()
    const first = await createTestContainer().resolved()
    const second = await createTestContainer().resolved()

    // K: exactly one canonical provider id owns the observer, and the container
    // declares exactly the two providers the composition entry declares.
    expect(first.providerIds).toEqual([
      'services:lia-brain-correlation',
      'services:lia-brain-correlation-observer',
    ])

    // L: the factory received the container's OWN canonical correlation
    // instance - the very same object the lifecycle owns, not a copy, not a
    // wrapper and not a second store.
    expect(first.observedReaders).toHaveLength(1)
    expect(first.observedReaders[0]).toBe(first.correlation)

    // M/N: exactly one build per container, and repeated resolution returns the
    // very same observer object.
    expect(first.builds).toHaveLength(1)
    const again = await first.resolveAgain()
    expect(again.observer).toBe(first.observer)
    expect(again.correlation).toBe(first.correlation)

    // O: a separate container receives a different observer instance - there is
    // no module-global singleton and no shared registry.
    expect(second.observer).not.toBe(first.observer)
    expect(second.correlation).not.toBe(first.correlation)

    // P/Q: materialization/boot reads nothing, records nothing and emits
    // nothing - the correlation memory stays untouched and empty.
    expect(first.delegations).toEqual([])
    expect(first.builds).toHaveLength(1)
    expect(first.correlation.size).toBe(0)
    expect(first.correlation.get('X')).toBeUndefined()
    expect(probes.composition.calls).toEqual([])
    expect(probes.mapping.received).toEqual([])

    // The wiring is real: content recorded through the container's correlation
    // instance is what an observation of the same container sees.
    first.correlation.recordDecision('X', productionDecision())
    expect(first.observer.observe('X')).toBeUndefined()
    expect(probes.composition.calls).toEqual(['X'])
    expect(probes.mapping.received).toEqual([GROQ_ENGINE_ID])
  })
})

/**
 * Phase 8.0D-10B-4D2A: the structured diagnostic log seam.
 *
 * The observer may now hand the EXACT facts it just read to an injected
 * callback - and nothing else changes: the read is still unconditional, the
 * facts are still never interpreted, every factual state travels unfiltered,
 * and production still supplies no callback at all.
 */

/** A recording log callback, plus the composition count observed AT each call. */
function recordingLog() {
  const entries: LiaBrainDiagnosticEntry[] = []
  const readsAtLogTime: number[] = []
  return {
    entries,
    // Compose BEFORE forward: at the moment the callback runs, the ONE
    // composition delegation has already happened (and happened exactly once).
    log: (entry: LiaBrainDiagnosticEntry) => {
      readsAtLogTime.push(probes.composition.calls.length)
      entries.push(entry)
    },
    readsAtLogTime,
  }
}

/** The snapshot that yields each factual state, over one shared key. */
const STATE_SNAPSHOTS = {
  correlationNotObserved: undefined,
  decisionNotObserved: { executions: [attempt()] },
  noBrainRouteSelected: { decision: manual({ status: 'noPreference' }), executions: [attempt()] },
  engineMappingMissing: {
    decision: manual({ engine: engine({ id: 'mystery-engine' }), model: model({ engineId: 'mystery-engine', id: 'mystery-model' }), status: 'resolvedModel' }),
    executions: [attempt()],
  },
  noExecutionObserved: { decision: productionDecision(), executions: [] },
  attemptIdentityFacts: { decision: productionDecision(), executions: [attempt()] },
} satisfies Record<string, LiaBrainExecutionIdentitySnapshot | undefined>

describe('correlation observer - structured diagnostic log seam (Phase 8.0D-10B-4D2A)', () => {
  it('a/b/c/d/e: without a callback the observation is exactly what it was, and the read still runs', async () => {
    resetProbes()
    const { calls, reader } = recordingReader({ X: STATE_SNAPSHOTS.attemptIdentityFacts })
    const observer = await loadObserver(reader)

    // A: the factory is valid with only the reader - the production shape.
    expect(observer).toBeTypeOf('object')
    // B: the public contract is still exactly one method.
    expect(Object.keys(observer)).toEqual(['observe'])
    expect(observer.observe).toBeTypeOf('function')
    // C: observing returns nothing.
    expect(observer.observe('X')).toBeUndefined()
    // D: the read still runs - unconditionally, exactly once.
    expect(probes.composition.calls).toEqual(['X'])
    expect(calls).toEqual(['X'])
    // E: the opaque key reaches the reader verbatim.
    expect(probes.mapping.received).toEqual([GROQ_ENGINE_ID])
  })

  it('f/g/h/i/j/k: the entry is the composed value plus the key, forwarded by reference', async () => {
    resetProbes()
    const { reader } = recordingReader({ 'logical-send-X': STATE_SNAPSHOTS.decisionNotObserved })
    const recorded = recordingLog()
    const observer = await loadObserver(reader, recorded.log)

    observer.observe('logical-send-X')

    // F: one observation -> exactly one entry.
    expect(recorded.entries).toHaveLength(1)
    const entry = recorded.entries[0]!
    // G: exactly the approved top-level fields - the opaque key plus the three
    // composed members. No timestamp, no sequence number, no environment or
    // window id, no provider/model/status duplicate, no raw snapshot, no
    // terminal record and no derived verdict.
    expect(Object.keys(entry).sort()).toEqual(['correlationId', 'facts', 'sendTerminalFacts', 'terminalFacts'])
    // H: the caller's key is forwarded verbatim, never trimmed or rewritten.
    expect(entry.correlationId).toBe('logical-send-X')
    // I: the entry carries the EXACT members the composition produced - the seam
    // recorded that value, and ALL THREE members are the same references. Not a
    // clone, not a re-derivation, not an edited copy.
    expect(probes.composition.returned).toHaveLength(1)
    const composed = composedPresent()
    expect(entry.facts).toBe(composed.facts)
    expect('terminalFacts' in entry && entry.terminalFacts).toBe(composed.terminalFacts)
    expect('sendTerminalFacts' in entry && entry.sendTerminalFacts).toBe(composed.sendTerminalFacts)
    expect(entry.facts.status).toBe('decisionNotObserved')
    // J: no time of any kind was added by this module.
    expect(entry).not.toHaveProperty('timestamp')
    expect(entry).not.toHaveProperty('time')
    expect(entry).not.toHaveProperty('at')
    // K: no duplicated fact at the top level.
    for (const duplicated of ['status', 'expected', 'attempts', 'providerId', 'modelId', 'engineId', 'roundId', 'providerIdentityEqual', 'modelIdentityEqual'])
      expect(entry).not.toHaveProperty(duplicated)
  })

  it('k2: the absent composed value reaches the callback as exactly two keys, with NO terminal member', async () => {
    resetProbes()
    const { reader } = recordingReader({})
    const recorded = recordingLog()
    const observer = await loadObserver(reader, recorded.log)

    observer.observe('logical-send-absent')

    expect(recorded.entries).toHaveLength(1)
    const entry = recorded.entries[0]!
    // The absence state is the whole answer: the key plus the absent facts, and
    // no terminal member - zero is never fabricated for a key with no snapshot.
    expect(Object.keys(entry).sort()).toEqual(['correlationId', 'facts'])
    expect('terminalFacts' in entry).toBe(false)
    expect('sendTerminalFacts' in entry).toBe(false)
    expect(entry.facts).toEqual({ status: 'correlationNotObserved' })
    expect(probes.composition.returned[0]).toEqual({ facts: { status: 'correlationNotObserved' } })
  })

  it('l/m/n/o/p/q: every factual state is forwarded - one entry each, unfiltered', async () => {
    for (const [status, snapshot] of Object.entries(STATE_SNAPSHOTS)) {
      resetProbes()
      const { reader } = recordingReader({ X: snapshot })
      const recorded = recordingLog()
      const observer = await loadObserver(reader, recorded.log)

      observer.observe('X')

      // Exactly one entry for this state - no status filtering, no suppression.
      expect(recorded.entries, status).toHaveLength(1)
      expect(recorded.entries[0]!.correlationId, status).toBe('X')
      // The state that travels is the state the facts layer produced, unedited.
      expect(recorded.entries[0]!.facts.status, status).toBe(status)
    }
  })

  it('r/s/t: the read precedes the callback, and duplicates are never deduped', async () => {
    resetProbes()
    const { reader } = recordingReader({ X: STATE_SNAPSHOTS.attemptIdentityFacts })
    const recorded = recordingLog()
    const observer = await loadObserver(reader, recorded.log)

    observer.observe('X')
    // R: the callback ran only after the read had already happened once.
    expect(recorded.readsAtLogTime).toEqual([1])
    expect(probes.composition.calls).toEqual(['X'])

    observer.observe('X')
    // S: two observations -> two reads -> two entries.
    expect(probes.composition.calls).toEqual(['X', 'X'])
    expect(recorded.entries).toHaveLength(2)
    // T: identical facts are NOT deduplicated - both entries are kept, and both
    // carry their own freshly read value.
    expect(recorded.entries[0]!.facts).toEqual(recorded.entries[1]!.facts)
    expect(recorded.entries[0]!.facts).toBe(composedPresent(0).facts)
    expect(recorded.entries[1]!.facts).toBe(composedPresent(1).facts)
    expect(recorded.entries[0]!.facts).not.toBe(recorded.entries[1]!.facts)
    expect('terminalFacts' in recorded.entries[0]! && recorded.entries[0]!.terminalFacts).toBe(composedPresent(0).terminalFacts)
    expect('terminalFacts' in recorded.entries[1]! && recorded.entries[1]!.terminalFacts).toBe(composedPresent(1).terminalFacts)
  })

  it('u/v/w: a composition that throws is never forwarded, and nothing is retried', async () => {
    // U: the composition itself throws (an injected read/storage defect).
    resetProbes()
    const { reader } = recordingReader({ X: STATE_SNAPSHOTS.attemptIdentityFacts })
    const recorded = recordingLog()
    const observer = await loadObserver(reader, recorded.log)
    probes.composition.error = new Error('storage exploded')

    expect(observer.observe('X')).toBeUndefined()
    expect(recorded.entries).toEqual([])
    // W: exactly ONE read attempt - no retry, no second read.
    expect(probes.composition.calls).toEqual(['X'])

    // V: the mapping/derive layer throws instead - same isolation.
    resetProbes()
    const second = recordingLog()
    const observer2 = await loadObserver(recordingReader({ X: STATE_SNAPSHOTS.attemptIdentityFacts }).reader, second.log)
    probes.mapping.throwOn = GROQ_ENGINE_ID

    expect(observer2.observe('X')).toBeUndefined()
    expect(second.entries).toEqual([])
    expect(probes.composition.calls).toEqual(['X'])
  })

  it('x/y/z/aa/ab: a hostile callback cannot escape, and it is called exactly once', async () => {
    resetProbes()
    const { reader } = recordingReader({ X: STATE_SNAPSHOTS.attemptIdentityFacts })
    const attempted: string[] = []
    const hostile = (entry: LiaBrainDiagnosticEntry) => {
      attempted.push(entry.correlationId)
      throw new Error('hostile log destination')
    }
    const observer = await loadObserver(reader, hostile)

    // Y: the exception never escapes the observation.
    expect(() => observer.observe('X')).not.toThrow()
    // X/AA: the callback was attempted exactly once...
    expect(attempted).toEqual(['X'])
    // ...and AB: there was no retry, no second callback and no second read.
    expect(attempted).toHaveLength(1)
    expect(probes.composition.calls).toEqual(['X'])

    // The observer remains usable after a hostile destination failed.
    expect(() => observer.observe('X')).not.toThrow()
    expect(attempted).toEqual(['X', 'X'])
    expect(probes.composition.calls).toEqual(['X', 'X'])
  })

  it('shape: the serialized present entry carries the approved fields and no hostile extra', async () => {
    resetProbes()
    const { reader } = recordingReader({ X: STATE_SNAPSHOTS.attemptIdentityFacts })
    const recorded = recordingLog()
    const observer = await loadObserver(reader, recorded.log)

    observer.observe('X')

    const serialized = JSON.stringify(recorded.entries[0]!)
    // The observer adds no data beyond the key and the facts: no prompt, no
    // message, no attachment, no tool argument, no credential, no API key, no
    // baseURL, no provider config and no chat payload has any path into it.
    // (Sanitizing arbitrary content INSIDE a trusted fact value is not this
    // module's job - transport sanitization stays upstream.)
    for (const forbidden of ['prompt', 'messages', 'attachments', 'tools', 'apiKey', 'secret', 'baseURL', 'chatProvider', 'credentials', 'conversationId', 'executionTerminals', 'snapshot', 'createdAt'])
      expect(serialized, forbidden).not.toContain(forbidden)
    // And the only keys are the approved four.
    expect(Object.keys(JSON.parse(serialized))).toEqual(['correlationId', 'facts', 'terminalFacts', 'sendTerminalFacts'])
    // The counts are the only terminal data, and they carry no record.
    expect(Object.keys(JSON.parse(serialized).terminalFacts).sort()).toEqual([
      'abandonedTerminalObservationCount',
      'failedTerminalObservationCount',
      'succeededTerminalObservationCount',
    ])
  })

  it('shape-absent: the serialized absent entry keeps its two keys and no terminal member', async () => {
    resetProbes()
    const { reader } = recordingReader({})
    const recorded = recordingLog()
    const observer = await loadObserver(reader, recorded.log)

    observer.observe('absent')

    const serialized = JSON.stringify(recorded.entries[0]!)
    expect(Object.keys(JSON.parse(serialized))).toEqual(['correlationId', 'facts'])
    expect(serialized).not.toContain('terminal')
  })

  it('the composition supplies only the BUILD-SELECTED callback - the reader plus one dev-gated sink', () => {
    // Phase 8.0D-10B-4D2B: the entry passes exactly the reader and the callback
    // the build-mode selector returned - no literal function, no logger, no
    // environment knowledge beyond the single selector argument.
    const entry = stripComments(readFileSync(new URL('apps/stage-tamagotchi/src/main/index.ts', REPO_ROOT), 'utf-8'))
    const entryCode = entry.replace(/\s+/g, ' ')
    expect(entryCode).toContain('createLiaBrainCorrelationObserver({ correlationReader: dependsOn.liaBrainCorrelation, log: selectLiaBrainDiagnosticLog(import.meta.env.DEV), })')
    // The entry never names the adapter's logger, never formats a line and
    // never inspects facts: it hands over the gate decision and nothing else.
    expect(entry).not.toMatch(/useLogg\('lia:brain'|\[LIA-BRAIN-DIAG\]|formatLiaBrainDiagnosticEntry|LiaBrainDiagnosticEntry/)
    expect(entry).not.toMatch(/\bfacts\b|\bstatus\b|\battempts\b|\bproviderId\b|\bmodelId\b|\bengineId\b/)
    // Exactly ONE factory call site in production, and it is the entry's.
    expect(productionMatching(/(?<!function )createLiaBrainCorrelationObserver\(/)).toEqual([
      'apps/stage-tamagotchi/src/main/index.ts',
    ])
    // Exactly TWO production modules name the diagnostic entry: this module
    // (which defines it) and the narrow log adapter (which consumes it).
    expect(productionMatching(/LiaBrainDiagnosticEntry/)).toEqual([
      OBSERVER,
      DIAGNOSTIC_LOG,
    ])
  })
})

/**
 * Phase 8.0D-10B-4D4C3A-F: the boundary correction that keeps RAW terminal
 * records out of the diagnostic facts - evolved by Phase 8.0D-10B-4D4C3B2-B2,
 * where the COMPOSED counts, and only they, reach the structured entry.
 *
 * The reader's SNAPSHOT contract may carry the terminal records a canonical
 * correlation entry stores; the composition counts them without exposing them,
 * so nothing terminal beyond the three counts can reach the structured entry or
 * the log line. These proofs drive the REAL store through the REAL observer (the
 * module double above delegates to the real implementation).
 */
describe('correlation observer - terminals reach the entry as counts only (Phase 8.0D-10B-4D4C3B2-B2)', () => {
  type Terminals = readonly { outcome: 'succeeded' | 'failed' | 'abandoned', roundId: string }[]

  const ZERO_TERMINALS: LiaBrainTerminalObservationFacts = {
    abandonedTerminalObservationCount: 0,
    failedTerminalObservationCount: 0,
    succeededTerminalObservationCount: 0,
  }

  /** The real store: real decision, one real execution report, plus terminals. */
  function storeWithTerminals(terminals: Terminals) {
    const store = createLiaBrainCorrelationStore({ maxEntries: 8, now: () => 1_000, ttlMs: 900_000 })
    store.recordDecision('X', productionDecision())
    store.recordExecution({ conversationId: 'conversation-1', correlationId: 'X', modelId: GROQ_MODEL_ID, providerId: GROQ_ENGINE_ID, roundId: 'R' })
    for (const terminal of terminals)
      store.recordExecutionTerminal({ correlationId: 'X', ...terminal })
    return store
  }

  /** One observation over that store, through the real observer and its entry. */
  async function observe(terminals: Terminals) {
    resetProbes()
    const store = storeWithTerminals(terminals)
    const recorded = recordingLog()
    const observer = await loadObserver(store, recorded.log)
    observer.observe('X')
    return { entry: recorded.entries[0]!, store }
  }

  it('bz: the entry carries the composed counts and NO raw terminal record', async () => {
    const { entry, store } = await observe([{ outcome: 'succeeded', roundId: 'R' }])

    // The structured entry is exactly the composed shape: the opaque key, the
    // identity facts, the three counts and the send sibling.
    expect(Object.keys(entry).sort()).toEqual(['correlationId', 'facts', 'sendTerminalFacts', 'terminalFacts'])
    // The forwarded identity facts neither declare nor carry a terminal collection.
    expect('executionTerminals' in entry.facts).toBe(false)
    expect('outcome' in entry.facts).toBe(false)
    // The counts are the ONLY terminal data in the entry, and they are the three
    // approved fields - no record, no round key, no outcome array.
    const present = presentEntry(entry)
    expect(present.terminalFacts).toEqual({ ...ZERO_TERMINALS, succeededTerminalObservationCount: 1 })
    expect(Object.keys(present.terminalFacts).sort()).toEqual([
      'abandonedTerminalObservationCount',
      'failedTerminalObservationCount',
      'succeededTerminalObservationCount',
    ])
    const serialized = JSON.stringify(present.terminalFacts)
    for (const forbidden of ['executionTerminals', 'roundId', 'outcome', 'snapshot', 'records'])
      expect(serialized, forbidden).not.toContain(forbidden)
    // The send sibling is present and empty here - a FACT about this snapshot,
    // not an absence - and no raw send record exists at the entry level.
    expect(present.sendTerminalFacts).toEqual({})
    expect(Object.keys(present.sendTerminalFacts)).toEqual([])

    // The raw record still exists at the SNAPSHOT boundary: the stop is the
    // composition, not terminal storage.
    expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'succeeded', roundId: 'R' }])
  })

  it('ca: the identity facts stay identical with and without terminal records - only the counts move', async () => {
    const withoutTerminals = await observe([])
    const withTerminals = await observe([
      { outcome: 'succeeded', roundId: 'R' },
      { outcome: 'failed', roundId: 'S' },
      { outcome: 'abandoned', roundId: 'T' },
    ])

    // The factual state is the real identity-facts answer, not a degenerate one.
    expect(withoutTerminals.entry.facts.status).toBe('attemptIdentityFacts')
    expect(Object.keys(withoutTerminals.entry.facts).sort()).toEqual(['attempts', 'expected', 'status'])
    // A terminal stream of any length changes nothing in the identity facts.
    expect(withTerminals.entry.facts).toEqual(withoutTerminals.entry.facts)
    expect(Object.keys(withTerminals.entry.facts).sort()).toEqual(['attempts', 'expected', 'status'])
    // ...and the counts are the ONLY difference between the two entries.
    expect(presentEntry(withoutTerminals.entry).terminalFacts).toEqual(ZERO_TERMINALS)
    expect(presentEntry(withTerminals.entry).terminalFacts).toEqual({
      abandonedTerminalObservationCount: 1,
      failedTerminalObservationCount: 1,
      succeededTerminalObservationCount: 1,
    })
    expect(Object.keys(withoutTerminals.entry).sort()).toEqual(Object.keys(withTerminals.entry).sort())
  })

  it('cb: the counts are the ONLY difference in the line - the identity prefix stays byte-identical', async () => {
    const withoutTerminals = await observe([])
    const withTerminals = await observe([
      { outcome: 'succeeded', roundId: 'R' },
      { outcome: 'failed', roundId: 'S' },
    ])
    const mixed = await observe([
      { outcome: 'succeeded', roundId: 'R' },
      { outcome: 'succeeded', roundId: 'S' },
      { outcome: 'failed', roundId: 'T' },
      { outcome: 'abandoned', roundId: 'U' },
    ])

    const zero = formatLiaBrainDiagnosticEntry(withoutTerminals.entry)
    const two = formatLiaBrainDiagnosticEntry(withTerminals.entry)
    const four = formatLiaBrainDiagnosticEntry(mixed.entry)

    // Phase 8.0D-10B-4D4C3B2-B4: each line now ENDS with the three approved
    // counts of ITS OWN snapshot, in the fixed order.
    expect(zero.endsWith('succeededTerminalObservationCount=0 failedTerminalObservationCount=0 abandonedTerminalObservationCount=0')).toBe(true)
    expect(two.endsWith('succeededTerminalObservationCount=1 failedTerminalObservationCount=1 abandonedTerminalObservationCount=0')).toBe(true)
    expect(four.endsWith('succeededTerminalObservationCount=2 failedTerminalObservationCount=1 abandonedTerminalObservationCount=1')).toBe(true)

    // ...and everything BEFORE them is one and the same identity line: the
    // counts are appended at the very end and move nothing else.
    const prefix = zero.slice(0, zero.indexOf('succeededTerminalObservationCount='))
    expect(two.slice(0, two.indexOf('succeededTerminalObservationCount='))).toBe(prefix)
    expect(four.slice(0, four.indexOf('succeededTerminalObservationCount='))).toBe(prefix)

    // One deterministic metadata line per entry, with no raw record in it.
    for (const line of [zero, two, four]) {
      expect(line.startsWith('[LIA-BRAIN-DIAG] ')).toBe(true)
      expect(line.split('\n')).toHaveLength(1)
      for (const forbidden of ['executionTerminals', 'outcome', 'snapshot', 'records', 'mismatch', 'orphan', 'fallback', 'winner', 'completed'])
        expect(line, forbidden).not.toContain(forbidden)
    }
  })
})

/**
 * Phase 8.0D-10B-4D4C3B2-B2: the composed entry over the REAL store, state by
 * state - an absent key, a decision-only key, an execution-only key, a
 * terminal-only key, a matched start+terminal pair, an unmatched pair and mixed
 * terminal outcomes. The observer adds nothing to what the composition derived:
 * it forwards the key plus the composed members, and the identity side is never
 * joined with the terminal side.
 */
describe('correlation observer - composed entry states (Phase 8.0D-10B-4D4C3B2-B2)', () => {
  const ZERO_TERMINALS: LiaBrainTerminalObservationFacts = {
    abandonedTerminalObservationCount: 0,
    failedTerminalObservationCount: 0,
    succeededTerminalObservationCount: 0,
  }

  function liveStore() {
    return createLiaBrainCorrelationStore({ maxEntries: 8, now: () => 1_000, ttlMs: 900_000 })
  }

  function start(store: ReturnType<typeof liveStore>, correlationId: string, roundId: string) {
    store.recordExecution({ conversationId: 'conversation-1', correlationId, modelId: GROQ_MODEL_ID, providerId: GROQ_ENGINE_ID, roundId })
  }

  function terminal(store: ReturnType<typeof liveStore>, correlationId: string, roundId: string, outcome: 'succeeded' | 'failed' | 'abandoned') {
    store.recordExecutionTerminal({ correlationId, outcome, roundId })
  }

  /** One observation over a prepared store, through the REAL observer and its entry. */
  async function entryAfter(prepare: (store: ReturnType<typeof liveStore>) => void, correlationId = 'X') {
    resetProbes()
    const store = liveStore()
    prepare(store)
    const recorded = recordingLog()
    const observer = await loadObserver(store, recorded.log)
    observer.observe(correlationId)
    return { entries: recorded.entries, entry: recorded.entries[0]!, store }
  }

  it('absent: the entry carries the key and the absence state, and no terminal member', async () => {
    const { entries, entry } = await entryAfter(() => {}, 'never-written')

    expect(entries).toHaveLength(1)
    expect(Object.keys(entry).sort()).toEqual(['correlationId', 'facts'])
    expect(entry.facts).toEqual({ status: 'correlationNotObserved' })
    expect('terminalFacts' in entry).toBe(false)
    expect(JSON.stringify(entry)).not.toContain('terminal')
  })

  it('decision-only: the current identity facts plus explicit zero counts', async () => {
    const { entry } = await entryAfter((store) => {
      store.recordDecision('X', productionDecision())
    })

    expect(Object.keys(entry).sort()).toEqual(['correlationId', 'facts', 'sendTerminalFacts', 'terminalFacts'])
    const { facts, terminalFacts, sendTerminalFacts } = presentEntry(entry)
    expect(facts.status).toBe('noExecutionObserved')
    if (facts.status !== 'noExecutionObserved')
      throw new Error('expected noExecutionObserved')
    expect(facts.attempts).toEqual([])
    expect(terminalFacts).toEqual(ZERO_TERMINALS)
    expect(sendTerminalFacts).toEqual({})
  })

  it('execution-only: the observed attempt plus zero counts, with no pending interpretation', async () => {
    const { entry } = await entryAfter((store) => {
      start(store, 'X', 'A')
    })

    const { facts, terminalFacts } = presentEntry(entry)
    expect(facts.status).toBe('decisionNotObserved')
    expect(facts.attempts.map(observation => observation.roundId)).toEqual(['A'])
    expect(terminalFacts).toEqual(ZERO_TERMINALS)
    expect(JSON.stringify(facts)).not.toMatch(/pending|incomplete|failure/i)
  })

  it('terminal-only: the current identity status plus the counted terminal, with no new status', async () => {
    const { entry } = await entryAfter((store) => {
      terminal(store, 'X', 'R', 'failed')
    })

    const { facts, terminalFacts } = presentEntry(entry)
    expect(facts).toEqual({ attempts: [], status: 'decisionNotObserved' })
    expect(terminalFacts).toEqual({ ...ZERO_TERMINALS, failedTerminalObservationCount: 1 })
  })

  it('matched: the attempt keeps its exact shape and the terminal is counted once', async () => {
    const { entry } = await entryAfter((store) => {
      start(store, 'X', 'R')
      terminal(store, 'X', 'R', 'succeeded')
    })

    const { facts, terminalFacts } = presentEntry(entry)
    expect(facts.status).toBe('decisionNotObserved')
    expect(facts.attempts).toHaveLength(1)
    expect(Object.keys(facts.attempts[0]!).sort()).toEqual(['arrivalIndex', 'modelId', 'providerId', 'roundId'])
    expect(JSON.stringify(facts)).not.toMatch(/outcome|succeeded|failed|abandoned/)
    expect(terminalFacts).toEqual({ ...ZERO_TERMINALS, succeededTerminalObservationCount: 1 })
  })

  it('unmatched: both sides stay independent - no mismatch, no orphan and no join field', async () => {
    const { entry } = await entryAfter((store) => {
      start(store, 'X', 'A')
      terminal(store, 'X', 'B', 'abandoned')
    })

    const { facts, terminalFacts } = presentEntry(entry)
    expect(facts.attempts.map(observation => observation.roundId)).toEqual(['A'])
    expect(terminalFacts).toEqual({ ...ZERO_TERMINALS, abandonedTerminalObservationCount: 1 })
    const serialized = JSON.stringify(entry)
    for (const forbidden of ['mismatch', 'orphan', 'join', 'unmatched'])
      expect(serialized, forbidden).not.toContain(forbidden)
  })

  it('send-only: the entry carries the direct settlement with zero round counts', async () => {
    for (const outcome of ['succeeded', 'failed'] as const) {
      const { entry } = await entryAfter((store) => {
        store.recordSendTerminal({ correlationId: 'X', outcome })
      })

      const { facts, terminalFacts, sendTerminalFacts } = presentEntry(entry)
      expect(facts).toEqual({ attempts: [], status: 'decisionNotObserved' })
      expect(terminalFacts).toEqual(ZERO_TERMINALS)
      expect(sendTerminalFacts).toEqual({ sendTerminalOutcome: outcome })
      expect(Object.keys(sendTerminalFacts)).toEqual(['sendTerminalOutcome'])
    }
  })

  it('round + send: the settlement reaches the entry without joining the counts', async () => {
    const { entry } = await entryAfter((store) => {
      terminal(store, 'X', 'R', 'succeeded')
      store.recordSendTerminal({ correlationId: 'X', outcome: 'failed' })
    })

    const { terminalFacts, sendTerminalFacts } = presentEntry(entry)
    expect(terminalFacts).toEqual({ ...ZERO_TERMINALS, succeededTerminalObservationCount: 1 })
    expect(sendTerminalFacts).toEqual({ sendTerminalOutcome: 'failed' })
    const serialized = JSON.stringify(entry)
    for (const forbidden of ['mismatch', 'contradiction', 'anomaly'])
      expect(serialized, forbidden).not.toContain(forbidden)
  })

  it('mixed: the counts are per outcome, with no total field', async () => {
    const { entry } = await entryAfter((store) => {
      start(store, 'X', 'R1')
      terminal(store, 'X', 'R1', 'succeeded')
      terminal(store, 'X', 'R2', 'succeeded')
      terminal(store, 'X', 'R3', 'failed')
      terminal(store, 'X', 'R4', 'abandoned')
    })

    const { facts, terminalFacts } = presentEntry(entry)
    expect(terminalFacts).toEqual({
      abandonedTerminalObservationCount: 1,
      failedTerminalObservationCount: 1,
      succeededTerminalObservationCount: 2,
    })
    expect('total' in terminalFacts).toBe(false)
    expect(facts.attempts).toHaveLength(1)
  })
})
