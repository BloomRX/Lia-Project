import type { ChatHistoryItem } from '@proj-airi/core-agent'

import type { ChatSendPayload } from '../chat'

/**
 * Phase 8.0D-10B-4D4C4-D2B11: generic PURE retry content derivation.
 *
 * No Pinia, no Vue, no Lia, no provider, no Brain, no persistence, no logging.
 * Synchronous, stateless, read-only over its input.
 *
 * Visibility: this module owns the ONE stored-USER-turn -> retryable-content
 * derivation shared by the chat store retry path, the renderer retry capture
 * and the Lia authoritative retry. A single implementation, never duplicated.
 */

/**
 * The generic image attachment contract, DERIVED from `ChatSendPayload` rather
 * than redeclared, so this module cannot drift into a second attachment shape.
 * The import is type-only: it is erased at build time, so the chat store can
 * depend on this module without creating a runtime import cycle.
 */
export type RetryImageAttachment = NonNullable<ChatSendPayload['attachments']>[number]

/** What a stored USER turn contributes to one retry. */
export interface RetryContent {
  /**
   * Retryable text, using the pre-existing retry text semantics: each text
   * part trimmed, empty parts omitted, remaining parts joined with a blank
   * line. Empty when the turn carried no retryable text.
   */
  text: string
  /**
   * Image attachments reconstructed from the stored image parts, in stored
   * order, with fresh objects. Empty when the turn carried no images.
   */
  attachments: RetryImageAttachment[]
}

/**
 * The stored image-part shape written by the send path: a base64 data URL of
 * the form `data:<mimeType>;base64,<data>`.
 *
 * The mime group is non-greedy and the data group greedy so the FIRST
 * `;base64,` is treated as the separator. That is unambiguous for every value
 * the send path can produce: base64 data contains neither `;` nor `,`, and a
 * browser `File.type` never contains the separator either.
 */
const STORED_IMAGE_DATA_URL = /^data:([\s\S]*?);base64,([\s\S]*)$/

/**
 * Reconstructs one attachment from one stored image part, losslessly.
 *
 * A part that claims to be an image but cannot be converted exactly is a hard
 * error rather than a dropped part: an image turn must never be quietly
 * retried as text-only, and no MIME type is ever invented to fill a gap.
 */
function retryImageAttachmentFromPart(part: { image_url?: { url?: unknown } }): RetryImageAttachment {
  const url = part.image_url?.url
  if (typeof url !== 'string')
    throw new Error('Retry target has an image part without a usable url')

  const stored = STORED_IMAGE_DATA_URL.exec(url)
  if (stored === null)
    throw new Error('Retry target has an image part that cannot be losslessly reconstructed')

  const [, mimeType, data] = stored

  return { type: 'image', data, mimeType }
}

/**
 * Derives the retryable content of one stored USER message.
 *
 * Returns `null` when the message is absent, is not a USER turn, or carries
 * neither retryable text nor a reconstructable image — the caller decides what
 * that means, and this module never substitutes a text-only fallback.
 *
 * The input is never mutated, so a deeply frozen message is a valid input.
 */
export function retryContentFromUserMessage(message: ChatHistoryItem | undefined): RetryContent | null {
  if (!message || message.role !== 'user')
    return null

  const content = message.content

  if (typeof content === 'string') {
    const text = content.trim()
    return text ? { text, attachments: [] } : null
  }

  if (!Array.isArray(content))
    return null

  const texts: string[] = []
  const attachments: RetryImageAttachment[] = []

  for (const part of content) {
    if (part.type === 'text') {
      const value = part.text?.trim()
      if (value)
        texts.push(value)

      continue
    }

    if (part.type === 'image_url')
      attachments.push(retryImageAttachmentFromPart(part))
  }

  const text = texts.join('\n\n')
  if (!text && attachments.length === 0)
    return null

  return { text, attachments }
}

/**
 * Returns a structurally identical but independently owned attachment snapshot:
 * a fresh array of fresh objects, preserving `type`, `data`, `mimeType` and
 * order exactly. Nothing is normalized, re-encoded, trimmed or inferred.
 *
 * Used wherever an attachment list must outlive the caller that supplied it —
 * notably across an awaited Brain decision, during which live UI state may
 * still change underneath the captured turn.
 */
export function cloneRetryAttachments(
  attachments: readonly RetryImageAttachment[],
): RetryImageAttachment[] {
  return attachments.map(attachment => ({
    type: attachment.type,
    data: attachment.data,
    mimeType: attachment.mimeType,
  }))
}
