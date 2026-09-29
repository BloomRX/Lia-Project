import type { ChatSendSettledObserver } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'

import { useElectronEventaContext } from '@proj-airi/electron-vueuse'
import { registerChatSendSettledObserver } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'

import { electronLiaBrainSendTerminalObservation } from '../../../shared/eventa'

/**
 * The observation the generic seam hands to its registered observer. It is
 * DERIVED from the seam's own public shape (type-only) instead of importing
 * Core Agent or re-declaring the Stage contract, so this diagnostics module
 * needs no extra package edge to report on a seam that already carries the
 * type.
 */
type ChatSendSettledObservation = Parameters<ChatSendSettledObserver>[0]

/**
 * Phase 8.0D-10B-4D4C4-B2: the Lia terminal reporter for the logical send.
 *
 * It is the ONE legitimate production consumer of the generic send-settled seam
 * (`registerChatSendSettledObserver`). For every logical send that settles, the
 * renderer that actually ran it reports the send's FACTUAL settlement
 * (`succeeded` / `failed`, exactly as the Stage send observed it) to the trusted
 * main process through ONE one-way channel.
 *
 * The send is the whole Stage send/retry invocation - every provider attempt it
 * ran, plus its own rollback/restore work - NOT one Core round. A logical send
 * may legitimately settle with no final round of its own, so this report is
 * deliberately separate from the round-level terminal report.
 *
 * Authority boundary (enforced by construction here):
 *   the generic Stage-UI layer stays Brain-blind - it exposes the observation
 *   and knows nothing about Lia, the report channel or main
 *   renderer -> main carries a settlement as an UNTRUSTED diagnostic claim
 *
 * What this module may do: read the settled observation it receives, narrow it
 * to the two contract fields, and report it. What it may NOT do: read a Brain
 * decision, look up a provider or a model, join a send to its rounds, compare
 * anything, remember anything, or influence the send it is observing. The
 * settlement is COPIED, never interpreted: there is no winner, no finality, no
 * fallback aggregate and no send-level verdict here.
 *
 * Multi-window: every renderer window has its own module instance and may
 * register, but only the window that actually ran the send ever receives an
 * observation - the reporter therefore never depends on sender-window local
 * state, it works purely from what it is handed.
 *
 * No storage: reports are never deduplicated, keyed, coalesced or cached. Two
 * identical settlements produce two emissions - a future consumer needs every
 * report, and this module is transport, not memory.
 */

/**
 * Installs the Lia send-terminal observer on the generic send-settled seam.
 *
 * The seam is Electron-free and inert until something registers; this is the
 * only production registration site (the renderer composition root calls it
 * once per window, next to the two sibling installations). Registration
 * performs no I/O: the report channel context is resolved lazily per report, so
 * boot can never be affected by it.
 */
export function registerLiaBrainSendTerminalObserver(): void {
  registerChatSendSettledObserver(reportLiaBrainSendTerminalObservation)
}

/**
 * The observer itself: narrows ONE settled logical send to the two contract
 * fields and reports it, then returns `void`.
 *
 * It is `void` by contract - no caller can await a report, branch on one or
 * feed one back into execution. A send without a usable key or with an outcome
 * outside the frozen vocabulary is NOT reported: uncorrelated traffic (voice,
 * spotlight, direct ingest, transport-originated turns, any unrelated runtime
 * request) is not part of this diagnostic and stays invisible here.
 *
 * Crash-proof: every dispatch failure (no Electron context, no main listener,
 * a throwing channel) is swallowed right here - the send is never gated,
 * retried, failed or notified because a diagnostic report could not be
 * delivered.
 */
export function reportLiaBrainSendTerminalObservation(observation: ChatSendSettledObservation): void {
  const { correlationId, outcome, initialRouteOverride } = observation

  // Filter first: this Lia boundary REQUIRES the logical-send key (the generic
  // seam deliberately does not), and it never synthesizes one.
  if (typeof correlationId !== 'string' || correlationId.length === 0)
    return
  // The outcome vocabulary is closed: an unknown value is dropped, never
  // coerced, aliased or defaulted.
  if (outcome !== 'succeeded' && outcome !== 'failed')
    return

  try {
    // Field-by-field copy of exactly the contract fields. Nothing is
    // defaulted, derived, re-resolved or added: no round, no provider/model
    // identity, no attempt count, no timing, no usage, no error, no prompt, no
    // message, no tool, no decision.
    // Phase 8.0D-10B-4D4C4-D2B7: tri-state initialRouteOverride is copied
    // field-by-field as well: undefined → omitted, null → null, object → fresh two-field copy.
    const report: {
      correlationId: string
      outcome: 'succeeded' | 'failed'
      initialRouteOverride?: { providerId: string, modelId: string } | null
    } = {
      correlationId,
      outcome,
    }
    if (initialRouteOverride === null) {
      report.initialRouteOverride = null
    }
    else if (initialRouteOverride !== undefined) {
      report.initialRouteOverride = {
        providerId: initialRouteOverride.providerId,
        modelId: initialRouteOverride.modelId,
      }
    }
    // One-way push: the existing renderer context, emitting - never an invoke,
    // because there is no response to read. Emitting is synchronous, so no
    // promise can be left unhandled.
    useElectronEventaContext().value.emit(electronLiaBrainSendTerminalObservation, report)
  }
  catch {
    // Diagnostic only: a report that cannot be delivered changes nothing about
    // the logical send it describes.
  }
}
