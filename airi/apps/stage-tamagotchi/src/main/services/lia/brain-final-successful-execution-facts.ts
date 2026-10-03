/**
 * Phase 8.0D-10B-4D4C4-D2B3: the pure final successful execution identity facts.
 *
 * It answers exactly one factual question about the snapshot it is handed:
 * which execution provider/model is associated with the successfully completed
 * round of the settled logical send retaining that snapshot, when such an
 * association can be established factually.
 *
 *   snapshot.sendTerminal
 *     + snapshot.executionTerminals (succeeded filter)
 *     + snapshot.executions (roundId join)
 *     -> one of seven explicit factual states
 *
 * What it is:
 *   pure        a snapshot comes in, a factual value goes out; inputs are read
 *               and never mutated, and every returned object is fresh
 *   synchronous stateless read-only no store access no IPC no logger
 *               no Brain call no provider registry no config no mutation
 *   read-only   the snapshot and every element inside it are only read
 *
 * What it deliberately is NOT:
 *   authority   it never calls a Brain service, never selects a route,
 *               never interprets fallback, never decides which attempt won
 *   comparison  it never compares a decision to an execution, never derives
 *               requestedInitialRoute / appliedRouteOverride / winner
 *               and never asks whether the Brain route was applied
 *   attempt     it never derives attemptIndex, isFallback, fallbackRoutes or
 *               initial-vs-fallback classification; arrivalIndex is only the
 *               observational position in the retained executions array
 *
 * Join contract:
 *   successfulRoundId is the roundId of the ONE terminal with outcome
 *   'succeeded' when exactly one such terminal exists in the retained
 *   snapshot. The execution identity is the ONE execution observation whose
 *   roundId equals that successfulRoundId. No other field participates.
 *
 * Absence vs pending: an absent sendTerminal means only that no accepted
 * settlement is retained, not pending or running. A succeeded send with no
 * succeeded terminal is an explicit incomplete state, not a guess from the
 * last execution.
 */

/** The minimum an execution observation must carry for this derivation. */
export interface LiaBrainFinalSuccessfulExecutionObservation {
  roundId: string
  providerId: string
  modelId: string
}

/** The minimum a round terminal must carry for this derivation. */
export interface LiaBrainFinalSuccessfulTerminalObservation {
  roundId: string
  outcome: 'succeeded' | 'failed' | 'abandoned'
}

/**
 * The input this derivation accepts: the three factual collections of ONE
 * settled logical send, as already retained by the canonical correlation entry.
 *
 * Deliberately structural and narrow - decision, conversation, correlation key,
 * timestamps and raw report metadata are NOT part of this contract, because
 * joining a successful round to its execution needs none of them. Each member
 * is optional so every existing structural double stays compatible, while the
 * canonical store always supplies executions and executionTerminals (possibly
 * empty) and an optional sendTerminal. The collections are only read.
 */
export interface LiaBrainFinalSuccessfulExecutionSnapshot {
  executions?: readonly LiaBrainFinalSuccessfulExecutionObservation[]
  executionTerminals?: readonly LiaBrainFinalSuccessfulTerminalObservation[]
  sendTerminal?: {
    outcome: 'succeeded' | 'failed'
  }
}

/**
 * The factual result: one of seven explicit states, and nothing else.
 *
 * Present sendTerminal is REQUIRED for any successful-round work: a round
 * fact and a logical-send settlement are distinct existing contracts, so a
 * succeeded round alone never yields a final route without a succeeded send.
 *
 * - `sendTerminalNotObserved`           no accepted send terminal retained
 * - `sendFailed`                        send retained as failed - no winner
 * - `noSucceededRoundObserved`          send succeeded but no terminal of
 *                                       outcome succeeded retained
 * - `multipleSucceededRoundTerminalsObserved` more than one succeeded terminal
 *                                       - ambiguous, no round chosen
 * - `succeededRoundExecutionNotObserved` exactly one succeeded round, but no
 *                                       execution report with that roundId
 * - `multipleExecutionsForSucceededRoundObserved` exactly one succeeded round,
 *                                       but more than one execution with that
 *                                       roundId - ambiguous, no execution chosen
 * - `finalSuccessfulExecutionObserved`  exactly one succeeded round and exactly
 *                                       one execution with that roundId - the
 *                                       factual observed execution identity of
 *                                       the successful logical send, with its
 *                                       observational arrival index
 *
 * Deliberately absent: the correlation key, raw snapshot, decision, attempt
 * counts, fallback classification, winner reason, expected/ requested provider,
 * engine id, score, correctness, preferred, selectedByBrain and any routing
 * verdict.
 */
export type LiaBrainFinalSuccessfulExecutionFacts
  = | { status: 'sendTerminalNotObserved' }
    | { status: 'sendFailed' }
    | { status: 'noSucceededRoundObserved' }
    | { status: 'multipleSucceededRoundTerminalsObserved' }
    | { status: 'succeededRoundExecutionNotObserved', roundId: string }
    | { status: 'multipleExecutionsForSucceededRoundObserved', roundId: string }
    | {
      status: 'finalSuccessfulExecutionObserved'
      roundId: string
      providerId: string
      modelId: string
      executionArrivalIndex: number
    }

/**
 * Derives the final successful execution identity of one supplied snapshot.
 *
 * Steps, in order:
 * 1. sendTerminal absent or outside closed vocabulary -> sendTerminalNotObserved
 * 2. sendTerminal outcome failed -> sendFailed (no winner even if a round succeeded)
 * 3. sendTerminal succeeded + zero succeeded round terminals -> noSucceededRoundObserved
 * 4. sendTerminal succeeded + more than one succeeded terminal -> multipleSucceededRoundTerminalsObserved
 * 5. sendTerminal succeeded + exactly one succeeded terminal -> use that roundId as join key
 *    a. zero matching executions -> succeededRoundExecutionNotObserved
 *    b. more than one matching execution -> multipleExecutionsForSucceededRoundObserved
 *    c. exactly one matching execution -> finalSuccessfulExecutionObserved with that
 *       execution's providerId/modelId/roundId and its observational arrival index
 *
 * Pure: snapshot and every element are read, never mutated; returned value
 * shares no object with the input.
 */
export function deriveLiaBrainFinalSuccessfulExecutionFacts(
  snapshot: LiaBrainFinalSuccessfulExecutionSnapshot,
): LiaBrainFinalSuccessfulExecutionFacts {
  const outcome = snapshot.sendTerminal?.outcome

  if (outcome !== 'succeeded' && outcome !== 'failed')
    return { status: 'sendTerminalNotObserved' }

  if (outcome === 'failed')
    return { status: 'sendFailed' }

  // Send is succeeded - inspect round terminals.
  const terminals = snapshot.executionTerminals ?? []
  let succeededRoundId: string | undefined
  let succeededCount = 0

  for (const record of terminals) {
    if (record.outcome === 'succeeded') {
      succeededCount += 1
      // Keep the one id when exactly one exists; multiple case discards choice.
      if (succeededCount === 1)
        succeededRoundId = record.roundId
    }
  }

  if (succeededCount === 0)
    return { status: 'noSucceededRoundObserved' }

  if (succeededCount > 1)
    return { status: 'multipleSucceededRoundTerminalsObserved' }

  // Exactly one succeeded round - join by roundId only.
  const roundId = succeededRoundId as string
  const executions = snapshot.executions ?? []

  let matchedIndex = -1
  let matchCount = 0
  let matchedProviderId = ''
  let matchedModelId = ''

  for (let index = 0; index < executions.length; index += 1) {
    const execution = executions[index]
    if (execution === undefined)
      continue
    if (execution.roundId === roundId) {
      matchCount += 1
      if (matchCount === 1) {
        matchedIndex = index
        matchedProviderId = execution.providerId
        matchedModelId = execution.modelId
      }
    }
  }

  if (matchCount === 0)
    return { roundId, status: 'succeededRoundExecutionNotObserved' }

  if (matchCount > 1)
    return { roundId, status: 'multipleExecutionsForSucceededRoundObserved' }

  return {
    executionArrivalIndex: matchedIndex,
    modelId: matchedModelId,
    providerId: matchedProviderId,
    roundId,
    status: 'finalSuccessfulExecutionObserved',
  }
}
