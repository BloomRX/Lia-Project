import type { LiaBrainModelRoute } from './routes'

/**
 * Phase 8.0C-3C: the pure selection-policy layer for automatic Brain
 * routing.
 *
 * It receives an already-composed candidate set plus an EXPLICIT ordered
 * policy and reports whether exactly one route can be established from
 * them. It never invents policy of its own: the ONLY source of precedence
 * is the caller's declared policy order, and the only identity that counts
 * is the engine+model pair. Candidate array position, engine registration
 * order, how ids happen to be spelled, display text, capability breadth
 * and metadata are all irrelevant here - deriving anything from them would
 * be a hidden default policy, which this layer deliberately does not have.
 * Routing intent and persisted selections are equally invisible: policy
 * arrives as an argument, never read from product config. Pure by
 * construction - descriptors in, decision out, no registry ownership or
 * mutation, no network/filesystem/IPC/logging.
 */

/** One exact engine+model pair - ids only, never display text. */
export interface LiaBrainRouteRef {
  engineId: string
  modelId: string
}

/**
 * Provider-neutral ordered policy: earlier entries take precedence over
 * later ones, and they do so ONLY because this explicit policy declares
 * that order.
 */
export interface LiaBrainAutomaticSelectionPolicy {
  routes: readonly LiaBrainRouteRef[]
}

/**
 * Discriminated decision. `noCandidates` and `noPolicyMatch` are distinct
 * on purpose: existing candidates the policy does not name are NOT a
 * selection opportunity - nothing is inferred from their presence.
 * `ambiguous` reports the winning identity without picking a duplicate.
 */
export type LiaBrainAutomaticSelection
  = | { status: 'noCandidates' }
    | { route: LiaBrainModelRoute, status: 'selected' }
    | { status: 'noPolicyMatch' }
    | { ref: LiaBrainRouteRef, status: 'ambiguous' }

/**
 * Establishes whether the policy identifies exactly one candidate route.
 *
 * Policy entries are visited in declared order; the FIRST reference whose
 * engineId and modelId both equal a candidate's identity settles the
 * answer for the whole call:
 * - exactly one such candidate -> `selected`;
 * - more than one (duplicate route identities in the candidate set) ->
 *   `ambiguous`, never a silent choice among them;
 * - and no later policy entry is consulted once an identity has matched.
 * A policy that names none of the candidates -> `noPolicyMatch`, even when
 * only one candidate exists. Empty candidate set -> `noCandidates`.
 * Inputs are read, never mutated; ordinary inputs never throw.
 */
export function selectBrainRouteByPolicy(
  candidates: readonly LiaBrainModelRoute[],
  policy: LiaBrainAutomaticSelectionPolicy,
): LiaBrainAutomaticSelection {
  if (candidates.length === 0)
    return { status: 'noCandidates' }

  for (const ref of policy.routes) {
    const matches = candidates.filter(candidate =>
      candidate.engine.id === ref.engineId && candidate.model.id === ref.modelId,
    )
    if (matches.length === 0)
      continue
    if (matches.length > 1)
      return { ref, status: 'ambiguous' }
    const [selected] = matches
    return { route: selected, status: 'selected' }
  }

  return { status: 'noPolicyMatch' }
}
