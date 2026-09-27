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
 * Phase 8.0D-10B-4D4C3A: the SNAPSHOT CONTRACT this adapter reads is widened to
 * admit the raw terminal records a canonical correlation entry may carry
 * (`executionTerminals`, one two-field record per round, in store arrival
 * order). That is a structural boundary only: the read RESULT is untouched - the
 * identity facts are still returned exactly as the pure facts layer produces
 * them, and the raw terminal records are neither read, copied, joined nor
 * interpreted by this module's runtime. A later phase may deliberately derive
 * terminal-specific facts; until then the collection stops at the snapshot.
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
 * The minimum a stored terminal record must carry for this adapter.
 *
 * Deliberately NOT the store's own record type: a real correlation-store entry
 * satisfies this shape as-is (its `executionTerminals` carry exactly these two
 * fields), and the opaque correlation key is not duplicated inside a record -
 * the entry that holds it is already keyed by it.
 */
export interface LiaObservedExecutionTerminal {
  roundId: string
  outcome:
    | 'succeeded'
    | 'failed'
    | 'abandoned'
}

/**
 * The snapshot this adapter READS: the facts minimum plus the raw terminal
 * collection a canonical correlation entry carries, owned by this layer.
 *
 * This is the ONLY terminal exposure this adapter owns. `executionTerminals` is
 * deliberately OPTIONAL on this structural boundary, so every existing
 * structural double stays compatible, while the canonical store always supplies
 * it. The two execution collections stay independent: nothing here pairs them by
 * `roundId` - the collection is carried by the contract and otherwise ignored.
 */
export interface LiaBrainCorrelationSnapshot extends LiaBrainExecutionIdentitySnapshot {
  /** Every terminal record of that logical send, in store arrival order. */
  executionTerminals?: readonly LiaObservedExecutionTerminal[]
}

/**
 * The minimum read dependency of this adapter: fetch ONE snapshot for an opaque
 * key, or nothing.
 *
 * Deliberately NOT the concrete correlation memory module: the production
 * object is structurally compatible (its entries carry the decision, the
 * execution reports and the terminal records), while its write APIs, its `size`
 * and its internals stay invisible to this module.
 */
export interface LiaBrainCorrelationSnapshotReader {
  get: (correlationId: string) => LiaBrainCorrelationSnapshot | undefined
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
 *   not interpreted). Nothing is fabricated for it - no empty collections;
 * - otherwise the identity facts are returned EXACTLY as the pure facts layer
 *   produced them, unmodified and unwrapped. Raw terminal records are NOT part of
 *   this result, even when the snapshot carries them.
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
 *    its result states - and no terminal handling of any kind, even when the
 *    snapshot contract carries a terminal collection.
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
