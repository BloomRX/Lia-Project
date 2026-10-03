import type { TextSegment, TextToken } from '@proj-airi/pipelines-audio'

/**
 * Phase 7.6, item 2/4: provider-aware speech segmentation.
 *
 * ## Why the default splitter hurts XTTS
 *
 * The stock segmenter (pipelines-audio `tts-chunker`) is designed for fast
 * remote engines: its first two yields go out IMMEDIATELY on any punctuation
 * (`boost=2`, so \"Ah,\" and \"Lucas,\" become their own requests), and it cuts
 * every 12 *words* after that. With a serialized local engine - AllTalk runs
 * one XTTS inference at a time - every sub-request is full-fare latency: the
 * QA saw 3/6/10-character fragments as individual network round trips, with
 * 5-40s of work between each audible sigh.
 *
 * ## What this wrapper does instead
 *
 * It consumes the SAME base segmenter stream and rebuilds natural-sized
 * speech chunks:
 *
 * - tiny adjacent fragments are MERGED until at least `softTargetChars`
 *   characters have accumulated at a strong boundary (a `hard` reason from
 *   the base chunker: ., ?, !, newline...) - never inside a word;
 * - a hard cap (`hardMaxChars`) splits one very long utterance into
 *   bounded pieces rather than sending the whole paragraph as one stalled
 *   request (time-to-first-audio stays sane);
 * - `special` tokens (emotion / delay markers) keep their EXACT textual
 *   position: any pending text is flushed before them, in order;
 * - stream end (whatever reason) flushes the remainder - including a short
 *   final sentence that never reached the soft target;
 * - punctuation/emoji/control-only empties are dropped, never spoken alone
 *   (item D: no standalone fragments).
 *
 * The wrapper is pure: same input stream shape, same output stream shape.
 * Providers that want the old latency profile simply don't apply it.
 */

export interface SpeechSegmentMergerPolicy {
  /**
   * Emit the buffered text once it reaches at least this length AND the
   * last segment closed a strong boundary. 80 chars is roughly one natural
   * spoken sentence; going much lower brings back tiny-request latency
   * bursts without making the first word arrive meaningfully sooner.
   */
  softTargetChars: number
  /**
   * Absolute cap: the buffer is emitted at the next boundary once past it -
   * or forcecuts at the cap itself if no boundary has arrived by 2x the cap
   * (pathological stop-less streams still terminate).
   */
  hardMaxChars: number
}

/** The preset the custom-voice providers want (Phase 7.6, item 4). */
export const LOCAL_TTS_SEGMENT_POLICY: SpeechSegmentMergerPolicy = {
  hardMaxChars: 240,
  softTargetChars: 80,
}

type SegmenterFn = (
  tokens: ReadableStream<TextToken>,
  meta: { streamId: string, intentId: string, turnId?: string },
) => ReadableStream<TextSegment>

/** Vazio de fala: apenas whitespace/pontuação/controle. */
function isSpeakable(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
}

export function mergeSpeechSegmentsForLocalTts(
  base: SegmenterFn,
  policy: SpeechSegmentMergerPolicy = LOCAL_TTS_SEGMENT_POLICY,
): SegmenterFn {
  const { hardMaxChars, softTargetChars } = policy

  return (tokens, meta) => {
    const inner = base(tokens, meta)

    const out = new ReadableStream<TextSegment>({
      start: async (controller) => {
        const reader = inner.getReader()
        let pending = ''
        let sequence = 0
        let lastSegment: TextSegment | undefined

        function chunk(trimmed: string, reason: TextSegment['reason']): TextSegment {
          return {
            createdAt: Date.now(),
            intentId: meta.intentId,
            reason,
            segmentId: `merged-${meta.intentId}-${sequence++}`,
            special: null,
            streamId: meta.streamId,
            text: trimmed,
            ...(lastSegment?.turnId ?? meta.turnId
              ? { turnId: lastSegment?.turnId ?? meta.turnId }
              : {}),
          }
        }

        function flushPending(reason: TextSegment['reason']) {
          const trimmed = pending.trim()
          pending = ''
          // D: standalone punctuation/emoji/control-only leftovers are
          // never spoken by themselves.
          if (!trimmed || !isSpeakable(trimmed))
            return
          controller.enqueue(chunk(trimmed, reason))
        }

        function forwardSpecial(segment: TextSegment) {
          // Specials ride the exact text position: flush text first.
          flushPending('special')
          controller.enqueue(segment)
        }

        try {
          for (;;) {
            const { value, done } = await reader.read()
            if (done)
              break
            if (!value)
              continue

            // Special-scope segments (emotion marker, delay) are not speech
            // text: they pass through in position, never merged into a
            // chunk.
            if (value.special) {
              forwardSpecial(value)
              continue
            }

            if (value.text === '')
              continue

            // A punctuation/emoji/control-only fragment with NO pending text
            // would be spoken alone (\"!!!\" as its own 40-second request).
            // Attached to a real sentence it is legitimate prosody, so only
            // the STANDALONE case is dropped (Phase 7.6, item 17-D).
            if (!pending && !isSpeakable(value.text))
              continue

            pending += (pending && !pending.endsWith(' ') ? ' ' : '') + value.text

            const overHardMax = pending.length >= hardMaxChars
            const atStrongBoundary = value.reason === 'hard' || value.reason === 'flush'
            const reachedSoftTarget = pending.length >= softTargetChars

            if ((reachedSoftTarget && atStrongBoundary) || overHardMax) {
              flushPending(value.reason === 'flush' ? 'flush' : 'hard')
            }
            else if (value.reason === 'flush') {
              // The input stream itself ended (or was explicitly flushed):
              // what fits in the buffer goes out NOW, never held for another
              // boundary that will not come.
              flushPending('flush')
            }

            lastSegment = value
          }

          // Final remainder of any length (short sentences included).
          flushPending('flush')
          controller.close()
        }
        catch (err) {
          controller.error(err)
          throw err
        }
        finally {
          reader.releaseLock()
        }
      },
    })

    return out
  }
}
