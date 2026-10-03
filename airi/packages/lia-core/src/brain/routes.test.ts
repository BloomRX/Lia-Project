import type { LiaBrainCapabilityRequirement } from './capabilities'
import type { LiaBrainCapabilities, LiaBrainEngineDescriptor, LiaBrainModelDescriptor } from './types'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { eligibleBrainModelRoutes } from './routes'

/**
 * Phase 8.0C-3B: route candidates - composition only. Every usable route
 * comes back; NOTHING is ever selected, ranked or preferred here.
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

/** The engine declares the association bidirectionally unless stated otherwise. */
function engine(id: string, modelIds: readonly string[], caps: LiaBrainCapabilities = TEXT): LiaBrainEngineDescriptor {
  return { availability: 'available', capabilities: caps, id, modelIds, name: `Engine ${id}` }
}

function model(id: string, engineId: string, caps: LiaBrainCapabilities = TEXT): LiaBrainModelDescriptor {
  return { capabilities: caps, engineId, id, name: `Model ${id}` }
}

function requirement(...required: LiaBrainCapabilityRequirement['required']): LiaBrainCapabilityRequirement {
  return { required }
}

const NEEDS_TEXT = requirement('textInput')
const NEEDS_VISION = requirement('imageInput')

describe('brain route candidates (8.0C-3B)', () => {
  it('a: a valid engine+model pair produces exactly one route carrying both descriptors', () => {
    const engines = [engine('e-alpha', ['m-alpha'])]
    const models = [model('m-alpha', 'e-alpha')]

    const routes = eligibleBrainModelRoutes(engines, models, NEEDS_TEXT)
    expect(routes).toHaveLength(1)
    expect(routes[0].engine).toBe(engines[0])
    expect(routes[0].model).toBe(models[0])
  })

  it('b: a model referencing a missing engine produces no route', () => {
    const models = [model('m-orphan', 'e-gone')]
    expect(eligibleBrainModelRoutes([], models, NEEDS_TEXT)).toEqual([])
    expect(eligibleBrainModelRoutes([engine('e-other', ['m-other'])], models, NEEDS_TEXT)).toEqual([])
  })

  it('c: an engine whose id differs from model.engineId produces no route', () => {
    const engines = [engine('e-one', ['m-alpha'])]
    const models = [model('m-alpha', 'e-two')]
    expect(eligibleBrainModelRoutes(engines, models, NEEDS_TEXT)).toEqual([])
  })

  it('d: an engine that does not declare the model id produces no route (one-sided claim is not repaired)', () => {
    // The MODEL claims the engine, but the engine never lists the model.
    const engines = [engine('e-alpha', [])]
    const models = [model('m-alpha', 'e-alpha')]
    expect(eligibleBrainModelRoutes(engines, models, NEEDS_TEXT)).toEqual([])

    // ...and the reverse one-sided claim never synthesizes a model either.
    const listingEngine = engine('e-alpha', ['m-phantom'])
    expect(eligibleBrainModelRoutes([listingEngine], [], NEEDS_TEXT)).toEqual([])
  })

  it('e: an incapable engine produces no route', () => {
    const engines = [engine('e-text-only', ['m-vision'], TEXT)]
    const models = [model('m-vision', 'e-text-only', VISION)]
    expect(eligibleBrainModelRoutes(engines, models, NEEDS_VISION)).toEqual([])
  })

  it('f: capable engine + incapable model produces no route', () => {
    const engines = [engine('e-alpha', ['m-text-only'], VISION)]
    const models = [model('m-text-only', 'e-alpha', TEXT)]
    expect(eligibleBrainModelRoutes(engines, models, NEEDS_VISION)).toEqual([])
  })

  it('g: incapable engine + capable model produces no route', () => {
    const engines = [engine('e-text-only', ['m-vision'], TEXT)]
    const models = [model('m-vision', 'e-text-only', VISION)]
    expect(eligibleBrainModelRoutes(engines, models, NEEDS_VISION)).toEqual([])
  })

  it('h: both capable and mutually declared -> the route exists', () => {
    const engines = [engine('e-alpha', ['m-alpha'], VISION)]
    const models = [model('m-alpha', 'e-alpha', VISION)]
    expect(eligibleBrainModelRoutes(engines, models, NEEDS_VISION)).toHaveLength(1)
  })

  it('i: multiple valid routes are ALL returned - none is preferred', () => {
    const engines = [engine('e-alpha', ['m-alpha']), engine('e-beta', ['m-beta'])]
    const models = [model('m-alpha', 'e-alpha'), model('m-beta', 'e-beta')]
    const routes = eligibleBrainModelRoutes(engines, models, NEEDS_TEXT)
    expect(routes).toHaveLength(2)
    expect(routes.map(route => [route.engine.id, route.model.id])).toEqual([
      ['e-alpha', 'm-alpha'],
      ['e-beta', 'm-beta'],
    ])
  })

  it('j: model input order is preserved verbatim (stable enumeration, not a policy)', () => {
    const engines = [
      engine('e-zeta', ['m-zeta']),
      engine('e-alpha', ['m-alpha', 'm-beta']),
    ]
    // Deliberately "unsorted" both across engines and within one engine.
    const models = [
      model('m-beta', 'e-alpha'),
      model('m-zeta', 'e-zeta'),
      model('m-alpha', 'e-alpha'),
    ]
    const routes = eligibleBrainModelRoutes(engines, models, NEEDS_TEXT)
    expect(routes.map(route => route.model.id)).toEqual(['m-beta', 'm-zeta', 'm-alpha'])
  })

  it('k: unrelated models and engines never create synthetic routes', () => {
    const engines = [
      engine('e-alpha', ['m-alpha']),
      engine('e-idle', ['m-absent']),
    ]
    const models = [
      model('m-alpha', 'e-alpha'),
      model('m-foreign', 'e-idle'), // e-idle does NOT declare m-foreign
    ]
    const routes = eligibleBrainModelRoutes(engines, models, NEEDS_TEXT)
    expect(routes).toHaveLength(1)
    expect(routes[0].model.id).toBe('m-alpha')
    // The engine listing a model without a descriptor synthesizes nothing.
    expect(routes.some(route => route.model.id === 'm-absent')).toBe(false)
  })

  it('l: an engine-only candidate is never synthesized', () => {
    // A perfectly eligible engine, with model descriptors withheld.
    const engines = [engine('e-alpha', ['m-alpha'], VISION)]
    expect(eligibleBrainModelRoutes(engines, [], NEEDS_VISION)).toEqual([])
    // Every route that DOES come back carries both halves - no exceptions.
    const routes = eligibleBrainModelRoutes(engines, [model('m-alpha', 'e-alpha', VISION)], NEEDS_VISION)
    for (const route of routes) {
      expect(route.engine).toBeDefined()
      expect(route.model).toBeDefined()
    }
  })

  it('m: input arrays and descriptors are never mutated', () => {
    const engines = [engine('e-alpha', ['m-alpha'], VISION), engine('e-beta', ['m-beta'])]
    const models = [model('m-alpha', 'e-alpha', VISION), model('m-beta', 'e-gone')]
    const enginesBefore = JSON.parse(JSON.stringify(engines))
    const modelsBefore = JSON.parse(JSON.stringify(models))
    const modelIdsBefore = [...engines[0].modelIds]

    const routes = eligibleBrainModelRoutes(engines, models, NEEDS_VISION)

    expect(JSON.parse(JSON.stringify(engines))).toEqual(enginesBefore)
    expect(JSON.parse(JSON.stringify(models))).toEqual(modelsBefore)
    expect([...engines[0].modelIds]).toEqual(modelIdsBefore)
    // The result is a fresh array, never an input handed back.
    expect(routes).not.toBe(models)
    expect(routes).not.toBe(engines)
  })

  it('n: the canonical 8.0C-1 eligibility helper is reused, not re-implemented', () => {
    const source = readSource('./routes.ts')
    expect(source).toContain('import { satisfiesBrainCapabilities } from \'./capabilities\'')
    expect(source.match(/satisfiesBrainCapabilities\(/g)?.length).toBeGreaterThanOrEqual(2)
    expect(source).not.toContain('capabilities[')
    expect(source).not.toMatch(/=== true|!== true/)
  })

  it('o: no routing mode, preference or default logic exists here', () => {
    const source = readSource('./routes.ts')
    expect(source).not.toMatch(/automatic|manual|disabled|routingMode|preferred|default/i)
    // The signature accepts descriptors + requirement ONLY.
    expect(source).toMatch(/eligibleBrainModelRoutes\(\s*engines: readonly LiaBrainEngineDescriptor\[\],\s*models: readonly LiaBrainModelDescriptor\[\],\s*requirement: LiaBrainCapabilityRequirement,?\s*\)/)
  })

  it('p: no ranking, scoring or priority behavior exists', () => {
    const source = readSource('./routes.ts')
    expect(source).not.toMatch(/rank|score|priority|weight|fallback|sort\(|compare|\bbest\b|\bpick\b|\bchoose\b/i)
  })

  it('q: no config/network/filesystem/registry side effects, and composition is deterministic', () => {
    const source = readSource('./routes.ts')
    expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram)['/]/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios/)
    expect(source).not.toMatch(/readFile|writeFile|process\.env/)
    expect(source).not.toContain('createBrainEngineRegistry')

    const engines = [engine('e-alpha', ['m-alpha'])]
    const models = [model('m-alpha', 'e-alpha')]
    const first = eligibleBrainModelRoutes(engines, models, NEEDS_TEXT)
    const second = eligibleBrainModelRoutes(engines, models, NEEDS_TEXT)
    expect(first).toEqual(second)
    expect(first[0].engine.id).toBe(second[0].engine.id)
  })
})
