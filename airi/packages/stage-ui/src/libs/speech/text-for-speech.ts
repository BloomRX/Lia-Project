/**
 * Phase 7.7.2, items 12-13: the deterministic "text-for-speech" layer.
 *
 * Runs BEFORE chunking/provider, on the speech path ONLY - the visible
 * assistant message is a different string and is never touched by this file
 * (item L). The contract, in order:
 *
 * - strip markdown syntax that was never meant to be spoken (fences, inline
 *   code, link/image markup, emphasis markers, heading hashes, list bullets,
 *   blockquotes, table pipes)
 * - strip hidden/meta content nothing user-facing should vocalize (zero-width
 *   characters; reasoning already never reaches here by construction)
 * - handle URLs/code: they are removed, not spelled out character by
 *   character (`segment-merger` precedent: control-only fragments are not
 *   spoken) - a bare URL is not Portuguese speech
 * - emoji: the product policy (same as `segment-merger` isSpeakable /
 *   standalone-drop precedent) is that emoji are not lexical speech; they
 *   are removed, never transliterated
 * - normalize whitespace so punctuation never detaches from its word
 *   ("funcionando ." is how "." becomes a standalone token XTTS can read
 *   as a word)
 * - preserve natural commas/question/exclamation/sentence boundaries - they
 *   are prosody, not text (item J)
 * - punctuation-only or symbol-only chunks are NEVER speakable and never
 *   reach the provider (item H)
 *
 * Deterministic and pure on purpose: no locale lists to tune, no LLM in the
 * loop, no probabilistic rules - the QA reads the rules and predicts the
 * output character for character.
 */

const CODE_FENCE_RE = /```[\s\S]*?```/g
const INLINE_CODE_RE = /`[^`\n]*`/g
const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g
const LINK_RE = /\[([^\]]*)\]\([^)]*\)/g
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s)>\]]+/gi
const ZERO_WIDTH_RE = /[\u200B-\u200D⁠\uFEFF]/g
const HEADING_RE = /^[ \t]*#{1,6}[ \t]*/gm
const BLOCKQUOTE_RE = /^[ \t]*>[ \t]?/gm
const BULLET_RE = /^[ \t]*[*+-][ \t]+/gm
const TABLE_PIPE_RE = /\|/g
const EMPHASIS_RE = /(\*\*|__|\*|_|~~)/g
/** Emoji and pictographs (extended pictographic + regional indicators + misc symbols/dingbats + variation selectors). */
const EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{20E3}\u{2B50}]/gu
/** What remains must contain a letter or a digit to be spoken at all. */
const SPEAKABLE_RE = /[\p{L}\p{N}]/u
const WHITESPACE_RE = /\s+/g
/** `palavra .` -> `palavra.` (also for , ? ! : ;) - detached punctuation must never tokenize on its own. */
const DETACHED_PUNCT_RE = /\s+([.,!?;:…])/g
const SPACE_BEFORE_TERMINAL_AFTER_COLLAPSE_RE = /([.,!?;:…])\s+([.,!?;:…])/g

export interface TextForSpeechResult {
  /** The normalized speech input. Never longer than the visible text. */
  text: string
  diagnostics: TextForSpeechDiagnostics
}

/** Safe structure counters for diagnostics - content never appears here. */
export interface TextForSpeechDiagnostics {
  inputLength: number
  normalizedLength: number
  removedCodeChars: number
  removedMarkupCount: number
  removedUrlCount: number
  emojiRemovedCount: number
}

export function normalizeTextForSpeech(input: string): TextForSpeechResult {
  const diagnostics: TextForSpeechDiagnostics = {
    emojiRemovedCount: 0,
    inputLength: input.length,
    normalizedLength: 0,
    removedCodeChars: 0,
    removedMarkupCount: 0,
    removedUrlCount: 0,
  }
  let text = input

  text = text.replace(CODE_FENCE_RE, (match) => {
    diagnostics.removedCodeChars += match.length
    return ' '
  })
  text = text.replace(INLINE_CODE_RE, (match) => {
    diagnostics.removedCodeChars += match.length
    return ' '
  })
  text = text.replace(IMAGE_RE, ' ')
  text = text.replace(LINK_RE, (_, label: string) => (label ? ` ${label} ` : ' '))
  text = text.replace(URL_RE, () => {
    diagnostics.removedUrlCount += 1
    return ' '
  })
  text = text.replace(ZERO_WIDTH_RE, '')
  text = text.replace(HEADING_RE, () => {
    diagnostics.removedMarkupCount += 1
    return ''
  })
  text = text.replace(BLOCKQUOTE_RE, () => {
    diagnostics.removedMarkupCount += 1
    return ''
  })
  text = text.replace(BULLET_RE, () => {
    diagnostics.removedMarkupCount += 1
    return ''
  })
  text = text.replace(TABLE_PIPE_RE, () => {
    diagnostics.removedMarkupCount += 1
    return ' '
  })
  text = text.replace(EMPHASIS_RE, () => {
    diagnostics.removedMarkupCount += 1
    return ''
  })
  text = text.replace(EMOJI_RE, () => {
    diagnostics.emojiRemovedCount += 1
    return ''
  })
  text = text.replace(WHITESPACE_RE, ' ')
  text = text.replace(DETACHED_PUNCT_RE, '$1')
  // `!` followed by another terminal mark with a space between them must not
  // split (`? !` -> `?!`) - doubled boundaries are prosody, not two chunks.
  text = text.replace(SPACE_BEFORE_TERMINAL_AFTER_COLLAPSE_RE, '$1$2')
  text = text.trim()

  diagnostics.normalizedLength = text.length
  return { diagnostics, text }
}

/**
 * May this chunk be sent to a speech provider at all? Letters/digits only -
 * a chunk of pure punctuation, symbols, emoji or whitespace is never speech.
 * (Item H; mirrors `segment-merger`'s standalone-drop precedent at the last
 * possible boundary, so even a chunker bypass is safe.)
 */
export function isSpeechChunkSpeakable(text: string): boolean {
  return SPEAKABLE_RE.test(text)
}
