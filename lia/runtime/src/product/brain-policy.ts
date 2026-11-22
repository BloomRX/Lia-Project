import type { LiaBrainAutomaticSelectionPolicy } from '../brain/selection'

import { GROQ_BRAIN_ENGINE_ID, GROQ_BRAIN_MODEL_ID, GROQ_BRAIN_VISION_MODEL_ID } from '../brain/adapters/groq'

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
 * The production automatic policy: two declared routes on one engine, in this
 * order. Adding or reordering production routes is an explicit product-policy
 * change here, and precedence remains this declared order.
 *
 * 1. the text chat brain - first, so a text-only turn keeps resolving to
 *    exactly what it always did;
 * 2. the engine's vision route - reached only when capability eligibility puts
 *    the first route out of the candidate set.
 *
 * This order is a precedence declaration and nothing more. It contains no
 * image detection, no filename or prompt inspection, no provider or UI state:
 * the selector visits these entries in order and settles on the first one that
 * is an eligible candidate, so a turn that does not require `imageInput`
 * selects route 1 and can never reach route 2 by accident, while a turn that
 * does drops route 1 at the eligibility layer and settles on route 2. The
 * capability requirement - not this list - is what decides.
 */
export function createProductionBrainAutomaticPolicy(): LiaBrainAutomaticSelectionPolicy {
  return {
    routes: [
      { engineId: GROQ_BRAIN_ENGINE_ID, modelId: GROQ_BRAIN_MODEL_ID },
      { engineId: GROQ_BRAIN_ENGINE_ID, modelId: GROQ_BRAIN_VISION_MODEL_ID },
    ],
  }
}
