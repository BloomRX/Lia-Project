import type { ChatHistoryItem } from '../types/chat'

/**
 * Phase 8.0D-M3: the ONE definition of "what reaches the provider".
 *
 * The stored conversation and the provider prompt are two different things.
 * The conversation record keeps everything - including a user turn whose send
 * failed and the runtime diagnostic bubble describing that failure - because
 * the user needs to see it and retry it. The provider prompt must not: a
 * failed turn's images and an error bubble are not part of any later request.
 *
 * This module is that boundary, written once and consumed by both sides that
 * used to compute it independently:
 *
 *   - the runtime's provider-history projection (`buildProviderMessages`),
 *     which decides what is actually sent;
 *   - the Brain capability facts for a turn, which decide which model is
 *     allowed to receive it.
 *
 * Both read the SAME predicate here, so route eligibility cannot drift away
 * from the content really being sent. Pure by construction: no store, no
 * config, no provider SDK, no network, no logging, and inputs are never
 * mutated - every function returns a new array.
 */

/**
 * A stored message that may be projected to a provider: any chat message,
 * never a diagnostic error bubble.
 */
export type ProviderContextMessage = Exclude<ChatHistoryItem, { role: 'error' }>

/**
 * Whether one stored message takes part in provider context.
 *
 * Two things never do:
 *   - `role: 'error'`, which is UI/runtime diagnostic history. It is not a
 *     turn anyone sent, and it must never be re-authored into the prompt as
 *     synthetic user text;
 *   - a message explicitly marked `excludedFromProviderContext`, i.e. the tail
 *     of a logically failed send, retained for the record only.
 *
 * Anything else participates, exactly as before. The predicate narrows to
 * `ProviderContextMessage` because "provider-visible" already implies "not an
 * error bubble" - callers therefore never need a second local filter, which is
 * how a second competing definition of provider history used to appear.
 */
export function isProviderContextMessage(message: ChatHistoryItem): message is ProviderContextMessage {
  if (message.role === 'error')
    return false
  return message.excludedFromProviderContext !== true
}

/**
 * The provider-visible subset of a stored conversation, in order.
 *
 * This is the canonical projection input: filtering here and nowhere else is
 * what keeps the prompt and the capability facts in agreement.
 */
export function selectProviderContextMessages(messages: readonly ChatHistoryItem[]): ProviderContextMessage[] {
  return messages.filter(message => isProviderContextMessage(message))
}

/** Content parts of one message, or nothing when its content is plain text. */
function contentParts(message: ChatHistoryItem): readonly unknown[] {
  const content = (message as { content?: unknown }).content
  return Array.isArray(content) ? content : []
}

/**
 * How many image parts ONE stored message carries, whether or not it is
 * provider-visible. The part shape is the one the runtime itself emits for an
 * image attachment (`{ type: 'image_url', ... }`), so this is the only place
 * in the product that knows how to recognise one.
 */
export function countImagePartsInMessage(message: ChatHistoryItem): number {
  return contentParts(message).filter(part => (part as { type?: string } | null)?.type === 'image_url').length
}

/**
 * How many images the provider would actually receive from this history.
 *
 * Excluded and error messages contribute zero by construction - they are not
 * sent - so a failed image send can never inflate the effective visual context
 * of a later turn. Text-only messages contribute zero too.
 */
export function countProviderContextImageParts(messages: readonly ChatHistoryItem[]): number {
  let total = 0
  for (const message of selectProviderContextMessages(messages))
    total += countImagePartsInMessage(message)
  return total
}

/**
 * Whether the provider-visible history already carries image content.
 *
 * This is what makes a LATER text-only turn still an image turn: the earlier
 * image is part of the request being composed, so the model serving it has to
 * accept images. Routing off the current composer attachment alone is what let
 * a text-only turn be sent to a model that rejects content arrays while the
 * same request still carried an image.
 */
export function hasProviderContextImageInput(messages: readonly ChatHistoryItem[]): boolean {
  return countProviderContextImageParts(messages) > 0
}
