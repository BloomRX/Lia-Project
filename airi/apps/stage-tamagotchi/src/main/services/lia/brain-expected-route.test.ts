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

import type { LiaBrainEngineProviderMapping } from './brain-expected-route'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createProductionBrainAutomaticPolicy, createProductionBrainCatalog, decideBrainRoute } from '@lia/core'
import { describe, expect, it } from 'vitest'

import { expectedExecutionRouteForBrainDecision, LIA_BRAIN_ENGINE_PROVIDER_MAPPING, selectedLiaBrainRoute } from './brain-expected-route'

/**
 * Phase 8.0D-10B-4C2A: the focused proof of the trusted expected-execution-route
 * mapping.
 *
 * What is proven here is FACTUAL only, in the same discipline the 4C1 audit
 * demanded: which decision shapes identify a concrete selected Brain route,
 * which Stage provider id the trusted mapping assigns, and that the expectation
 * comes from the trusted side alone. No comparison with any execution
 * observation happens here, no correlation state is touched, and no verdict,
 * score or recommendation vocabulary is used.
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

/** A custom descriptor set whose engine declares the given availability. */
function descriptorsWithAvailability(availability: LiaBrainEngineAvailability) {
  return {
    engines: [engine({ availability })],
    models: [model()],
  }
}

/** The audited production decisions, straight from the canonical router. */
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

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value))
      deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

describe('selected Brain route extraction (Phase 8.0D-10B-4C2A)', () => {
  it('a/b: the two route-bearing shapes extract their exact engine and model ids', () => {
    // A: automatic + selected.
    expect(selectedLiaBrainRoute(automatic({
      route: { engine: engine(), model: model() },
      status: 'selected',
    }))).toEqual({ engineId: 'groq', modelId: 'openai/gpt-oss-120b' })

    // B: manual + resolvedModel (the explicit, validated preference pair).
    expect(selectedLiaBrainRoute(manual({
      engine: engine(),
      model: model(),
      status: 'resolvedModel',
    }))).toEqual({ engineId: 'groq', modelId: 'openai/gpt-oss-120b' })

    // The extraction reads ids only - names, capabilities, metadata and the
    // descriptor objects themselves never leak into the result.
    const extracted = selectedLiaBrainRoute(automatic({
      route: { engine: engine({ name: 'Renamed engine' }), model: model({ name: 'Renamed model' }) },
      status: 'selected',
    }))
    expect(Object.keys(extracted!).sort()).toEqual(['engineId', 'modelId'])
  })

  it('c: every non-route automatic selection state returns undefined', () => {
    // noCandidates: nothing eligible AND ready.
    expect(selectedLiaBrainRoute(automatic({ status: 'noCandidates' }))).toBeUndefined()
    // noPolicyMatch: candidates exist that the policy does not name.
    expect(selectedLiaBrainRoute(automatic({ status: 'noPolicyMatch' }))).toBeUndefined()
    // ambiguous: names a candidate identity WITHOUT establishing it as a route.
    expect(selectedLiaBrainRoute(automatic({
      ref: { engineId: GROQ_ENGINE_ID, modelId: GROQ_MODEL_ID },
      status: 'ambiguous',
    }))).toBeUndefined()
  })

  it('d: every non-route manual resolution returns undefined, including the ones carrying engine/model fields', () => {
    expect(selectedLiaBrainRoute(manual({ status: 'noPreference' }))).toBeUndefined()

    // Engine-only resolution: a valid engine, but no model - not a route.
    expect(selectedLiaBrainRoute(manual({ engine: engine(), status: 'resolvedEngine' }))).toBeUndefined()

    expect(selectedLiaBrainRoute(manual({ preferredEngineId: GROQ_ENGINE_ID, status: 'engineNotFound' }))).toBeUndefined()

    // Ineligible engine - an engine (and, on the model path, a model) IS present.
    expect(selectedLiaBrainRoute(manual({ engine: engine(), status: 'engineIneligible' }))).toBeUndefined()
    expect(selectedLiaBrainRoute(manual({ engine: engine(), model: model(), status: 'engineIneligible' }))).toBeUndefined()

    expect(selectedLiaBrainRoute(manual({ preferredModelId: GROQ_MODEL_ID, status: 'modelNotFound' }))).toBeUndefined()
    expect(selectedLiaBrainRoute(manual({ model: model(), status: 'modelIneligible' }))).toBeUndefined()
    expect(selectedLiaBrainRoute(manual({ model: model(), status: 'modelEngineNotFound' }))).toBeUndefined()

    // A refused engine+model pair - both descriptors present, and still no route.
    expect(selectedLiaBrainRoute(manual({ engine: engine(), model: model(), status: 'modelEngineMismatch' }))).toBeUndefined()
  })

  it('e/f/g: disabled, modeUnspecified and automaticPolicyMissing return undefined', () => {
    expect(selectedLiaBrainRoute({ status: 'disabled' })).toBeUndefined()
    expect(selectedLiaBrainRoute({ status: 'modeUnspecified' })).toBeUndefined()
    expect(selectedLiaBrainRoute({ status: 'automaticPolicyMissing' })).toBeUndefined()
  })

  it('h: manual readiness never suppresses a resolvedModel route', () => {
    const resolutions: LiaBrainPreferredResolution = { engine: engine(), model: model(), status: 'resolvedModel' }
    const route = { engineId: 'groq', modelId: 'openai/gpt-oss-120b' }

    for (const readiness of [
      { status: 'ready' },
      { status: 'configurationRequired' },
      { status: 'unavailable' },
    ] satisfies LiaBrainManualReadiness[]) {
      expect(selectedLiaBrainRoute(manual(resolutions, readiness)), JSON.stringify(readiness)).toEqual(route)
    }

    // ...and the same holds when the readiness comes from the canonical router
    // itself: an engine that cannot execute NOW still has an explicit route.
    for (const availability of ['configurationRequired', 'unavailable'] as const) {
      const set = descriptorsWithAvailability(availability)
      const decision = decideBrainRoute({
        engines: set.engines,
        models: set.models,
        mode: 'manual',
        preferredEngineId: GROQ_ENGINE_ID,
        preferredModelId: GROQ_MODEL_ID,
        requirement: REQUIREMENT,
      })
      expect(decision.status).toBe('manual')
      if (decision.status !== 'manual')
        throw new Error('expected a manual decision')
      expect(decision.readiness.status, availability).toBe(availability)
      expect(decision.resolution.status).toBe('resolvedModel')
      expect(selectedLiaBrainRoute(decision), availability).toEqual(route)
    }
  })

  it('a/b via the canonical router: the audited production decisions extract the real route', () => {
    const automaticDecision = productionAutomaticDecision()
    expect(automaticDecision.status).toBe('automatic')
    expect(automaticDecision).toMatchObject({ selection: { status: 'selected' } })
    expect(selectedLiaBrainRoute(automaticDecision)).toEqual({ engineId: GROQ_ENGINE_ID, modelId: GROQ_MODEL_ID })

    const manualDecision = productionManualDecision()
    expect(manualDecision.status).toBe('manual')
    expect(manualDecision).toMatchObject({ resolution: { status: 'resolvedModel' } })
    expect(selectedLiaBrainRoute(manualDecision)).toEqual({ engineId: GROQ_ENGINE_ID, modelId: GROQ_MODEL_ID })

    // The extraction returns the route's OWN ids - no normalization, no alias.
    if (manualDecision.status !== 'manual' || manualDecision.resolution.status !== 'resolvedModel')
      throw new Error('expected a resolved manual decision')
    const extracted = selectedLiaBrainRoute(manualDecision)
    expect(extracted!.engineId).toBe(manualDecision.resolution.engine.id)
    expect(extracted!.modelId).toBe(manualDecision.resolution.model.id)
  })
})

describe('trusted Brain engine -> Stage provider mapping (Phase 8.0D-10B-4C2A)', () => {
  function stageChatProviderOptionIds(): string[] {
    const source = readFileSync(fileURLToPath(new URL('../../../renderer/stores/lia/provider.ts', import.meta.url)), 'utf-8')
    const start = source.indexOf('export const LIA_CHAT_PROVIDER_OPTIONS')
    const end = source.indexOf('export interface LiaModelOption', start)
    return [...source.slice(start, end).matchAll(/\{ id: '([^']+)'/g)].map(match => match[1]!)
  }

  it('i/k: the audited Brain engine resolves to the exact Stage provider id, deterministically', () => {
    expect(LIA_BRAIN_ENGINE_PROVIDER_MAPPING.providerIdForEngine(GROQ_ENGINE_ID)).toBe(GROQ_ENGINE_ID)
    // Determinism: no state, no ordering, no randomness - same id, same answer.
    for (let call = 0; call < 5; call += 1)
      expect(LIA_BRAIN_ENGINE_PROVIDER_MAPPING.providerIdForEngine(GROQ_ENGINE_ID)).toBe('groq')
  })

  it('j: an unknown engine reads as unmapped - never as a guess, and never as an error', () => {
    for (const unknown of ['openai', 'anthropic', 'gemini', 'ollama', 'qwen', 'deepseek', 'mistral-ai', 'xai', '', 'GROQ', 'groq ']) {
      expect(LIA_BRAIN_ENGINE_PROVIDER_MAPPING.providerIdForEngine(unknown), JSON.stringify(unknown)).toBeUndefined()
    }
    // The record is consulted with the id's exact spelling - nothing is learned
    // from a previous lookup, trimmed, lowercased or fuzzy-matched.
    expect(LIA_BRAIN_ENGINE_PROVIDER_MAPPING.providerIdForEngine('anthropic')).toBeUndefined()
    expect(LIA_BRAIN_ENGINE_PROVIDER_MAPPING.providerIdForEngine(GROQ_ENGINE_ID)).toBe('groq')
    expect(LIA_BRAIN_ENGINE_PROVIDER_MAPPING.providerIdForEngine('anthropic')).toBeUndefined()
  })

  it('l: no execution identity participates in the lookup', () => {
    const received: string[] = []
    const mapping: LiaBrainEngineProviderMapping = {
      providerIdForEngine(engineId: string): string | undefined {
        received.push(engineId)
        return engineId === 'brain-engine' ? 'stage-provider' : undefined
      },
    }

    const decision = automatic({
      route: { engine: engine({ id: 'brain-engine' }), model: model({ engineId: 'brain-engine', id: 'model-under-test' }) },
      status: 'selected',
    })
    expectedExecutionRouteForBrainDecision(decision, mapping)

    // The lookup received EXACTLY the decision's engine id: the model id, the
    // provider id and every execution-looking identity are not arguments of it.
    expect(received).toEqual(['brain-engine'])
    expect(received).not.toContain('model-under-test')
    expect(received).not.toContain('stage-provider')

    // The production mapping is a closed lookup: nothing about it can change,
    // and no caller can extend it.
    expect(Object.isFrozen(LIA_BRAIN_ENGINE_PROVIDER_MAPPING)).toBe(true)
    expect(Object.keys(LIA_BRAIN_ENGINE_PROVIDER_MAPPING)).toEqual(['providerIdForEngine'])
    const attempt = LIA_BRAIN_ENGINE_PROVIDER_MAPPING as { providerIdForEngine: (engineId: string) => string | undefined }
    expect(() => {
      attempt.providerIdForEngine = () => 'execution-supplied-provider'
    }).toThrow(TypeError)
    expect(LIA_BRAIN_ENGINE_PROVIDER_MAPPING.providerIdForEngine(GROQ_ENGINE_ID)).toBe('groq')
  })

  it('m: the production mapping covers exactly the registered production Brain engines - no speculative entries', () => {
    // The audited baseline of this build: one production engine.
    const productionEngineIds = createProductionBrainCatalog().engines.map(entry => entry.id)
    expect(productionEngineIds).toEqual(['groq'])
    for (const engineId of productionEngineIds)
      expect(LIA_BRAIN_ENGINE_PROVIDER_MAPPING.providerIdForEngine(engineId), engineId).toBeDefined()

    // Every OTHER Stage chat provider ships with no production Brain engine, so
    // none of them may appear in a mapping (the option ids are read from the
    // Stage renderer's own list - the audited source of the Stage side).
    const stageProviderIds = stageChatProviderOptionIds()
    expect(stageProviderIds).toContain(GROQ_ENGINE_ID)
    expect(stageProviderIds.length).toBeGreaterThan(5)
    for (const providerId of stageProviderIds.filter(id => id !== GROQ_ENGINE_ID))
      expect(LIA_BRAIN_ENGINE_PROVIDER_MAPPING.providerIdForEngine(providerId), providerId).toBeUndefined()
  })
})

describe('expected execution route for a Brain decision (Phase 8.0D-10B-4C2A)', () => {
  it('n: a decision with no selected Brain route expects nothing', () => {
    const routeLess: LiaBrainRoutingDecision[] = [
      { status: 'modeUnspecified' },
      { status: 'disabled' },
      { status: 'automaticPolicyMissing' },
      automatic({ status: 'noCandidates' }),
      automatic({ status: 'noPolicyMatch' }),
      automatic({ ref: { engineId: GROQ_ENGINE_ID, modelId: GROQ_MODEL_ID }, status: 'ambiguous' }),
      manual({ status: 'noPreference' }),
      manual({ engine: engine(), status: 'resolvedEngine' }),
      manual({ engine: engine(), status: 'engineIneligible' }),
      manual({ engine: engine(), model: model(), status: 'modelEngineMismatch' }),
    ]

    for (const decision of routeLess) {
      const outcome = expectedExecutionRouteForBrainDecision(decision, LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
      // No expectation is ever fabricated from an execution side - there is no
      // execution side here at all - and no route-less state throws.
      expect(outcome, JSON.stringify(decision)).toEqual({ status: 'noBrainRouteSelected' })
    }
  })

  it('o: a selected route whose engine has no mapping is reported factually', () => {
    const decision = automatic({
      route: { engine: engine({ id: 'unmapped-brain-engine' }), model: model({ engineId: 'unmapped-brain-engine', id: 'unmapped-model' }) },
      status: 'selected',
    })

    expect(() => expectedExecutionRouteForBrainDecision(decision, LIA_BRAIN_ENGINE_PROVIDER_MAPPING)).not.toThrow()
    expect(expectedExecutionRouteForBrainDecision(decision, LIA_BRAIN_ENGINE_PROVIDER_MAPPING)).toEqual({
      engineId: 'unmapped-brain-engine',
      modelId: 'unmapped-model',
      status: 'engineMappingMissing',
    })
  })

  it('p/q/r: the audited Groq routes map to the exact expected execution identity, model id verbatim', () => {
    const expected = {
      route: {
        engineId: 'groq',
        modelId: 'openai/gpt-oss-120b',
        providerId: 'groq',
      },
      status: 'expectedRoute',
    }

    // P: automatic + selected, from the canonical router.
    expect(expectedExecutionRouteForBrainDecision(productionAutomaticDecision(), LIA_BRAIN_ENGINE_PROVIDER_MAPPING)).toEqual(expected)
    // Q: manual + resolvedModel, from the canonical router.
    expect(expectedExecutionRouteForBrainDecision(productionManualDecision(), LIA_BRAIN_ENGINE_PROVIDER_MAPPING)).toEqual(expected)

    // R: the model id is the route's OWN string, preserved verbatim.
    const outcome = expectedExecutionRouteForBrainDecision(productionManualDecision(), LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
    if (outcome.status !== 'expectedRoute')
      throw new Error('expected an expectedRoute outcome')
    expect(outcome.route.modelId).toBe('openai/gpt-oss-120b')
    expect(outcome.route.modelId).toHaveLength('openai/gpt-oss-120b'.length)
    expect(typeof outcome.route.modelId).toBe('string')
  })

  it('r: a non-catalog model id survives verbatim - nothing is normalized, aliased or looked up', () => {
    const decision = manual({
      engine: engine(),
      model: model({ id: 'openai/gpt-oss-120b-preview-EXACT' }),
      status: 'resolvedModel',
    })
    expect(expectedExecutionRouteForBrainDecision(decision, LIA_BRAIN_ENGINE_PROVIDER_MAPPING)).toEqual({
      route: {
        engineId: 'groq',
        modelId: 'openai/gpt-oss-120b-preview-EXACT',
        providerId: 'groq',
      },
      status: 'expectedRoute',
    })
  })

  it('s: the expected provider comes from the mapping - never from the engine id', () => {
    const decision = automatic({
      route: { engine: engine({ id: 'brain-engine' }), model: model({ engineId: 'brain-engine' }) },
      status: 'selected',
    })
    const mapping: LiaBrainEngineProviderMapping = {
      providerIdForEngine: engineId => (engineId === 'brain-engine' ? 'stage-provider' : undefined),
    }
    expect(expectedExecutionRouteForBrainDecision(decision, mapping)).toEqual({
      route: { engineId: 'brain-engine', modelId: GROQ_MODEL_ID, providerId: 'stage-provider' },
      status: 'expectedRoute',
    })

    // Negative control: an engine whose id LOOKS like a provider id is not
    // silently treated as one - the mapping is the only source of a provider id.
    const identityLooking = automatic({
      route: { engine: engine({ id: 'stage-provider' }), model: model({ engineId: 'stage-provider' }) },
      status: 'selected',
    })
    expect(expectedExecutionRouteForBrainDecision(identityLooking, mapping)).toEqual({
      engineId: 'stage-provider',
      modelId: GROQ_MODEL_ID,
      status: 'engineMappingMissing',
    })
  })

  it('purity: inputs are never mutated, and equal inputs produce equal but fresh outcomes', () => {
    const decision = deepFreeze(manual({ engine: engine(), model: model(), status: 'resolvedModel' }))
    const before = JSON.stringify(decision)
    const mapping: LiaBrainEngineProviderMapping = Object.freeze({
      providerIdForEngine: (engineId: string) => (engineId === GROQ_ENGINE_ID ? 'groq' : undefined),
    })

    const first = expectedExecutionRouteForBrainDecision(decision, mapping)
    const second = expectedExecutionRouteForBrainDecision(decision, mapping)

    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(JSON.stringify(decision)).toBe(before)
    expect(Object.keys(mapping)).toEqual(['providerIdForEngine'])
    expect(selectedLiaBrainRoute(decision)).not.toBe(selectedLiaBrainRoute(decision))
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

describe('expected-route module - authority and purity invariants (Phase 8.0D-10B-4C2A)', () => {
  const source = stripComments(readSource('./brain-expected-route.ts'))

  it('the module is a pure id transformation: one type-only import, no transport, no runtime, no I/O', () => {
    // The ENTIRE dependency surface: one TYPE import of the canonical decision.
    expect(source.match(/^import .*$/gm)).toEqual([
      `import type { LiaBrainRoutingDecision } from '@lia/core'`,
    ])
    expect(source).not.toMatch(/from ['"]\.\.?\//)

    // No IPC/Eventa surface and no Brain channel.
    expect(source).not.toMatch(/eventa|defineEventa|defineInvokeEventa|defineInvokeHandler|ipcMain|ipcRenderer|BrowserWindow|\.emit\(/)
    expect(source).not.toMatch(/eventa:(?:invoke|event):lia:brain/)

    // No Brain call, no policy, no product config write, no preference write.
    expect(source).not.toMatch(/decideBrainRoute|LiaBrainService|automaticPolicy|createProductionBrainAutomaticPolicy|liaProductConfig|updateLiaProductConfig|setPreferred/)
    expect(source).not.toMatch(/fallback|retry|permission|winner|score|recommendation|verdict/i)

    // No provider resolution, no provider runtime, no renderer store.
    expect(source).not.toMatch(/getChatProviderInstance|useProviderStore|activeProvider|activeModel|providersStore|createOpenAI|defineProvider|resolveProvider/)

    // No correlation state and no execution observation.
    expect(source).not.toMatch(/brain-correlation-store|brain-correlation-service|createLiaBrainCorrelation|LiaBrainCorrelation|correlationStore|correlationId/)
    expect(source).not.toMatch(/recordDecision|recordExecution/)
    expect(source).not.toMatch(/LiaBrainExecutionObservationReport|ChatRequestStartedObservation|execution-observation|electronLiaBrain/)

    // No I/O, no timers, no ambient state, no mutation of the module surface.
    expect(source).not.toMatch(/setInterval|setTimeout|queueMicrotask|process\.on|Date\.now|Math\.random/)
    expect(source).not.toMatch(/from ['"](?:node:)?(?:fs|net|https?|child_process|dns|dgram|timers)['/]|\bfetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage/)
    expect(source).not.toMatch(/^(?:await|console\.|process\.|globalThis\.)/m)
    expect(source).not.toMatch(/^(?:let|var) /m)

    // The exported surface is exactly the audited one - nothing to mutate with.
    expect([...source.matchAll(/^export (?:const|function|interface|type) (\w+)/gm)].map(match => match[1])).toEqual([
      'LiaBrainSelectedRoute',
      'LiaBrainEngineProviderMapping',
      'GROQ_STAGE_CHAT_PROVIDER_ID',
      'LIA_BRAIN_ENGINE_PROVIDER_MAPPING',
      'selectedLiaBrainRoute',
      'LiaBrainExpectedRoute',
      'LiaBrainExpectedExecutionRoute',
      'expectedExecutionRouteForBrainDecision',
    ])
  })

  it('the module is neither a correlation-store reader nor a decision/execution comparator', () => {
    // The shipped "zero reader" guard, re-checked against this module.
    expect(source).not.toMatch(/\w*[Cc]orrelation\w*\.(?:get\(|size\b)/)
    // The shipped "write-only producers" guard: this module writes nothing.
    expect(source).not.toMatch(/recordDecision\(|recordExecution\(/)
    // The shipped "no comparison" guard pattern (the forbidden JOIN surface).
    const comparisonPattern = /executionMatches|matchesExecution|decisionVsExecution|executionVsDecision|comparisonState|pendingComparison|compareBrain|brainVsExecution|liaBrainComparison|executionObservationMatches|brainDecisionComparison|decisionMatches|matchStatus|comparisonResult|diagnosticVerdict/i
    expect(source).not.toMatch(comparisonPattern)
  })

  it('w: exactly ONE pure production-code caller - the per-attempt identity facts module', () => {
    // Phase 8.0D-10B-4C2B turned the 4C2A "zero callers" state into an explicit
    // allowlist of exactly one: the pure per-attempt facts transformation, which
    // derives its expectation THROUGH this foundation (never by copying its
    // route extraction, its table or its Groq identities).
    expect(productionSources(BRAIN_ROOTS)
      .filter(relative => /brain-expected-route/.test(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
      .sort()).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-execution-identity-facts.ts',
    ])

    // Explicitly: the two producers, the composition entry and the lifecycle
    // service of the correlation work do not name it either.
    for (const relative of [
      'apps/stage-tamagotchi/src/main/index.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-decision-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-execution-report-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-service.ts',
      'apps/stage-tamagotchi/src/renderer/main.ts',
    ]) {
      expect(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8')), relative)
        .not
        .toMatch(/brain-expected-route|selectedLiaBrainRoute|expectedExecutionRouteForBrainDecision|LIA_BRAIN_ENGINE_PROVIDER_MAPPING/)
    }
  })
})
