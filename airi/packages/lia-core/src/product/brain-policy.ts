import type { LiaBrainAutomaticSelectionPolicy } from '../brain/selection'

import { GROQ_BRAIN_ENGINE_ID, GROQ_BRAIN_MODEL_ID } from '../brain/adapters/groq'

/**
 * Phase 8.0D-8: Lia's PRODUCTION automatic Brain selection policy.
 *
 * Routing policy is a product decision, not generic Brain-domain behavior:
 * it lives in the product layer, next to the rest of Lia's product truth,
 * and the Brain domain stays policy-blind. The generic routing modules
 * receive this policy as an argument and never learn that a production one
 * exists.
 *
 * The route is DECLARED here, explicitly and in order - it is never derived
 * from catalog array order, registry registration order, a first/last
 * candidate, alphabetical ids or anything else implicit. Ids are not
 * restated either: the provider-specific adapter owns them, so this file
 * cannot drift from the shipped engine/model identities.
 *
 * Trust boundary: this module is consumed by the trusted main/product layer
 * only. The renderer never supplies, modifies or even names a policy - it
 * describes WHAT a turn needs, and this is the product's answer to WHICH
 * shipped route that means (subject to the router's own capability
 * eligibility, which the policy never overrides).
 *
 * Pure declaration: no config read, no environment read, no credentials, no
 * network/filesystem I/O, no registry or catalog access, no SDK
 * initialization, no mutable process-global state. Every call returns a
 * fresh policy object with a fresh routes array, so no caller can affect a
 * later one.
 */

/**
 * The production automatic policy, as of this phase: exactly ONE route -
 * Lia's current chat brain (Groq + openai/gpt-oss-120b). Adding or
 * reordering future production routes is an explicit product-policy change
 * here, and precedence remains this declared order.
 */
export function createProductionBrainAutomaticPolicy(): LiaBrainAutomaticSelectionPolicy {
  return {
    routes: [
      { engineId: GROQ_BRAIN_ENGINE_ID, modelId: GROQ_BRAIN_MODEL_ID },
    ],
  }
}
