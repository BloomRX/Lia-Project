import type { PlaybackItem, TextSegment, TextToken } from '@proj-airi/pipelines-audio'

import { createSpeechPipeline } from '@proj-airi/pipelines-audio'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  registerSpeechTtsFallbackPolicy,
  resetSpeechTtsFallbackForTesting,
  withSpeechTtsSegmentFallback,
} from './tts-fallback'

/**
 * End-to-end fallback through the REAL speech pipeline.
 *
 * Nothing here is stubbed except the two true edges: the segmenter (which the
 * pipeline's own tests also inject) and the playback manager. `createSpeechPipeline`,
 * the segment ordering machinery and the fallback wrapper are all the real ones,
 * so these tests pin the properties that matter for audio: exactly one buffer per
 * segment, playback order preserved, no duplicate synthesis, no provider talking
 * after a cancel.
 *
 * The "voice runtime" below stands in for the Lia store: switching target moves
 * a cursor along a configured chain, exactly like
 * `useLiaVoiceStore.nextVoiceTargetOnFailure()` + `applyVoiceTarget()`.
 */

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function createSegmenter(texts: string[]) {
  return (_tokens: ReadableStream<TextToken>, meta: { streamId: string, intentId: string }) => {
    let index = 0

    return new ReadableStream<TextSegment>({
      pull(controller) {
        const text = texts[index]
        if (text == null) {
          controller.close()
          return
        }

        controller.enqueue({
          streamId: meta.streamId,
          intentId: meta.intentId,
          segmentId: `${meta.streamId}:${index}`,
          text,
          special: null,
          reason: 'flush',
          createdAt: Date.now(),
        })
        index += 1
      },
    })
  }
}

function createPlaybackSpy() {
  const scheduled: Array<PlaybackItem<string>> = []
  const endListeners: Array<(event: { item: PlaybackItem<string>, endedAt: number }) => void> = []

  return {
    scheduled,
    playback: {
      schedule(item: PlaybackItem<string>) {
        scheduled.push(item)
        queueMicrotask(() => endListeners.forEach(listener => listener({ item, endedAt: Date.now() })))
      },
      stopAll: vi.fn(),
      stopByIntent: vi.fn(),
      stopByOwner: vi.fn(),
      onStart: vi.fn(),
      onEnd(listener: (event: { item: PlaybackItem<string>, endedAt: number }) => void) {
        endListeners.push(listener)
      },
      onInterrupt: vi.fn(),
      onReject: vi.fn(),
    },
  }
}

/** The request shape the speech pipeline hands to a host `tts()` callback. */
type SegmentRequest = Parameters<Parameters<typeof createSpeechPipeline<string>>[0]['tts']>[0]

/**
 * A voice chain plus the two hooks the host needs: the policy (switch target)
 * and the per-segment synthesis, wrapped by the real fallback wrapper.
 */
function createVoiceRuntime(chain: string[], options?: { failing?: string[], latencyMs?: Record<string, number> }) {
  const failing = new Set(options?.failing ?? [])
  const latency = options?.latencyMs ?? {}
  const attempts: Array<{ providerId: string, text: string }> = []
  const switches: number[] = []
  let cursor = 0

  const policy = {
    onAttemptFailed: (ctx: { attempt: number }) => {
      if (cursor + 1 >= chain.length)
        return false
      cursor += 1
      switches.push(ctx.attempt)
      return true
    },
  }

  const tts = withSpeechTtsSegmentFallback<string, SegmentRequest>(
    async (request, signal) => {
      const providerId = chain[cursor]!
      attempts.push({ providerId, text: request.text })

      const wait = latency[providerId] ?? 0
      if (wait)
        await delay(wait)

      if (signal.aborted)
        throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })

      if (failing.has(providerId))
        throw new Error(`${providerId}: 503 provider unavailable`)

      return `${providerId}::${request.text}`
    },
  )

  return {
    attempts,
    switches,
    policy,
    tts,
    currentProvider: () => chain[cursor]!,
  }
}

async function runIntent(pipeline: ReturnType<typeof createSpeechPipeline<string>>, texts: string[]) {
  const finished = new Promise<void>(resolve => pipeline.on('onIntentEnd', () => resolve()))
  const canceled = new Promise<void>(resolve => pipeline.on('onTurnCancel', () => resolve()))

  const intent = pipeline.openIntent({ turnId: 'turn-1' })
  for (const text of texts)
    intent.writeLiteral(text)
  intent.end()

  await Promise.race([finished, canceled])
  return intent
}

describe('speech TTS fallback through the real pipeline', () => {
  beforeEach(() => {
    resetSpeechTtsFallbackForTesting()
  })

  it('uses only the preferred provider when it works', async () => {
    const runtime = createVoiceRuntime(['preferred', 'fallback-0'])
    registerSpeechTtsFallbackPolicy(runtime.policy)
    const { scheduled, playback } = createPlaybackSpy()

    const pipeline = createSpeechPipeline<string>({
      segmenter: createSegmenter(['hello', 'world']),
      playback,
      tts: runtime.tts,
    })
    await runIntent(pipeline, ['hello', 'world'])

    expect(runtime.attempts.map(a => a.providerId)).toEqual(['preferred', 'preferred'])
    expect(runtime.switches).toEqual([])
    expect(scheduled.map(item => item.audio)).toEqual(['preferred::hello', 'preferred::world'])
  })

  it('falls back for the failing segment and plays the fallback audio exactly once', async () => {
    const runtime = createVoiceRuntime(['preferred', 'fallback-0'], { failing: ['preferred'] })
    registerSpeechTtsFallbackPolicy(runtime.policy)
    const { scheduled, playback } = createPlaybackSpy()

    const pipeline = createSpeechPipeline<string>({
      segmenter: createSegmenter(['hello']),
      playback,
      tts: runtime.tts,
    })
    await runIntent(pipeline, ['hello'])

    // preferred once, fallback once — no third attempt.
    expect(runtime.attempts.map(a => a.providerId)).toEqual(['preferred', 'fallback-0'])
    expect(runtime.switches).toEqual([1])
    // One buffer only, and it is the fallback's.
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]!.audio).toBe('fallback-0::hello')
  })

  it('walks preferred -> fallback[0] -> fallback[1] and stops at the first success', async () => {
    const runtime = createVoiceRuntime(['preferred', 'fallback-0', 'fallback-1'], {
      failing: ['preferred', 'fallback-0'],
    })
    registerSpeechTtsFallbackPolicy(runtime.policy)
    const { scheduled, playback } = createPlaybackSpy()

    const pipeline = createSpeechPipeline<string>({
      segmenter: createSegmenter(['hello']),
      playback,
      tts: runtime.tts,
    })
    await runIntent(pipeline, ['hello'])

    expect(runtime.attempts.map(a => a.providerId)).toEqual(['preferred', 'fallback-0', 'fallback-1'])
    expect(runtime.switches).toEqual([1, 2])
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]!.audio).toBe('fallback-1::hello')
  })

  it('drops the segment without looping when the whole chain fails', async () => {
    const runtime = createVoiceRuntime(['preferred', 'fallback-0'], {
      failing: ['preferred', 'fallback-0'],
    })
    registerSpeechTtsFallbackPolicy(runtime.policy)
    const { scheduled, playback } = createPlaybackSpy()

    const pipeline = createSpeechPipeline<string>({
      segmenter: createSegmenter(['hello', 'world']),
      playback,
      tts: runtime.tts,
    })
    await runIntent(pipeline, ['hello', 'world'])

    // Each segment gets exactly one pass over the chain — never a second lap.
    expect(runtime.attempts.map(a => a.providerId)).toEqual([
      'preferred',
      'fallback-0',
      'fallback-0',
    ])
    expect(scheduled).toEqual([])
  })

  it('does not re-synthesize segments that already succeeded', async () => {
    // Only the second segment's preferred attempt fails; the first already
    // produced audio and must never be spoken twice.
    const failing = new Set(['preferred'])
    const attempts: string[] = []
    let cursor = 0
    const chain = ['preferred', 'fallback-0']

    registerSpeechTtsFallbackPolicy({
      onAttemptFailed: () => {
        if (cursor + 1 >= chain.length)
          return false
        cursor += 1
        // Only the second segment is allowed to fail over.
        return attempts.filter(a => a.startsWith('preferred::second')).length > 0
      },
    })

    const { scheduled, playback } = createPlaybackSpy()
    const pipeline = createSpeechPipeline<string>({
      ttsMaxConcurrent: 1,
      segmenter: createSegmenter(['first', 'second', 'third']),
      playback,
      tts: withSpeechTtsSegmentFallback<string, SegmentRequest>(
        async (request) => {
          const providerId = chain[cursor]!
          attempts.push(`${providerId}::${request.text}`)
          if (failing.has(providerId) && request.text === 'second')
            throw new Error('503 provider unavailable')
          return `${providerId}::${request.text}`
        },
      ),
    })
    await runIntent(pipeline, ['first', 'second', 'third'])

    expect(attempts).toEqual([
      'preferred::first',
      'preferred::second',
      'fallback-0::second',
      'fallback-0::third',
    ])
    // Exactly one buffer per segment, in order, nothing duplicated.
    expect(scheduled.map(item => item.sequence)).toEqual([0, 1, 2])
    expect(scheduled.map(item => item.audio)).toEqual([
      'preferred::first',
      'fallback-0::second',
      'fallback-0::third',
    ])
  })

  it('preserves playback order when a retried segment finishes last', async () => {
    const runtime = createVoiceRuntime(['preferred', 'fallback-0'], {
      failing: ['preferred'],
      latencyMs: { 'fallback-0': 40 },
    })
    registerSpeechTtsFallbackPolicy(runtime.policy)
    const { scheduled, playback } = createPlaybackSpy()

    const pipeline = createSpeechPipeline<string>({
      ttsMaxConcurrent: 3,
      segmenter: createSegmenter(['first', 'second', 'third']),
      playback,
      tts: async (request, signal) => {
        // Only the first segment goes through the slow fallback path.
        if (request.sequence !== 0)
          return `preferred::${request.text}`
        return runtime.tts(request, signal)
      },
    })
    await runIntent(pipeline, ['first', 'second', 'third'])

    expect(scheduled.map(item => item.sequence)).toEqual([0, 1, 2])
    expect(scheduled.map(item => item.text)).toEqual(['first', 'second', 'third'])
  })

  it('stops switching target once the intent is cancelled', async () => {
    const runtime = createVoiceRuntime(['preferred', 'fallback-0', 'fallback-1'], {
      failing: ['preferred', 'fallback-0', 'fallback-1'],
      latencyMs: {
        'preferred': 5,
        'fallback-0': 5,
        'fallback-1': 5,
      },
    })
    registerSpeechTtsFallbackPolicy(runtime.policy)
    const { scheduled, playback } = createPlaybackSpy()

    const pipeline = createSpeechPipeline<string>({
      ttsMaxConcurrent: 1,
      segmenter: createSegmenter(['first', 'second', 'third']),
      playback,
      tts: runtime.tts,
    })

    const canceled = new Promise<void>(resolve => pipeline.on('onIntentCancel', () => resolve()))
    const intent = pipeline.openIntent({ turnId: 'turn-1' })
    intent.writeLiteral('first')
    intent.writeLiteral('second')
    intent.end()

    await delay(8)
    intent.cancel('user-stop')
    await canceled

    const attemptsAtCancel = runtime.attempts.length
    await delay(30)

    // No further attempt started after the cancel.
    expect(runtime.attempts.length).toBe(attemptsAtCancel)
    expect(scheduled).toEqual([])
  })

  it('keeps AIRI behaviour when no policy is registered', async () => {
    const runtime = createVoiceRuntime(['preferred', 'fallback-0'], { failing: ['preferred'] })
    // No registerSpeechTtsFallbackPolicy() call.
    const { scheduled, playback } = createPlaybackSpy()

    const pipeline = createSpeechPipeline<string>({
      segmenter: createSegmenter(['hello']),
      playback,
      tts: runtime.tts,
    })
    await runIntent(pipeline, ['hello'])

    // One attempt, segment silently dropped — exactly the pre-4D-3 behaviour.
    expect(runtime.attempts.map(a => a.providerId)).toEqual(['preferred'])
    expect(runtime.switches).toEqual([])
    expect(scheduled).toEqual([])
  })
})
