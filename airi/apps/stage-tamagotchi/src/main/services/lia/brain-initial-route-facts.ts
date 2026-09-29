/**
 * Phase 8.0D-10B-4D4C4-D2B7: the pure initial routeOverride observation facts.
 *
 * It answers exactly one factual question about the snapshot it is handed:
 * what initial routeOverride, if any, did the generic Stage seam observe
 * at the earliest honest moment (payload.routeOverride snapshot before any await)?
 *
 *   snapshot.initialRouteOverride          (absent | null | one two-field object)
 *     -> the direct retained factual snapshot, or truthfully not observed
 *
 * What it deliberately is NOT: not a store, not a read adapter, not a transport,
 * not a sanitizer, not an observer and not an authority. It holds no state, reads
 * no clock, imports nothing, edits nothing and returns a fresh value on every
 * call. It never joins the initial routeOverride to a decision, an execution
 * round, a later retry payload, a fallback aggregate or an inferred provider:
 * comparison/scoring/ranking is explicitly not implemented here.
 *
 * Retention boundary: the caller supplies the snapshot, so the caller - and the
 * canonical store behind it - owns what history is retained. The canonical store
 * keeps at most ONE initialRouteOverride per correlation, first observation wins
 * (null or object), and the value describes only the snapshot that was handed in.
 *
 * Truthfulness: undefined means \"not observed in this snapshot\" (legacy or
 * uncorrelated), null means \"observed absent\" (payload had no routeOverride at
 * the generic seam), object means \"observed present\" with exactly the two
 * identities. The three states are distinct and never collapsed.
 *
 * Ownership: nothing is imported at all, so this derivation cannot reach the
 * canonical store, the read adapter, the transport contract or the observer. The
 * vocabulary is declared locally as the minimal structural contract this
 * projection needs. Data minimization: only providerId/modelId, no prompt, no
 * session, no tool, no credential, no history.
 */

/**
 * The input this derivation accepts: one optional tri-state initialRouteOverride.
 *
 * Deliberately narrow - a routing decision, request-start reports, round
 * terminals, conversation, round and correlation keys, send terminal, execution
 * counts are NOT part of this contract, because projecting one factual snapshot
 * needs none of them. `initialRouteOverride` is optional, so a structural snapshot
 * that carries no record reads exactly like one that carries `undefined`: both
 * describe not observed.
 */
export interface LiaBrainInitialRouteObservationSnapshot {
  initialRouteOverride?: {
    providerId: string
    modelId: string
  } | null
}

/**
 * The factual result: the direct retained initial routeOverride snapshot, and nothing else.
 *
 * Three distinct states:
 * - `initialRouteOverrideNotObserved` : no accepted observation retained (legacy / not yet written / absent)
 * - `noInitialRouteOverride`          : observed absent (payload had no routeOverride at first honest seam)
 * - `initialRouteOverrideObserved`    : observed present, with fresh two-field copy
 *
 * No count, no total, no round join, no verdict, no comparison. The three states
 * are never collapsed: \"not observed\" ≠ \"observed absent\".
 */
export type LiaBrainInitialRouteObservationFacts
  = | { status: 'initialRouteOverrideNotObserved' }
    | { status: 'noInitialRouteOverride' }
    | { status: 'initialRouteOverrideObserved', providerId: string, modelId: string }

/**
 * Projects the initial routeOverride observation of one supplied snapshot.
 *
 * Pure and synchronous: one tri-state read, one closed-vocabulary check, one fresh
 * result object. The snapshot and its record are only read - never edited,
 * reordered or kept - and repeated calls over the same snapshot produce equal,
 * independently owned results.
 *
 * The check stays deliberately narrow: the input is a trusted, already-canonical
 * snapshot (the ingress sanitizer owns the IPC trust boundary and the store owns
 * first-write), so this is a projection guard, not a second sanitizer - no
 * `isRecord`, no trimming, no length check and no cloning helper beyond the
 * fresh two-field copy for the observed object. A value outside the tri-state
 * vocabulary (e.g. malformed object) contributes NOT OBSERVED rather than being
 * repaired, renamed or reported.
 */
export function deriveLiaBrainInitialRouteObservationFacts(
  snapshot: LiaBrainInitialRouteObservationSnapshot,
): LiaBrainInitialRouteObservationFacts {
  const raw = snapshot.initialRouteOverride

  if (raw === undefined)
    return { status: 'initialRouteOverrideNotObserved' }

  if (raw === null)
    return { status: 'noInitialRouteOverride' }

  const providerId = (raw as { providerId: unknown, modelId: unknown }).providerId
  const modelId = (raw as { providerId: unknown, modelId: unknown }).modelId

  if (typeof providerId === 'string' && typeof modelId === 'string') {
    return {
      status: 'initialRouteOverrideObserved',
      providerId,
      modelId,
    }
  }

  return { status: 'initialRouteOverrideNotObserved' }
}
