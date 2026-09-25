import type {
  LiaBrainAutomaticSelection,
  LiaBrainCapabilities,
  LiaBrainEngineAvailability,
  LiaBrainEngineDescriptor,
  LiaBrainManualReadiness,
  LiaBrainModelDescriptor,
  LiaBrainPreferredResolution,
  LiaBrainRoutingDecision,
} from '@lia/core'

import type { LiaBrainExecutionObservationReport } from '../../../shared/eventa'
import type { LiaBrainCorrelationEntry } from './brain-correlation-store'
import type { LiaObservedExecutionIdentity } from './brain-execution-identity-facts'
import type { LiaBrainEngineProviderMapping } from './brain-expected-route'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createProductionBrainAutomaticPolicy, createProductionBrainCatalog, decideBrainRoute } from '@lia/core'
import { describe, expect, it } from 'vitest'

import { deriveLiaBrainExecutionIdentityFacts } from './brain-execution-identity-facts'
import { LIA_BRAIN_ENGINE_PROVIDER_MAPPING } from './brain-expected-route'

/**
 * Phase 8.0D-10B-4C2B: the focused proof of the pure per-attempt execution
 * identity facts.
 *
 * What is proven is FACTUAL only: which identity a trusted decision expects,
 * and whether each observed attempt's own provider/model strings equal it.
 * No attempt is ever reduced to a single verdict, no aggregate fact is
 * derived, and nothing here reads a correlation store.
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

function manual(resolution: LiaBrainPreferredResolution, readiness: LiaBrainManualReadiness = { status: 'ready' }): LiaBrainRoutingDecision {
  return { readiness, resolution, status: 'manual' }
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

/** The manual decision of the audited production route, from the canonical router. */
function productionManualDecision(): LiaBrainRoutingDecision {
  const catalog = createProductionBrainCatalog()
  return decideBrainRoute({
    engines: catalog.engines,
    models: catalog.models,
    mode: 'manual',
    preferredEngineId: GROQ_ENGINE_ID,
    preferredModelId: GROQ_MODEL_ID,
    requirement: REQUIREMENT,
  })
}

function attempt(overrides: Partial<LiaObservedExecutionIdentity> = {}): LiaObservedExecutionIdentity {
  return { modelId: GROQ_MODEL_ID, providerId: GROQ_ENGINE_ID, roundId: 'A', ...overrides }
}

function snapshot(decision: LiaBrainRoutingDecision | undefined, executions: LiaObservedExecutionIdentity[]) {
  return { decision, executions }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value))
      deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

/** A custom-domain mapping: the Brain engine id is NOT the Stage provider id. */
function customDomainMappingForGroq(): LiaBrainEngineProviderMapping {
  return { providerIdForEngine: (engineId: string) => (engineId === GROQ_ENGINE_ID ? GROQ_ENGINE_ID : undefined) }
}

function customDomainMapping(): LiaBrainEngineProviderMapping {
  return {
    providerIdForEngine: (engineId: string) => (engineId === 'brain-engine' ? 'stage-provider' : undefined),
  }
}

/** A custom-domain decision: engine 'brain-engine' + model 'brain-model-x'. */
function customDomainDecision(): LiaBrainRoutingDecision {
  return manual({
    engine: engine({ id: 'brain-engine' }),
    model: model({ engineId: 'brain-engine', id: 'brain-model-x' }),
    status: 'resolvedModel',
  })
}

describe('execution identity facts - expectation states (Phase 8.0D-10B-4C2B)', () => {
  it('a: a missing decision preserves the observed attempts and expects nothing', () => {
    const outcome = deriveLiaBrainExecutionIdentityFacts(
      snapshot(undefined, [attempt(), attempt({ roundId: 'B', providerId: 'unknown' })]),
      LIA_BRAIN_ENGINE_PROVIDER_MAPPING,
    )

    expect(outcome).toEqual({
      attempts: [
        { arrivalIndex: 0, modelId: GROQ_MODEL_ID, providerId: 'groq', roundId: 'A' },
        { arrivalIndex: 1, modelId: GROQ_MODEL_ID, providerId: 'unknown', roundId: 'B' },
      ],
      status: 'decisionNotObserved',
    })
    // No expectation is fabricated, and no equality fact is derived.
    expect(outcome).not.toHaveProperty('expected')
    expect(JSON.stringify(outcome)).not.toMatch(/IdentityEqual/)
  })

  it('b: a decision without a selected route is factual, and observed executions stay preserved', () => {
    const routeLess: LiaBrainRoutingDecision[] = [
      { status: 'disabled' },
      { status: 'modeUnspecified' },
      { status: 'automaticPolicyMissing' },
      automatic({ status: 'noCandidates' }),
      automatic({ status: 'noPolicyMatch' }),
      automatic({ ref: { engineId: GROQ_ENGINE_ID, modelId: GROQ_MODEL_ID }, status: 'ambiguous' }),
      manual({ status: 'noPreference' }),
      manual({ engine: engine(), status: 'resolvedEngine' }),
      manual({ engine: engine(), model: model(), status: 'modelEngineMismatch' }),
    ]

    for (const decision of routeLess) {
      const observed = [attempt(), attempt({ roundId: 'B' })]
      const outcome = deriveLiaBrainExecutionIdentityFacts(snapshot(decision, observed), LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
      expect(outcome, JSON.stringify(decision)).toEqual({
        attempts: [
          { arrivalIndex: 0, modelId: GROQ_MODEL_ID, providerId: 'groq', roundId: 'A' },
          { arrivalIndex: 1, modelId: GROQ_MODEL_ID, providerId: 'groq', roundId: 'B' },
        ],
        status: 'noBrainRouteSelected',
      })
    }

    // An execution having happened is NOT an error state - and the same holds
    // when nothing was executed at all.
    expect(deriveLiaBrainExecutionIdentityFacts(snapshot({ status: 'disabled' }, []), LIA_BRAIN_ENGINE_PROVIDER_MAPPING))
      .toEqual({ attempts: [], status: 'noBrainRouteSelected' })
  })

  it('c: a selected route whose engine is unmapped preserves the route ids and the attempts', () => {
    const decision = manual({
      engine: engine({ id: 'unmapped-brain-engine' }),
      model: model({ engineId: 'unmapped-brain-engine', id: 'unmapped-model' }),
      status: 'resolvedModel',
    })

    expect(() => deriveLiaBrainExecutionIdentityFacts(snapshot(decision, [attempt()]), LIA_BRAIN_ENGINE_PROVIDER_MAPPING))
      .not
      .toThrow()
    expect(deriveLiaBrainExecutionIdentityFacts(snapshot(decision, [attempt()]), LIA_BRAIN_ENGINE_PROVIDER_MAPPING)).toEqual({
      attempts: [{ arrivalIndex: 0, modelId: GROQ_MODEL_ID, providerId: 'groq', roundId: 'A' }],
      engineId: 'unmapped-brain-engine',
      modelId: 'unmapped-model',
      status: 'engineMappingMissing',
    })
  })

  it('d: an expected route with no observed attempt is factual - no timeout or failure is inferred', () => {
    const outcome = deriveLiaBrainExecutionIdentityFacts(snapshot(productionAutomaticDecision(), []), LIA_BRAIN_ENGINE_PROVIDER_MAPPING)

    expect(outcome).toEqual({ attempts: [], expected: GROQ_EXPECTED, status: 'noExecutionObserved' })
    expect(outcome.attempts).toHaveLength(0)
  })
})

describe('execution identity facts - per-attempt equality (Phase 8.0D-10B-4C2B)', () => {
  it('e/f/g/h: the four provider/model combinations stay two independent facts, per attempt', () => {
    const decision = productionAutomaticDecision()
    const outcome = deriveLiaBrainExecutionIdentityFacts(snapshot(decision, [
      // E: exact provider + exact model.
      attempt({ roundId: 'A' }),
      // F: different provider, exact model.
      attempt({ roundId: 'B', providerId: 'anthropic' }),
      // G: exact provider, different model.
      attempt({ roundId: 'C', modelId: `${GROQ_MODEL_ID}-preview` }),
      // H: different provider + different model.
      attempt({ roundId: 'D', modelId: 'claude-x', providerId: 'anthropic' }),
    ]), LIA_BRAIN_ENGINE_PROVIDER_MAPPING)

    expect(outcome.status).toBe('attemptIdentityFacts')
    if (outcome.status !== 'attemptIdentityFacts')
      throw new Error('expected attemptIdentityFacts')

    expect(outcome.expected).toEqual(GROQ_EXPECTED)
    expect(outcome.attempts.map(({ providerIdentityEqual, modelIdentityEqual }) => [providerIdentityEqual, modelIdentityEqual]))
      .toEqual([
        [true, true],
        [false, true],
        [true, false],
        [false, false],
      ])

    // No combined boolean exists on any attempt.
    for (const fact of outcome.attempts)
      expect(Object.keys(fact).sort()).toEqual(['arrivalIndex', 'modelId', 'modelIdentityEqual', 'providerId', 'providerIdentityEqual', 'roundId'])
  })

  it('i: an observed provider of unknown is simply an observed string', () => {
    const decision = productionAutomaticDecision()
    const [unknownAttempt] = deriveLiaBrainExecutionIdentityFacts(snapshot(decision, [attempt({ providerId: 'unknown' })]), LIA_BRAIN_ENGINE_PROVIDER_MAPPING).attempts
    expect(unknownAttempt).toMatchObject({ providerId: 'unknown', providerIdentityEqual: false, modelIdentityEqual: true })

    // It is NOT special-cased: when the trusted mapping literally expects the
    // provider 'unknown', the equality fact follows the mapping.
    const expectsUnknown: LiaBrainEngineProviderMapping = { providerIdForEngine: () => 'unknown' }
    const [literalAttempt] = deriveLiaBrainExecutionIdentityFacts(snapshot(productionAutomaticDecision(), [attempt({ providerId: 'unknown' })]), expectsUnknown).attempts
    expect(literalAttempt).toMatchObject({ providerId: 'unknown', providerIdentityEqual: true })
  })

  it('j: model equality is exact-string equality, with the model preserved verbatim', () => {
    const decision = productionAutomaticDecision()
    const observed = [
      attempt({ modelId: GROQ_MODEL_ID, roundId: 'A' }),
      attempt({ modelId: `${GROQ_MODEL_ID}-preview`, roundId: 'B' }),
      attempt({ modelId: GROQ_MODEL_ID.toUpperCase(), roundId: 'C' }),
      attempt({ modelId: ` ${GROQ_MODEL_ID}`, roundId: 'D' }),
      attempt({ modelId: 'gpt-oss-120b', roundId: 'E' }),
    ]
    const outcome = deriveLiaBrainExecutionIdentityFacts(snapshot(decision, observed), LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    if (outcome.status !== 'attemptIdentityFacts')
      throw new Error('expected attemptIdentityFacts')

    expect(outcome.attempts.map(fact => fact.modelIdentityEqual)).toEqual([true, false, false, false, false])
    // The observed strings themselves are copied verbatim - no trimming, no
    // case folding, no alias, no catalog lookup.
    expect(outcome.attempts.map(fact => fact.modelId)).toEqual(observed.map(entry => entry.modelId))
    expect(outcome.expected.modelId).toBe(GROQ_MODEL_ID)
  })

  it('k: the equality facts follow the trusted mapping, never an engine-id fallback', () => {
    const decision = customDomainDecision()
    const outcome = deriveLiaBrainExecutionIdentityFacts(snapshot(decision, [
      // The Brain engine id spelled as a provider id is NOT the expectation.
      attempt({ providerId: 'brain-engine', roundId: 'A' }),
      // The mapped Stage provider id is.
      attempt({ providerId: 'stage-provider', roundId: 'B' }),
    ]), customDomainMapping())

    expect(outcome.status).toBe('attemptIdentityFacts')
    if (outcome.status !== 'attemptIdentityFacts')
      throw new Error('expected attemptIdentityFacts')

    expect(outcome.expected).toEqual({ engineId: 'brain-engine', modelId: 'brain-model-x', providerId: 'stage-provider' })
    expect(outcome.attempts.map(fact => fact.providerIdentityEqual)).toEqual([false, true])
    // The falsy case is a comparison against the mapping's answer, not a
    // repair: the engine id never silently becomes the expected provider.
    expect(outcome.expected.providerId).not.toBe(outcome.expected.engineId)
  })

  it('l/m: the automatic and the manual Groq decisions expect the same execution identity', () => {
    const automaticOutcome = deriveLiaBrainExecutionIdentityFacts(snapshot(productionAutomaticDecision(), [attempt()]), LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    const manualOutcome = deriveLiaBrainExecutionIdentityFacts(snapshot(productionManualDecision(), [attempt()]), LIA_BRAIN_ENGINE_PROVIDER_MAPPING)

    for (const outcome of [automaticOutcome, manualOutcome]) {
      expect(outcome.status).toBe('attemptIdentityFacts')
      if (outcome.status !== 'attemptIdentityFacts')
        throw new Error('expected attemptIdentityFacts')
      expect(outcome.expected).toEqual(GROQ_EXPECTED)
      expect(outcome.attempts[0]).toMatchObject({ providerIdentityEqual: true, modelIdentityEqual: true })
    }
    expect(automaticOutcome).toEqual(manualOutcome)
  })

  it('n: manual readiness variants keep their route, so the facts stay derivable', () => {
    for (const availability of ['available', 'configurationRequired', 'unavailable'] as LiaBrainEngineAvailability[]) {
      const engines = [engine({ availability })]
      const models = [model()]
      const decision = decideBrainRoute({
        engines,
        models,
        mode: 'manual',
        preferredEngineId: GROQ_ENGINE_ID,
        preferredModelId: GROQ_MODEL_ID,
        requirement: REQUIREMENT,
      })
      expect(decision.status).toBe('manual')
      if (decision.status !== 'manual')
        throw new Error('expected a manual decision')
      expect(decision.readiness.status, availability).toBe(availability === 'available' ? 'ready' : availability)
      expect(decision.resolution.status).toBe('resolvedModel')

      const outcome = deriveLiaBrainExecutionIdentityFacts(snapshot(decision, [attempt()]), LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
      expect(outcome.status, availability).toBe('attemptIdentityFacts')
      if (outcome.status !== 'attemptIdentityFacts')
        throw new Error('expected attemptIdentityFacts')
      // Readiness describes executability, not success: the expected route and
      // the observed identity facts are identical in all three states.
      expect(outcome.expected, availability).toEqual(GROQ_EXPECTED)
      expect(outcome.attempts[0], availability).toMatchObject({ providerIdentityEqual: true, modelIdentityEqual: true })
    }
  })

  it('o/p: every attempt keeps its own place, and repeated attempts stay repeated', () => {
    const decision = productionAutomaticDecision()
    const observed = [
      attempt({ roundId: 'A' }),
      attempt({ roundId: 'B', providerId: 'anthropic', modelId: 'claude-x' }),
      // P: the SAME attempt reported twice is kept twice - no dedupe by key.
      attempt({ roundId: 'A' }),
    ]
    const outcome = deriveLiaBrainExecutionIdentityFacts(snapshot(decision, observed), LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    if (outcome.status !== 'attemptIdentityFacts')
      throw new Error('expected attemptIdentityFacts')

    expect(outcome.attempts.map(fact => fact.roundId)).toEqual(['A', 'B', 'A'])
    expect(outcome.attempts.map(fact => fact.arrivalIndex)).toEqual([0, 1, 2])
    expect(outcome.attempts.map(fact => [fact.providerIdentityEqual, fact.modelIdentityEqual]))
      .toEqual([[true, true], [false, false], [true, true]])

    // The default single-attempt call reports arrivalIndex 0.
    const single = deriveLiaBrainExecutionIdentityFacts(snapshot(decision, [attempt()]), LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    if (single.status !== 'attemptIdentityFacts')
      throw new Error('expected attemptIdentityFacts')
    expect(single.attempts[0]?.arrivalIndex).toBe(0)
  })
})

describe('execution identity facts - purity and trust boundary (Phase 8.0D-10B-4C2B)', () => {
  it('q: frozen inputs are unchanged by a derivation', () => {
    const decision = deepFreeze(productionManualDecision())
    const executions = deepFreeze([attempt(), attempt({ roundId: 'B', providerId: 'unknown' })])
    const mapping = Object.freeze(customDomainMappingForGroq())
    const snapshotBefore = JSON.stringify({ decision, executions })

    deriveLiaBrainExecutionIdentityFacts({ decision, executions }, mapping)

    expect(JSON.stringify({ decision, executions })).toBe(snapshotBefore)
    expect(Object.isFrozen(mapping)).toBe(true)
    expect(executions.map(entry => entry.providerId)).toEqual(['groq', 'unknown'])
  })

  it('r/s: returned values are fresh, and mutating one cannot reach the inputs or a later result', () => {
    const decision = productionAutomaticDecision()
    const executions = [attempt(), attempt({ roundId: 'B', providerId: 'anthropic', modelId: 'claude-x' })]
    const mapping = LIA_BRAIN_ENGINE_PROVIDER_MAPPING

    const first = deriveLiaBrainExecutionIdentityFacts({ decision, executions }, mapping)
    const baseline = deriveLiaBrainExecutionIdentityFacts({ decision, executions }, mapping)
    expect(first).toEqual(baseline)

    // R: no output object is an input object.
    if (first.status !== 'attemptIdentityFacts')
      throw new Error('expected attemptIdentityFacts')
    expect(first.attempts[0]).not.toBe(executions[0])
    expect(first.expected).not.toBe(GROQ_EXPECTED)

    // Mutating the returned value reaches neither the inputs...
    first.attempts[0]!.providerId = 'mutated-in-output'
    first.attempts[0]!.providerIdentityEqual = true
    first.expected.providerId = 'mutated-in-output'
    first.attempts.push({ arrivalIndex: 99, modelId: 'injected', providerId: 'injected', roundId: 'injected' })
    expect(executions[0]!.providerId).toBe('groq')
    expect(executions).toHaveLength(2)

    // ...nor a later derivation from the same inputs (S).
    expect(deriveLiaBrainExecutionIdentityFacts({ decision, executions }, mapping)).toEqual(baseline)
    expect(baseline.attempts[0]!.providerId).toBe('groq')
  })

  it('t: the mapping is consulted only with the trusted engine id, never with an observed identity', () => {
    const received: string[] = []
    const mapping: LiaBrainEngineProviderMapping = {
      providerIdForEngine(engineId: string): string | undefined {
        received.push(engineId)
        return engineId === 'brain-engine' ? 'stage-provider' : undefined
      },
    }
    const decision = customDomainDecision()
    const executions = [
      attempt({ providerId: 'stage-provider', roundId: 'A' }),
      attempt({ providerId: 'brain-engine', roundId: 'B' }),
      attempt({ providerId: 'unknown', roundId: 'C' }),
    ]

    deriveLiaBrainExecutionIdentityFacts({ decision, executions }, mapping)

    // Exactly the decision's engine id: observed provider/model strings and the
    // mapping's own answer are never fed back into the expectation.
    expect(received).toEqual(['brain-engine'])
    expect(received).not.toContain('stage-provider')
    expect(received).not.toContain('unknown')
    expect(received).not.toContain('brain-model-x')

    // The same holds when no decision exists at all: no lookup happens.
    const untouched: string[] = []
    deriveLiaBrainExecutionIdentityFacts({ executions }, {
      providerIdForEngine(engineId: string): string | undefined {
        untouched.push(engineId)
        return undefined
      },
    })
    expect(untouched).toEqual([])
  })

  it('u: no aggregate or verdict fact exists - the attempt array is the whole evidence', () => {
    const outcome = deriveLiaBrainExecutionIdentityFacts(snapshot(productionAutomaticDecision(), [attempt()]), LIA_BRAIN_ENGINE_PROVIDER_MAPPING)

    expect(Object.keys(outcome).sort()).toEqual(['attempts', 'expected', 'status'])
    const serialized = JSON.stringify(outcome)
    for (const aggregate of ['anyAttempt', 'firstAttempt', 'finalAttempt', 'fallback', 'expectedRouteObserved', 'attemptCount', 'preferredAttempt', 'chosenAttempt', 'routeIdentityEqual', 'attemptMatches', 'winner', 'score', 'recommendation', 'timeout'])
      expect(serialized, aggregate).not.toMatch(new RegExp(aggregate, 'i'))
  })

  it('metadata-free by construction: equal content with different store metadata derives equal facts', () => {
    // The real correlation-store entry shape satisfies the minimal input as-is:
    // this assignment is only legal because the execution reports carry the
    // three identity fields, and the metadata is simply not part of the contract.
    const asSnapshot = (entry: LiaBrainCorrelationEntry) => entry
    const asObserved = (report: LiaBrainExecutionObservationReport): LiaObservedExecutionIdentity => report

    const report = (roundId: string): LiaBrainExecutionObservationReport => ({
      conversationId: 'conversation-1',
      correlationId: 'X',
      modelId: GROQ_MODEL_ID,
      providerId: GROQ_ENGINE_ID,
      roundId,
    })
    const entry = (createdAt: number): LiaBrainCorrelationEntry => ({
      correlationId: 'X',
      createdAt,
      decision: productionAutomaticDecision(),
      executions: [report('A'), report('B')],
    })

    const early = deriveLiaBrainExecutionIdentityFacts(asSnapshot(entry(1)), LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    const late = deriveLiaBrainExecutionIdentityFacts(asSnapshot(entry(999_999)), LIA_BRAIN_ENGINE_PROVIDER_MAPPING)

    expect(early).toEqual(late)
    expect(early.status).toBe('attemptIdentityFacts')
    expect(asObserved(report('A'))).toMatchObject({ modelId: GROQ_MODEL_ID, providerId: GROQ_ENGINE_ID, roundId: 'A' })
    // Neither the opaque key, the conversation id nor a timestamp appears in
    // the derived facts.
    expect(JSON.stringify(early)).not.toMatch(/correlationId|conversationId|createdAt/)
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

describe('execution identity facts - authority and isolation invariants (Phase 8.0D-10B-4C2B)', () => {
  const source = stripComments(readSource('./brain-execution-identity-facts.ts'))

  it('the module is pure: one production dependency, no transport, no runtime, no I/O', () => {
    // The whole dependency surface: the canonical decision type, the trusted
    // expected-route foundation, and nothing else.
    expect(source.match(/^import .*$/gm)).toEqual([
      `import type { LiaBrainRoutingDecision } from '@lia/core'`,
      `import type { LiaBrainEngineProviderMapping, LiaBrainExpectedRoute } from './brain-expected-route'`,
      `import { expectedExecutionRouteForBrainDecision } from './brain-expected-route'`,
    ])
    // The expectation is derived through the foundation - never duplicated here.
    expect(source).not.toMatch(/selectedLiaBrainRoute|GROQ_STAGE_CHAT_PROVIDER_ID|providerIdForEngine\s*[:=]\s*\(|'groq'|openai\/gpt-oss/)

    // No IPC/Eventa, no channel.
    expect(source).not.toMatch(/eventa|defineEventa|defineInvokeEventa|defineInvokeHandler|ipcMain|ipcRenderer|BrowserWindow|\.emit\(/)
    expect(source).not.toMatch(/eventa:(?:invoke|event):lia:brain/)

    // No Brain call, no policy, no product config write, no preference write.
    expect(source).not.toMatch(/decideBrainRoute|LiaBrainService|automaticPolicy|liaProductConfig|updateLiaProductConfig|setPreferred/)

    // No provider resolution, no provider runtime, no renderer store, no catalog.
    expect(source).not.toMatch(/getChatProviderInstance|useProviderStore|activeProvider|activeModel|providersStore|createOpenAI|defineProvider|resolveProvider|LIA_MODEL_CATALOG|createProductionBrainCatalog/)

    // No authority of any kind: no switching, fallback, retry, permission or tool access.
    expect(source).not.toMatch(/fallback|retry|permission|toolCall|switch|override/i)

    // No I/O, no timers, no ambient state, no logging, no mutation of state.
    expect(source).not.toMatch(/setInterval|setTimeout|queueMicrotask|process\.on|Date\.now|Math\.random/)
    expect(source).not.toMatch(/from ['"](?:node:)?(?:fs|net|https?|child_process|dns|dgram|timers)['/]|\bfetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage/)
    expect(source).not.toMatch(/console\.|^(?:await|process\.|globalThis\.)/m)
    expect(source).not.toMatch(/^(?:let|var) /m)
    expect(source).not.toMatch(/\.sort\(|\.filter\(/)

    // The exported surface is exactly the audited one.
    expect([...source.matchAll(/^export (?:const|function|interface|type) (\w+)/gm)].map(match => match[1])).toEqual([
      'LiaObservedExecutionIdentity',
      'LiaBrainExecutionIdentitySnapshot',
      'LiaBrainObservedAttempt',
      'LiaBrainAttemptIdentityFact',
      'LiaBrainExecutionIdentityFacts',
      'deriveLiaBrainExecutionIdentityFacts',
    ])
  })

  it('the module has no correlation-store access and no aggregate/verdict logic', () => {
    // The shipped "zero reader" invariant, re-checked against this module - it
    // reads a structural snapshot, never a store.
    expect(source).not.toMatch(/\w*[Cc]orrelation\w*\.(?:get\(|size\b)/)
    expect(source).not.toMatch(/brain-correlation-store|brain-correlation-service|correlationStore|correlationId|createLiaBrainCorrelation|LiaBrainCorrelation/)
    expect(source).not.toMatch(/recordDecision\(|recordExecution\(/)
    // No transport contract either: the observed attempt is a minimal local type.
    expect(source).not.toMatch(/LiaBrainExecutionObservationReport|ChatRequestStartedObservation|execution-observation|electronLiaBrain/)

    // No aggregate interpretation, no route-level verdict, no comparison JOIN.
    expect(source).not.toMatch(/anyAttempt|firstAttempt|finalAttempt|fallbackObserved|expectedRouteObserved|attemptCount|preferredAttempt|chosenAttempt|routeIdentityEqual|attemptMatches|mismatch|divergence|aligned|winner|score|recommendation|verdict/i)
    const comparisonPattern = /executionMatches|matchesExecution|decisionVsExecution|executionVsDecision|comparisonState|pendingComparison|compareBrain|brainVsExecution|liaBrainComparison|executionObservationMatches|brainDecisionComparison|decisionMatches|matchStatus|comparisonResult|diagnosticVerdict/i
    expect(source).not.toMatch(comparisonPattern)

    // The two equality facts are computed independently - never combined.
    expect(source).toMatch(/providerIdentityEqual: attempt\.providerId === expected\.route\.providerId/)
    expect(source).toMatch(/modelIdentityEqual: attempt\.modelId === expected\.route\.modelId/)
  })

  it('v: exactly ONE pure production-code caller - the correlation snapshot reader', () => {
    // Phase 8.0D-10B-4C3A evolved the 4C2B "zero production application callers"
    // state into an explicit allowlist of exactly one: the narrow read adapter,
    // which forwards ONE snapshot and reuses these facts. No application,
    // lifecycle, bridge, handler or renderer caller exists.
    expect(productionSources(BRAIN_ROOTS)
      .filter(relative => /brain-execution-identity-facts/.test(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
      .sort()).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-reader.ts',
    ])

    for (const relative of [
      'apps/stage-tamagotchi/src/main/index.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-decision-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-execution-report-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-service.ts',
      'apps/stage-tamagotchi/src/renderer/main.ts',
    ]) {
      expect(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8')), relative)
        .not
        .toMatch(/brain-execution-identity-facts|deriveLiaBrainExecutionIdentityFacts/)
    }
  })

  it('w: exactly one production-code caller of the expected-route foundation - this module', () => {
    expect(productionSources(BRAIN_ROOTS)
      .filter(relative => /brain-expected-route/.test(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
      .sort()).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-execution-identity-facts.ts',
    ])
    // ...and it uses the foundation's function, not a copy of its table.
    expect(source).toContain(`import { expectedExecutionRouteForBrainDecision } from './brain-expected-route'`)
    expect(source.match(/expectedExecutionRouteForBrainDecision\(/g)).toHaveLength(1)
  })

  it('x: the zero-reader invariant holds for every module except the ONE pure read adapter', () => {
    // The shipped invariant was "no production reader at all". Phase
    // 8.0D-10B-4C3A evolves it narrowly to exactly one legitimate read
    // adapter - the same pattern the shipped guards use, re-run here. This
    // module itself is still NOT a reader.
    expect(productionSources(BRAIN_ROOTS)
      .filter(relative => /\w*[Cc]orrelation\w*\.(?:get\(|size\b)/.test(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
      .sort()).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-reader.ts',
    ])
    expect(source).not.toMatch(/\w*[Cc]orrelation\w*\.(?:get\(|size\b)/)
  })
})
