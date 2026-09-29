import type { ChatRetryPayload } from '@proj-airi/stage-ui/stores/chat'
import type { ChatToolReference } from '@proj-airi/stage-ui/types/chat'

import { chatTurnFactsFromSend } from './brain-shadow'
import { resolveLiaAuthoritativeSendRoute } from './lia-authoritative-route-resolver'

/**
 * Phase 8.0D-10B-4D4C4-D2B6 corrective: Lia-specific awaited authoritative retry sequence.
 *
 * Thin, testable owner of the stable-ID authoritative path. It owns:
 *   correlation mint → facts construction → awaited canonical resolver → retry callback
 *
 * No second Brain invoke implementation, no duplicated resolver logic, no state,
 * no provider mutation, no cache. Facts are derived from the ACTUAL retry payload
 * (attachments=[], reasoning/tools frozen at capture).
 *
 * Dependency injection for retry/resolver/mint keeps it mount-free for tests.
 */

export interface LiaAuthoritativeRetryInput {
  sessionId: string
  index: number
  sourceMessageId: string
  reasoning: boolean
  tools: ChatToolReference[]
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

  // Freeze tools snapshot before any await
  const toolsSnapshot = [...input.tools]

  const facts = chatTurnFactsFromSend({
    attachments: [] as const,
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
    ...(routeOverride === undefined ? {} : { routeOverride }),
  })
}
