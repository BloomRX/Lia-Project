import type { LiaBrainCapability } from '../capabilities'
import type { LiaBrainCapabilities } from '../types'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { satisfiesBrainCapabilities } from '../capabilities'
import { createBrainEngineRegistry, modelsForEngine } from '../engine-registry'
import { eligibleBrainModelRoutes } from '../routes'
import { decideBrainRouteFromProductState } from '../runtime'
import { GROQ_BRAIN_ENGINE_ID, GROQ_BRAIN_MODEL_ID, groqBrainDescriptors } from './groq'

/**
 * Phase 8.0D-2: the current-brain adapter - identity, association,
 * capability honesty and compatibility with the existing pure layers.
 * Nothing here is consumed by production yet.
 */

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

/** The nine capability dimensions, from the canonical domain interface. */
const CAPABILITY_FLAGS: readonly LiaBrainCapability[] = [
  'audioInput',
  'audioOutput',
  'imageInput',
  'realtime',
  'reasoning',
  'textInput',
  'textOutput',
  'toolCalling',
  'videoInput',
]

describe('current brain descriptor adapter (8.0D-2)', () => {
  it('a: exactly the intended current engine is described', () => {
    const { engines } = groqBrainDescriptors()
    expect(engines).toHaveLength(1)
    const [engine] = engines
    expect(engine.id).toBe('groq')
    expect(engine.name).toBe('Groq')
    // Product support, not live authentication health.
    expect(engine.availability).toBe('available')
  })

  it('b: exactly the intended current model is described', () => {
    const { models } = groqBrainDescriptors()
    expect(models).toHaveLength(1)
    const [model] = models
    expect(model.id).toBe('openai/gpt-oss-120b')
    expect(model.name).toBe('GPT-OSS 120B')
    // No hypothetical or future models, no metadata inventing.
    expect(model.metadata).toBeUndefined()
  })

  it('c/D: engine and model ids are stable and non-empty across calls', () => {
    for (const id of [GROQ_BRAIN_ENGINE_ID, GROQ_BRAIN_MODEL_ID]) {
      expect(typeof id).toBe('string')
      expect(id.trim().length).toBeGreaterThan(0)
    }
    const first = groqBrainDescriptors()
    const second = groqBrainDescriptors()
    expect(first.engines[0].id).toBe(second.engines[0].id)
    expect(first.models[0].id).toBe(second.models[0].id)
    expect(first.engines[0].id).toBe(GROQ_BRAIN_ENGINE_ID)
    expect(first.models[0].id).toBe(GROQ_BRAIN_MODEL_ID)
  })

  it('c/D (evidence): the ids come from the repository catalogs, not from memory', () => {
    // The Lia chat catalog that onboarding persists from.
    const liaCatalog = readSource('../../../../../apps/stage-tamagotchi/src/renderer/stores/lia/provider.ts')
    expect(liaCatalog).toContain('{ id: \'groq\', label: \'Groq\'')
    expect(liaCatalog).toContain('{ id: \'openai/gpt-oss-120b\', label: \'GPT-OSS 120B\' }')

    // The AIRI provider definition that actually builds the chat requests.
    const provider = readSource('../../../../stage-ui/src/libs/providers/providers/groq/index.ts')
    expect(provider).toContain('id: \'groq\'')
    expect(provider).toContain('name: \'Groq\'')
  })

  it('e: model.engineId matches engine.id', () => {
    const { engines, models } = groqBrainDescriptors()
    expect(models[0].engineId).toBe(engines[0].id)
  })

  it('f: the engine declares exactly this model in modelIds', () => {
    const { engines, models } = groqBrainDescriptors()
    expect(engines[0].modelIds).toEqual([models[0].id])
    expect(engines[0].modelIds).toContain(GROQ_BRAIN_MODEL_ID)
  })

  it('g: all nine capability flags are explicitly present on both descriptors', () => {
    const { engines, models } = groqBrainDescriptors()
    for (const caps of [engines[0].capabilities, models[0].capabilities]) {
      expect(Object.keys(caps).sort()).toEqual([...CAPABILITY_FLAGS].sort())
      for (const flag of CAPABILITY_FLAGS)
        expect(typeof caps[flag], flag).toBe('boolean')
    }
  })

  it('h: capability values match the audited CURRENT repository behavior', () => {
    const expected: LiaBrainCapabilities = {
      // Declared task is 'chat' - text conversation in and out.
      audioInput: false,
      // A distinct capability from Lia's TTS voice engine (never inferred).
      audioOutput: false,
      // Image understanding is a SEPARATE AIRI module; the engine declares
      // the 'chat' task only - no repository evidence for this brain path.
      imageInput: false,
      // The current path exposes no interactive/low-latency sessions.
      realtime: false,
      // The engine declares reasoning modes and its effort mapping targets
      // this model family explicitly.
      reasoning: true,
      textInput: true,
      textOutput: true,
      // The chat execution path composes built-in + custom tools into the
      // request, handles tool results and can re-run a tool call.
      toolCalling: true,
      videoInput: false,
    }
    const { engines, models } = groqBrainDescriptors()
    expect(engines[0].capabilities).toEqual(expected)
    expect(models[0].capabilities).toEqual(expected)

    // Evidence for the reasoning flag: declared BY THE PROVIDER DEFINITION.
    const provider = readSource('../../../../stage-ui/src/libs/providers/providers/groq/index.ts')
    expect(provider).toContain('reasoning')
    expect(provider).toMatch(/gpt-oss accepts only/)

    // Evidence that no vision task is declared for this engine (so image
    // input cannot be claimed): tasks is the chat task alone.
    expect(provider).toMatch(/tasks: \['chat'\]/)
    expect(provider).not.toMatch(/tasks: \[[^\]]*vision/)

    // Evidence for tool calling in the shared chat path: tools are composed
    // into the provider request and their compatibility only ever degrades
    // after a failure.
    const llm = readSource('../../../../core-agent/src/runtime/llm-service.ts')
    expect(llm).toContain('streamOptionsToolsCompatibilityOk')
    expect(llm).toMatch(/mergedTools/)
  })

  it('i: the engine descriptor registers and resolves, and the model association is valid', () => {
    const { engines, models } = groqBrainDescriptors()
    const registry = createBrainEngineRegistry()

    expect(registry.register(engines[0])).toEqual({ status: 'registered' })
    // Duplicate registration is rejected without mutating state.
    expect(registry.register(engines[0])).toEqual({ reason: 'duplicate-engine-id', status: 'rejected' })

    expect(registry.list().map(entry => entry.id)).toEqual([GROQ_BRAIN_ENGINE_ID])
    const resolved = registry.resolve(GROQ_BRAIN_ENGINE_ID)
    expect(resolved?.name).toBe('Groq')
    expect(resolved?.capabilities.textInput).toBe(true)

    // Models are reached through the engine's declared ids (the canonical
    // helper), which is exactly the association this adapter must satisfy.
    const served = modelsForEngine(models, GROQ_BRAIN_ENGINE_ID)
    expect(served.map(entry => entry.id)).toEqual([GROQ_BRAIN_MODEL_ID])
  })

  it('j: the descriptor set works with eligibleBrainModelRoutes()', () => {
    const { engines, models } = groqBrainDescriptors()
    const routes = eligibleBrainModelRoutes(engines, models, { required: ['textInput', 'textOutput'] })
    expect(routes).toHaveLength(1)
    expect(routes[0].engine.id).toBe(GROQ_BRAIN_ENGINE_ID)
    expect(routes[0].model.id).toBe(GROQ_BRAIN_MODEL_ID)

    // The runtime decision layer consumes the same descriptors, observationally.
    const decision = decideBrainRouteFromProductState({
      engines,
      models,
      requirement: { required: ['textInput'] },
      snapshot: {
        brain: {
          engine: { preferred: GROQ_BRAIN_ENGINE_ID },
          mode: 'manual',
          model: { preferred: GROQ_BRAIN_MODEL_ID },
        },
      },
    })
    expect(decision.status).toBe('manual')
    if (decision.status !== 'manual')
      return
    expect(decision.resolution.status).toBe('resolvedModel')

    // ...and the automatic path with an explicit policy naming this route.
    const automatic = decideBrainRouteFromProductState({
      engines,
      models,
      requirement: { required: ['reasoning'] },
      automaticPolicy: { routes: [{ engineId: GROQ_BRAIN_ENGINE_ID, modelId: GROQ_BRAIN_MODEL_ID }] },
      snapshot: { brain: { mode: 'automatic' } },
    })
    expect(automatic.status).toBe('automatic')
    if (automatic.status !== 'automatic')
      return
    expect(automatic.selection.status).toBe('selected')
  })

  it('k: unsupported multimodal capabilities never become eligible accidentally', () => {
    const { engines, models } = groqBrainDescriptors()
    const unsupported: readonly LiaBrainCapability[] = ['audioInput', 'audioOutput', 'imageInput', 'realtime', 'videoInput']

    for (const flag of unsupported) {
      // Eligible for nothing that needs this capability...
      expect(eligibleBrainModelRoutes(engines, models, { required: [flag] }), flag).toEqual([])
      // ...and not even alongside a capability that IS supported.
      expect(eligibleBrainModelRoutes(engines, models, { required: ['textInput', flag] }), flag).toEqual([])
      // Directly: the canonical eligibility helper says no.
      expect(satisfiesBrainCapabilities(models[0].capabilities, { required: [flag] }), flag).toBe(false)
    }
    // The supported set still routes - the truth is selective, not blanket.
    expect(eligibleBrainModelRoutes(engines, models, { required: ['textInput', 'reasoning', 'toolCalling'] })).toHaveLength(1)
  })

  it('l: Brain audioOutput is never inferred from Lia TTS', () => {
    const { engines, models } = groqBrainDescriptors()
    expect(engines[0].capabilities.audioOutput).toBe(false)
    expect(models[0].capabilities.audioOutput).toBe(false)
    // The adapter derives nothing from the voice layer.
    const source = readSource('./groq.ts')
    expect(source).not.toMatch(/voice|tts|speech|kokoro|alltalk/i)
  })

  it('m: no network, config, authentication or environment access exists', () => {
    const source = readSource('./groq.ts')
    expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram|electron)['/]/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios/)
    expect(source).not.toMatch(/readFile|writeFile|process\.env|vault|\bsecrets?\b|apiKey|api_key/i)
    // No config reads and no registry ownership either.
    expect(source).not.toMatch(/readLiaProductConfig|updateLiaProductConfig|createBrainEngineRegistry|decideBrainRoute/)
    // The only import is the erased type import from the neutral domain.
    expect(source.split('\n').filter(line => line.startsWith('import')))
      .toEqual(['import type { LiaBrainCapabilities, LiaBrainEngineDescriptor, LiaBrainModelDescriptor } from \'../types\''])
  })

  it('n: the generic Brain domain files stay free of provider/model identities', () => {
    const domainDir = fileURLToPath(new URL('..', import.meta.url))
    // Production files only - test files legitimately spell vendor names as
    // scan patterns in their assertions. The production catalog is excluded
    // by design: it is the ONE composition module allowed to name adapters
    // (its own suite pins that dependency direction), while the generic
    // domain files below stay identity-free.
    const genericFiles = readdirSync(domainDir)
      .filter(name => name.endsWith('.ts') && !name.includes('.test.') && name !== 'catalog.ts')
    expect(genericFiles.length).toBeGreaterThan(0)
    const vendorPattern = /groq|gpt-oss|qwen|openai|anthropic|gemini|claude|mistral|ollama|deepseek|cerebras/i
    for (const name of genericFiles)
      expect(readFileSync(`${domainDir}/${name}`, 'utf-8'), name).not.toMatch(vendorPattern)
    // And the adapter really lives outside them.
    expect(genericFiles).not.toContain('groq.ts')
  })

  it('o: the current chat/provider execution path does not consume the adapter', () => {
    // Nothing outside lia-core references the adapter or its descriptor set:
    // the source trees of both apps and the other packages are scanned and
    // no consumer exists, so no existing behavior can depend on it yet.
    const airiDir = fileURLToPath(new URL('../../../../../', import.meta.url))
    const consumers: string[] = []
    for (const root of ['apps', 'packages']) {
      for (const workspace of readdirSync(`${airiDir}/${root}`, { withFileTypes: true })) {
        if (!workspace.isDirectory() || workspace.name === 'lia-core')
          continue
        const srcDir = `${airiDir}/${root}/${workspace.name}/src`
        let entries
        try {
          entries = readdirSync(srcDir, { recursive: true, withFileTypes: true })
        }
        catch {
          continue
        }
        for (const entry of entries) {
          if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name))
            continue
          const file = `${entry.parentPath}/${entry.name}`
          if (/groqBrainDescriptors|LiaBrainDescriptorSet/.test(readFileSync(file, 'utf-8')))
            consumers.push(file)
        }
      }
    }
    expect(consumers).toEqual([])
  })
})
