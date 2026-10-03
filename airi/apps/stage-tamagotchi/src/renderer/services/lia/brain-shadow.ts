import type { LiaBrainChatDecision, LiaBrainChatTurnFacts } from '../../../shared/eventa'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'

import { electronLiaBrainChatDecision } from '../../../shared/eventa'

/**
 * Phase 8.0D-9: the shadow observer for one user chat turn.
 *
 * It is the ONE legitimate production caller of the read-only Brain decision
 * bridge, and it exists to OBSERVE: for each normal send, the same turn facts
 * the outgoing request already carries are sent to main, and the returned
 * decision is turned into a single diagnostic line. Nothing else consumes it.
 *
 * Authority boundary (unchanged, and enforced by construction here):
 *   renderer -> capability requirements (facts) + ONE opaque join key
 *   trusted main/product layer -> the routing policy
 *   canonical router -> the decision
 *
 * The helper therefore returns NOTHING: `observeLiaBrainDecisionForChatTurn`
 * is `void`, so no caller can await a decision, branch on one, or feed one
 * into provider/model/payload selection even by accident. It never throws
 * (a missing, slow, rejected or throwing bridge is isolated inside), it never
 * writes state (no store, no config, no localStorage, no session), and it
 * never reaches for a provider or a model - the decision is diagnostic text.
 *
 * Facts are DERIVED, not invented: `chatTurnFactsFromSend` describes exactly
 * the values the current send already uses - the outgoing attachments, the
 * outgoing tool references and the existing session-level reasoning flag.
 */

/** The three facts, read off the values the outgoing turn already carries. */
export function chatTurnFactsFromSend(input: {
  /** The attachments actually being sent with this turn. */
  attachments: readonly unknown[]
  /** The existing session-level reasoning request (consciousness settings). */
  reasoning: boolean
  /** The tool references supplied with this turn. */
  tools: readonly unknown[]
}): LiaBrainChatTurnFacts {
  return {
    hasImageInput: input.attachments.length > 0,
    reasoningRequested: input.reasoning,
    usesTools: input.tools.length > 0,
  }
}

/** What the shadow observation is given: the turn facts and, when the caller has one, its logical-send key. */
export interface LiaBrainShadowObservationInput {
  /**
   * Phase 8.0D-10B-3B2: the SAME opaque key the send path carries for this
   * logical user send. This helper only FORWARDS it - it never mints one and
   * never interprets it. Absent when the caller has none.
   */
  correlationId?: string
  facts: LiaBrainChatTurnFacts
}

/**
 * Phase 8.0D-10B-4D4C4-D2B2-D1: canonical awaited Brain decision primitive.
 *
 * The ONE reusable Eventa invoke implementation for the Brain decision channel.
 * It forwards `{ facts }` plus the caller's opaque `correlationId` when present
 * (never minted, never interpreted) and returns the decision verbatim.
 * It may reject/throw if the bridge is unavailable - callers own containment.
 * The fire-and-forget observer and the future authoritative resolver both reuse
 * this primitive so the decision invoke exists in ONE canonical renderer owner
 * and future request count can stay one.
 */
export async function requestLiaBrainDecisionForChatTurn(
  input: LiaBrainShadowObservationInput,
): Promise<LiaBrainChatDecision> {
  const invoke = useElectronEventaInvoke(electronLiaBrainChatDecision)
  return invoke({
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    facts: input.facts,
  })
}

/**
 * Sends the turn facts to the Brain decision bridge and observes the result.
 *
 * Fire-and-forget BY CONTRACT: it returns `void` immediately, the invoke is
 * never awaited by the caller, and every failure mode (no handler, rejection,
 * thrown error, slow bridge) is caught inside and reduced to a diagnostic
 * line. Chat send is never gated on it.
 */
export function observeLiaBrainDecisionForChatTurn(input: LiaBrainShadowObservationInput): void {
  void observe(input)
}

/** Minimal statuses - never ids, payloads, prompt text or model metadata. */
function describeDecision(decision: LiaBrainChatDecision): string {
  if (decision.status === 'automatic')
    return `status=automatic selection=${decision.selection.status}`
  if (decision.status === 'manual')
    return `status=manual resolution=${decision.resolution.status} readiness=${decision.readiness.status}`
  return `status=${decision.status}`
}

async function observe(input: LiaBrainShadowObservationInput): Promise<void> {
  try {
    const decision = await requestLiaBrainDecisionForChatTurn(input)
    console.info(`[LIA-BRAIN] shadow decision ${describeDecision(decision)}`)
  }
  catch (error) {
    // Shadow only: the decision is observational, so a failing bridge is a
    // diagnostic event, never a chat failure, never a retry, never a toast.
    console.info(`[LIA-BRAIN] shadow unavailable (${errorMessageFrom(error) ?? 'unknown error'})`)
  }
}
