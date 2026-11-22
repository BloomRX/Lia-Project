import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { GROQ_BRAIN_ENGINE_ID, GROQ_BRAIN_MODEL_ID, GROQ_BRAIN_VISION_MODEL_ID } from '../brain/adapters/groq'
import { createProductionBrainCatalog } from '../brain/catalog'
import { brainRequirementForChatTurn } from '../brain/chat-requirement'
import { decideBrainRoute } from '../brain/decision'
import { eligibleBrainModelRoutes } from '../brain/routes'
import { createProductionBrainAutomaticPolicy } from './brain-policy'

/**
 * Phase 8.0D-M1: the multimodal route, proved through the REAL production
 * catalog and the REAL production policy.
 *
 * Nothing here is mocked or restated: descriptors come from
 * `createProductionBrainCatalog()`, precedence from
 * `createProductionBrainAutomaticPolicy()`, the requirement from
 * `brainRequirementForChatTurn()` - the same derivation the send path uses -
 * and the decision from the same `decideBrainRoute()` the runtime calls. So a
 * green suite means the shipped routing really behaves this way, not that a
 * replica does.
 *
 * The invariant under test is that routing stays CAPABILITY-DRIVEN: the policy
 * declares precedence only, and eligibility is what removes the text brain
 * from an image turn. No filename, prompt, provider or UI state is consulted
 * anywhere in that path.
 */

/** The turn facts the send path builds, spelled the way the seam spells them. */
function requirementFor(facts: { hasImageInput?: boolean, reasoningRequested?: boolean, usesTools?: boolean }) {
  return brainRequirementForChatTurn({
    hasImageInput: facts.hasImageInput === true,
    reasoningRequested: facts.reasoningRequested === true,
    usesTools: facts.usesTools === true,
  })
}

/** Runs the real automatic decision for one turn's facts. */
function decideAutomatic(facts: Parameters<typeof requirementFor>[0]) {
  const { engines, models } = createProductionBrainCatalog()
  const decision = decideBrainRoute({
    automaticPolicy: createProductionBrainAutomaticPolicy(),
    engines,
    mode: 'automatic',
    models,
    requirement: requirementFor(facts),
  })
  expect(decision.status).toBe('automatic')
  if (decision.status !== 'automatic')
    throw new Error('unreachable')
  expect(decision.selection.status).toBe('selected')
  if (decision.selection.status !== 'selected')
    throw new Error('unreachable')
  return {
    engineId: decision.selection.route.engine.id,
    modelId: decision.selection.route.model.id,
  }
}

describe('multimodal brain routing (Phase 8.0D-M1)', () => {
  it('gate 1: a text-only turn keeps resolving to the existing text brain', () => {
    expect(decideAutomatic({})).toEqual({
      engineId: GROQ_BRAIN_ENGINE_ID,
      modelId: GROQ_BRAIN_MODEL_ID,
    })
  })

  it('gate 2: an image requirement makes the text brain ineligible', () => {
    const { engines, models } = createProductionBrainCatalog()
    const requirement = requirementFor({ hasImageInput: true })

    const eligible = eligibleBrainModelRoutes(engines, models, requirement)
    expect(eligible.map(route => route.model.id)).not.toContain(GROQ_BRAIN_MODEL_ID)

    // The engine is NOT the reason - it declares the superset, so it passes and
    // the decision is made per model, which is what keeps the vision route
    // reachable at all.
    expect(eligible[0]?.engine.id).toBe(GROQ_BRAIN_ENGINE_ID)
  })

  it('gate 3: the same image requirement resolves to the vision route', () => {
    expect(decideAutomatic({ hasImageInput: true })).toEqual({
      engineId: GROQ_BRAIN_ENGINE_ID,
      modelId: GROQ_BRAIN_VISION_MODEL_ID,
    })
  })

  it('gate 4: image plus reasoning resolves to the vision route', () => {
    const { engines, models } = createProductionBrainCatalog()
    const requirement = requirementFor({ hasImageInput: true, reasoningRequested: true })
    expect(requirement.required).toContain('reasoning')
    expect(eligibleBrainModelRoutes(engines, models, requirement).map(route => route.model.id))
      .toEqual([GROQ_BRAIN_VISION_MODEL_ID])

    expect(decideAutomatic({ hasImageInput: true, reasoningRequested: true })).toEqual({
      engineId: GROQ_BRAIN_ENGINE_ID,
      modelId: GROQ_BRAIN_VISION_MODEL_ID,
    })
  })

  it('gate 5: image plus tool calling resolves only because the vision route declares both', () => {
    const { models } = createProductionBrainCatalog()
    const requirement = requirementFor({ hasImageInput: true, usesTools: true })
    expect(requirement.required).toEqual(['textInput', 'imageInput', 'textOutput', 'toolCalling'])

    const vision = models.find(model => model.id === GROQ_BRAIN_VISION_MODEL_ID)!
    expect(vision.capabilities.imageInput, 'image').toBe(true)
    expect(vision.capabilities.toolCalling, 'tools').toBe(true)

    expect(decideAutomatic({ hasImageInput: true, usesTools: true })).toEqual({
      engineId: GROQ_BRAIN_ENGINE_ID,
      modelId: GROQ_BRAIN_VISION_MODEL_ID,
    })
  })

  it('gate 9: the absence of an image never promotes the vision route', () => {
    // Every non-image fact combination must stay on the text brain, so the
    // vision route cannot be reached by reasoning, tools or nothing at all.
    for (const facts of [
      {},
      { reasoningRequested: true },
      { usesTools: true },
      { reasoningRequested: true, usesTools: true },
      { hasImageInput: false },
      { hasImageInput: false, reasoningRequested: true, usesTools: true },
    ]) {
      expect(decideAutomatic(facts), JSON.stringify(facts)).toEqual({
        engineId: GROQ_BRAIN_ENGINE_ID,
        modelId: GROQ_BRAIN_MODEL_ID,
      })
    }
  })

  it('gate 9b: precedence is the declared order, and eligibility is what removes a route', () => {
    const { engines, models } = createProductionBrainCatalog()
    const policy = createProductionBrainAutomaticPolicy()

    // For a text turn BOTH routes are eligible, so the declared order decides.
    const textCandidates = eligibleBrainModelRoutes(engines, models, requirementFor({}))
    expect(textCandidates).toHaveLength(2)
    expect(policy.routes[0]?.modelId).toBe(GROQ_BRAIN_MODEL_ID)

    // For an image turn only ONE is eligible, so order is irrelevant - the
    // vision route wins because it is the only candidate, not because anything
    // preferred it.
    const imageCandidates = eligibleBrainModelRoutes(engines, models, requirementFor({ hasImageInput: true }))
    expect(imageCandidates).toHaveLength(1)
    expect(imageCandidates[0].model.id).toBe(GROQ_BRAIN_VISION_MODEL_ID)
  })

  it('a capability no model has yields no route rather than a silent substitute', () => {
    const { engines, models } = createProductionBrainCatalog()
    const decision = decideBrainRoute({
      automaticPolicy: createProductionBrainAutomaticPolicy(),
      engines,
      mode: 'automatic',
      models,
      requirement: { required: ['audioInput', 'textInput', 'textOutput'] },
    })
    expect(decision).toEqual({ selection: { status: 'noCandidates' }, status: 'automatic' })
  })
})

describe('multimodal slice scope (Phase 8.0D-M1 gate 10)', () => {
  it('the Brain domain and the production policy have no voice/STT/TTS coupling', () => {
    const brainDir = fileURLToPath(new URL('../brain/', import.meta.url))
    const files = readdirSync(brainDir, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.includes('.test.'))
      .map(entry => `${entry.parentPath}/${entry.name}`)
    files.push(fileURLToPath(new URL('./brain-policy.ts', import.meta.url)))

    expect(files.length).toBeGreaterThan(10)
    for (const file of files) {
      const source = readFileSync(file, 'utf-8')
      // No voice, speech-to-text or text-to-speech module is imported...
      expect(source, file).not.toMatch(/from ['"][^'"]*(?:hearing|voice|speech|transcription|tts|audio)[^'"]*['"]/i)
      // ...and no such identifier is referenced either. Lia's validated voice
      // pipeline stays a separate concern that this slice never touched.
      expect(source, file).not.toMatch(/\b(?:useHearingStore|useSettingsAudioDevice|activeTranscriptionProvider|LIA_GROQ_TRANSCRIPTION|Kokoro|alltalk)\b/)
    }
  })
})
