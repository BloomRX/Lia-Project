import type { LiaBrainRoutingDecision } from '@lia/core'
import type { ChatSendRouteOverride } from '@proj-airi/stage-ui/stores/chat'

import { LIA_BRAIN_ENGINE_PROVIDER_MAPPING } from '../../../shared/lia/brain-engine-provider-mapping'

/**
 * Phase 8.0D-10B-4D4C4-D2B1: Lia-specific route candidate adapter.
 *
 * Translates an already-resolved, trusted AUTOMATIC Lia Brain decision into
 * the generic Stage `ChatSendRouteOverride` contract.
 *
 * - Only `automatic` + `selected` is routable → `{providerId, modelId}`
 * - Everything else → `undefined` (manual/disabled/modeUnspecified/
 *   automaticPolicyMissing/noCandidates/noPolicyMatch/ambiguous/…)
 * - Mapping `engineId → providerId` reuses the canonical production table:
 *   `groq` → `groq` (see `shared/lia/brain-engine-provider-mapping.ts`
 *   `LIA_BRAIN_ENGINE_PROVIDER_MAPPING`). No new table, no switch on
 *   model string, no inference.
 * - `modelId` is the selected Brain route's own id verbatim.
 * - Fresh plain object, never mutated input, no credential/provider
 *   resolution, no global state, no fallback knowledge, no execution.
 * - Output is a *candidate*, not authoritative execution truth — live
 *   revalidation (credentials/availability) happens at execution time.
 */
export function resolveLiaBrainSendRouteCandidate(
  decision: LiaBrainRoutingDecision,
): ChatSendRouteOverride | undefined {
  if (decision.status !== 'automatic')
    return undefined

  const selection = decision.selection
  if (selection.status !== 'selected')
    return undefined

  const engineId = selection.route.engine.id
  const modelId = selection.route.model.id

  // Canonical engine→provider mapping: reuse the audited production table;
  // no new table, no switch on engine, no model-string parsing.
  const providerId = LIA_BRAIN_ENGINE_PROVIDER_MAPPING.providerIdForEngine(engineId)
  if (providerId === undefined)
    return undefined

  return { providerId, modelId }
}
