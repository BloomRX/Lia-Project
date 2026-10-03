/**
 * Phase 8.0D-10B-4D4C4-D2B10: the pure route-conformance facts.
 *
 * It answers exactly one factual question about the two facts it is handed:
 * when BOTH sides are independently known, was the final successful execution
 * identity equal to the initially observed routeOverride identity?
 *
 *   initialRouteOverrideFacts     (the initial observed route identity)
 *     + finalSuccessfulExecutionFacts (the final successful execution identity)
 *     -> one of seven explicit factual states
 *
 * This is a FACTS-TO-FACTS derivation. It reads no snapshot, no store, no read
 * adapter, no transport and no clock: the two sibling derivations already own
 * the initial tri-state logic and the successful-round join, and this layer
 * consumes only their RESULTS. Duplicating either here would let the two copies
 * drift, and a drifted copy would be indistinguishable from a correct one.
 *
 * What it deliberately is NOT: not a store, not a read adapter, not a transport,
 * not a sanitizer, not an observer and not an authority. It holds no state,
 * imports nothing at runtime, edits nothing and returns a fresh value on every
 * call.
 *
 * COMPARABILITY. Exactly ONE source-state pair carries two complete route
 * identities:
 *
 *   initialRouteOverrideFacts.status     === 'initialRouteOverrideObserved'
 *   finalSuccessfulExecutionFacts.status === 'finalSuccessfulExecutionObserved'
 *
 * Every other pair is `routeComparisonUnavailable`, and the reason is preserved
 * verbatim rather than flattened. The other 20 pairs never produce an equality
 * claim, so absence is never reported as a difference.
 *
 * SEMANTIC BOUNDARY. A differing identity is an observation, not a judgement.
 * `routeIdentityDiffered` means ONLY that the two independently observed
 * identities are not equal. A logical send may legitimately execute through
 * another route, and this layer never asks why: it infers no cause, names no
 * defect and ranks nothing. The vocabulary is deliberately evaluative-free -
 * there is no state here that could be read as a defect or a policy outcome.
 *
 * EQUALITY. Raw JavaScript string equality only. No whitespace folding, no case
 * folding, no alias resolution, no provider or model-family translation, no
 * registry lookup and no fuzzy matching: `'groq'` and `'Groq'` are different
 * identities here, exactly as they are different strings. Normalizing would
 * manufacture an equality the two observations never stated.
 *
 * DATA MINIMIZATION. The result carries availability, the exact unavailability
 * reason(s) and the two equality booleans - and nothing else. It deliberately
 * copies NO provider id, NO model id and NO round key: the composed diagnostic
 * object already carries `initialRouteOverrideFacts` and
 * `finalSuccessfulExecutionFacts` beside this sibling, so repeating an identity
 * here would add no information and would create a second copy able to drift
 * from the sibling it duplicates.
 *
 * The two unavailability reason vocabularies are DERIVED structurally from the
 * input fact types instead of being re-declared. That keeps this layer
 * automatically in step if an upstream state is ever added, and it keeps the
 * upstream send-level vocabulary owned solely by its own modules.
 *
 * Ownership: nothing is imported at runtime at all, so this derivation cannot
 * reach the canonical store, the read adapter, the transport contract or the
 * observer. Data minimization: no prompt, no session, no tool, no credential,
 * no raw report, no raw snapshot, no history.
 */

import type { LiaBrainFinalSuccessfulExecutionFacts } from './brain-final-successful-execution-facts'
import type { LiaBrainInitialRouteObservationFacts } from './brain-initial-route-facts'

/**
 * The initial-route states that carry NO identity, derived from the upstream
 * union: every member except the observed one. Never re-declared here, so this
 * vocabulary cannot drift from the fact it describes.
 */
type LiaBrainInitialRouteUnavailableReason
  = Exclude<LiaBrainInitialRouteObservationFacts, { status: 'initialRouteOverrideObserved' }>['status']

/**
 * The final-execution states that carry NO unique successful execution
 * identity, derived the same way: every member except the observed one.
 */
type LiaBrainFinalExecutionUnavailableReason
  = Exclude<LiaBrainFinalSuccessfulExecutionFacts, { status: 'finalSuccessfulExecutionObserved' }>['status']

/**
 * The factual result: one of seven explicit states, and nothing else.
 *
 * `unavailableSide` is a SECOND discriminator, and it exists so that an
 * unavailability result with no reason is not representable at all. Without it
 * a bare `{ status: 'routeComparisonUnavailable' }` would type-check while
 * saying nothing about which side was missing - a value that reads as a fact
 * while carrying none.
 *
 * - `routeComparisonUnavailable` / `initial` the initial route identity is not
 *   known; the final execution identity IS known and is deliberately not
 *   reported here, because the sibling beside this one already carries it;
 * - `routeComparisonUnavailable` / `final`   the initial route identity IS
 *   known, but no unique final successful execution identity exists;
 * - `routeComparisonUnavailable` / `both`    neither identity is known, and
 *   BOTH reasons travel;
 * - `routeIdentityMatched`    both identities known and equal on both
 *   components - the only state where the two booleans are both `true`;
 * - `routeIdentityDiffered`   both identities known and unequal on at least one
 *   component. The three differing combinations are declared as three separate
 *   arms with literal booleans, which makes `routeIdentityDiffered` together
 *   with two `true` booleans UNREPRESENTABLE rather than merely discouraged.
 *
 * Deliberately absent: any provider id, any model id, any round key, any
 * arrival index, the correlation key, the raw snapshot, both input fact
 * objects, any count, any score, any ranking and any cause.
 */
export type LiaBrainRouteConformanceFacts
  = | {
    status: 'routeComparisonUnavailable'
    unavailableSide: 'initial'
    initialUnavailableReason: LiaBrainInitialRouteUnavailableReason
  }
  | {
    status: 'routeComparisonUnavailable'
    unavailableSide: 'final'
    finalUnavailableReason: LiaBrainFinalExecutionUnavailableReason
  }
  | {
    status: 'routeComparisonUnavailable'
    unavailableSide: 'both'
    initialUnavailableReason: LiaBrainInitialRouteUnavailableReason
    finalUnavailableReason: LiaBrainFinalExecutionUnavailableReason
  }
  | {
    status: 'routeIdentityMatched'
    providerMatches: true
    modelMatches: true
  }
  | {
    status: 'routeIdentityDiffered'
    providerMatches: true
    modelMatches: false
  }
  | {
    status: 'routeIdentityDiffered'
    providerMatches: false
    modelMatches: true
  }
  | {
    status: 'routeIdentityDiffered'
    providerMatches: false
    modelMatches: false
  }

/**
 * Derives the route-conformance facts of two supplied sibling facts.
 *
 * Exact semantics, once per call:
 * 1. availability is read structurally from the two `status` discriminants, and
 *    from nothing else;
 * 2. neither side observed  -> `unavailableSide: 'both'`, both reasons copied;
 * 3. initial side not observed -> `unavailableSide: 'initial'`, its reason;
 * 4. final side not observed   -> `unavailableSide: 'final'`, its reason;
 * 5. both sides observed -> the two raw string equalities decide between
 *    `routeIdentityMatched` and the one `routeIdentityDiffered` arm that states
 *    exactly which component differs.
 *
 * Pure and synchronous: both inputs and every field inside them are only read -
 * never edited, reordered or kept - and the returned object shares nothing with
 * either input. Repeated calls over equal inputs produce equal, independently
 * owned results.
 *
 * No defense is added against malformed input: both facts arrive from trusted
 * pure derivations over an already-sanitized snapshot, so this is a projection,
 * not a second sanitizer. There is no record check, no length check, no repair
 * and no default - a value outside the declared vocabulary is a programming
 * error and stays visible instead of being quietly rewritten.
 */
export function deriveLiaBrainRouteConformanceFacts(
  initialRouteOverrideFacts: LiaBrainInitialRouteObservationFacts,
  finalSuccessfulExecutionFacts: LiaBrainFinalSuccessfulExecutionFacts,
): LiaBrainRouteConformanceFacts {
  // Availability is a structural question about the two facts handed in: only
  // these two states carry a complete route identity. Each branch below tests a
  // discriminant directly rather than through a stored boolean, so the compiler
  // narrows the fact itself and every reason copied out of it is provably a
  // non-observed state - no assertion is needed anywhere in this function.

  // Neither identity is known: both reasons travel, and no equality is claimed.
  if (initialRouteOverrideFacts.status !== 'initialRouteOverrideObserved'
    && finalSuccessfulExecutionFacts.status !== 'finalSuccessfulExecutionObserved') {
    return {
      finalUnavailableReason: finalSuccessfulExecutionFacts.status,
      initialUnavailableReason: initialRouteOverrideFacts.status,
      status: 'routeComparisonUnavailable',
      unavailableSide: 'both',
    }
  }

  // The final execution identity IS known here; only the initial side is absent.
  if (initialRouteOverrideFacts.status !== 'initialRouteOverrideObserved') {
    return {
      initialUnavailableReason: initialRouteOverrideFacts.status,
      status: 'routeComparisonUnavailable',
      unavailableSide: 'initial',
    }
  }

  // The initial route identity IS known here; no unique final identity exists.
  if (finalSuccessfulExecutionFacts.status !== 'finalSuccessfulExecutionObserved') {
    return {
      finalUnavailableReason: finalSuccessfulExecutionFacts.status,
      status: 'routeComparisonUnavailable',
      unavailableSide: 'final',
    }
  }

  // The ONE comparable pair: two complete identities, compared component by
  // component with raw string equality and nothing else.
  const providerMatches = initialRouteOverrideFacts.providerId === finalSuccessfulExecutionFacts.providerId
  const modelMatches = initialRouteOverrideFacts.modelId === finalSuccessfulExecutionFacts.modelId

  if (providerMatches && modelMatches)
    return { modelMatches: true, providerMatches: true, status: 'routeIdentityMatched' }

  // Exactly one of the three differing combinations, each with literal
  // booleans, so the "differed but both equal" shape cannot be produced.
  if (providerMatches)
    return { modelMatches: false, providerMatches: true, status: 'routeIdentityDiffered' }

  if (modelMatches)
    return { modelMatches: true, providerMatches: false, status: 'routeIdentityDiffered' }

  return { modelMatches: false, providerMatches: false, status: 'routeIdentityDiffered' }
}
