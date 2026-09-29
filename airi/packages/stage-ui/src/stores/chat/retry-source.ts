import type { ChatHistoryItem } from '@proj-airi/core-agent'

/**
 * Phase 8.0D-10B-4D4C4-D2B6 corrective: generic PURE retry source resolution.
 *
 * No Pinia, no Vue, no Lia, no provider, no Brain, no persistence mutation.
 * Synchronous, stateless, read-only.
 *
 * Visibility: this module owns the generic source derivation that both
 * the chat store (retry preprocessing) and the renderer (source capture)
 * must share — a single implementation, not a duplicated algorithm.
 */

export function retrySourceIndexFrom(
  messages: readonly ChatHistoryItem[],
  index: number,
): number {
  const targetMessage = messages[index]
  if (!targetMessage)
    return -1

  if (targetMessage.role === 'user')
    return index

  if (targetMessage.role !== 'assistant' && targetMessage.role !== 'error')
    return -1

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor]?.role === 'user')
      return cursor
  }

  return -1
}

/**
 * Stable source identity for a clicked history item.
 *
 * - clicked user → that user when it has a usable string id
 * - clicked assistant/error → nearest preceding user when it has a usable string id
 * - unsupported/tool/system → undefined (non-retriable)
 * - source user without usable id → undefined (id-less legacy, no authority)
 *
 * Returns a source USER message id only when it has a usable non-empty string id.
 * Never fabricates, never mutates.
 */
export function retrySourceMessageIdFrom(
  messages: readonly ChatHistoryItem[],
  clickedIndex: number,
): string | undefined {
  const sourceIndex = retrySourceIndexFrom(messages, clickedIndex)
  if (sourceIndex < 0)
    return undefined

  const source = messages[sourceIndex] as ChatHistoryItem & { id?: unknown }
  const rawId = (source as { id?: unknown }).id
  if (typeof rawId !== 'string')
    return undefined

  // Usable when non-empty after trim; return exact stored value when usable
  // (preserve original, but treat whitespace-only as absent)
  if (rawId.trim().length === 0)
    return undefined

  return rawId
}
