import type { LiaProductConfigSnapshot } from '../product/config'
import type { LiaBrainCapabilityRequirement } from './capabilities'
import type { LiaBrainRoutingDecision } from './decision'
import type { LiaBrainAutomaticSelectionPolicy } from './selection'
import type { LiaBrainEngineDescriptor, LiaBrainModelDescriptor } from './types'

import { readBrainRoutingMode, readPreferredBrainEngineId, readPreferredBrainModelId } from '../product/config'
import { decideBrainRoute } from './decision'

/**
 * Phase 8.0D-1: the runtime-side brain DECISION CONTEXT - the smallest
 * bridge that turns Lia's REAL product state into the pure routing decision
 * of 8.0C.
 *
 * Owner: Lia Core, the trusted, renderer-free runtime layer that already
 * owns both halves of this bridge - the canonical product-config readers and
 * the canonical routing decision. The pure decision layer answers "given
 * this intent and these inputs, what routing decision results?"; this module
 * answers only "what does the persisted product state SAY about that
 * intent?" - and hands the answer over untouched.
 *
 * Observational by construction: the result is a value. Nothing in the
 * current conversation execution path consumes it, and this phase
 * deliberately changes no existing behavior. The product snapshot and the
 * Brain descriptors arrive as arguments - the host seam (Stage main) keeps
 * the I/O, this bridge keeps the mapping. No file reads, no IPC, no config
 * writes, no registry population, no inference.
 */

/**
 * One decision context. `snapshot` carries exactly the slice the canonical
 * readers accept (a full `LiaProductConfigSnapshot` satisfies it
 * structurally); absent fields inside it stay absent - this bridge never
 * fabricates a mode, a selection or a policy.
 */
export interface LiaBrainRuntimeContext {
  snapshot: Pick<LiaProductConfigSnapshot, 'brain'>
  engines: readonly LiaBrainEngineDescriptor[]
  models: readonly LiaBrainModelDescriptor[]
  requirement: LiaBrainCapabilityRequirement
  automaticPolicy?: LiaBrainAutomaticSelectionPolicy
}

/**
 * Derives the routing decision from persisted product state.
 *
 * Steps, in order:
 * 1. read the canonical routing intent from the snapshot
 *    (`readBrainRoutingMode` - absence stays absence);
 * 2. read the canonical preferred engine/model ids
 *    (`readPreferredBrainEngineId` / `readPreferredBrainModelId` - blank ids
 *    stay absent);
 * 3. call `decideBrainRoute` with those values plus the supplied
 *    descriptors, requirement and policy;
 * 4. return that decision EXACTLY as produced.
 *
 * No routing semantics live here: the manual/automatic/disabled paths, the
 * eligibility rules and the policy precedence all belong to 8.0C and are
 * reached only through `decideBrainRoute`. No default mode and no default
 * policy are invented - a missing mode yields `modeUnspecified` and a
 * missing policy under automatic yields `automaticPolicyMissing`, straight
 * from the canonical decision. Inputs are read, never mutated.
 */
export function decideBrainRouteFromProductState(context: LiaBrainRuntimeContext): LiaBrainRoutingDecision {
  return decideBrainRoute({
    automaticPolicy: context.automaticPolicy,
    engines: context.engines,
    mode: readBrainRoutingMode(context.snapshot),
    models: context.models,
    preferredEngineId: readPreferredBrainEngineId(context.snapshot),
    preferredModelId: readPreferredBrainModelId(context.snapshot),
    requirement: context.requirement,
  })
}
