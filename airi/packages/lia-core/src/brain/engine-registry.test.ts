import type { LiaBrainCapabilities, LiaBrainEngineDescriptor, LiaBrainModelDescriptor } from './types'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createBrainEngineRegistry, modelsForEngine } from './engine-registry'

/**
 * Phase 8.0B-1: the Brain Engine registry foundation, proven WITHOUT any
 * vendor, network or filesystem involvement - pure domain rules only.
 */

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

/** All capabilities off - tests flip exactly the flags they care about. */
const NO_CAPABILITIES: LiaBrainCapabilities = {
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

function engine(overrides: Partial<LiaBrainEngineDescriptor> = {}): LiaBrainEngineDescriptor {
  return {
    availability: 'available',
    capabilities: { ...NO_CAPABILITIES, textInput: true, textOutput: true },
    id: 'engine-alpha',
    modelIds: ['model-alpha'],
    name: 'Engine Alpha',
    ...overrides,
  }
}

describe('brain engine registry (8.0B-1)', () => {
  it('a: an engine can be registered', () => {
    const registry = createBrainEngineRegistry()
    expect(registry.register(engine())).toEqual({ status: 'registered' })
    expect(registry.resolve('engine-alpha')).toMatchObject({
      id: 'engine-alpha',
      name: 'Engine Alpha',
      availability: 'available',
      modelIds: ['model-alpha'],
    })
  })

  it('b: engines can be listed - empty registry is honest, order is stable', () => {
    const registry = createBrainEngineRegistry()
    expect(registry.list()).toEqual([])

    registry.register(engine({ id: 'engine-one', name: 'One' }))
    registry.register(engine({ id: 'engine-two', name: 'Two' }))
    expect(registry.list().map(entry => entry.id)).toEqual(['engine-one', 'engine-two'])
  })

  it('c: an engine resolves by exact id; unknown/blank ids stay undefined', () => {
    const registry = createBrainEngineRegistry()
    registry.register(engine({ id: 'engine-alpha' }))

    expect(registry.resolve('engine-alpha')?.id).toBe('engine-alpha')
    expect(registry.resolve('  engine-alpha  ')?.id).toBe('engine-alpha')
    expect(registry.resolve('engine-beta')).toBeUndefined()
    expect(registry.resolve('')).toBeUndefined()
    expect(registry.resolve(undefined as unknown as string)).toBeUndefined()
  })

  it('d: duplicate engine ids are rejected deterministically (first wins)', () => {
    const registry = createBrainEngineRegistry()
    expect(registry.register(engine({ id: 'engine-alpha', name: 'First' }))).toEqual({ status: 'registered' })

    const second = registry.register(engine({ id: 'engine-alpha', name: 'Second' }))
    expect(second).toEqual({ reason: 'duplicate-engine-id', status: 'rejected' })
    // ...and the original descriptor SURVIVES the attempt.
    expect(registry.resolve('engine-alpha')?.name).toBe('First')
    expect(registry.list()).toHaveLength(1)

    // Blank ids are rejected just as deterministically.
    expect(registry.register(engine({ id: '   ' }))).toEqual({ reason: 'invalid-engine-id', status: 'rejected' })
  })

  it('e: a model descriptor retains its engine association (and the pure filter honors it)', () => {
    const model: LiaBrainModelDescriptor = {
      capabilities: { ...NO_CAPABILITIES, textInput: true, textOutput: true },
      engineId: 'engine-alpha',
      id: 'model-alpha',
      metadata: { contextWindow: 32000 },
      name: 'Model Alpha',
    }
    expect(model.engineId).toBe('engine-alpha')

    const other: LiaBrainModelDescriptor = { ...model, engineId: 'engine-beta', id: 'model-beta' }
    expect(modelsForEngine([model, other], 'engine-alpha')).toEqual([model])
    expect(modelsForEngine([model, other], 'engine-beta')).toEqual([other])
    expect(modelsForEngine([model, other], 'engine-gamma')).toEqual([])
  })

  it('f: capability descriptors preserve independent flags per descriptor', () => {
    const registry = createBrainEngineRegistry()
    registry.register(engine({
      capabilities: { ...NO_CAPABILITIES, textInput: true, textOutput: true, toolCalling: true },
      id: 'tool-brain',
    }))
    registry.register(engine({
      capabilities: { ...NO_CAPABILITIES, textInput: true, textOutput: true },
      id: 'plain-brain',
    }))

    // Each descriptor keeps ITS OWN flags - the registry never merges them.
    expect(registry.resolve('tool-brain')?.capabilities.toolCalling).toBe(true)
    expect(registry.resolve('plain-brain')?.capabilities.toolCalling).toBe(false)
    expect(registry.resolve('plain-brain')?.capabilities.textOutput).toBe(true)
  })

  it('g: audio, image and video capabilities are independent dimensions', () => {
    const registry = createBrainEngineRegistry()
    registry.register(engine({
      capabilities: { ...NO_CAPABILITIES, audioInput: true, textInput: true, textOutput: true },
      id: 'ears-only',
    }))
    registry.register(engine({
      capabilities: { ...NO_CAPABILITIES, imageInput: true, textInput: true, textOutput: true },
      id: 'eyes-only',
    }))
    registry.register(engine({
      capabilities: { ...NO_CAPABILITIES, textInput: true, textOutput: true, videoInput: true },
      id: 'film-only',
    }))

    // Hearing implies neither seeing nor filming - and vice versa.
    expect(registry.resolve('ears-only')?.capabilities).toMatchObject({ audioInput: true, imageInput: false, videoInput: false })
    expect(registry.resolve('eyes-only')?.capabilities).toMatchObject({ audioInput: false, imageInput: true, videoInput: false })
    expect(registry.resolve('film-only')?.capabilities).toMatchObject({ audioInput: false, imageInput: false, videoInput: true })
    // Audio output is its own axis as well.
    expect(registry.resolve('ears-only')?.capabilities.audioOutput).toBe(false)
  })

  it('h: toolCalling, reasoning and realtime are independent dimensions', () => {
    const flags = ['reasoning', 'toolCalling', 'realtime'] as const
    for (const flag of flags) {
      const registry = createBrainEngineRegistry()
      registry.register(engine({
        capabilities: { ...NO_CAPABILITIES, [flag]: true, textInput: true, textOutput: true },
        id: 'flagged',
      }))
      const capabilities = registry.resolve('flagged')?.capabilities
      expect(capabilities?.[flag], flag).toBe(true)
      for (const other of flags.filter(candidate => candidate !== flag))
        expect(capabilities?.[other], `${flag} must not imply ${other}`).toBe(false)
    }
  })

  it('i: the registry contains no vendor/provider-specific behavior', () => {
    const registrySource = readSource('./engine-registry.ts')
    const typesSource = readSource('./types.ts')
    const vendors = /groq|qwen|openai|anthropic|gemini|claude|\bgpt\b|mistral|ollama|deepseek/i
    expect(registrySource).not.toMatch(vendors)
    expect(typesSource).not.toMatch(vendors)

    // And it hardcodes no engine/model ids at all - registration is the
    // ONLY way an engine enters.
    expect(registrySource).not.toContain('id: \'')
  })

  it('j: no network/filesystem side effects - pure in-memory behavior', () => {
    const registrySource = readSource('./engine-registry.ts')
    const typesSource = readSource('./types.ts')
    for (const source of [registrySource, typesSource]) {
      expect(source).not.toMatch(/from ['"]node:/)
      expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram)['/]/)
      expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios/)
    }

    // Behavioral proof: reads are copies, so callers can never mutate the
    // registry through what they received.
    const registry = createBrainEngineRegistry()
    registry.register(engine({ id: 'engine-alpha', modelIds: ['model-alpha'] }))

    const listed = registry.list() as LiaBrainEngineDescriptor[]
    listed[0].name = 'hijacked'
    ;(listed[0].modelIds as string[]).push('injected')
    listed.push(engine({ id: 'fake' }))
    expect(registry.resolve('engine-alpha')?.name).toBe('Engine Alpha')
    expect(registry.resolve('engine-alpha')?.modelIds).toEqual(['model-alpha'])
    expect(registry.list()).toHaveLength(1)

    const resolved = registry.resolve('engine-alpha') as LiaBrainEngineDescriptor
    resolved.capabilities.toolCalling = true
    expect(registry.resolve('engine-alpha')?.capabilities.toolCalling).toBe(false)
  })
})
