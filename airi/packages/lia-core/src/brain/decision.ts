import type { LiaBrainRoutingMode } from '../product/config'
import type { LiaBrainCapabilityRequirement } from './capabilities'
import type { LiaBrainPreferredResolution } from './resolver'
import type { LiaBrainAutomaticSelection, LiaBrainAutomaticSelectionPolicy } from './selection'
import type { LiaBrainEngineDescriptor, LiaBrainModelDescriptor } from './types'

import { resolvePreferredBrainSelection } from './resolver'
import { eligibleBrainModelRoutes } from './routes'
import { selectBrainRouteByPolicy } from './selection'

/**
 * Phase 8.0C-3D: the unified Brain routing DECISION - pure orchestration
 * over the layers already defined in 8.0C.
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
 * canonical route composer plus the canonical policy selector. It never
 * re-derives eligibility, association or precedence rules, and it never
 * invents a mode or an automatic policy of its own.
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
 * Discriminated top-level decision. The lower layers stay canonical: the
 * manual branch carries the resolver's own result and the automatic branch
 * carries the selector's own result, rather than flattening every
 * lower-level status into this union.
 */
export type LiaBrainRoutingDecision
  = | { status: 'modeUnspecified' }
    | { status: 'disabled' }
    | { resolution: LiaBrainPreferredResolution, status: 'manual' }
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
 *   verbatim; the automatic policy is not consulted;
 * - `automatic` -> requires the caller's own policy (`automaticPolicyMissing`
 *   otherwise); with one, the canonical candidate composition feeds the
 *   canonical policy selector, and persisted preferences have no effect.
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
    return {
      resolution: resolvePreferredBrainSelection({
        engines: input.engines,
        models: input.models,
        preferredEngineId: input.preferredEngineId,
        preferredModelId: input.preferredModelId,
        requirement: input.requirement,
      }),
      status: 'manual',
    }
  }

  // Automatic routing exists only under an explicit caller policy.
  if (input.automaticPolicy === undefined)
    return { status: 'automaticPolicyMissing' }

  const candidates = eligibleBrainModelRoutes(input.engines, input.models, input.requirement)
  return {
    selection: selectBrainRouteByPolicy(candidates, input.automaticPolicy),
    status: 'automatic',
  }
}
