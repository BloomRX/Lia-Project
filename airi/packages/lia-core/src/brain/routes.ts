import type { LiaBrainCapabilityRequirement } from './capabilities'
import type { LiaBrainEngineDescriptor, LiaBrainModelDescriptor } from './types'

import { satisfiesBrainCapabilities } from './capabilities'

/**
 * Phase 8.0C-3B: the pure route-COMPOSITION layer.
 *
 * It answers exactly one question:
 *
 *   "Which concrete engine+model routes are usable for this requirement?"
 *
 * It returns ALL usable routes, in stable enumeration order - never a
 * single one. Deciding which route to use belongs to a later phase and has
 * no representation here: this module does not read or interpret any
 * routing intent, persisted selection or storage state. Pure by
 * construction: descriptors in, routes out, no product-config access, no
 * registry ownership or mutation, no network/filesystem/IPC/logging.
 * Capability checks ride the canonical 8.0C-1 eligibility helper - never
 * re-derived here.
 */

/** A resolved route always carries BOTH descriptors - never a provider object. */
export interface LiaBrainModelRoute {
  engine: LiaBrainEngineDescriptor
  model: LiaBrainModelDescriptor
}

/**
 * Composes every usable engine+model route for the requirement.
 *
 * A route exists only when ALL hold:
 * - the model's `engineId` references an engine present in `engines`;
 * - the association is declared on BOTH sides (`engine.modelIds` includes
 *   the model id) - a one-sided claim yields no route, never a repair;
 * - the engine satisfies the requirement;
 * - the model satisfies the requirement.
 *
 * Only the model descriptors drive enumeration (model input order is
 * preserved verbatim - there is no reordering step at all), so an engine's
 * `modelIds` entry without a matching model descriptor synthesizes
 * nothing, a model without a matching engine is simply omitted, and an
 * engine-only outcome never exists here. Inputs are read, never mutated;
 * ordinary inconsistent inputs never throw.
 */
export function eligibleBrainModelRoutes(
  engines: readonly LiaBrainEngineDescriptor[],
  models: readonly LiaBrainModelDescriptor[],
  requirement: LiaBrainCapabilityRequirement,
): readonly LiaBrainModelRoute[] {
  const routes: LiaBrainModelRoute[] = []
  for (const model of models) {
    const engine = engines.find(candidate => candidate.id === model.engineId)
    if (engine === undefined)
      continue
    // Both sides must agree that this relationship exists.
    if (!engine.modelIds.includes(model.id))
      continue
    if (!satisfiesBrainCapabilities(engine.capabilities, requirement))
      continue
    if (!satisfiesBrainCapabilities(model.capabilities, requirement))
      continue
    routes.push({ engine, model })
  }
  return routes
}
