import type { ChatRequestStartedObservation } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'

import { useElectronEventaContext } from '@proj-airi/electron-vueuse'
import { registerChatRequestStartedObserver } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'

import { electronLiaBrainExecutionObservation } from '../../../shared/eventa'

/**
 * Phase 8.0D-10B-4A: the Lia diagnostic reporter for correlated execution.
 *
 * It is the ONE legitimate production consumer of the generic request-start
 * seam (`registerChatRequestStartedObserver`). For every LLM request the
 * renderer that actually executes it reports the identity of that attempt to
 * the trusted main process through ONE new one-way channel.
 *
 * Authority boundary (enforced by construction here):
 *   the generic Stage-UI / Core-Agent layers stay Brain-blind - they expose the
 *   observation and know nothing about Lia, the report channel or main
 *   renderer -> main carries execution identity as an UNTRUSTED diagnostic
 *   claim; main sanitizes and DISCARDS it
 *
 * What this module may do: read the correlated request-start metadata it
 * receives, and report it. What it may NOT do: read a Brain decision, look up
 * a provider or a model, resolve or re-resolve anything the runtime already
 * resolved, inspect product config, store comparison state, or influence the
 * request it is observing.
 *
 * Multi-window: every renderer window has its own module instance and may
 * register, but only the window that actually executes the request ever
 * receives an observation - the reporter therefore never depends on
 * sender-window local state, it works purely from what it is handed.
 *
 * Multi-attempt: one logical send with a fallback produces ONE report per
 * attempt. Reports are never deduplicated, keyed or coalesced by
 * `correlationId` - a future comparison needs every attempt.
 */

/**
 * Installs the Lia execution observer on the generic request-start seam.
 *
 * The seam is Electron-free and inert until something registers; this is the
 * only production registration site (the renderer composition root calls it
 * once per window). Registration performs no I/O: the report channel context
 * is resolved lazily per report, so boot can never be affected by it.
 */
export function registerLiaBrainExecutionObserver(): void {
  registerChatRequestStartedObserver(reportLiaBrainExecutionObservation)
}

/**
 * The observer itself: copies the five identities of ONE attempt and reports
 * them, then returns `void`.
 *
 * It is `void` by contract - no caller can await a report, branch on one or
 * feed one back into execution. An attempt without a usable logical-send key
 * is NOT reported: uncorrelated traffic (voice, spotlight, direct ingest,
 * transport-originated turns, any unrelated runtime request) is not part of
 * this diagnostic and stays invisible here.
 *
 * Crash-proof: reading the observation cannot throw for a well-formed one, and
 * every dispatch failure (no Electron context, no main listener, a throwing
 * channel) is swallowed right here - the LLM request is never gated, retried,
 * failed or notified because a diagnostic report could not be delivered.
 */
export function reportLiaBrainExecutionObservation(observation: ChatRequestStartedObservation): void {
  const { correlationId } = observation
  // Filter first: only a correlated observation of a logical send is reportable.
  if (typeof correlationId !== 'string' || correlationId.length === 0)
    return

  try {
    // Field-by-field copy of exactly what the runtime resolved for THIS
    // attempt. Nothing is defaulted, derived, re-resolved or added: no prompt,
    // no message, no tool, no attachment, no credential, no endpoint, no
    // provider object, no decision.
    const report = {
      correlationId,
      conversationId: observation.conversationId,
      roundId: observation.roundId,
      providerId: observation.providerId,
      modelId: observation.modelId,
    }
    // One-way push: the existing renderer context, emitting - never an invoke,
    // because there is no response to read. Emitting is synchronous, so no
    // promise can be left unhandled.
    useElectronEventaContext().value.emit(electronLiaBrainExecutionObservation, report)
  }
  catch {
    // Diagnostic only: a report that cannot be delivered changes nothing about
    // the request that is already starting.
  }
}
