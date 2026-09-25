import type { LiaBrainModelRoute } from './routes'
import type { LiaBrainCapabilities, LiaBrainEngineAvailability, LiaBrainEngineDescriptor, LiaBrainModelDescriptor } from './types'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { brainEngineReadiness, readyBrainModelRoutes } from './readiness'

/**
 * Phase 8.0C-4: engine readiness - "can this engine execute NOW?", kept
 * strictly apart from capability eligibility ("can it support this at all?").
 *
 * Real behavior: readiness reads declared descriptor availability only, and
 * the filter is a pure, order-preserving, duplicate-preserving pass-through.
 */

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

const TEXT: LiaBrainCapabilities = { ...NONE, textInput: true, textOutput: true }

function engine(id: string, availability: LiaBrainEngineAvailability, modelIds: readonly string[] = []): LiaBrainEngineDescriptor {
  return { availability, capabilities: TEXT, id, modelIds, name: `Engine ${id}` }
}

function model(id: string, engineId: string): LiaBrainModelDescriptor {
  return { capabilities: TEXT, engineId, id, name: `Model ${id}` }
}

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('brain engine readiness (Phase 8.0C-4)', () => {
  it('a/b/c: declared availability maps onto exactly one readiness state', () => {
    // A: the shipped, selectable engine.
    expect(brainEngineReadiness(engine('e-ready', 'available'))).toEqual({ status: 'ready' })
    // B: known, but not executable until configured.
    expect(brainEngineReadiness(engine('e-config', 'configurationRequired'))).toEqual({ status: 'configurationRequired' })
    // C: not usable in this build at all.
    expect(brainEngineReadiness(engine('e-off', 'unavailable'))).toEqual({ status: 'unavailable' })

    // The mapping reads availability ONLY - nothing else about the
    // descriptor changes the answer.
    const rich: LiaBrainEngineDescriptor = {
      availability: 'configurationRequired',
      capabilities: { ...TEXT, imageInput: true, toolCalling: true },
      id: 'e-rich',
      modelIds: ['m-one', 'm-two'],
      name: 'Very Capable Engine',
    }
    expect(brainEngineReadiness(rich)).toEqual({ status: 'configurationRequired' })

    // Fresh value per call - no shared mutable readiness object.
    const first = brainEngineReadiness(engine('e-ready', 'available'))
    const second = brainEngineReadiness(engine('e-ready', 'available'))
    expect(first).not.toBe(second)
    expect(first).toEqual(second)
  })

  it('d: only available engines survive the route filter', () => {
    const ready = engine('e-ready', 'available')
    const config = engine('e-config', 'configurationRequired')
    const off = engine('e-off', 'unavailable')
    const routes: LiaBrainModelRoute[] = [
      { engine: config, model: model('m-b', 'e-config') },
      { engine: ready, model: model('m-a', 'e-ready') },
      { engine: off, model: model('m-c', 'e-off') },
    ]

    const filtered = readyBrainModelRoutes(routes)
    expect(filtered).toHaveLength(1)
    expect(filtered[0].engine).toBe(ready)
    expect(filtered.map(route => route.engine.id)).toEqual(['e-ready'])
  })

  it('e/f: order is preserved verbatim and duplicates stay duplicated', () => {
    const first = engine('e-one', 'available')
    const second = engine('e-two', 'available')
    const shared = { engine: first, model: model('m-shared', 'e-one') }
    const routes: LiaBrainModelRoute[] = [
      shared,
      { engine: second, model: model('m-two', 'e-two') },
      shared,
      { engine: engine('e-config', 'configurationRequired'), model: model('m-skipped', 'e-config') },
      shared,
    ]

    const filtered = readyBrainModelRoutes(routes)
    // E: input order, verbatim - no sorting, no ranking, no dedup.
    expect(filtered.map(route => route.engine.id)).toEqual(['e-one', 'e-two', 'e-one', 'e-one'])
    // F: the very same route OBJECTS come back (identity too), duplicates included.
    expect(filtered).toEqual([shared, routes[1], shared, shared])
    expect(filtered[0]).toBe(shared)
    expect(filtered[2]).toBe(shared)
  })

  it('g: the input array and its routes are never mutated', () => {
    const routes: LiaBrainModelRoute[] = [
      { engine: engine('e-ready', 'available'), model: model('m-ready', 'e-ready') },
      { engine: engine('e-config', 'configurationRequired'), model: model('m-config', 'e-config') },
    ]
    const before = JSON.stringify(routes)
    const engineBefore = routes[0].engine

    const filtered = readyBrainModelRoutes(routes)

    // G: a NEW array; the input is untouched, and the kept descriptors are
    // the same objects the caller handed over.
    expect(filtered).not.toBe(routes)
    expect(JSON.stringify(routes)).toBe(before)
    expect(routes).toHaveLength(2)
    expect(filtered[0].engine).toBe(engineBefore)
    // Empty in, empty out - and no exception for it.
    expect(readyBrainModelRoutes([])).toEqual([])
  })

  it('h: the filter performs no capability, policy or ordering logic', () => {
    const source = stripComments(readSource('./readiness.ts'))

    // H: availability is the ONLY predicate; no capabilities, no policy, no
    // candidate composition, no ordering, no fallback.
    expect(source).toMatch(/route\.engine\.availability === 'available'/)
    expect(source).not.toMatch(/capabilit|requirement/i)
    expect(source).not.toMatch(/policy|precedence|select/i)
    expect(source).not.toMatch(/\bsort\(|\breverse\(|\brank|score|weight|prefer|fallback/i)
    expect(source).not.toMatch(/eligibleBrainModelRoutes|selectBrainRouteByPolicy|resolvePreferredBrainSelection/)
  })

  it('z: readiness is a pure interpretation - no config, I/O, network or provider logic', () => {
    const source = stripComments(readSource('./readiness.ts'))

    expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram|os|path)['/]/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios|sdk|credential|token|apiKey/i)
    expect(source).not.toMatch(/process\.env|readFile|writeFile|vault|secret/i)
    expect(source).not.toMatch(/readLiaProductConfig|product\/config|registry|engine-registry/)
    // Nothing provider-specific: no vendor names, no ids, no model names.
    expect(source).not.toMatch(/groq|gpt|qwen|openai|anthropic|gemini|claude|ollama|mistral|deepseek/i)
    expect(source).not.toMatch(/engine\.id|modelIds/)
    // Imports are the descriptor/route TYPES and nothing else.
    expect(source.match(/^import .*$/gm)?.sort()).toEqual([
      'import type { LiaBrainEngineDescriptor } from \'./types\'',
      'import type { LiaBrainModelRoute } from \'./routes\'',
    ])
  })

  it('the capability layer stays unaware of availability (separation of concerns)', () => {
    // X: eligibility did not learn about readiness.
    const eligibility = stripComments(readSource('./capabilities.ts'))
    expect(eligibility).not.toMatch(/availability|readiness|ready/i)
    // Y: the policy selector did not learn about readiness either.
    const selection = stripComments(readSource('./selection.ts'))
    expect(selection).not.toMatch(/availability|readiness|ready/i)
    // ...and the readiness module owns no capability logic of its own.
    const readiness = stripComments(readSource('./readiness.ts'))
    expect(readiness).not.toMatch(/satisfiesBrainCapabilities|required/)
    // The two concepts are separate modules with a one-way dependency.
    expect(readiness).toContain('from \'./routes\'')
    expect(readiness).not.toContain('from \'./capabilities\'')
    expect(eligibility).not.toContain('\'./readiness\'')
    expect(selection).not.toContain('\'./readiness\'')
  })

  it('the brain domain keeps its module inventory intact', () => {
    const domainDir = fileURLToPath(new URL('.', import.meta.url))
    const files = readdirSync(domainDir).filter(name => name.endsWith('.ts') && !name.includes('.test.'))
    // One new pure module joined the domain; nothing was merged or removed.
    expect(files.sort()).toEqual([
      'capabilities.ts',
      'catalog.ts',
      'chat-requirement.ts',
      'decision.ts',
      'engine-registry.ts',
      'readiness.ts',
      'resolver.ts',
      'routes.ts',
      'runtime.ts',
      'selection.ts',
      'types.ts',
    ])
  })
})
