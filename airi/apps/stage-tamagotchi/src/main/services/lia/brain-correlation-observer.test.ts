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
import type { LiaBrainExecutionIdentitySnapshot, LiaObservedExecutionIdentity } from './brain-execution-identity-facts'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createProductionBrainAutomaticPolicy, createProductionBrainCatalog, decideBrainRoute } from '@lia/core'
import { createContainer, provide, resolve } from 'injeca'
import { describe, expect, it, vi } from 'vitest'

import { createLiaBrainCorrelationObserver } from './brain-correlation-observer'
import { createLiaBrainCorrelationService } from './brain-correlation-service'
import { createLiaBrainCorrelationStore } from './brain-correlation-store'

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
  reader: {
    calls: [] as string[],
    error: undefined as Error | undefined,
    // Phase 8.0D-10B-4D2A: the exact object the read returned, so the entry can
    // be proven to forward THAT reference (not a clone, not a rebuild).
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

vi.mock('./brain-correlation-reader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./brain-correlation-reader')>()
  return {
    ...actual,
    readLiaBrainExecutionIdentityFacts: (
      reader: LiaBrainCorrelationSnapshotReader,
      correlationId: string,
      mapping: Parameters<typeof actual.readLiaBrainExecutionIdentityFacts>[2],
    ) => {
      probes.reader.calls.push(correlationId)
      if (probes.reader.error !== undefined)
        throw probes.reader.error
      const facts = actual.readLiaBrainExecutionIdentityFacts(reader, correlationId, mapping)
      probes.reader.returned.push(facts)
      return facts
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
        get reads() {
          return probes.reader.calls
        },
        resolveAgain: () => resolve(container, { correlation: liaBrainCorrelation, observer: liaBrainCorrelationObserver }),
      }
    },
  }
}

/** Clears the probes so one test's observations cannot leak into the next. */
function resetProbes(): void {
  probes.mapping.received.length = 0
  probes.mapping.throwOn = undefined
  probes.reader.calls.length = 0
  probes.reader.error = undefined
  probes.reader.returned.length = 0
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
    expect(probes.reader.calls).toEqual([opaqueKey])
    // ...and the single snapshot read happened exactly once.
    expect(calls).toEqual([opaqueKey])
    // D: nothing trimmed, prefixed, parsed or synthesized.
    expect(calls[0]).toBe(opaqueKey)
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
    expect(probes.reader.calls).toEqual(['X', 'X'])
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
    probes.reader.error = new Error('derivation exploded')

    expect(() => observer.observe('X')).not.toThrow()
    expect(observer.observe('X')).toBeUndefined()
    // The delegation still happens once per observation: the failure is INSIDE
    // the read path, never a read-path bypass or a second code path...
    expect(probes.reader.calls).toEqual(['X', 'X'])
    // ...and nothing was retried: the injected failure aborted before the
    // adapter could reach the memory, and no attempt was made to read again.
    expect(calls).toEqual([])
  })

  it('m/n: a failure leaves the observer exactly as it was - no state, no second code path', async () => {
    resetProbes()
    const { reader } = recordingReader({ X: { executions: [attempt()] } })
    const observer = await loadObserver(reader)
    const before = Object.keys(observer)

    probes.reader.error = new Error('isolated')
    observer.observe('X')
    probes.reader.error = undefined
    observer.observe('X')

    expect(Object.keys(observer)).toEqual(before)
    expect(before).toEqual(['observe'])
    expect(probes.reader.calls).toEqual(['X', 'X'])
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
    expect(probes.reader.calls).toEqual(['X', 'Y', 'X'])
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
    expect(probes.reader.calls).toEqual(['X'])
  })

  it('v/w/x/y/z: the source may forward the factual result but never interprets it', () => {
    const source = stripComments(readSource('./brain-correlation-observer.ts'))

    // Phase 8.0D-10B-4D2A: the result is handed off by REFERENCE to the
    // optional callback - assigned to exactly one local named `facts`, which
    // never leaves the module's own entry shape.
    expect(source).toContain('const facts = readLiaBrainExecutionIdentityFacts(correlationReader, correlationId, LIA_BRAIN_ENGINE_PROVIDER_MAPPING)')
    expect(source).toContain('log?.({ correlationId, facts })')
    // Exactly ONE read call site and ONE forward call site.
    expect(source.match(/readLiaBrainExecutionIdentityFacts\(/g)).toHaveLength(1)
    expect(source.match(/log\?\.\(/g)).toHaveLength(1)
    expect(source).not.toMatch(/\bresult\b|\boutcome\b|\bsnapshot\b/)
    // V: the facts are never READ: no property access, no status inspection and
    // no state branching at all. (`facts` may only be named, never dereferenced.)
    expect(source).not.toMatch(/facts\./)
    expect(source).not.toMatch(/status/i)
    expect(source).not.toMatch(/\bif\b|\bswitch\b|\belse\b|\?\?/)
    // The ONLY optional chaining is the callback call itself - not a branch on
    // any factual value.
    expect(source.match(/\?\./g)).toHaveLength(1)
    expect(source).not.toMatch(/facts\?\.|attempts\?\.|expected\?\./)
    // W: no attempt iteration or reading.
    expect(source).not.toMatch(/attempts|\.map\(|\.filter\(|for \(/)
    // X/Y: no equality facts are read.
    expect(source).not.toMatch(/providerIdentityEqual|modelIdentityEqual/)
    // Z: nothing is destructured out of a result - the ONLY destructuring is
    // the injected dependencies (reader + optional callback).
    expect(source.match(/const \{/g)).toHaveLength(1)
    expect(source).toContain('const { correlationReader, log } = params')
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
const READER = 'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-reader.ts'
const IDENTITY_FACTS = 'apps/stage-tamagotchi/src/main/services/lia/brain-execution-identity-facts.ts'
const EXPECTED_ROUTE = 'apps/stage-tamagotchi/src/main/services/lia/brain-expected-route.ts'

function productionMatching(pattern: RegExp): string[] {
  return productionSources(BRAIN_ROOTS)
    .filter(relative => pattern.test(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
    .sort()
}

describe('correlation observer - caller allowlists and authority (Phase 8.0D-10B-4C4A)', () => {
  const source = stripComments(readSource('./brain-correlation-observer.ts'))

  it('ad: the reader has exactly ONE production caller - this observer', () => {
    expect(productionMatching(/brain-correlation-reader/)).toEqual([OBSERVER])
    expect(source).toContain(`import { readLiaBrainExecutionIdentityFacts } from './brain-correlation-reader'`)
    expect(source.match(/readLiaBrainExecutionIdentityFacts\(/g)).toHaveLength(1)
  })

  it('ae: the direct correlation read allowlist is still exactly the reader module', () => {
    expect(productionMatching(/\w*[Cc]orrelation\w*\.(?:get\(|size\b)/)).toEqual([READER])
    // The observer never touches the memory itself: no `.get(`, no size.
    expect(source).not.toMatch(/\.get\(|\.size/)
  })

  it('af: the identity-facts caller allowlist is still exactly the reader module', () => {
    expect(productionMatching(/brain-execution-identity-facts/)).toEqual([READER])
    expect(source).not.toMatch(/brain-execution-identity-facts|deriveLiaBrainExecutionIdentityFacts/)
  })

  it('ag: the expected-route FUNCTION call allowlist is still exactly the identity-facts module', () => {
    // The declaring module is excluded by the `function ` lookbehind, exactly as
    // the shipped factory guards do.
    expect(productionMatching(/(?<!function )expectedExecutionRouteForBrainDecision\(/)).toEqual([IDENTITY_FACTS])
    expect(source).not.toMatch(/expectedExecutionRouteForBrainDecision\(|selectedLiaBrainRoute/)
  })

  it('ah: the trusted mapping VALUE has exactly the intended consumers', () => {
    // Its owning module (the declaration) and this observer - nothing else.
    expect(productionMatching(/LIA_BRAIN_ENGINE_PROVIDER_MAPPING/)).toEqual([OBSERVER, EXPECTED_ROUTE])
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
    // The whole dependency surface: the read adapter's structural type + its
    // result type + function, and the trusted mapping value - nothing else.
    // (Phase 8.0D-10B-4D2A adds exactly the read result TYPE, so the diagnostic
    // entry can forward it verbatim instead of re-declaring its union.)
    expect(source.match(/^import .*$/gm)).toEqual([
      `import type { LiaBrainCorrelationReadFacts, LiaBrainCorrelationSnapshotReader } from './brain-correlation-reader'`,
      `import { readLiaBrainExecutionIdentityFacts } from './brain-correlation-reader'`,
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
  it('ai: the module references are the composition entry plus the two TYPE-ONLY producers, and the entry never observes', () => {
    // Phase 8.0D-10B-4C4B gives the observer its ONE canonical lifecycle owner;
    // Phase 8.0D-10B-4C4C adds the two producers, which know only the contract
    // TYPE and the one trigger - neither creates, resolves or constructs one.
    expect(productionMatching(/brain-correlation-observer/)).toEqual([
      'apps/stage-tamagotchi/src/main/index.ts',
      DECISION_PRODUCER,
      EXECUTION_PRODUCER,
    ])
    // A. FACTORY ownership stays exactly the composition entry (the `function `
    // lookbehind excludes the factory's own declaration, so this counts CALLs).
    expect(productionMatching(/(?<!function )createLiaBrainCorrelationObserver\(/)).toEqual([
      'apps/stage-tamagotchi/src/main/index.ts',
    ])

    // B. The observer is triggered by EXACTLY the two producers - the callers
    // that performed a successful diagnostic write first.
    expect(productionMatching(/\.observe\(/)).toEqual([
      DECISION_PRODUCER,
      EXECUTION_PRODUCER,
    ])
    for (const producer of [DECISION_PRODUCER, EXECUTION_PRODUCER]) {
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
    expect(entryCode).toContain('dependsOn: { liaBrainCorrelation }, build: ({ dependsOn }) => createLiaBrainCorrelationObserver({ correlationReader: dependsOn.liaBrainCorrelation })')
    expect(entryCode).toContain('dependsOn: { liaBrainCorrelationObserver }, callback: (deps) => { void deps.liaBrainCorrelationObserver')
    // The entry OWNS the observer but never TRIGGERS it: no observe call, no
    // fact naming, no mapping and no snapshot read.
    expect(entry).not.toMatch(/\.observe\(|LIA_BRAIN_ENGINE_PROVIDER_MAPPING|readLiaBrainExecutionIdentityFacts|providerIdentityEqual|modelIdentityEqual/)
    expect(entry).not.toMatch(/recordDecision|recordExecution|\w*[Cc]orrelation\w*\.(?:get\(|size\b)/)

    // Both producers receive the SAME lifecycle handle - two injections, one
    // observer, no second instance anywhere in the composition.
    expect(entryCode).toContain('correlationObserver: deps.liaBrainCorrelationObserver,')
    expect(entry.match(/correlationObserver: deps\.liaBrainCorrelationObserver/g)).toHaveLength(2)
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
    expect(first.reads).toEqual([])
    expect(first.builds).toHaveLength(1)
    expect(first.correlation.size).toBe(0)
    expect(first.correlation.get('X')).toBeUndefined()
    expect(probes.reader.calls).toEqual([])
    expect(probes.mapping.received).toEqual([])

    // The wiring is real: content recorded through the container's correlation
    // instance is what an observation of the same container sees.
    first.correlation.recordDecision('X', productionDecision())
    expect(first.observer.observe('X')).toBeUndefined()
    expect(probes.reader.calls).toEqual(['X'])
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

/** A recording log callback, plus the read count observed AT each call. */
function recordingLog() {
  const entries: LiaBrainDiagnosticEntry[] = []
  const readsAtLogTime: number[] = []
  return {
    entries,
    // Read BEFORE forward: at the moment the callback runs, the read has
    // already happened (and happened exactly once).
    log: (entry: LiaBrainDiagnosticEntry) => {
      readsAtLogTime.push(probes.reader.calls.length)
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
    expect(probes.reader.calls).toEqual(['X'])
    expect(calls).toEqual(['X'])
    // E: the opaque key reaches the reader verbatim.
    expect(probes.mapping.received).toEqual([GROQ_ENGINE_ID])
  })

  it('f/g/h/i/j/k: the entry is exactly { correlationId, facts } and forwards the read result by reference', async () => {
    resetProbes()
    const { reader } = recordingReader({ 'logical-send-X': STATE_SNAPSHOTS.decisionNotObserved })
    const recorded = recordingLog()
    const observer = await loadObserver(reader, recorded.log)

    observer.observe('logical-send-X')

    // F: one observation -> exactly one entry.
    expect(recorded.entries).toHaveLength(1)
    const entry = recorded.entries[0]!
    // G: exactly the two approved top-level fields - no timestamp, no sequence
    // number, no environment or window id, no provider/model/status duplicate,
    // no derived verdict.
    expect(Object.keys(entry).sort()).toEqual(['correlationId', 'facts'])
    // H: the caller's key is forwarded verbatim, never trimmed or rewritten.
    expect(entry.correlationId).toBe('logical-send-X')
    // I: the entry carries the EXACT object the read produced - the seam
    // recorded that reference, and it is the same one the entry holds. Not a
    // clone, not a re-derivation, not an edited copy.
    expect(probes.reader.returned).toHaveLength(1)
    expect(entry.facts).toBe(probes.reader.returned[0])
    expect(entry.facts.status).toBe('decisionNotObserved')
    // J: no time of any kind was added by this module.
    expect(entry).not.toHaveProperty('timestamp')
    expect(entry).not.toHaveProperty('time')
    expect(entry).not.toHaveProperty('at')
    // K: no duplicated fact at the top level.
    for (const duplicated of ['status', 'expected', 'attempts', 'providerId', 'modelId', 'engineId', 'roundId', 'providerIdentityEqual', 'modelIdentityEqual'])
      expect(entry).not.toHaveProperty(duplicated)
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
    expect(probes.reader.calls).toEqual(['X'])

    observer.observe('X')
    // S: two observations -> two reads -> two entries.
    expect(probes.reader.calls).toEqual(['X', 'X'])
    expect(recorded.entries).toHaveLength(2)
    // T: identical facts are NOT deduplicated - both entries are kept, and both
    // carry their own freshly read value.
    expect(recorded.entries[0]!.facts).toEqual(recorded.entries[1]!.facts)
    expect(recorded.entries[0]!.facts).toBe(probes.reader.returned[0])
    expect(recorded.entries[1]!.facts).toBe(probes.reader.returned[1])
    expect(recorded.entries[0]!.facts).not.toBe(recorded.entries[1]!.facts)
  })

  it('u/v/w: a read that throws is never forwarded, and nothing is retried', async () => {
    // U: the read adapter itself throws (an injected storage defect).
    resetProbes()
    const { reader } = recordingReader({ X: STATE_SNAPSHOTS.attemptIdentityFacts })
    const recorded = recordingLog()
    const observer = await loadObserver(reader, recorded.log)
    probes.reader.error = new Error('storage exploded')

    expect(observer.observe('X')).toBeUndefined()
    expect(recorded.entries).toEqual([])
    // W: exactly ONE read attempt - no retry, no second read.
    expect(probes.reader.calls).toEqual(['X'])

    // V: the mapping/derive layer throws instead - same isolation.
    resetProbes()
    const second = recordingLog()
    const observer2 = await loadObserver(recordingReader({ X: STATE_SNAPSHOTS.attemptIdentityFacts }).reader, second.log)
    probes.mapping.throwOn = GROQ_ENGINE_ID

    expect(observer2.observe('X')).toBeUndefined()
    expect(second.entries).toEqual([])
    expect(probes.reader.calls).toEqual(['X'])
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
    expect(probes.reader.calls).toEqual(['X'])

    // The observer remains usable after a hostile destination failed.
    expect(() => observer.observe('X')).not.toThrow()
    expect(attempted).toEqual(['X', 'X'])
    expect(probes.reader.calls).toEqual(['X', 'X'])
  })

  it('shape: the serialized entry carries the two approved fields and no hostile extra', async () => {
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
    for (const forbidden of ['prompt', 'messages', 'attachments', 'tools', 'apiKey', 'secret', 'baseURL', 'chatProvider', 'credentials', 'conversationId'])
      expect(serialized, forbidden).not.toContain(forbidden)
    // And the only keys are the approved two.
    expect(Object.keys(JSON.parse(serialized))).toEqual(['correlationId', 'facts'])
  })

  it('production still supplies NO callback - the composition constructs the reader-only shape', () => {
    // The exact production factory call, whitespace-normalized: the dependency
    // set is the reader alone, so nothing in production can produce output.
    const entry = stripComments(readFileSync(new URL('apps/stage-tamagotchi/src/main/index.ts', REPO_ROOT), 'utf-8'))
    const entryCode = entry.replace(/\s+/g, ' ')
    expect(entryCode).toContain('createLiaBrainCorrelationObserver({ correlationReader: dependsOn.liaBrainCorrelation })')
    expect(entry).not.toMatch(/log: |useLogg\('lia:brain/)
    // Exactly ONE factory call site in production, and it is the entry's.
    expect(productionMatching(/(?<!function )createLiaBrainCorrelationObserver\(/)).toEqual([
      'apps/stage-tamagotchi/src/main/index.ts',
    ])
    // Zero production sources name the diagnostic entry's callback seam: the
    // only module that knows it is this one.
    expect(productionMatching(/LiaBrainDiagnosticEntry/)).toEqual([OBSERVER])
  })
})
