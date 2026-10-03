/**
 * Phase 8.0D-10B-4D4C4-B4B2: the pure logical-send terminal observation facts.
 *
 * It answers exactly one factual question about the snapshot it is handed: which
 * settlement of the whole logical send does that snapshot currently retain?
 *
 *   snapshot.sendTerminal            (absent | one one-field record)
 *     -> the direct retained observation, or nothing at all
 *
 * What it deliberately is NOT: not a store, not a read adapter, not a transport,
 * not a sanitizer, not an observer and not an authority. It holds no state, reads
 * no clock, imports nothing, edits nothing and returns a fresh value on every
 * call. It never joins the send settlement to a round, an attempt, a decision or
 * an identity: `executionTerminals`, `executions`, `roundId`, provider and model
 * are not part of its contract at all.
 *
 * Retention boundary: the caller supplies the snapshot, so the caller - and the
 * canonical store behind it - owns what history is retained. The canonical store
 * keeps at most ONE send terminal per correlation, first write wins, and the
 * value describes only the snapshot that was handed in; see the zero semantics
 * documented on the result type.
 *
 * Ownership: nothing is imported at all, so this derivation cannot reach the
 * canonical store, the read adapter, the transport contract or the observer. The
 * outcome vocabulary is declared locally as the minimal structural contract this
 * projection needs.
 */

/**
 * The input this derivation accepts: one optional logical-send terminal record.
 *
 * Deliberately narrow - a routing decision, request-start reports, round
 * terminals, provider or model identity, conversation, round and correlation keys
 * are NOT part of this contract, because projecting one direct settlement needs
 * none of them. `sendTerminal` is optional, so a structural snapshot that carries
 * no record reads exactly like one that carries `undefined`: both describe no
 * retained send-terminal observation.
 */
export interface LiaBrainSendTerminalObservationSnapshot {
  sendTerminal?: {
    outcome:
      | 'succeeded'
      | 'failed'
  }
}

/**
 * The factual result: the direct retained settlement, and nothing else.
 *
 * A present `sendTerminalOutcome` IS the observation - there is no status field
 * (presence already says "observed"), no boolean pair (it would collapse "not
 * retained" and "observed as the other one"), no count (the store retains at most
 * one record, so a 0/1 count would only be presence disguised as an aggregate),
 * no total, no round join and no verdict of any kind.
 *
 * Absence semantics, exactly: an empty result means ONLY that no accepted
 * logical-send terminal observation is retained in the supplied snapshot. It does
 * not mean pending, still running, unfinished, succeeded = false, failed = false,
 * reporting lost, no fallback occurred, or any other lifecycle claim - and for an
 * absent or expired correlation there is no snapshot at all.
 */
export interface LiaBrainSendTerminalObservationFacts {
  sendTerminalOutcome?:
    | 'succeeded'
    | 'failed'
}

/**
 * Projects the logical-send terminal observation of one supplied snapshot.
 *
 * Pure and synchronous: one optional read, one closed-vocabulary check, one fresh
 * result object. The snapshot and its record are only read - never edited,
 * reordered or kept - and repeated calls over the same snapshot produce equal,
 * independently owned results.
 *
 * The closed-vocabulary check stays deliberately narrow: the input is a trusted,
 * already-canonical snapshot (the ingress sanitizer owns the IPC trust boundary),
 * so this is a projection guard, not a second sanitizer - no `isRecord`, no
 * `typeof` probe, no trimming, no length check and no cloning helper. An outcome
 * outside the closed vocabulary contributes NOTHING rather than being repaired,
 * renamed or reported.
 */
export function deriveLiaBrainSendTerminalObservationFacts(
  snapshot: LiaBrainSendTerminalObservationSnapshot,
): LiaBrainSendTerminalObservationFacts {
  const outcome = snapshot.sendTerminal?.outcome

  if (outcome !== 'succeeded' && outcome !== 'failed')
    return {}

  return {
    sendTerminalOutcome: outcome,
  }
}
