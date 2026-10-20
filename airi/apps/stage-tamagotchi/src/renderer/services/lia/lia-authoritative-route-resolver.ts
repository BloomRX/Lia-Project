import type { LiaBrainRoutingDecision } from '@lia/core'
import type { ChatSendRouteOverride } from '@proj-airi/stage-ui/stores/chat'

import type { LiaBrainChatTurnFacts } from '../../../shared/eventa'

import { useLiaProviderStore } from '../../stores/lia/provider'
import { resolveLiaBrainSendRouteCandidate } from './brain-send-route-candidate'
import { requestLiaBrainDecisionForChatTurn } from './brain-shadow'

/**
 * Phase 8.0D-10B-4D4C4-D2B2-D1: awaited Lia authoritative INITIAL route resolver.
 *
 * Composes ONLY already-approved pieces:
 *   existing Brain decision invoke (via canonical requestLiaBrainDecisionForChatTurn)
 *     → Lia route candidate adapter (resolveLiaBrainSendRouteCandidate)
 *     → existing sanitized credential-presence seam (hasApiKey → electronLiaSecretHas)
 *     → ChatSendRouteOverride | undefined
 *
 * M3.1: before selecting a candidate, enforce the resolved model image limit.
 * The caller count includes eligible history and stays local (never sent over IPC).
 * An excess throws explicitly so it cannot fall through to a legacy send.
 *
 * Freshness / immutability: does not mutate input, facts, decision, candidate or provider state.
 * No fallback, no send, no payload construction, no tools/reasoning capture, no cache,
 * no secret value read, no provider registry precheck, no Core coupling.
 *
 * Current groq-only note: credential presence (apiKey) is sufficient preflight for the
 * CURRENT mapping `groq → groq`; not a claim that all future providers require apiKey.
 * The Brain decision already proves static availability/capability; Stage remains final guard.
 *
 * No new channel, no new observer trigger, no diagnostic logging, no secret leakage.
 */
export interface ResolveLiaAuthoritativeSendRouteInput {
  correlationId: string
  facts: LiaBrainChatTurnFacts
  imageInputCount: number
}

/** A refused request is not an invitation to send through the legacy route. */
export class LiaImageLimitError extends Error {
  constructor(count: number, limit: number) {
    super(`Esta conversa enviaria ${count} imagens; o limite é ${limit}. Remova anexos ou comece uma nova conversa.`)
    this.name = 'LiaImageLimitError'
  }
}

export async function resolveLiaAuthoritativeSendRoute(
  input: ResolveLiaAuthoritativeSendRouteInput,
): Promise<ChatSendRouteOverride | undefined> {
  // 1. request Brain decision via canonical awaited primitive
  let decision: LiaBrainRoutingDecision
  try {
    decision = await requestLiaBrainDecisionForChatTurn(input)
  }
  catch {
    return undefined
  }

  const model = decision.status === 'automatic' && decision.selection.status === 'selected'
    ? decision.selection.route.model
    : decision.status === 'manual' && decision.resolution.status === 'resolvedModel'
      ? decision.resolution.model
      : undefined
  const limit = model?.maxImagesPerRequest
  if (limit !== undefined && input.imageInputCount > limit)
    throw new LiaImageLimitError(input.imageInputCount, limit)

  // 2. convert with adapter
  const candidate = resolveLiaBrainSendRouteCandidate(decision)
  if (candidate === undefined)
    return undefined

  // 4-5. verify credential presence via already-approved sanitized seam
  // Reuse the production renderer abstraction: hasApiKey → electronLiaSecretHas {scope, key:'apiKey'}
  // Do NOT duplicate raw secret channel; do NOT read secret value.
  let hasCredential: boolean
  try {
    const liaProviderStore = useLiaProviderStore()
    hasCredential = await liaProviderStore.hasApiKey(candidate.providerId)
  }
  catch {
    return undefined
  }

  if (hasCredential === false)
    return undefined

  // 6. return candidate verbatim (adapter already returns fresh {providerId, modelId})
  return candidate
}
