import type { LiaBrainDescriptorSet } from './adapters/groq'
import type { LiaBrainModelDescriptor } from './types'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { groqBrainDescriptors } from './adapters/groq'
import { composeBrainCatalog, createProductionBrainCatalog } from './catalog'
import { decideBrainRouteFromProductState } from './runtime'

/**
 * Phase 8.0D-3: the production catalog - composition, invariants and
 * isolation. Nothing here is wired into a runtime consumer yet.
 */

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

describe('production brain catalog (8.0D-3)', () => {
  it('a/B: exactly one production engine, and it is groq', () => {
    const catalog = createProductionBrainCatalog()
    expect(catalog.engines).toHaveLength(1)
    expect(catalog.engines[0].id).toBe('groq')
    expect(catalog.engines[0].name).toBe('Groq')
  })

  it('c/D: exactly one production model, and it is openai/gpt-oss-120b', () => {
    const catalog = createProductionBrainCatalog()
    expect(catalog.models).toHaveLength(1)
    expect(catalog.models[0].id).toBe('openai/gpt-oss-120b')
    expect(catalog.models[0].name).toBe('GPT-OSS 120B')
  })

  it('e: the engine was registered through the canonical registry', () => {
    const catalog = createProductionBrainCatalog()
    // The registry enumerates exactly the catalog engine (its own clone),
    // so the arrays and the registry describe the same descriptors.
    expect(catalog.registry.list().map(entry => entry.id)).toEqual(['groq'])
    expect(catalog.registry.list()[0]).toEqual(catalog.engines[0])
  })

  it('f: resolving the groq engine id returns the catalog engine', () => {
    const catalog = createProductionBrainCatalog()
    const resolved = catalog.registry.resolve('groq')
    expect(resolved).toEqual(catalog.engines[0])
    expect(resolved?.id).toBe('groq')
    expect(resolved?.capabilities.textInput).toBe(true)
  })

  it('g: the model association is valid in both directions', () => {
    const catalog = createProductionBrainCatalog()
    const [engine] = catalog.engines
    const [model] = catalog.models
    expect(model.engineId).toBe(engine.id)
    expect(engine.modelIds).toContain(model.id)
    // ...and the engine's declared ids describe exactly the catalog models.
    expect(engine.modelIds).toEqual(catalog.models.map(entry => entry.id))
  })

  it('h: the catalog composes groqBrainDescriptors() instead of restating descriptors', () => {
    const adapter = groqBrainDescriptors()
    const catalog = createProductionBrainCatalog()
    // Same content as the adapter, whatever the adapter says...
    expect(catalog.engines).toEqual(adapter.engines)
    expect(catalog.models).toEqual(adapter.models)

    // ...because the catalog file never spells an engine/model literal itself.
    const source = readSource('./catalog.ts')
    expect(source).toContain('groqBrainDescriptors')
    expect(source).not.toContain('openai/gpt-oss-120b')
    expect(source).not.toMatch(/'groq'/)
    expect(source).not.toMatch(/name: 'Groq'/)
  })

  it('i: an invalid engine registration fails construction deterministically', () => {
    const blankIdSet: LiaBrainDescriptorSet = {
      engines: [{ ...groqBrainDescriptors().engines[0], id: '' }],
      models: [],
    }
    expect(() => composeBrainCatalog([blankIdSet])).toThrow(/invalid-engine-id/)
    // Deterministic: the same input fails the same way, every time.
    expect(() => composeBrainCatalog([blankIdSet])).toThrow(/invalid-engine-id/)
    // The production factory is unaffected by a malformed caller set.
    expect(createProductionBrainCatalog().engines).toHaveLength(1)
  })

  it('j: a duplicate production engine id fails construction deterministically', () => {
    const set = groqBrainDescriptors()
    // Two adapters claiming the same engine id...
    expect(() => composeBrainCatalog([set, groqBrainDescriptors()])).toThrow(/duplicate-engine-id/)
    // ...or one adapter listing the same engine twice.
    expect(() => composeBrainCatalog([{ engines: [set.engines[0], set.engines[0]], models: set.models }]))
      .toThrow(/duplicate-engine-id/)
    // The refusal names the engine that collided.
    expect(() => composeBrainCatalog([set, set])).toThrow(/engine 'groq' was refused/)
  })

  it('k: a model naming an unregistered engine fails construction deterministically', () => {
    const [model] = groqBrainDescriptors().models
    const orphanSet: LiaBrainDescriptorSet = { engines: [], models: [model] }
    expect(() => composeBrainCatalog([orphanSet])).toThrow(/which is not registered/)
    expect(() => composeBrainCatalog([orphanSet])).toThrow(/model 'openai\/gpt-oss-120b'/)
  })

  it('l: an engine that does not declare its model fails construction deterministically', () => {
    const adapter = groqBrainDescriptors()
    const undeclaredSet: LiaBrainDescriptorSet = {
      // The engine exists and the association is otherwise plausible, but the
      // engine never declares the model id.
      engines: [{ ...adapter.engines[0], modelIds: [] }],
      models: adapter.models,
    }
    expect(() => composeBrainCatalog([undeclaredSet])).toThrow(/does not declare model/)
    expect(() => composeBrainCatalog([undeclaredSet])).toThrow(/engine 'groq'/)
  })

  it('m: repeated factory calls return independent registries and arrays', () => {
    const first = createProductionBrainCatalog()
    const second = createProductionBrainCatalog()

    expect(first.registry).not.toBe(second.registry)
    expect(first.engines).not.toBe(second.engines)
    expect(first.models).not.toBe(second.models)

    // Mutating the first catalog's structures (deliberately abusive) must not
    // leak into a later factory call.
    const engines = first.engines as unknown as { id: string, modelIds: string[] }[]
    engines.push({ id: 'intruder', modelIds: [] })
    engines[0].modelIds.push('invented-model')
    const models = first.models as unknown as LiaBrainModelDescriptor[]
    models.push({ ...models[0], id: 'intruder-model' })

    const third = createProductionBrainCatalog()
    expect(third.engines).toHaveLength(1)
    expect(third.engines[0].modelIds).toEqual(['openai/gpt-oss-120b'])
    expect(third.models).toHaveLength(1)
    expect(third.registry.resolve('intruder')).toBeUndefined()
    // The registry's own state survived the abuse of its enumeration output.
    expect(third.registry.resolve('groq')?.modelIds).toEqual(['openai/gpt-oss-120b'])
    expect(third.engines).toEqual(groqBrainDescriptors().engines)
  })

  it('n: the catalog descriptors work directly with decideBrainRouteFromProductState', () => {
    const { engines, models } = createProductionBrainCatalog()

    const manual = decideBrainRouteFromProductState({
      engines,
      models,
      requirement: { required: ['textInput'] },
      snapshot: { brain: { engine: { preferred: 'groq' }, mode: 'manual', model: { preferred: 'openai/gpt-oss-120b' } } },
    })
    expect(manual.status).toBe('manual')
    if (manual.status !== 'manual')
      return
    expect(manual.resolution.status).toBe('resolvedModel')

    const automatic = decideBrainRouteFromProductState({
      engines,
      models,
      requirement: { required: ['textInput', 'reasoning'] },
      automaticPolicy: { routes: [{ engineId: 'groq', modelId: 'openai/gpt-oss-120b' }] },
      snapshot: { brain: { mode: 'automatic' } },
    })
    expect(automatic.status).toBe('automatic')
    if (automatic.status !== 'automatic')
      return
    expect(automatic.selection.status).toBe('selected')
    if (automatic.selection.status !== 'selected')
      return
    expect(automatic.selection.route.engine.id).toBe('groq')
    expect(automatic.selection.route.model.id).toBe('openai/gpt-oss-120b')

    // An unsupported ask yields no candidate route - the catalog describes
    // availability, it never promises more than the descriptors support.
    const unsupported = decideBrainRouteFromProductState({
      engines,
      models,
      requirement: { required: ['imageInput'] },
      automaticPolicy: { routes: [{ engineId: 'groq', modelId: 'openai/gpt-oss-120b' }] },
      snapshot: { brain: { mode: 'automatic' } },
    })
    expect(unsupported).toEqual({ selection: { status: 'noCandidates' }, status: 'automatic' })
  })

  it('o: the catalog owns no routing intent or stored selection', () => {
    const source = readSource('./catalog.ts')
    expect(source).not.toMatch(/\bmode\b|\bpreferred\b|\bpolicy\b|\brequirement\b|\bautomatic\b|\bmanual\b|\bdisabled\b/i)

    // Shape proof: the catalog exposes descriptors and the registry only.
    const catalog = createProductionBrainCatalog()
    expect(Object.keys(catalog).sort()).toEqual(['engines', 'models', 'registry'])
  })

  it('p: no config, credential, environment, network, engine-start or IPC side effects exist', () => {
    const source = readSource('./catalog.ts')
    expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram|electron|worker_threads)['/]/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios/)
    expect(source).not.toMatch(/readFile|writeFile|existsSync|process\.env|vault|apiKey|api_key/i)
    expect(source).not.toMatch(/readLiaProductConfig|updateLiaProductConfig|decideBrainRoute|ipcMain|ipcRenderer/)
    // Value imports are exactly two: the registry factory and the adapter.
    expect(source.split('\n').filter(line => line.startsWith('import ') && !line.startsWith('import type ')).sort())
      .toEqual([
        'import { createBrainEngineRegistry } from \'./engine-registry\'',
        'import { groqBrainDescriptors } from \'./adapters/groq\'',
      ])
  })

  it('q: the generic Brain modules stay unaware of the catalog and the adapter', () => {
    const domainDir = fileURLToPath(new URL('.', import.meta.url))
    // Every production module except the composition catalog itself.
    const genericFiles = readdirSync(domainDir)
      .filter(name => name.endsWith('.ts') && !name.includes('.test.') && name !== 'catalog.ts')
    expect(genericFiles.length).toBeGreaterThan(0)
    for (const name of genericFiles) {
      const source = readFileSync(`${domainDir}/${name}`, 'utf-8')
      expect(source, name).not.toMatch(/from '\.\/(?:catalog|adapters)/)
      expect(source, name).not.toMatch(/\bgroq\b/i)
    }
    // The dependency direction is catalog -> adapter -> types, never reversed.
    expect(readSource('./catalog.ts')).toContain('from \'./adapters/groq\'')
    expect(readSource('./adapters/groq.ts')).not.toMatch(/from '\.\.\/(?:catalog|routes|decision|runtime)/)
  })
})
