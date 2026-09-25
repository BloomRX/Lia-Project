import type { LiaBrainRoutingMode } from '../product/config'
import type { LiaBrainCapabilityRequirement } from './capabilities'
import type { LiaBrainEngineReadiness } from './readiness'
import type { LiaBrainPreferredResolution } from './resolver'
import type { LiaBrainAutomaticSelection, LiaBrainAutomaticSelectionPolicy } from './selection'
import type { LiaBrainEngineDescriptor, LiaBrainModelDescriptor } from './types'

import { brainEngineReadiness, readyBrainModelRoutes } from './readiness'
import { resolvePreferredBrainSelection } from './resolver'
import { eligibleBrainModelRoutes } from './routes'
import { selectBrainRouteByPolicy } from './selection'

/**
 * Phase 8.0C-3D, extended by 8.0C-4: the unified Brain routing DECISION -
 * pure orchestration over the layers already defined in 8.0C.
 *
 * It answers one question: "Given the user's routing intent and the
 * already-defined routing inputs, what decision results?" - and nothing
 * further. The result is a decision value; it is not wired into chat or
 * any runtime consumer by this phase.
 *
 * All state arrives as arguments: no product-config access, no registry
 * ownership or mutation, no environment read, no network/filesystem/IPC.
 * This module is orchestration only - the manual path delegates to the
 * canonical explicit resolver, and the automatic path delegates to the
 * canonical route composer, the canonical readiness filter and the
 * canonical policy selector. It never re-derives eligibility, readiness,
 * association or precedence rules, and it never invents a mode or an
 * automatic policy of its own.
 */

/**
 * All routing state for one decision. `mode` is deliberately optional:
 * absence means "no explicit routing intent was ever persisted", which the
 * decision reports as-is rather than reading it as a default.
 */
export interface LiaBrainRoutingDecisionInput {
  mode?: LiaBrainRoutingMode
  engines: readonly LiaBrainEngineDescriptor[]
  models: readonly LiaBrainModelDescriptor[]
  preferredEngineId?: string
  preferredModelId?: string
  requirement: LiaBrainCapabilityRequirement
  automaticPolicy?: LiaBrainAutomaticSelectionPolicy
}

/**
 * Readiness of a manual outcome (Phase 8.0C-4). Additive information, for
 * successful resolutions ONLY: a preference the resolver could not settle
 * reports `notResolved` rather than a guessed engine's state, and an
 * unready-but-explicit preference stays exactly what the user asked for.
 */
export type LiaBrainManualReadiness = { status: 'notResolved' } | LiaBrainEngineReadiness

/**
 * Discriminated top-level decision. The lower layers stay canonical: the
 * manual branch carries the resolver's own result plus its additive
 * readiness, and the automatic branch carries the selector's own result,
 * rather than flattening every lower-level status into this union.
 */
export type LiaBrainRoutingDecision
  = | { status: 'modeUnspecified' }
    | { status: 'disabled' }
    | { readiness: LiaBrainManualReadiness, resolution: LiaBrainPreferredResolution, status: 'manual' }
    | { status: 'automaticPolicyMissing' }
    | { selection: LiaBrainAutomaticSelection, status: 'automatic' }

/**
 * Resolves the routing decision for the declared intent.
 *
 * Exactly one mode drives the call - the others' inputs are ignored, never
 * mixed:
 * - no mode -> `modeUnspecified`; nothing is inferred from stored
 *   preferences or available candidates (defaulting is a later phase);
 * - `disabled` -> `disabled`; preferences and policy are not consulted at
 *   all, so their validity cannot influence the outcome;
 * - `manual` -> the explicit preference resolver's result, passed through
 *   verbatim and never swapped for another route, plus the additive
 *   readiness of a successful resolution; the automatic policy is not
 *   consulted;
 * - `automatic` -> requires the caller's own policy (`automaticPolicyMissing`
 *   otherwise); with one, the canonical candidate composition is filtered to
 *   currently ready engines and feeds the canonical policy selector, so an
 *   unexecutable higher-precedence route never blocks a ready one - and when
 *   nothing ready remains, that is `noCandidates`, never a fallback. Persisted
 *   preferences have no effect.
 */
export function decideBrainRoute(input: LiaBrainRoutingDecisionInput): LiaBrainRoutingDecision {
  const mode = input.mode

  // Absence is not a default: this layer declines to route on its own.
  if (mode === undefined)
    return { status: 'modeUnspecified' }

  // User intent says routing is off - nothing else is inspected.
  if (mode === 'disabled')
    return { status: 'disabled' }

  if (mode === 'manual') {
    const resolution = resolvePreferredBrainSelection({
      engines: input.engines,
      models: input.models,
      preferredEngineId: input.preferredEngineId,
      preferredModelId: input.preferredModelId,
      requirement: input.requirement,
    })
    return {
      // Additive readiness for the successful resolutions only: the
      // resolution itself is never altered, replaced or re-resolved.
      readiness: manualReadiness(resolution),
      resolution,
      status: 'manual',
    }
  }

  // Automatic routing exists only under an explicit caller policy.
  if (input.automaticPolicy === undefined)
    return { status: 'automaticPolicyMissing' }

  // Capability eligibility first, then readiness, then policy precedence -
  // each layer keeps its own single responsibility.
  const candidates = readyBrainModelRoutes(
    eligibleBrainModelRoutes(input.engines, input.models, input.requirement),
  )
  return {
    selection: selectBrainRouteByPolicy(candidates, input.automaticPolicy),
    status: 'automatic',
  }
}

/**
 * Readiness for a manual outcome: only a RESOLVED engine is described - the
 * engine itself (for `resolvedModel`, the model's engine, because readiness
 * belongs to what executes). `noPreference` and every resolver failure are
 * `notResolved`: an unready preference is still the user's explicit choice,
 * and it is never swapped for another route here.
 */
function manualReadiness(resolution: LiaBrainPreferredResolution): LiaBrainManualReadiness {
  if (resolution.status === 'resolvedEngine' || resolution.status === 'resolvedModel')
    return brainEngineReadiness(resolution.engine)
  return { status: 'notResolved' }
}
