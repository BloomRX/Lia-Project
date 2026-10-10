import type { ChatRetryPayload } from '@proj-airi/stage-ui/stores/chat'
import type { RetryImageAttachment } from '@proj-airi/stage-ui/stores/chat/retry-content'
import type { ChatHistoryItem, ChatToolReference } from '@proj-airi/stage-ui/types/chat'

import { cloneRetryAttachments } from '@proj-airi/stage-ui/stores/chat/retry-content'

import { chatTurnFactsFromSend } from './brain-shadow'
import { resolveLiaAuthoritativeSendRoute } from './lia-authoritative-route-resolver'

/**
 * Phase 8.0D-10B-4D4C4-D2B6 corrective: Lia-specific awaited authoritative retry sequence.
 *
 * Thin, testable owner of the stable-ID authoritative path. It owns:
 *   correlation mint -> facts construction -> awaited canonical resolver -> retry callback
 *
 * No second Brain invoke implementation, no duplicated resolver logic, no state,
 * no provider mutation, no cache. Facts are derived from the ACTUAL retry payload
 * (attachments, reasoning and tools all frozen at capture).
 *
 * Dependency injection for retry/resolver/mint keeps it mount-free for tests.
 */

export interface LiaAuthoritativeRetryInput {
  sessionId: string
  index: number
  sourceMessageId: string
  reasoning: boolean
  tools: ChatToolReference[]
  /**
   * Phase 8.0D-10B-4D4C4-D2B11: image attachments of the source USER turn,
   * captured SYNCHRONOUSLY by the caller before this sequence awaits anything.
   *
   * One snapshot serves two linked purposes: it reduces to the Brain's
   * `hasImageInput` fact, and it is the attachment list the retry actually
   * carries. The decision and the outgoing turn therefore describe the same
   * captured user turn. Absent means the source turn carried no images.
   *
   * Image content never crosses the Brain boundary - only the boolean does.
   */
  attachments?: readonly RetryImageAttachment[]
  /**
   * Phase 8.0D-M3: the conversation that still stands in provider context once
   * this retry truncates at the source turn - everything BEFORE it.
   *
   * The source turn itself is re-sent as a fresh user message and is described
   * by `attachments`, so it must not be counted twice here. Required, so no
   * caller can silently ask for a current-attachment-only reading of the facts.
   */
  providerHistory: readonly ChatHistoryItem[]
}

export interface LiaAuthoritativeRetryDeps {
  retry: (payload: ChatRetryPayload) => Promise<unknown>
  resolveRoute?: typeof resolveLiaAuthoritativeSendRoute
  mintCorrelationId?: () => string
}

export async function executeLiaAuthoritativeRetry(
  input: LiaAuthoritativeRetryInput,
  deps: LiaAuthoritativeRetryDeps,
): Promise<void> {
  const mint = deps.mintCorrelationId ?? (() => crypto.randomUUID())
  const correlationId = mint()

  // Freeze BOTH snapshots before any await, each independently owned from the
  // caller. A caller that mutates its own array, replaces an attachment object
  // or edits a field while the Brain decision is in flight cannot reach either
  // the facts already sent or the retry that follows.
  const toolsSnapshot = [...input.tools]
  const attachmentsSnapshot = cloneRetryAttachments(input.attachments ?? [])

  const facts = chatTurnFactsFromSend({
    attachments: attachmentsSnapshot,
    providerHistory: input.providerHistory,
    reasoning: input.reasoning,
    tools: toolsSnapshot,
  })

  const resolveRoute = deps.resolveRoute ?? resolveLiaAuthoritativeSendRoute
  const routeOverride = await resolveRoute({
    correlationId,
    facts,
  })

  await deps.retry({
    sessionId: input.sessionId,
    index: input.index,
    sourceMessageId: input.sourceMessageId,
    correlationId,
    reasoning: input.reasoning,
    tools: toolsSnapshot,
    // Phase 8.0D-10B-4D4C4-D2B11: the SAME frozen snapshot the facts were
    // derived from, so hasImageInput describes this exact outgoing payload.
    attachments: attachmentsSnapshot,
    ...(routeOverride === undefined ? {} : { routeOverride }),
  })
}
