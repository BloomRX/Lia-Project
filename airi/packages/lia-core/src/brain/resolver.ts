import type { LiaBrainCapabilityRequirement } from './capabilities'
import type { LiaBrainEngineDescriptor, LiaBrainModelDescriptor } from './types'

import { satisfiesBrainCapabilities } from './capabilities'

/**
 * Phase 8.0C-2: the EXPLICIT preference-aware Brain resolver.
 *
 * It answers exactly two questions about the user's OWN persisted choice:
 *
 *   "Is this explicit Brain preference valid for the task requirement, and
 *    what exact engine/model does it resolve to?"
 *
 * It never answers "which candidate should run instead" - an invalid or
 * missing preference is reported as an explicit failure outcome, never
 * repaired, substituted or silently cleared. Automatic policy belongs to a
 * later phase. Pure by construction: preferences arrive as INPUT (no
 * product-config reads), the registry is never owned or mutated here, and
 * there is no network/filesystem/IPC involvement. Capability checks ride
 * the canonical 8.0C-1 eligibility helper - this module never re-derives
 * capability rules itself.
 *
 * Route composition (introduced here): a usable model route requires an
 * eligible engine AND an eligible model - each judged by its OWN
 * descriptor.
 */

export interface LiaBrainPreferredResolutionInput {
  engines: readonly LiaBrainEngineDescriptor[]
  models: readonly LiaBrainModelDescriptor[]
  /** Opaque Brain Engine Registry id; blank counts as absent. */
  preferredEngineId?: string
  /** Opaque Brain Model id; blank counts as absent. */
  preferredModelId?: string
  requirement: LiaBrainCapabilityRequirement
}

/**
 * Discriminated outcomes - every failure is explicit. `engineIneligible`
 * covers both paths to an incapable engine (a direct engine preference and
 * the engine associated with a preferred model); `model` is present in the
 * latter case.
 */
export type LiaBrainPreferredResolution
  = | { status: 'noPreference' }
    | { engine: LiaBrainEngineDescriptor, status: 'resolvedEngine' }
    | { engine: LiaBrainEngineDescriptor, model: LiaBrainModelDescriptor, status: 'resolvedModel' }
    | { preferredEngineId: string, status: 'engineNotFound' }
    | { engine: LiaBrainEngineDescriptor, model?: LiaBrainModelDescriptor, status: 'engineIneligible' }
    | { preferredModelId: string, status: 'modelNotFound' }
    | { model: LiaBrainModelDescriptor, status: 'modelIneligible' }
    | { model: LiaBrainModelDescriptor, status: 'modelEngineNotFound' }
    | { engine: LiaBrainEngineDescriptor, model: LiaBrainModelDescriptor, status: 'modelEngineMismatch' }

/** Blank ids are "absent" - the config layer stores absence the same way. */
function asOptionalId(value: string | undefined): string | undefined {
  const id = value?.trim()
  return id || undefined
}

function findEngine(engines: readonly LiaBrainEngineDescriptor[], id: string): LiaBrainEngineDescriptor | undefined {
  return engines.find(engine => engine.id === id)
}

function findModel(models: readonly LiaBrainModelDescriptor[], id: string): LiaBrainModelDescriptor | undefined {
  return models.find(model => model.id === id)
}

/**
 * Resolves the user's EXPLICIT Brain preference against the requirement.
 *
 * Semantics:
 * - No preference ids at all -> `noPreference` (nothing is selected).
 * - Engine only: the engine must exist and satisfy the requirement. A valid
 *   engine resolves to the engine ALONE - none of its models is chosen
 *   automatically.
 * - Model (with or without an engine preference): the model must exist,
 *   its associated engine must exist, and BOTH descriptors must satisfy
 *   the requirement (engine checked first). When an explicit engine id is
 *   also present, `model.engineId` must equal it - disagreement is the
 *   explicit `modelEngineMismatch` outcome, never repaired.
 *
 * Deterministic validation order: existence, then association (when both
 * ids are present), then eligibility (engine before model). Ordinary
 * outcomes never throw.
 */
export function resolvePreferredBrainSelection(input: LiaBrainPreferredResolutionInput): LiaBrainPreferredResolution {
  const preferredEngineId = asOptionalId(input.preferredEngineId)
  const preferredModelId = asOptionalId(input.preferredModelId)

  // A. Nothing explicit was ever chosen - and nothing is chosen here.
  if (preferredEngineId === undefined && preferredModelId === undefined)
    return { status: 'noPreference' }

  // B/D. The explicit engine, when one is named.
  let engine: LiaBrainEngineDescriptor | undefined
  if (preferredEngineId !== undefined) {
    engine = findEngine(input.engines, preferredEngineId)
    if (engine === undefined)
      return { preferredEngineId, status: 'engineNotFound' }
  }

  // C/D. The explicit model, when one is named.
  let model: LiaBrainModelDescriptor | undefined
  if (preferredModelId !== undefined) {
    model = findModel(input.models, preferredModelId)
    if (model === undefined)
      return { preferredModelId, status: 'modelNotFound' }

    // D. Both ids present: the pair must actually agree - a disagreement is
    // reported, never repaired.
    if (engine !== undefined && model.engineId !== engine.id)
      return { engine, model, status: 'modelEngineMismatch' }

    // C. A model route needs its associated engine in the engine set.
    const associatedEngine = engine ?? findEngine(input.engines, model.engineId)
    if (associatedEngine === undefined)
      return { model, status: 'modelEngineNotFound' }

    // Route composition: eligible engine AND eligible model (engine first).
    if (!satisfiesBrainCapabilities(associatedEngine.capabilities, input.requirement))
      return { engine: associatedEngine, model, status: 'engineIneligible' }
    if (!satisfiesBrainCapabilities(model.capabilities, input.requirement))
      return { model, status: 'modelIneligible' }

    return { engine: associatedEngine, model, status: 'resolvedModel' }
  }

  // B. Engine-only preference: eligibility decides; the result is the
  // engine alone - its models are never chosen here.
  if (!satisfiesBrainCapabilities(engine!.capabilities, input.requirement))
    return { engine: engine!, status: 'engineIneligible' }
  return { engine: engine!, status: 'resolvedEngine' }
}
