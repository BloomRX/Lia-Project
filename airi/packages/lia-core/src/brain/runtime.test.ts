import type { LiaProductConfigSnapshot } from '../product/config'
import type { LiaBrainCapabilityRequirement } from './capabilities'
import type { LiaBrainAutomaticSelectionPolicy, LiaBrainRouteRef } from './selection'
import type { LiaBrainCapabilities, LiaBrainEngineDescriptor, LiaBrainModelDescriptor } from './types'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { decideBrainRoute } from './decision'
import { decideBrainRouteFromProductState } from './runtime'

/**
 * Phase 8.0D-1: the runtime decision context - product state in, the
 * canonical 8.0C decision out, nothing consumed.
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

/** A REAL product snapshot shape, built through the persisted document keys. */
function snapshot(brain?: LiaProductConfigSnapshot['brain']): LiaProductConfigSnapshot {
  return {
    brain,
    persona: { activeCardId: 'lia' },
    provider: { chat: { preferred: { providerId: 'openai-compatible' } } },
    schemaVersion: 1,
  }
}

describe('runtime brain decision context (8.0D-1)', () => {
  it('a: a snapshot without brain.mode -> modeUnspecified', () => {
    const base = {
      engines: [engine('e-alpha', ['m-alpha'])],
      models: [model('m-alpha', 'e-alpha')],
      requirement: NEEDS_TEXT,
    }
    // No brain section at all, and a brain section with only selections.
    expect(decideBrainRouteFromProductState({ ...base, snapshot: snapshot() })).toEqual({ status: 'modeUnspecified' })
    expect(decideBrainRouteFromProductState({
      ...base,
      snapshot: snapshot({ engine: { preferred: 'e-alpha' }, model: { preferred: 'm-alpha' } }),
    })).toEqual({ status: 'modeUnspecified' })
  })

  it('b: a disabled snapshot -> disabled, even with valid selections and a policy present', () => {
    expect(decideBrainRouteFromProductState({
      automaticPolicy: policy(ref('e-alpha', 'm-alpha')),
      engines: [engine('e-alpha', ['m-alpha'])],
      models: [model('m-alpha', 'e-alpha')],
      requirement: NEEDS_TEXT,
      snapshot: snapshot({ engine: { preferred: 'e-alpha' }, mode: 'disabled', model: { preferred: 'm-alpha' } }),
    })).toEqual({ status: 'disabled' })
  })

  it('c: a manual snapshot carries the canonical preferred ids into the unified router', () => {
    const engines = [engine('e-alpha', ['m-alpha'], VISION)]
    const models = [model('m-alpha', 'e-alpha', VISION)]
    const decision = decideBrainRouteFromProductState({
      engines,
      models,
      requirement: NEEDS_VISION,
      snapshot: snapshot({ engine: { preferred: 'e-alpha' }, mode: 'manual', model: { preferred: 'm-alpha' } }),
    })
    expect(decision.status).toBe('manual')
    if (decision.status !== 'manual')
      return
    expect(decision.resolution.status).toBe('resolvedModel')
    if (decision.resolution.status !== 'resolvedModel')
      return
    // Both canonical ids travelled: model preference wins the descriptor pair,
    // exactly as the explicit resolver defines it.
    expect(decision.resolution.engine).toBe(engines[0])
    expect(decision.resolution.model).toBe(models[0])

    // Engine-only persisted preference resolves engine-only, same as direct.
    const engineOnly = decideBrainRouteFromProductState({
      engines,
      models,
      requirement: NEEDS_VISION,
      snapshot: snapshot({ engine: { preferred: 'e-alpha' }, mode: 'manual' }),
    })
    expect(engineOnly.status).toBe('manual')
    if (engineOnly.status !== 'manual')
      return
    expect(engineOnly.resolution.status).toBe('resolvedEngine')

    // Blank ids read as absent through the canonical readers (noPreference).
    expect(decideBrainRouteFromProductState({
      engines,
      models,
      requirement: NEEDS_VISION,
      snapshot: snapshot({ engine: { preferred: '   ' }, mode: 'manual' }),
    })).toEqual({ resolution: { status: 'noPreference' }, status: 'manual' })
  })

  it('d: an automatic snapshot + explicit policy equals the direct decideBrainRoute decision', () => {
    const engines = [engine('e-alpha', ['m-alpha'], VISION), engine('e-beta', ['m-beta'], VISION)]
    const models = [model('m-alpha', 'e-alpha', VISION), model('m-beta', 'e-beta', VISION)]
    const declared = policy(ref('e-beta', 'm-beta'), ref('e-alpha', 'm-alpha'))

    const bridged = decideBrainRouteFromProductState({
      automaticPolicy: declared,
      engines,
      models,
      requirement: NEEDS_VISION,
      // Persisted manual selections exist too - automatic must ignore them.
      snapshot: snapshot({ engine: { preferred: 'e-alpha' }, mode: 'automatic', model: { preferred: 'm-alpha' } }),
    })
    const direct = decideBrainRoute({
      automaticPolicy: declared,
      engines,
      models,
      mode: 'automatic',
      preferredEngineId: 'e-alpha',
      preferredModelId: 'm-alpha',
      requirement: NEEDS_VISION,
    })
    expect(bridged).toEqual(direct)
    expect(bridged.status).toBe('automatic')
    if (bridged.status !== 'automatic')
      return
    expect(bridged.selection.status).toBe('selected')
    if (bridged.selection.status !== 'selected')
      return
    // Policy order decided, descriptor objects are the very inputs.
    expect(bridged.selection.route.engine).toBe(engines[1])
    expect(bridged.selection.route.model).toBe(models[1])
  })

  it('e: automatic without a policy -> automaticPolicyMissing (no runtime default invented)', () => {
    expect(decideBrainRouteFromProductState({
      engines: [engine('e-alpha', ['m-alpha'])],
      models: [model('m-alpha', 'e-alpha')],
      requirement: NEEDS_TEXT,
      snapshot: snapshot({ engine: { preferred: 'e-alpha' }, mode: 'automatic', model: { preferred: 'm-alpha' } }),
    })).toEqual({ status: 'automaticPolicyMissing' })
  })

  it('f/G/H: the canonical snapshot readers are the ones reused', () => {
    const source = readSource('./runtime.ts')
    expect(source).toContain('readBrainRoutingMode')
    expect(source).toContain('readPreferredBrainEngineId')
    expect(source).toContain('readPreferredBrainModelId')
    expect(source).toMatch(/import \{ readBrainRoutingMode, readPreferredBrainEngineId, readPreferredBrainModelId \} from '\.\.\/product\/config'/)
    // Behavioral: values that only a canonical reader can produce travel through.
    // A non-canonical mode value never reaches the router as a mode.
    expect(decideBrainRouteFromProductState({
      engines: [],
      models: [],
      requirement: NEEDS_TEXT,
      snapshot: { brain: { mode: 'turbo' } } as unknown as LiaProductConfigSnapshot['brain'],
    })).toEqual({ status: 'modeUnspecified' })
  })

  it('i/J: decideBrainRoute is the ONLY routing decision function the bridge calls', () => {
    const source = readSource('./runtime.ts')
    // Exactly one routing call, and it is the unified router.
    expect(source.match(/decideBrainRoute\(/g)?.length).toBe(1)
    expect(source).toMatch(/return decideBrainRoute\(\{/)
    // No lower 8.0C layer is reached directly from here.
    for (const lower of ['resolvePreferredBrainSelection', 'eligibleBrainModelRoutes', 'selectBrainRouteByPolicy', 'satisfiesBrainCapabilities']) {
      expect(source, lower).not.toContain(lower)
    }
  })

  it('k: the bridge never traverses snapshot.brain fields directly', () => {
    const source = readSource('./runtime.ts')
    expect(source).not.toMatch(/snapshot\??\.brain/)
    expect(source).not.toMatch(/\.brain\?\./)
    expect(source).not.toMatch(/\.mode\b|\.preferred\b/)
    // The snapshot is handed to the canonical readers verbatim.
    expect(source.match(/readBrainRoutingMode\(context\.snapshot\)|readPreferredBrainEngineId\(context\.snapshot\)|readPreferredBrainModelId\(context\.snapshot\)/g)?.length).toBe(3)
  })

  it('l: supplied engines/models/requirement/policy/snapshot are never mutated', () => {
    const engines = [engine('e-alpha', ['m-alpha'], VISION), engine('e-beta', ['m-beta'], VISION)]
    const models = [model('m-alpha', 'e-alpha', VISION), model('m-beta', 'e-beta', VISION)]
    const declared = policy(ref('e-beta', 'm-beta'))
    const req = requirement('imageInput')
    const state = snapshot({ mode: 'automatic' })
    const before = JSON.parse(JSON.stringify({ declared, engines, models, req, state }))

    decideBrainRouteFromProductState({ automaticPolicy: declared, engines, models, requirement: req, snapshot: state })
    decideBrainRouteFromProductState({ engines, models, requirement: req, snapshot: snapshot({ mode: 'disabled' }) })

    expect(JSON.parse(JSON.stringify({ declared, engines, models, req, state }))).toEqual(before)
  })

  it('m: no config write, filesystem, network, IPC or registry mutation exists', () => {
    const source = readSource('./runtime.ts')
    expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram|electron|worker_threads)['/]/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios/)
    expect(source).not.toMatch(/readFile|writeFile|existsSync|process\.env/)
    // No writes of any kind, no registry ownership.
    expect(source).not.toMatch(/updateLiaProductConfig|writeLiaProductConfig|brainRoutingModeUpdate|brainSelectionUpdate/)
    expect(source).not.toContain('createBrainEngineRegistry')
    // Exactly one import from the product layer: the three readers (values only).
    expect(source.split('\n').filter(line => line.includes('../product')))
      .toEqual([
        'import type { LiaProductConfigSnapshot } from \'../product/config\'',
        'import { readBrainRoutingMode, readPreferredBrainEngineId, readPreferredBrainModelId } from \'../product/config\'',
      ])
  })

  it('n: the current conversation/provider execution path stays untouched', () => {
    // Nothing outside the brain domain consumes the routing decision yet -
    // this bridge included: its only importer is the package root entry.
    const brainDir = fileURLToPath(new URL('.', import.meta.url))
    const srcDir = fileURLToPath(new URL('..', import.meta.url))
    const consumers: string[] = []
    for (const entry of readdirSync(srcDir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts'))
        continue
      const file = `${entry.parentPath}/${entry.name}`
      if (file.startsWith(brainDir) || file.endsWith('brain/runtime.ts') || file.endsWith('brain/runtime.test.ts'))
        continue
      const source = readFileSync(file, 'utf-8')
      if (/decideBrainRouteFromProductState|decideBrainRoute\b/.test(source))
        consumers.push(file.slice(srcDir.length))
    }
    // Only the package root re-exports it - no execution path imports it.
    expect(consumers).toEqual(['/index.ts'])

    // The launcher->stage bridge (the chat/voice contract) carries no brain
    // routing at all: the existing execution path cannot depend on it.
    expect(readSource('../bridge/lia-config.ts')).not.toMatch(/brain|routing|decideBrainRoute/i)
  })
})
