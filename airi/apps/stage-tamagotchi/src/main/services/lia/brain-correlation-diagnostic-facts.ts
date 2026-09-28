import type { LiaBrainCorrelationSnapshotReader, LiaBrainEngineProviderLookup } from './brain-correlation-reader'
import type { LiaBrainExecutionIdentityFacts } from './brain-execution-identity-facts'
import type { LiaBrainTerminalObservationFacts } from './brain-execution-terminal-facts'
import type { LiaBrainSendTerminalObservationFacts } from './brain-send-terminal-facts'

import { deriveLiaBrainExecutionIdentityFacts } from './brain-execution-identity-facts'
import { deriveLiaBrainTerminalObservationFacts } from './brain-execution-terminal-facts'
import { deriveLiaBrainSendTerminalObservationFacts } from './brain-send-terminal-facts'

/**
 * Phase 8.0D-10B-4D4C3B2: the ONE-SNAPSHOT diagnostic composition.
 *
 * It is the single place that turns one opaque correlation key into ONE composed
 * factual object:
 *
 *   correlationId
 *     -> ONE snapshot read (the reader-owned structural contract)
 *     -> the pure per-attempt identity facts of Phase 8.0D-10B-4C2B
 *     -> the pure terminal-observation counts of Phase 8.0D-10B-4D4C3B1
 *     -> the pure logical-send terminal facts of Phase 8.0D-10B-4D4C4-B4B2
 *     -> one composed result, or the explicit absence state
 *
 * The single-snapshot rule is the entire reason this module exists: ALL THREE
 * derivations are handed the SAME snapshot object the ONE read returned, so the
 * identity facts, the round-terminal counts and the logical-send terminal fact of
 * one result always describe one and the same retained snapshot. Two separate
 * reads could describe two different retained snapshots - a lazy expiry could
 * fall between them, or a later write could land between them - and a result that
 * mixed them would be indistinguishable from a correct one.
 *
 * Because it performs that read, this module is not itself a mathematical
 * function: it consumes one live read handle and returns a fresh value per call.
 * The three derivations it invokes stay exactly what they were - pure,
 * synchronous and stateless - and this module adds no reasoning of its own
 * beyond the read, the absence branch and the three delegations. It holds no
 * state between calls, reads no clock and interprets no fact: the identity
 * states, the three counts and the direct send settlement travel exactly as the
 * pure layers produced them.
 *
 * The three derivations stay INDEPENDENT: nothing here pairs an execution-start
 * observation with a terminal observation, groups by round key, joins the
 * logical-send settlement to any round, orders anything, dedupes anything or
 * combines the domains into a claim. There is no aggregate, no score and no
 * execution authority - this module cannot influence what executes.
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
 *   three zeros there mean "present, and retaining no terminal observation",
 *   which is a fact and not an absence - plus the logical-send terminal facts of
 *   that same snapshot, where `sendTerminalFacts` is REQUIRED too: an empty
 *   sibling means "present, and retaining no accepted send-terminal
 *   observation", which is a fact and not an absence.
 *
 * The discriminator is the identity layer's own `facts.status`
 * (`correlationNotObserved` is the only absent state); no second status field,
 * no presence flag and no extra key is layered on top of it. In particular the
 * send sibling carries NO status of its own: presence of its qualified outcome
 * is the whole observation.
 *
 * Deliberately absent: the opaque correlation key itself (the caller already
 * owns it), the raw snapshot, the decision, the attempts, the round records, the
 * raw logical-send record and any claim about the send - only the approved
 * identity facts, the three counts and the one direct settlement travel.
 */
export type LiaBrainCorrelationDiagnosticFacts
  = | { facts: { status: 'correlationNotObserved' } }
    | {
      facts: LiaBrainExecutionIdentityFacts
      terminalFacts: LiaBrainTerminalObservationFacts
      sendTerminalFacts: LiaBrainSendTerminalObservationFacts
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
 *    NEITHER derivation runs: no empty snapshot is fabricated and no zero counts
 *    are produced for a key with no live snapshot;
 * 3. a snapshot -> the identity facts of `(snapshot, mapping)` plus the terminal
 *    counts and the logical-send terminal facts of the SAME `snapshot` object, in
 *    one freshly built result.
 *
 * The mapping is forwarded to the identity derivation only: it is the trusted
 * engine -> provider lookup that layer already consumes, and this module never
 * resolves, rebuilds or inspects it.
 *
 * Failure semantics: the injected read handle and both derivations are
 * synchronous internal dependencies, so an unexpected throw is NOT swallowed
 * here - it propagates to the caller unchanged. Hiding an internal defect behind
 * a factual-looking absence state would misreport a programming or storage
 * problem as "nothing observed"; a caller that wants that containment owns it.
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
  // both derivations ever see, so they cannot describe two different retained
  // snapshots.
  const snapshot = correlationReader.get(correlationId)
  if (snapshot === undefined)
    return { facts: { status: 'correlationNotObserved' } }

  // All three derivations read the same object, which is not copied, cloned or
  // split: the read handle already returns a fresh snapshot, and none of the
  // derivations keeps or edits anything it is handed.
  return {
    facts: deriveLiaBrainExecutionIdentityFacts(snapshot, mapping),
    terminalFacts: deriveLiaBrainTerminalObservationFacts(snapshot),
    sendTerminalFacts: deriveLiaBrainSendTerminalObservationFacts(snapshot),
  }
}
