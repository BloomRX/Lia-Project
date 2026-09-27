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
 * Since Phase 8.0D-10B-4D4C3A it also carries the RAW terminal collection of
 * the snapshot it read (`executionTerminals`, one two-field record per round, in
 * store arrival order). That is pure factual carriage: the reader never joins it
 * to `executions`, never interprets an outcome and never derives anything from
 * it - the identity facts are computed exactly as before, and the terminals are
 * copied verbatim beside them.
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
 * collection, owned by this layer.
 *
 * `executionTerminals` is deliberately optional on the way IN - it is the one
 * field a structural double may omit - while the reader's own result always
 * exposes the collection (empty when the correlation has none). The two
 * execution collections stay independent: nothing here pairs them by `roundId`.
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
 * The raw terminal carriage of one present snapshot.
 *
 * `executionTerminals` is ALWAYS an array for a correlation that exists - empty
 * when no round has settled yet - and each element is a fresh two-field copy.
 * A caller cannot reach the snapshot it passed in through it, and nothing here
 * interprets an outcome, counts records or reads the last one.
 */
export interface LiaBrainCorrelationTerminalFacts {
  executionTerminals: readonly LiaObservedExecutionTerminal[]
}

/**
 * The factual outcome of one read.
 *
 * - `correlationNotObserved`  no live snapshot exists for that key at read
 *   time (absent, expired or evicted - indistinguishable here, and deliberately
 *   not interpreted). Nothing is fabricated for it - no empty collections;
 * - otherwise the identity facts are returned EXACTLY as the pure facts layer
 *   produced them, unmodified and unwrapped, BESIDE the raw terminal
 *   collection of that same snapshot.
 */
export type LiaBrainCorrelationReadFacts
  = | { status: 'correlationNotObserved' }
    | (LiaBrainExecutionIdentityFacts & LiaBrainCorrelationTerminalFacts)

/** Copies exactly the two terminal fields of every record into fresh objects. */
function copyObservedExecutionTerminals(
  terminals: readonly LiaObservedExecutionTerminal[] | undefined,
): LiaObservedExecutionTerminal[] {
  return (terminals ?? []).map(terminal => ({
    outcome: terminal.outcome,
    roundId: terminal.roundId,
  }))
}

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
 *    returned unchanged, with the snapshot's raw terminal collection copied
 *    beside it (empty array when the correlation has no terminal records). No
 *    second lookup, no re-derivation, no re-typing of its result states, and no
 *    interpretation of the terminal facts.
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

  // The facts are computed exactly as before - the terminal collection is NOT
  // an input to that derivation - and the raw terminal facts are copied beside
  // them, in their own order, one fresh record per stored record.
  return {
    ...deriveLiaBrainExecutionIdentityFacts(snapshot, mapping),
    executionTerminals: copyObservedExecutionTerminals(snapshot.executionTerminals),
  }
}
