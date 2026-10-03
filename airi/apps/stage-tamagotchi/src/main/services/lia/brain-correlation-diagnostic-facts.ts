import type { LiaBrainCorrelationSnapshotReader, LiaBrainEngineProviderLookup } from './brain-correlation-reader'
import type { LiaBrainExecutionIdentityFacts } from './brain-execution-identity-facts'
import type { LiaBrainTerminalObservationFacts } from './brain-execution-terminal-facts'
import type { LiaBrainFinalSuccessfulExecutionFacts } from './brain-final-successful-execution-facts'
import type { LiaBrainInitialRouteObservationFacts } from './brain-initial-route-facts'
import type { LiaBrainRouteConformanceFacts } from './brain-route-conformance-facts'
import type { LiaBrainSendTerminalObservationFacts } from './brain-send-terminal-facts'

import { deriveLiaBrainExecutionIdentityFacts } from './brain-execution-identity-facts'
import { deriveLiaBrainTerminalObservationFacts } from './brain-execution-terminal-facts'
import { deriveLiaBrainFinalSuccessfulExecutionFacts } from './brain-final-successful-execution-facts'
import { deriveLiaBrainInitialRouteObservationFacts } from './brain-initial-route-facts'
import { deriveLiaBrainRouteConformanceFacts } from './brain-route-conformance-facts'
import { deriveLiaBrainSendTerminalObservationFacts } from './brain-send-terminal-facts'

/**
 * Phase 8.0D-10B-4D4C4-D2B3: the ONE-SNAPSHOT diagnostic composition.
 *
 * It is the single place that turns one opaque correlation key into ONE composed
 * factual object:
 *
 *   correlationId
 *     -> ONE snapshot read (the reader-owned structural contract)
 *     -> the pure per-attempt identity facts of Phase 8.0D-10B-4C2B
 *     -> the pure terminal-observation counts of Phase 8.0D-10B-4D4C3B1
 *     -> the pure logical-send terminal facts of Phase 8.0D-10B-4D4C4-B4B2
 *     -> the pure initial routeOverride facts of Phase 8.0D-10B-4D4C4-D2B7
 *     -> the pure final successful execution facts of Phase 8.0D-10B-4D4C4-D2B3
 *     -> the pure route-conformance facts of Phase 8.0D-10B-4D4C4-D2B10
 *     -> one composed result, or the explicit absence state
 *
 * The single-snapshot rule is the entire reason this module exists: ALL FIVE
 * snapshot derivations are handed the SAME snapshot object the ONE read
 * returned, so the identity facts, the round-terminal counts, the logical-send
 * terminal fact, the initial routeOverride fact and the final successful
 * execution facts of one result always describe one and the same retained
 * snapshot. Two separate reads could describe two different retained snapshots -
 * a lazy expiry could fall between them, or a later write could land between
 * them - and a result that mixed them would be indistinguishable from a correct
 * one.
 *
 * Phase 8.0D-10B-4D4C4-D2B10 adds a SIXTH derived sibling, and it is a
 * different kind of derivation: the route-conformance facts are FACTS-TO-FACTS.
 * They consume the RESULTS of the initial-route and final-successful-execution
 * derivations and never touch the snapshot, the read handle or the mapping. So
 * the single-snapshot rule is preserved rather than extended - there is still
 * exactly one read, still exactly five derivations that see the snapshot, and
 * the sixth sees only what those two already produced from it. Because it
 * reuses their results it cannot re-derive the successful-round join or the
 * initial tri-state, and therefore cannot disagree with the sibling beside it.
 *
 * Because it performs that read, this module is not itself a mathematical
 * function: it consumes one live read handle and returns a fresh value per call.
 * The derivations it invokes stay exactly what they were - pure, synchronous and
 * stateless - and this module adds no reasoning of its own beyond the read, the
 * absence branch and the delegations. It holds no state between calls, reads no
 * clock and interprets no fact: the identity states, the three counts, the
 * direct send settlement, the initial route snapshot, the final successful
 * execution facts and the route-conformance facts travel exactly as the pure
 * layers produced them.
 *
 * The five snapshot derivations stay INDEPENDENT: nothing here pairs an
 * execution-start observation with a terminal observation, groups by round key
 * beyond the successful-round join owned by the final derivation, joins the
 * logical-send settlement or the initial route to any round outside their
 * derivation, orders anything or dedupes anything. The sixth sibling is the ONE
 * place this module emits a factual comparison, and that comparison is narrow
 * and inert: it states only whether two independently observed route identities
 * are string-equal, or which side was not observed. There is still no score, no
 * ranking, no aggregate over the other siblings, no causal inference about why
 * two identities could differ, no routing authority and no execution control -
 * this module cannot influence what executes.
 *
 * Deliberately absent: no store, no service, no observer, no diagnostic line, no
 * IPC/Eventa, no output sink, no filesystem, no network, no timers and no
 * environment knowledge.
 */

/**
 * The composed diagnostic facts of ONE correlation key - the whole result, and
 * nothing else.
 *
 * The union mirrors the read boundary exactly, so zero can never be confused
 * with unknown:
 *
 * - a key with NO live snapshot answers with the explicit absence state and NO
 *   terminal facts at all - the counts are not fabricated as zeros, because
 *   there was no snapshot to count;
 * - a key WITH a live snapshot answers with the identity facts of that snapshot
 *   plus the counts of the SAME snapshot, where `terminalFacts` is REQUIRED -
 *   three zeros there mean \"present, and retaining no terminal observation\",
 *   which is a fact and not an absence - plus the logical-send terminal facts of
 *   that same snapshot, where `sendTerminalFacts` is REQUIRED too: an empty
 *   sibling means \"present, and retaining no accepted send-terminal
 *   observation\", which is a fact and not an absence - plus the final
 *   successful execution facts of that same snapshot, where
 *   `finalSuccessfulExecutionFacts` is REQUIRED too - plus the route-conformance
 *   facts derived from those two route sides, where `routeConformanceFacts` is
 *   REQUIRED as well: an unavailability state there means "present, and one or
 *   both route identities were not observed", which is a fact and not an
 *   absence.
 *
 * The discriminator is the identity layer's own `facts.status`
 * (`correlationNotObserved` is the only absent state); no second status field,
 * no presence flag and no extra key is layered on top of it. In particular the
 * send sibling carries NO status of its own: presence of its qualified outcome
 * is the whole observation. The final sibling carries its own explicit statuses
 * and never fabricates a winner when none is factually retained, and the
 * route-conformance sibling never fabricates an equality when either route
 * identity was not observed.
 *
 * Deliberately absent: the opaque correlation key itself (the caller already
 * owns it), the raw snapshot, the decision, the attempts, the round records, the
 * raw logical-send record and any claim about the send - only the approved
 * identity facts, the three counts, the one direct settlement, the two route
 * sides and the one route-conformance comparison travel.
 */
export type LiaBrainCorrelationDiagnosticFacts
  = | { facts: { status: 'correlationNotObserved' } }
    | {
      facts: LiaBrainExecutionIdentityFacts
      terminalFacts: LiaBrainTerminalObservationFacts
      sendTerminalFacts: LiaBrainSendTerminalObservationFacts
      initialRouteOverrideFacts: LiaBrainInitialRouteObservationFacts
      finalSuccessfulExecutionFacts: LiaBrainFinalSuccessfulExecutionFacts
      routeConformanceFacts: LiaBrainRouteConformanceFacts
    }

/**
 * Reads ONE correlation snapshot and composes the diagnostic facts of that one
 * snapshot.
 *
 * Exact semantics, once per call:
 * 1. `correlationReader.get(correlationId)` is called EXACTLY once - the key is
 *    forwarded verbatim as an opaque string, never parsed, validated, trimmed,
 *    prefixed or replaced;
 * 2. `undefined` -> `{ facts: { status: 'correlationNotObserved' } }`, and
 *    NONE of the derivations run: no empty snapshot is fabricated and no zero
 *    counts are produced for a key with no live snapshot;
 * 3. a snapshot -> the identity facts of `(snapshot, mapping)` plus the terminal
 *    counts, the logical-send terminal facts, the initial routeOverride facts
 *    and the final successful execution facts of the SAME `snapshot` object;
 * 4. the initial-route and final-execution RESULTS from step 3 are then handed,
 *    as facts and never as a snapshot, to the route-conformance derivation - so
 *    that sixth sibling is computed from the two results already in hand and
 *    cannot read a second snapshot or re-run either join. All six are placed in
 *    one freshly built result.
 *
 * The mapping is forwarded to the identity derivation only: it is the trusted
 * engine -> provider lookup that layer already consumes, and this module never
 * resolves, rebuilds or inspects it.
 *
 * Failure semantics: the injected read handle and all derivations are
 * synchronous internal dependencies, so an unexpected throw is NOT swallowed
 * here - it propagates to the caller unchanged. Hiding an internal defect behind
 * a factual-looking absence state would misreport a programming or storage
 * problem as \"nothing observed\"; a caller that wants that containment owns it.
 *
 * The snapshot, its decision, its attempts, its terminal records and the mapping
 * are only read - never edited, reordered or kept. Repeated calls over an
 * equivalent snapshot produce deeply equal, independently owned results.
 */
export function composeLiaBrainCorrelationDiagnosticFacts(
  correlationReader: LiaBrainCorrelationSnapshotReader,
  correlationId: string,
  mapping: LiaBrainEngineProviderLookup,
): LiaBrainCorrelationDiagnosticFacts {
  // Exactly ONE read, before any branch: the snapshot below is the ONLY thing
  // all derivations ever see, so they cannot describe two different retained
  // snapshots.
  const snapshot = correlationReader.get(correlationId)
  if (snapshot === undefined)
    return { facts: { status: 'correlationNotObserved' } }

  // All FIVE snapshot derivations read the same object, which is not copied,
  // cloned or split: the read handle already returns a fresh snapshot, and none
  // of the derivations keeps or edits anything it is handed.
  //
  // The two route sides are bound to locals - not inlined - for one reason only:
  // the sixth derivation below consumes their RESULTS, and each of them must
  // therefore run exactly once. Deriving either one twice to feed the comparison
  // would double the work and, worse, would let the compared value drift from
  // the sibling it is published beside.
  const initialRouteOverrideFacts = deriveLiaBrainInitialRouteObservationFacts(snapshot)
  const finalSuccessfulExecutionFacts = deriveLiaBrainFinalSuccessfulExecutionFacts(snapshot)

  // The SIXTH derivation is facts-to-facts: it is handed the two results above
  // and never the snapshot, so it cannot read a second snapshot, cannot re-run
  // the successful-round join and cannot re-derive the initial tri-state.
  const routeConformanceFacts = deriveLiaBrainRouteConformanceFacts(initialRouteOverrideFacts, finalSuccessfulExecutionFacts)

  return {
    facts: deriveLiaBrainExecutionIdentityFacts(snapshot, mapping),
    terminalFacts: deriveLiaBrainTerminalObservationFacts(snapshot),
    sendTerminalFacts: deriveLiaBrainSendTerminalObservationFacts(snapshot),
    initialRouteOverrideFacts,
    finalSuccessfulExecutionFacts,
    routeConformanceFacts,
  }
}
