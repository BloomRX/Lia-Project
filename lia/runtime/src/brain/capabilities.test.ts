import type { LiaBrainCapabilityRequirement } from './capabilities'
import type { LiaBrainCapabilities, LiaBrainEngineDescriptor, LiaBrainModelDescriptor } from './types'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  eligibleBrainEngines,
  eligibleBrainModels,
  satisfiesBrainCapabilities,
} from './capabilities'

/**
 * Phase 8.0C-1: capability ELIGIBILITY only - pure matching, proven without
 * any vendor, side effect or decision-making. The layer answers "can it
 * satisfy these capabilities?" and nothing else.
 */

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

/** All capabilities off - tests flip exactly the flags they care about. */
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

function requirement(...required: LiaBrainCapabilityRequirement['required']): LiaBrainCapabilityRequirement {
  return { required }
}

function model(id: string, caps: LiaBrainCapabilities, engineId = 'engine-alpha'): LiaBrainModelDescriptor {
  return { capabilities: caps, engineId, id, name: `Model ${id}` }
}

function engine(id: string, caps: LiaBrainCapabilities): LiaBrainEngineDescriptor {
  return { availability: 'available', capabilities: caps, id, modelIds: [], name: `Engine ${id}` }
}

describe('brain capability eligibility (8.0C-1)', () => {
  it('a: an empty requirement matches ANY capability set', () => {
    expect(satisfiesBrainCapabilities(NONE, requirement())).toBe(true)
    expect(satisfiesBrainCapabilities(capabilities({ textInput: true }), requirement())).toBe(true)
    expect(satisfiesBrainCapabilities(capabilities({ realtime: true, videoInput: true }), requirement())).toBe(true)
  })

  it('b: one required capability must be true', () => {
    expect(satisfiesBrainCapabilities(capabilities({ textInput: true }), requirement('textInput'))).toBe(true)
    expect(satisfiesBrainCapabilities(capabilities({ textInput: false }), requirement('textInput'))).toBe(false)
    expect(satisfiesBrainCapabilities(NONE, requirement('textOutput'))).toBe(false)
  })

  it('c: multiple required capabilities demand ALL of them', () => {
    const both = requirement('textInput', 'imageInput')
    expect(satisfiesBrainCapabilities(capabilities({ imageInput: true, textInput: true }), both)).toBe(true)
    // One satisfied flag is not enough...
    expect(satisfiesBrainCapabilities(capabilities({ textInput: true }), both)).toBe(false)
    expect(satisfiesBrainCapabilities(capabilities({ imageInput: true }), both)).toBe(false)
    // ...and neither is clearly not.
    expect(satisfiesBrainCapabilities(NONE, both)).toBe(false)
  })

  it('d: an unrelated false capability never affects eligibility', () => {
    const caps = capabilities({ audioInput: false, audioOutput: false, textInput: true, videoInput: false })
    expect(satisfiesBrainCapabilities(caps, requirement('textInput'))).toBe(true)
    // Only the listed capabilities constrain the answer.
    expect(satisfiesBrainCapabilities(caps, requirement('textInput', 'reasoning'))).toBe(false)
  })

  it('e: text, image, audio and video requirements stay independent', () => {
    const inputFlags = ['audioInput', 'imageInput', 'textInput', 'videoInput'] as const
    for (const flag of inputFlags) {
      const caps = capabilities({ [flag]: true })
      expect(satisfiesBrainCapabilities(caps, requirement(flag)), flag).toBe(true)
      for (const other of inputFlags.filter(candidate => candidate !== flag))
        expect(satisfiesBrainCapabilities(caps, requirement(other)), `${flag} must not satisfy ${other}`).toBe(false)
    }
    // Output axes are their own dimensions as well.
    expect(satisfiesBrainCapabilities(capabilities({ audioOutput: true }), requirement('audioOutput'))).toBe(true)
    expect(satisfiesBrainCapabilities(capabilities({ audioOutput: true }), requirement('textOutput'))).toBe(false)
    expect(satisfiesBrainCapabilities(capabilities({ textOutput: true }), requirement('audioOutput'))).toBe(false)
  })

  it('f: reasoning, toolCalling and realtime stay independent', () => {
    const flags = ['realtime', 'reasoning', 'toolCalling'] as const
    for (const flag of flags) {
      const caps = capabilities({ [flag]: true })
      expect(satisfiesBrainCapabilities(caps, requirement(flag)), flag).toBe(true)
      for (const other of flags.filter(candidate => candidate !== flag))
        expect(satisfiesBrainCapabilities(caps, requirement(other)), `${flag} must not satisfy ${other}`).toBe(false)
    }
  })

  it('g: eligibleBrainModels filters correctly and preserves input order', () => {
    const models = [
      model('m-text', capabilities({ textInput: true, textOutput: true })),
      model('m-vision', capabilities({ imageInput: true, textInput: true, textOutput: true })),
      model('m-plain', capabilities({ textOutput: true })),
      model('m-full', capabilities({ imageInput: true, textInput: true, textOutput: true, toolCalling: true })),
    ]

    const vision = eligibleBrainModels(models, requirement('imageInput', 'textInput'))
    expect(vision.map(entry => entry.id)).toEqual(['m-vision', 'm-full'])

    // Empty requirement keeps everyone, in order.
    expect(eligibleBrainModels(models, requirement()).map(entry => entry.id))
      .toEqual(['m-text', 'm-vision', 'm-plain', 'm-full'])
    // Nothing eligible is an honest empty result.
    expect(eligibleBrainModels(models, requirement('realtime'))).toEqual([])
  })

  it('h: eligibleBrainEngines filters correctly, preserves order, and never infers across layers', () => {
    const engines = [
      engine('e-text', capabilities({ textInput: true, textOutput: true })),
      engine('e-vision', capabilities({ imageInput: true, textInput: true, textOutput: true })),
      engine('e-live', capabilities({ realtime: true, textInput: true, textOutput: true })),
    ]
    expect(eligibleBrainEngines(engines, requirement('imageInput')).map(entry => entry.id)).toEqual(['e-vision'])
    expect(eligibleBrainEngines(engines, requirement('textInput')).map(entry => entry.id))
      .toEqual(['e-text', 'e-vision', 'e-live'])
    expect(eligibleBrainEngines(engines, requirement()).map(entry => entry.id))
      .toEqual(['e-text', 'e-vision', 'e-live'])

    // Engine eligibility reads the ENGINE descriptor alone: this engine's
    // model list names a vision model, yet the engine itself declares no
    // image input - so it is NOT eligible for image tasks...
    const hostEngine = engine('e-host', capabilities({ textInput: true, textOutput: true }))
    expect(eligibleBrainEngines([hostEngine], requirement('imageInput'))).toEqual([])
    // ...while a MODEL is judged by its own descriptor alone, even when its
    // engine declares less.
    const visionModel = model('m-vision', capabilities({ imageInput: true, textInput: true }), 'e-host')
    expect(eligibleBrainModels([visionModel], requirement('imageInput')).map(entry => entry.id)).toEqual(['m-vision'])
  })

  it('i: inputs are never mutated (arrays and descriptors alike)', () => {
    const models = [
      model('m-1', capabilities({ textInput: true })),
      model('m-2', capabilities({ imageInput: true })),
    ]
    const engines = [
      engine('e-1', capabilities({ textInput: true })),
      engine('e-2', capabilities({ audioInput: true })),
    ]
    const modelsBefore = JSON.parse(JSON.stringify(models))
    const enginesBefore = JSON.parse(JSON.stringify(engines))

    const modelResult = eligibleBrainModels(models, requirement('textInput'))
    const engineResult = eligibleBrainEngines(engines, requirement('textInput'))

    // The results are NEW arrays (never the input re-handed back)...
    expect(modelResult).not.toBe(models)
    expect(engineResult).not.toBe(engines)
    // ...and both inputs read back exactly as they went in.
    expect(JSON.parse(JSON.stringify(models))).toEqual(modelsBefore)
    expect(JSON.parse(JSON.stringify(engines))).toEqual(enginesBefore)

    // The requirement itself is read-only too.
    const frozen = Object.freeze({ required: Object.freeze(['textInput'] as const) })
    expect(satisfiesBrainCapabilities(capabilities({ textInput: true }), frozen)).toBe(true)
  })

  it('j: no vendor/provider-specific rule exists in this layer', () => {
    const source = readSource('./capabilities.ts')
    const vendors = /groq|qwen|openai|anthropic|gemini|claude|\bgpt\b|mistral|ollama|deepseek/i
    expect(source).not.toMatch(vendors)
    // Imports are descriptor types ONLY - no registry ownership, no ids.
    expect(source).toMatch(/import type \{[\s\S]*?\} from '\.\/types'/)
    expect(source).not.toContain('from \'./engine-registry\'')
  })

  it('k: no ranking/scoring/fallback behavior exists - eligibility only', () => {
    const source = readSource('./capabilities.ts')
    expect(source).not.toMatch(/rank|score|priority|weight|fallback|prefer/i)
    // The ONLY runtime helpers are the eligibility ones; nothing sorts,
    // compares or picks a candidate.
    expect(source).not.toMatch(/\bsort\(|\bcompare|best|pick|choose/i)

    // Behavioral proof: the answer is a boolean/membership, never a choice -
    // two eligible candidates come back BOTH, in order, unchanged.
    const engines = [
      engine('e-a', capabilities({ textInput: true })),
      engine('e-b', capabilities({ textInput: true })),
    ]
    expect(eligibleBrainEngines(engines, requirement('textInput'))).toHaveLength(2)
  })

  it('l: no network/filesystem/config side effects - pure matching', () => {
    const source = readSource('./capabilities.ts')
    expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram)['/]/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios/)
    expect(source).not.toMatch(/readFile|writeFile|process\.env|import\.meta\.env/)

    // Behavioral proof: identical inputs always produce identical answers,
    // with nothing observable between calls.
    const caps = capabilities({ textInput: true, toolCalling: true })
    const req = requirement('textInput', 'toolCalling')
    const first = satisfiesBrainCapabilities(caps, req)
    const second = satisfiesBrainCapabilities(caps, req)
    expect(first).toBe(true)
    expect(second).toBe(first)
  })
})
