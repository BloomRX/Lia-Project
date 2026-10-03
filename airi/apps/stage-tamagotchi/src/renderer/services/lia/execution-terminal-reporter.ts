import type { ChatRoundSettledObserver } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'

import { useElectronEventaContext } from '@proj-airi/electron-vueuse'
import { registerChatRoundSettledObserver } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'

import { electronLiaBrainExecutionTerminalObservation } from '../../../shared/eventa'

/**
 * The observation the generic seam hands to its registered observer. It is
 * DERIVED from the seam's own public shape (type-only) instead of importing
 * Core Agent directly, so this diagnostics module needs no extra package edge
 * to report on a seam that already carries the type.
 */
type ChatRoundSettledObservation = Parameters<ChatRoundSettledObserver>[0]

/**
 * Phase 8.0D-10B-4D4C1: the Lia terminal reporter for correlated execution.
 *
 * It is the ONE legitimate production consumer of the generic settled-round
 * seam (`registerChatRoundSettledObserver`). For every round that entered the
 * send body, the renderer that actually ran it reports the round's FACTUAL
 * terminal treatment (`succeeded` / `failed` / `abandoned`, exactly as the Core
 * Agent runtime classified it) to the trusted main process through ONE new
 * one-way channel.
 *
 * Authority boundary (enforced by construction here):
 *   the generic Stage-UI / Core-Agent layers stay Brain-blind - they expose the
 *   observation and know nothing about Lia, the report channel or main
 *   renderer -> main carries an outcome as an UNTRUSTED diagnostic claim
 *
 * What this module may do: read the settled observation it receives, narrow it
 * to the three contract fields, and report it. What it may NOT do: read a Brain
 * decision, look up a provider or a model, join a round to its request-start
 * report, compare anything, remember anything, or influence the send it is
 * observing. The outcome is COPIED, never interpreted: there is no winner, no
 * finality, no fallback and no aggregate here.
 *
 * Multi-window: every renderer window has its own module instance and may
 * register, but only the window that actually ran the round ever receives an
 * observation - the reporter therefore never depends on sender-window local
 * state, it works purely from what it is handed.
 *
 * No storage: reports are never deduplicated, keyed, coalesced or cached. Two
 * identical observations produce two emissions - a future consumer needs every
 * report, and this module is transport, not memory.
 */

/**
 * Installs the Lia terminal observer on the generic settled-round seam.
 *
 * The seam is Electron-free and inert until something registers; this is the
 * only production registration site (the renderer composition root calls it
 * once per window, next to the request-start installation). Registration
 * performs no I/O: the report channel context is resolved lazily per report,
 * so boot can never be affected by it.
 */
export function registerLiaBrainExecutionTerminalObserver(): void {
  registerChatRoundSettledObserver(reportLiaBrainExecutionTerminalObservation)
}

/**
 * The observer itself: narrows ONE settled round to the three contract fields
 * and reports it, then returns `void`.
 *
 * It is `void` by contract - no caller can await a report, branch on one or
 * feed one back into execution. A round without a usable key or with an
 * outcome outside the frozen vocabulary is NOT reported: uncorrelated traffic
 * (voice, spotlight, direct ingest, transport-originated turns, any unrelated
 * runtime request) is not part of this diagnostic and stays invisible here.
 *
 * Crash-proof: every dispatch failure (no Electron context, no main listener,
 * a throwing channel) is swallowed right here - the send is never gated,
 * retried, failed or notified because a diagnostic report could not be
 * delivered.
 */
export function reportLiaBrainExecutionTerminalObservation(observation: ChatRoundSettledObservation): void {
  const { correlationId, outcome, roundId } = observation

  // Filter first: this Lia boundary REQUIRES the logical-send key (the generic
  // seam deliberately does not), and it never synthesizes one.
  if (typeof correlationId !== 'string' || correlationId.length === 0)
    return
  // The round key follows the same narrow non-empty string policy.
  if (typeof roundId !== 'string' || roundId.length === 0)
    return
  // The outcome vocabulary is closed: an unknown value is dropped, never
  // coerced, aliased or defaulted.
  if (outcome !== 'succeeded' && outcome !== 'failed' && outcome !== 'abandoned')
    return

  try {
    // Field-by-field copy of exactly the three contract fields. Nothing is
    // defaulted, derived, re-resolved or added: no conversation, no
    // provider/model identity, no timing, no usage, no error, no prompt, no
    // message, no tool, no decision.
    const report = {
      correlationId,
      outcome,
      roundId,
    }
    // One-way push: the existing renderer context, emitting - never an invoke,
    // because there is no response to read. Emitting is synchronous, so no
    // promise can be left unhandled.
    useElectronEventaContext().value.emit(electronLiaBrainExecutionTerminalObservation, report)
  }
  catch {
    // Diagnostic only: a report that cannot be delivered changes nothing about
    // the round it describes.
  }
}
