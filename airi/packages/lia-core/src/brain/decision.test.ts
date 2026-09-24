import type { LiaBrainCapabilityRequirement } from './capabilities'
import type { LiaBrainRoutingDecisionInput } from './decision'
import type { LiaBrainModelRoute } from './routes'
import type { LiaBrainAutomaticSelectionPolicy, LiaBrainRouteRef } from './selection'
import type { LiaBrainCapabilities, LiaBrainEngineDescriptor, LiaBrainModelDescriptor } from './types'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { decideBrainRoute } from './decision'
import { resolvePreferredBrainSelection } from './resolver'
import { selectBrainRouteByPolicy } from './selection'

/**
 * Phase 8.0C-3D: the unified routing decision - orchestration over the
 * canonical 8.0C layers, with no mode ever leaking into another path.
 */

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

const NONE: LiaBrainCapabilities = {
  audioInput: false,
  audioOutput: false,
  imageInput: false,
  realtime: false,
  reasoning: false,
  textInput: false,
  textOutput: false,
  toolCalling: false,
  videoInput: false,
}

function capabilities(flags: Partial<LiaBrainCapabilities>): LiaBrainCapabilities {
  return { ...NONE, ...flags }
}

const TEXT = capabilities({ textInput: true, textOutput: true })
const VISION = capabilities({ imageInput: true, textInput: true, textOutput: true })

function engine(id: string, modelIds: readonly string[], caps: LiaBrainCapabilities = TEXT): LiaBrainEngineDescriptor {
  return { availability: 'available', capabilities: caps, id, modelIds, name: `Engine ${id}` }
}

function model(id: string, engineId: string, caps: LiaBrainCapabilities = TEXT): LiaBrainModelDescriptor {
  return { capabilities: caps, engineId, id, name: `Model ${id}` }
}

function requirement(...required: LiaBrainCapabilityRequirement['required']): LiaBrainCapabilityRequirement {
  return { required }
}

function ref(engineId: string, modelId: string): LiaBrainRouteRef {
  return { engineId, modelId }
}

function policy(...routes: LiaBrainRouteRef[]): LiaBrainAutomaticSelectionPolicy {
  return { routes }
}

const NEEDS_TEXT = requirement('textInput')
const NEEDS_VISION = requirement('imageInput')

/** A policy that detonates if anyone touches its entries. */
const explodingPolicy = {
  get routes(): never {
    throw new Error('automatic policy must not be consulted on this path')
  },
} as unknown as LiaBrainAutomaticSelectionPolicy

/** Routing state that must stay untouched on a non-routing path. */
function explodingRoutingState(mode: LiaBrainRoutingDecisionInput['mode'], extra: Partial<LiaBrainRoutingDecisionInput> = {}): LiaBrainRoutingDecisionInput {
  const boom = (what: string) => () => {
    throw new Error(`${what} must not be read on this path`)
  }
  return {
    get automaticPolicy() {
      return boom('automaticPolicy')()
    },
    get engines() {
      return boom('engines')()
    },
    get mode() {
      return mode
    },
    get models() {
      return boom('models')()
    },
    get preferredEngineId() {
      return boom('preferredEngineId')()
    },
    get preferredModelId() {
      return boom('preferredModelId')()
    },
    requirement: NEEDS_TEXT,
    ...extra,
  } as unknown as LiaBrainRoutingDecisionInput
}

describe('unified brain routing decision (8.0C-3D)', () => {
  it('a: no mode -> modeUnspecified (and no routing state is even read)', () => {
    expect(decideBrainRoute({
      engines: [engine('e-alpha', ['m-alpha'])],
      models: [model('m-alpha', 'e-alpha')],
      requirement: NEEDS_TEXT,
    })).toEqual({ status: 'modeUnspecified' })

    // The non-routing path touches NOTHING else on the input.
    expect(decideBrainRoute(explodingRoutingState(undefined))).toEqual({ status: 'modeUnspecified' })
  })

  it('b: disabled -> disabled, even with valid preferences AND a valid policy present', () => {
    const decision = decideBrainRoute({
      engines: [engine('e-alpha', ['m-alpha'])],
      models: [model('m-alpha', 'e-alpha')],
      mode: 'disabled',
      preferredEngineId: 'e-alpha',
      preferredModelId: 'm-alpha',
      requirement: NEEDS_TEXT,
      automaticPolicy: policy(ref('e-alpha', 'm-alpha')),
    })
    expect(decision).toEqual({ status: 'disabled' })
    // No resolved candidate, no selection, no failure detail leaks out.
    expect('resolution' in decision).toBe(false)
    expect('selection' in decision).toBe(false)
  })

  it('c: manual + no preference -> manual/noPreference', () => {
    const decision = decideBrainRoute({
      engines: [engine('e-alpha', ['m-alpha'])],
      models: [model('m-alpha', 'e-alpha')],
      mode: 'manual',
      requirement: NEEDS_TEXT,
    })
    expect(decision).toEqual({ resolution: { status: 'noPreference' }, status: 'manual' })
  })

  it('d: manual + valid engine-only preference -> manual/resolvedEngine (never forced into a model route)', () => {
    const engines = [engine('e-alpha', ['m-alpha'])]
    const decision = decideBrainRoute({
      engines,
      models: [model('m-alpha', 'e-alpha')],
      mode: 'manual',
      preferredEngineId: 'e-alpha',
      requirement: NEEDS_TEXT,
    })
    expect(decision.status).toBe('manual')
    if (decision.status !== 'manual')
      return
    expect(decision.resolution.status).toBe('resolvedEngine')
    if (decision.resolution.status !== 'resolvedEngine')
      return
    expect(decision.resolution.engine).toBe(engines[0])

    // An eligible model for that engine exists, and is still NOT attached.
    expect('model' in decision.resolution).toBe(false)
  })

  it('e: manual + valid model preference -> manual/resolvedModel', () => {
    const engines = [engine('e-alpha', ['m-alpha'], VISION)]
    const models = [model('m-alpha', 'e-alpha', VISION)]
    const decision = decideBrainRoute({
      engines,
      models,
      mode: 'manual',
      preferredModelId: 'm-alpha',
      requirement: NEEDS_VISION,
    })
    expect(decision.status).toBe('manual')
    if (decision.status !== 'manual')
      return
    expect(decision.resolution.status).toBe('resolvedModel')
    if (decision.resolution.status !== 'resolvedModel')
      return
    expect(decision.resolution.engine).toBe(engines[0])
    expect(decision.resolution.model).toBe(models[0])
  })

  it('f: manual failure outcomes pass through unchanged', () => {
    const engines = [engine('e-one', ['m-one']), engine('e-two', ['m-two'])]
    const models = [model('m-one', 'e-one'), model('m-two', 'e-two')]

    const missing = decideBrainRoute({
      engines,
      models,
      mode: 'manual',
      preferredEngineId: 'e-ghost',
      requirement: NEEDS_TEXT,
    })
    expect(missing).toEqual({ resolution: { preferredEngineId: 'e-ghost', status: 'engineNotFound' }, status: 'manual' })

    const mismatch = decideBrainRoute({
      engines,
      models,
      mode: 'manual',
      preferredEngineId: 'e-one',
      preferredModelId: 'm-two',
      requirement: NEEDS_TEXT,
    })
    expect(mismatch.status).toBe('manual')
    if (mismatch.status !== 'manual')
      return
    expect(mismatch.resolution.status).toBe('modelEngineMismatch')

    // Invalid preference is reported, NEVER substituted by a valid one.
    const ineligible = decideBrainRoute({
      engines: [engine('e-text-only', ['m-vision'], TEXT), engine('e-good', ['m-good'], VISION)],
      models: [model('m-vision', 'e-text-only', VISION), model('m-good', 'e-good', VISION)],
      mode: 'manual',
      preferredEngineId: 'e-text-only',
      requirement: NEEDS_VISION,
    })
    expect(ineligible.status).toBe('manual')
    if (ineligible.status !== 'manual')
      return
    expect(ineligible.resolution.status).toBe('engineIneligible')
  })

  it('g: manual mode never consults the automatic policy', () => {
    const decision = decideBrainRoute({
      automaticPolicy: explodingPolicy,
      engines: [engine('e-alpha', ['m-alpha'])],
      models: [model('m-alpha', 'e-alpha')],
      mode: 'manual',
      preferredEngineId: 'e-alpha',
      requirement: NEEDS_TEXT,
    })
    expect(decision.status).toBe('manual')
    if (decision.status !== 'manual')
      return
    expect(decision.resolution.status).toBe('resolvedEngine')
  })

  it('h: automatic without a policy -> automaticPolicyMissing', () => {
    const decision = decideBrainRoute({
      engines: [engine('e-alpha', ['m-alpha'])],
      models: [model('m-alpha', 'e-alpha')],
      mode: 'automatic',
      preferredEngineId: 'e-alpha',
      requirement: NEEDS_TEXT,
    })
    expect(decision).toEqual({ status: 'automaticPolicyMissing' })
  })

  it('i: automatic with zero eligible routes -> automatic/noCandidates', () => {
    // No models at all.
    const empty = decideBrainRoute({
      engines: [engine('e-alpha', ['m-alpha'])],
      models: [],
      mode: 'automatic',
      requirement: NEEDS_TEXT,
      automaticPolicy: policy(ref('e-alpha', 'm-alpha')),
    })
    expect(empty).toEqual({ selection: { status: 'noCandidates' }, status: 'automatic' })

    // Candidates composed away by the requirement (engine incapable).
    const incapable = decideBrainRoute({
      engines: [engine('e-text-only', ['m-vision'], TEXT)],
      models: [model('m-vision', 'e-text-only', VISION)],
      mode: 'automatic',
      requirement: NEEDS_VISION,
      automaticPolicy: policy(ref('e-text-only', 'm-vision')),
    })
    expect(incapable).toEqual({ selection: { status: 'noCandidates' }, status: 'automatic' })
  })

  it('j: automatic candidates exist but the policy names none -> automatic/noPolicyMatch', () => {
    const decision = decideBrainRoute({
      engines: [engine('e-alpha', ['m-alpha'])],
      models: [model('m-alpha', 'e-alpha')],
      mode: 'automatic',
      requirement: NEEDS_TEXT,
      automaticPolicy: policy(ref('e-ghost', 'm-ghost')),
    })
    expect(decision).toEqual({ selection: { status: 'noPolicyMatch' }, status: 'automatic' })
  })

  it('k: a duplicated winning identity -> automatic/ambiguous', () => {
    const decision = decideBrainRoute({
      engines: [engine('e-alpha', ['m-alpha'])],
      // The same route identity appears twice in the candidate set.
      models: [model('m-alpha', 'e-alpha'), model('m-alpha', 'e-alpha')],
      mode: 'automatic',
      requirement: NEEDS_TEXT,
      automaticPolicy: policy(ref('e-alpha', 'm-alpha')),
    })
    expect(decision.status).toBe('automatic')
    if (decision.status !== 'automatic')
      return
    expect(decision.selection).toEqual({ ref: ref('e-alpha', 'm-alpha'), status: 'ambiguous' })
  })

  it('l: automatic with a valid policy -> automatic/selected, carrying the canonical route', () => {
    const engines = [engine('e-alpha', ['m-alpha']), engine('e-beta', ['m-beta'])]
    const models = [model('m-alpha', 'e-alpha'), model('m-beta', 'e-beta')]
    const decision = decideBrainRoute({
      engines,
      models,
      mode: 'automatic',
      requirement: NEEDS_TEXT,
      automaticPolicy: policy(ref('e-beta', 'm-beta'), ref('e-alpha', 'm-alpha')),
    })
    expect(decision.status).toBe('automatic')
    if (decision.status !== 'automatic')
      return
    expect(decision.selection.status).toBe('selected')
    if (decision.selection.status !== 'selected')
      return
    // Policy order decided; the descriptor objects are the very inputs.
    expect(decision.selection.route.engine).toBe(engines[1])
    expect(decision.selection.route.model).toBe(models[1])
  })

  it('m: automatic mode ignores persisted preferred ids completely', () => {
    // The persisted ids point at a perfectly valid route A...
    const engines = [engine('e-manual', ['m-manual'], VISION), engine('e-auto', ['m-auto'], VISION)]
    const models = [model('m-manual', 'e-manual', VISION), model('m-auto', 'e-auto', VISION)]
    const decision = decideBrainRoute({
      engines,
      models,
      mode: 'automatic',
      preferredEngineId: 'e-manual',
      preferredModelId: 'm-manual',
      requirement: NEEDS_VISION,
      // ...while the policy names route B.
      automaticPolicy: policy(ref('e-auto', 'm-auto')),
    })
    expect(decision.status).toBe('automatic')
    if (decision.status !== 'automatic')
      return
    expect(decision.selection.status).toBe('selected')
    if (decision.selection.status !== 'selected')
      return
    expect(decision.selection.route.engine.id).toBe('e-auto')
    expect(decision.selection.route.model.id).toBe('m-auto')

    // A bogus persisted id can't even produce a failure here - it's invisible.
    const bogus = decideBrainRoute({
      engines,
      models,
      mode: 'automatic',
      preferredEngineId: 'e-does-not-exist',
      requirement: NEEDS_VISION,
      automaticPolicy: policy(ref('e-auto', 'm-auto')),
    })
    expect(bogus.status).toBe('automatic')
    if (bogus.status !== 'automatic')
      return
    expect(bogus.selection.status).toBe('selected')
  })

  it('n: an absent mode never infers manual from stored preferences', () => {
    expect(decideBrainRoute({
      engines: [engine('e-alpha', ['m-alpha'])],
      models: [model('m-alpha', 'e-alpha')],
      preferredEngineId: 'e-alpha',
      preferredModelId: 'm-alpha',
      requirement: NEEDS_TEXT,
    })).toEqual({ status: 'modeUnspecified' })
  })

  it('o: an absent mode never infers automatic from available candidates, nor disabled from emptiness', () => {
    // Rich candidate set + a policy that WOULD select - still unspecified.
    expect(decideBrainRoute({
      engines: [engine('e-alpha', ['m-alpha'])],
      models: [model('m-alpha', 'e-alpha')],
      requirement: NEEDS_TEXT,
      automaticPolicy: policy(ref('e-alpha', 'm-alpha')),
    })).toEqual({ status: 'modeUnspecified' })

    // Nothing configured anywhere - still not "disabled".
    expect(decideBrainRoute({
      engines: [],
      models: [],
      requirement: NEEDS_TEXT,
    })).toEqual({ status: 'modeUnspecified' })
  })

  it('p: the disabled path invokes no lower routing layer at all', () => {
    // Every other input detonates on access - mode is the only thing read.
    expect(decideBrainRoute(explodingRoutingState('disabled'))).toEqual({ status: 'disabled' })
  })

  it('q/R/S: the canonical manual resolver, route composer and automatic selector are the ones reused', () => {
    const source = readSource('./decision.ts')
    expect(source).toContain('import { resolvePreferredBrainSelection } from \'./resolver\'')
    expect(source).toContain('import { eligibleBrainModelRoutes } from \'./routes\'')
    expect(source).toContain('import { selectBrainRouteByPolicy } from \'./selection\'')
    expect(source).toContain('resolvePreferredBrainSelection({')
    expect(source).toContain('eligibleBrainModelRoutes(')
    expect(source).toContain('selectBrainRouteByPolicy(')

    // Behavioral pass-through: the unified result EQUALS the canonical
    // layer's own result for the same inputs.
    const engines = [engine('e-alpha', ['m-alpha'], VISION)]
    const models = [model('m-alpha', 'e-alpha', VISION)]
    const decided = decideBrainRoute({
      engines,
      models,
      mode: 'manual',
      preferredModelId: 'm-alpha',
      requirement: NEEDS_VISION,
    })
    expect(decided).toEqual({
      resolution: resolvePreferredBrainSelection({
        engines,
        models,
        preferredModelId: 'm-alpha',
        requirement: NEEDS_VISION,
      }),
      status: 'manual',
    })

    const candidates: readonly LiaBrainModelRoute[] = [
      { engine: engines[0], model: models[0] },
    ]
    const declared = policy(ref('e-alpha', 'm-alpha'))
    expect(decideBrainRoute({
      engines,
      models,
      mode: 'automatic',
      requirement: NEEDS_VISION,
      automaticPolicy: declared,
    })).toEqual({
      selection: selectBrainRouteByPolicy(candidates, declared),
      status: 'automatic',
    })
  })

  it('t: no lower-layer rule (capability, association, precedence) is duplicated here', () => {
    const source = readSource('./decision.ts')
    // No capability matching of its own...
    expect(source).not.toContain('capabilities[')
    expect(source).not.toMatch(/=== true|!== true/)
    // ...no engine/model association logic (no descriptor fields read)...
    expect(source).not.toMatch(/\.engineId|\.modelIds/)
    // ...no policy precedence walking, and no candidate scanning.
    expect(source).not.toMatch(/\.filter\(|\.find\(|\.some\(|\.includes\(/)
    // The three delegations are the ONLY routing work in the file.
    expect(source.match(/eligibleBrainModelRoutes\(|selectBrainRouteByPolicy\(|resolvePreferredBrainSelection\(/g)?.length).toBe(3)
  })

  it('u: routing inputs are never mutated', () => {
    const engines = [engine('e-alpha', ['m-alpha'], VISION), engine('e-beta', ['m-beta'], VISION)]
    const models = [model('m-alpha', 'e-alpha', VISION), model('m-beta', 'e-beta', VISION)]
    const declared = policy(ref('e-beta', 'm-beta'), ref('e-alpha', 'm-alpha'))
    const req = requirement('imageInput')
    const snapshot = JSON.parse(JSON.stringify({ declared, engines, models, req }))

    decideBrainRoute({ engines, models, mode: 'manual', preferredEngineId: 'e-alpha', requirement: req })
    decideBrainRoute({ engines, models, mode: 'automatic', requirement: req, automaticPolicy: declared })
    decideBrainRoute({ engines, models, mode: 'disabled', preferredModelId: 'm-alpha', requirement: req, automaticPolicy: declared })

    expect(JSON.parse(JSON.stringify({ declared, engines, models, req }))).toEqual(snapshot)
  })

  it('v: no config/network/filesystem/registry side effects, and decisions are deterministic', () => {
    const source = readSource('./decision.ts')
    expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram)['/]/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios/)
    expect(source).not.toMatch(/readFile|writeFile|process\.env/)
    expect(source).not.toContain('createBrainEngineRegistry')
    // No product-config ACCESS either: state arrives as arguments. The only
    // '../product' reference allowed is the erased type-only mode import.
    expect(source).toMatch(/import type \{ LiaBrainRoutingMode \} from '\.\.\/product\/config'/)
    expect(source).not.toMatch(/readLiaProductConfig|brainSelectionUpdate|readBrainRoutingMode|updateLiaProductConfig/)
    // The lone '../product' line is the type-only mode import (erased at runtime).
    expect(source.split('\n').filter(line => line.includes('../product')))
      .toEqual(['import type { LiaBrainRoutingMode } from \'../product/config\''])

    const input: LiaBrainRoutingDecisionInput = {
      engines: [engine('e-alpha', ['m-alpha'])],
      models: [model('m-alpha', 'e-alpha')],
      mode: 'automatic',
      requirement: NEEDS_TEXT,
      automaticPolicy: policy(ref('e-alpha', 'm-alpha')),
    }
    expect(decideBrainRoute(input)).toEqual(decideBrainRoute(input))
  })
})
