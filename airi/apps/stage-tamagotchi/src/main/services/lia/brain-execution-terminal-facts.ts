/**
 * Phase 8.0D-10B-4D4C3B1: the pure terminal-observation facts.
 *
 * It answers exactly one factual question about the snapshot it is handed: how
 * many accepted terminal observations of each outcome that snapshot currently
 * retains.
 *
 *   snapshot.executionTerminals   (absent | empty | one | many)
 *     -> one observation count per outcome
 *
 * What it deliberately is NOT: not a store, not a read adapter, not a
 * transport, not a sanitizer, not an observer and not an authority. It holds no
 * state, reads no clock, imports nothing, edits nothing and returns fresh
 * counts on every call. It never pairs a terminal observation with a
 * request-start observation, never groups by round key, never orders, never
 * dedupes and never renames an outcome: every record it receives is counted as
 * the outcome it carries, and a record carrying anything else contributes to
 * none of the three counts.
 *
 * Counting boundary: the caller supplies the snapshot, so the caller - and the
 * canonical store behind it - owns what history is retained. The three counts
 * describe ONLY the retained snapshot that was handed in; see the zero
 * semantics documented on the result type.
 *
 * Ownership: nothing is imported at all, so this derivation cannot reach the
 * canonical store, the read adapter or the transport contract. The outcome
 * vocabulary is declared locally as the minimal structural contract this
 * counting needs.
 */

/** The minimum a terminal observation must carry for this derivation. */
export interface LiaBrainTerminalObservationRecord {
  /** The observation's own outcome, in the runtime's closed vocabulary. */
  outcome:
    | 'succeeded'
    | 'failed'
    | 'abandoned'
}

/**
 * The input this derivation accepts: one optional terminal collection.
 *
 * Deliberately narrow - a routing decision, request-start reports, provider or
 * model identity, conversation and round key are NOT part of this contract,
 * because counting outcomes needs none of them. `executionTerminals` is
 * optional, so a structural snapshot that carries no collection reads exactly
 * like one that carries an empty collection: both describe zero retained
 * observations.
 */
export interface LiaBrainTerminalObservationSnapshot {
  executionTerminals?: readonly LiaBrainTerminalObservationRecord[]
}

/**
 * The factual result: one observation count per outcome, and nothing else.
 *
 * The three fields are the whole result - there is no total field (it would be
 * exactly their sum), no boolean presence flag (it would be exactly
 * `count > 0`), no per-round record and no verdict of any kind.
 *
 * Zero semantics, exactly: for the supplied snapshot, `0` means only that no
 * accepted observation of that outcome is represented in that retained
 * snapshot. It does not mean the outcome never happened, that the retained
 * history is whole, that no report was ever lost, or that no entry was pruned
 * before this read.
 */
export interface LiaBrainTerminalObservationFacts {
  succeededTerminalObservationCount: number
  failedTerminalObservationCount: number
  abandonedTerminalObservationCount: number
}

/**
 * Counts the terminal observations of one supplied snapshot.
 *
 * Pure and synchronous: one pass over the supplied collection, three local
 * tallies, one fresh result object. The collection and every record in it are
 * only read - never edited, reordered or kept. Repeated calls over the same
 * snapshot produce equal, independently owned results.
 */
export function deriveLiaBrainTerminalObservationFacts(
  snapshot: LiaBrainTerminalObservationSnapshot,
): LiaBrainTerminalObservationFacts {
  let succeeded = 0
  let failed = 0
  let abandoned = 0

  for (const record of snapshot.executionTerminals ?? []) {
    if (record.outcome === 'succeeded')
      succeeded += 1
    else if (record.outcome === 'failed')
      failed += 1
    else if (record.outcome === 'abandoned')
      abandoned += 1
  }

  return {
    abandonedTerminalObservationCount: abandoned,
    failedTerminalObservationCount: failed,
    succeededTerminalObservationCount: succeeded,
  }
}
