import type { LiaBrainCapabilityRequirement } from './capabilities'
import type { LiaBrainCapabilities, LiaBrainEngineDescriptor, LiaBrainModelDescriptor } from './types'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { resolvePreferredBrainSelection } from './resolver'

/**
 * Phase 8.0C-2: the explicit preference-aware resolver - validation only.
 * Every invalid or absent preference becomes an EXPLICIT outcome; no
 * substitute candidate is ever produced here.
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

function engine(id: string, caps: LiaBrainCapabilities = TEXT): LiaBrainEngineDescriptor {
  return { availability: 'available', capabilities: caps, id, modelIds: [], name: `Engine ${id}` }
}

function model(id: string, engineId: string, caps: LiaBrainCapabilities = TEXT): LiaBrainModelDescriptor {
  return { capabilities: caps, engineId, id, name: `Model ${id}` }
}

function requirement(...required: LiaBrainCapabilityRequirement['required']): LiaBrainCapabilityRequirement {
  return { required }
}

const NEEDS_TEXT = requirement('textInput')
const NEEDS_VISION = requirement('imageInput')

describe('explicit brain preference resolver (8.0C-2)', () => {
  it('a: no preferences -> noPreference (and nothing is selected)', () => {
    const engines = [engine('e-alpha')]
    const models = [model('m-alpha', 'e-alpha')]

    for (const [preferredEngineId, preferredModelId] of [
      [undefined, undefined],
      ['', ''],
      ['   ', undefined],
      [undefined, '  '],
    ] as const) {
      const result = resolvePreferredBrainSelection({ engines, models, preferredEngineId, preferredModelId, requirement: NEEDS_TEXT })
      expect(result).toEqual({ status: 'noPreference' })
    }
  })

  it('b: a valid engine-only preference -> resolvedEngine, and NO model is chosen for it', () => {
    const engines = [engine('e-alpha')]
    const models = [model('m-alpha', 'e-alpha')]

    const result = resolvePreferredBrainSelection({
      engines,
      models,
      preferredEngineId: 'e-alpha',
      requirement: NEEDS_TEXT,
    })
    expect(result.status).toBe('resolvedEngine')
    if (result.status !== 'resolvedEngine')
      return
    expect(result.engine).toBe(engines[0])
    // The engine resolves ALONE - the resolver never attaches one of its models.
    expect('model' in result).toBe(false)
  })

  it('c: an unknown engine preference -> engineNotFound (explicit id echoed)', () => {
    const result = resolvePreferredBrainSelection({
      engines: [engine('e-alpha')],
      models: [],
      preferredEngineId: 'e-ghost',
      requirement: NEEDS_TEXT,
    })
    expect(result).toEqual({ preferredEngineId: 'e-ghost', status: 'engineNotFound' })
  })

  it('d: an incapable engine preference -> engineIneligible', () => {
    const engines = [engine('e-text-only')]
    const result = resolvePreferredBrainSelection({
      engines,
      models: [],
      preferredEngineId: 'e-text-only',
      requirement: NEEDS_VISION,
    })
    expect(result.status).toBe('engineIneligible')
    if (result.status !== 'engineIneligible')
      return
    expect(result.engine).toBe(engines[0])
    expect(result.model).toBeUndefined()
  })

  it('e: a valid model preference resolves its associated engine AND the model', () => {
    const engines = [engine('e-alpha', VISION)]
    const models = [model('m-alpha', 'e-alpha', VISION)]

    const result = resolvePreferredBrainSelection({
      engines,
      models,
      preferredModelId: 'm-alpha',
      requirement: NEEDS_VISION,
    })
    expect(result.status).toBe('resolvedModel')
    if (result.status !== 'resolvedModel')
      return
    expect(result.engine).toBe(engines[0])
    expect(result.model).toBe(models[0])
  })

  it('f: a missing preferred model -> modelNotFound', () => {
    const result = resolvePreferredBrainSelection({
      engines: [engine('e-alpha')],
      models: [model('m-alpha', 'e-alpha')],
      preferredModelId: 'm-ghost',
      requirement: NEEDS_TEXT,
    })
    expect(result).toEqual({ preferredModelId: 'm-ghost', status: 'modelNotFound' })
  })

  it('g: capable model, incapable associated engine -> engineIneligible (the route needs BOTH)', () => {
    const engines = [engine('e-text-only', TEXT)]
    const models = [model('m-vision', 'e-text-only', VISION)]

    const result = resolvePreferredBrainSelection({
      engines,
      models,
      preferredModelId: 'm-vision',
      requirement: NEEDS_VISION,
    })
    expect(result.status).toBe('engineIneligible')
    if (result.status !== 'engineIneligible')
      return
    expect(result.engine).toBe(engines[0])
    expect(result.model).toBe(models[0])
  })

  it('h: capable engine, incapable model -> modelIneligible', () => {
    const engines = [engine('e-alpha', VISION)]
    const models = [model('m-text-only', 'e-alpha', TEXT)]

    const result = resolvePreferredBrainSelection({
      engines,
      models,
      preferredModelId: 'm-text-only',
      requirement: NEEDS_VISION,
    })
    expect(result.status).toBe('modelIneligible')
    if (result.status !== 'modelIneligible')
      return
    expect(result.model).toBe(models[0])
  })

  it('i: a model referencing a missing engine -> modelEngineNotFound', () => {
    const models = [model('m-orphan', 'e-gone', TEXT)]
    const result = resolvePreferredBrainSelection({
      engines: [],
      models,
      preferredModelId: 'm-orphan',
      requirement: NEEDS_TEXT,
    })
    expect(result.status).toBe('modelEngineNotFound')
    if (result.status !== 'modelEngineNotFound')
      return
    expect(result.model).toBe(models[0])
  })

  it('j: explicit engine + model pointing at different engines -> modelEngineMismatch (never repaired)', () => {
    const engines = [engine('e-one'), engine('e-two')]
    const models = [model('m-two', 'e-two')]

    const result = resolvePreferredBrainSelection({
      engines,
      models,
      preferredEngineId: 'e-one',
      preferredModelId: 'm-two',
      requirement: NEEDS_TEXT,
    })
    expect(result.status).toBe('modelEngineMismatch')
    if (result.status !== 'modelEngineMismatch')
      return
    expect(result.engine).toBe(engines[0])
    expect(result.model).toBe(models[0])
  })

  it('k: a valid explicit engine + model pair -> resolvedModel with both descriptors', () => {
    const engines = [engine('e-alpha', VISION)]
    const models = [model('m-alpha', 'e-alpha', VISION)]

    const result = resolvePreferredBrainSelection({
      engines,
      models,
      preferredEngineId: 'e-alpha',
      preferredModelId: 'm-alpha',
      requirement: NEEDS_VISION,
    })
    expect(result.status).toBe('resolvedModel')
    if (result.status !== 'resolvedModel')
      return
    expect(result.engine).toBe(engines[0])
    expect(result.model).toBe(models[0])
  })

  it('l: no alternative candidate is EVER chosen on failure', () => {
    // An eligible substitute sits RIGHT THERE in every input below - the
    // resolver must ignore it and report the explicit failure.
    const goodEngine = engine('e-good', VISION)
    const goodModel = model('m-good', 'e-good', VISION)

    const cases = [
      // Incapable preferred engine next to a capable one.
      resolvePreferredBrainSelection({
        engines: [engine('e-text-only', TEXT), goodEngine],
        models: [goodModel],
        preferredEngineId: 'e-text-only',
        requirement: NEEDS_VISION,
      }),
      // Missing preferred engine next to a capable one.
      resolvePreferredBrainSelection({
        engines: [goodEngine],
        models: [goodModel],
        preferredEngineId: 'e-ghost',
        requirement: NEEDS_VISION,
      }),
      // Incapable preferred model next to a capable one.
      resolvePreferredBrainSelection({
        engines: [goodEngine],
        models: [model('m-text-only', 'e-good', TEXT), goodModel],
        preferredModelId: 'm-text-only',
        requirement: NEEDS_VISION,
      }),
      // Missing preferred model next to a capable one.
      resolvePreferredBrainSelection({
        engines: [goodEngine],
        models: [goodModel],
        preferredModelId: 'm-ghost',
        requirement: NEEDS_VISION,
      }),
    ]

    for (const result of cases) {
      // The outcome is ALWAYS an explicit failure - never a resolved
      // substitute, however eligible one sits in the same input.
      expect(['engineIneligible', 'engineNotFound', 'modelIneligible', 'modelNotFound'], result.status).toContain(result.status)
    }
  })

  it('m: input arrays and descriptors are never mutated', () => {
    const engines = [engine('e-alpha', VISION), engine('e-beta', TEXT)]
    const models = [model('m-alpha', 'e-alpha', VISION), model('m-beta', 'e-beta', TEXT)]
    const enginesBefore = JSON.parse(JSON.stringify(engines))
    const modelsBefore = JSON.parse(JSON.stringify(models))

    resolvePreferredBrainSelection({ engines, models, preferredEngineId: 'e-alpha', preferredModelId: 'm-alpha', requirement: NEEDS_VISION })
    resolvePreferredBrainSelection({ engines, models, preferredModelId: 'm-ghost', requirement: NEEDS_VISION })

    expect(JSON.parse(JSON.stringify(engines))).toEqual(enginesBefore)
    expect(JSON.parse(JSON.stringify(models))).toEqual(modelsBefore)
  })

  it('n: the resolver reuses the canonical 8.0C-1 eligibility logic', () => {
    const source = readSource('./resolver.ts')
    // Eligibility rides the one canonical helper...
    expect(source).toContain('import { satisfiesBrainCapabilities } from \'./capabilities\'')
    expect(source.match(/satisfiesBrainCapabilities\(/g)?.length).toBeGreaterThanOrEqual(2)
    // ...and the resolver never re-implements capability matching itself.
    expect(source).not.toContain('capabilities[')
    expect(source).not.toMatch(/=== true|!== true/)
  })

  it('o: no config/network/filesystem/registry side effects', () => {
    const source = readSource('./resolver.ts')
    expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram)['/]/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios/)
    expect(source).not.toMatch(/readFile|writeFile|process\.env/)
    // The resolver never owns or mutates a registry - inputs are the only state.
    expect(source).not.toContain('createBrainEngineRegistry')

    // Determinism: the same input resolves identically on every call.
    const input = {
      engines: [engine('e-alpha')],
      models: [model('m-alpha', 'e-alpha')],
      preferredEngineId: 'e-alpha',
      requirement: NEEDS_TEXT,
    }
    expect(resolvePreferredBrainSelection(input)).toEqual(resolvePreferredBrainSelection(input))
  })
})
