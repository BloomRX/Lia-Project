import type { TextSegment, TextToken } from '@proj-airi/pipelines-audio'

import { CUSTOM_LOCAL_VOICE_PROVIDER_ID } from '../providers/providers/custom-local-voice'
import { mergeSpeechSegmentsForLocalTts } from './segment-merger'

/**
 * Phase 7.6: per-provider speech pipeline tuning.
 *
 * The Stage speech pipeline is provider-agnostic BY DESIGN (the 4E-2
 * convergence rule: `Stage.vue` never branches on a provider id). Tuning
 * therefore lives here, as data: a provider RESOLVES to a small record the
 * pipeline consumes without knowing who it came from.
 *
 * What differs and why:
 *
 * - Remote multi-slot engines keep the stock latency-oriented splitter and
 *   the default synthesis concurrency (4): tiny first chunks start speech
 *   fast when each request is a fast cloud round trip.
 *
 * - The local custom voice (AllTalk + XTTS v2) runs ONE inference at a time
 *   on a serialized server queue. For it, tiny fragments are pure overhead
 *   (each one is a full-fare serialized inference) and parallel requests
 *   only pile up blind server-side queueing. It resolves to: merged,
 *   natural-sentence-sized chunks + a concurrency of 1.
 */

export type SpeechSegmenter = (
  tokens: ReadableStream<TextToken>,
  meta: { streamId: string, intentId: string, turnId?: string },
) => ReadableStream<TextSegment>

export interface SpeechPipelineTuning {
  /** Wraps the stock segmenter to re-chunk for this provider. */
  wrapSegmenter?: (base: SpeechSegmenter) => SpeechSegmenter
  /** Max concurrent TTS synthesis tasks for this provider. */
  maxConcurrent: number
}

export function resolveSpeechPipelineTuning(providerId: string | undefined): SpeechPipelineTuning {
  if (providerId === CUSTOM_LOCAL_VOICE_PROVIDER_ID) {
    return {
      maxConcurrent: 1,
      wrapSegmenter: base => mergeSpeechSegmentsForLocalTts(base),
    }
  }

  return { maxConcurrent: 4 }
}
