import type { LiaBrainExecutionIdentityFacts, LiaBrainExecutionIdentitySnapshot } from './brain-execution-identity-facts'

import { deriveLiaBrainExecutionIdentityFacts } from './brain-execution-identity-facts'

/**
 * Phase 8.0D-10B-4C3A: the correlation snapshot READER.
 *
 * It is the smallest possible adapter between the ephemeral correlation memory
 * and the pure per-attempt facts of Phase 8.0D-10B-4C2B:
 *
 *   correlationId
 *     -> ONE snapshot read (structural reader)
 *     -> the existing pure identity-facts transformation
 *     -> factual per-attempt identity facts (or "nothing observed")
 *
 * It owns the READ only. It interprets nothing: every state the facts layer can
 * produce (`decisionNotObserved`, `noBrainRouteSelected`, `engineMappingMissing`,
 * `noExecutionObserved`, `attemptIdentityFacts`) is returned exactly as
 * produced. The reader adds no aggregate fact, no verdict, no score, no
 * recommendation and no execution authority - it cannot select, switch, retry
 * or override anything, and nothing here can write to the memory it reads.
 *
 * Absence is not a diagnosis: `correlationNotObserved` means only that no live
 * snapshot existed for that key AT READ TIME. It is never read as a timeout, a
 * failure, a loss, an expiry error or a divergence - the ephemeral memory may
 * have evicted or expired the entry, and this module deliberately does not
 * infer why. Consequently there is no retry, no poll, no timer, no sleep and no
 * subscription: the call describes the snapshot that exists NOW.
 *
 * The reader dependency is STRUCTURAL (`get(correlationId)` only): the
 * production correlation memory object satisfies it as-is, without importing
 * that module here, and without this module learning that `recordDecision`,
 * `recordExecution`, `size` or any backing storage exist. The trusted
 * engine -> provider mapping arrives as an explicit argument - this module
 * never reaches for a global table, a provider registry or a catalog.
 *
 * Deliberately absent: no IPC/Eventa, no Brain call, no product-config write,
 * no provider/model resolution, no fallback/retry, no permissions or tools, no
 * filesystem, no network, no timers, no logging, no retention of the snapshot.
 */

/**
 * The minimum read dependency of this adapter: fetch ONE snapshot for an opaque
 * key, or nothing.
 *
 * Deliberately NOT the concrete correlation memory module: the production
 * object is structurally compatible (its entries carry the decision plus the
 * execution reports, which satisfy `LiaBrainExecutionIdentitySnapshot`), while
 * its write APIs, its `size` and its internals stay invisible to this module.
 */
export interface LiaBrainCorrelationSnapshotReader {
  get: (correlationId: string) => LiaBrainExecutionIdentitySnapshot | undefined
}

/**
 * The trusted engine -> provider mapping this adapter consumes, declared
 * STRUCTURALLY.
 *
 * It is the exact shape of the trusted mapping contract introduced with the
 * expected-route foundation (`LiaBrainEngineProviderMapping`), so the product
 * layer's mapping object satisfies it as-is - and declaring it locally keeps
 * the dependency chain of this phase strictly linear:
 *
 *   brain-correlation-reader -> brain-execution-identity-facts -> brain-expected-route
 *
 * This module never reaches for a global table, never imports the production
 * mapping object and never resolves a provider: the mapping is an explicit
 * argument, and how it is consulted stays owned by the identity-facts layer.
 */
export interface LiaBrainEngineProviderLookup {
  providerIdForEngine: (engineId: string) => string | undefined
}

/**
 * The factual outcome of one read.
 *
 * - `correlationNotObserved`  no live snapshot exists for that key at read
 *   time (absent, expired or evicted - indistinguishable here, and deliberately
 *   not interpreted);
 * - otherwise the identity facts are returned EXACTLY as the pure facts layer
 *   produced them, unmodified and unwrapped.
 */
export type LiaBrainCorrelationReadFacts
  = | { status: 'correlationNotObserved' }
    | LiaBrainExecutionIdentityFacts

/**
 * Reads one correlation snapshot and derives its per-attempt identity facts.
 *
 * Exact semantics, once per call:
 * 1. `correlationReader.get(correlationId)` is called EXACTLY once - the key is
 *    forwarded verbatim as an opaque string, never parsed, validated, trimmed,
 *    prefixed or replaced;
 * 2. `undefined` -> `{ status: 'correlationNotObserved' }`; the mapping is not
 *    consulted at all in that case;
 * 3. a snapshot -> `deriveLiaBrainExecutionIdentityFacts(snapshot, mapping)`,
 *    returned unchanged. No second lookup, no re-derivation, no re-typing of
 *    its result states.
 *
 * Failure semantics: the injected reader is a synchronous internal dependency,
 * so an unexpected throw is NOT swallowed here - it propagates to the caller
 * unchanged (the same holds for anything the pure facts layer throws, such as a
 * mapping that throws). Hiding an internal defect behind a factual-looking state
 * would misreport a programming or storage problem as "nothing observed"; a
 * future application wiring may choose its own diagnostic isolation boundary.
 *
 * Pure with respect to its inputs: the snapshot, its decision, its attempts and
 * the mapping are read and never mutated, nothing is retained between calls,
 * and repeated calls with an unchanged snapshot produce equal, freshly built
 * facts.
 */
export function readLiaBrainExecutionIdentityFacts(
  correlationReader: LiaBrainCorrelationSnapshotReader,
  correlationId: string,
  mapping: LiaBrainEngineProviderLookup,
): LiaBrainCorrelationReadFacts {
  const snapshot = correlationReader.get(correlationId)
  if (snapshot === undefined)
    return { status: 'correlationNotObserved' }

  return deriveLiaBrainExecutionIdentityFacts(snapshot, mapping)
}
