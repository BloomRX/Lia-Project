import type { PlaybackItem, TextSegment, TextToken, TtsRequest } from './types'

import { describe, expect, it, vi } from 'vitest'

import { createSpeechPipeline } from './speech-pipeline'

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return {
    promise,
    resolve,
    reject,
  }
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

function createPlaybackSpy(options?: { autoEnd?: boolean }) {
  const scheduled: Array<PlaybackItem<string>> = []
  const endListeners: Array<(event: { item: PlaybackItem<string>, endedAt: number }) => void> = []
  const autoEnd = options?.autoEnd ?? true

  return {
    scheduled,
    end(item: PlaybackItem<string>) {
      for (const listener of endListeners)
        listener({ item, endedAt: Date.now() })
    },
    playback: {
      schedule(item: PlaybackItem<string>) {
        scheduled.push(item)
        if (autoEnd)
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

describe('createSpeechPipeline', () => {
  it('preserves playback order when TTS completes out of order', async () => {
    const { scheduled, playback } = createPlaybackSpy()

    const pipeline = createSpeechPipeline<string>({
      ttsMaxConcurrent: 2,
      segmenter: createSegmenter(['first', 'second', 'third']),
      playback,
      async tts(request) {
        if (request.sequence === 0)
          await delay(30)
        else if (request.sequence === 1)
          await delay(5)

        return request.text
      },
    })

    const intentFinished = new Promise<void>((resolve) => {
      pipeline.on('onIntentEnd', () => resolve())
    })

    const intent = pipeline.openIntent()
    intent.end()

    await intentFinished

    expect(scheduled.map(item => item.sequence)).toEqual([0, 1, 2])
    expect(scheduled.map(item => item.text)).toEqual(['first', 'second', 'third'])
  })

  it('prefetches TTS requests up to the configured concurrency', async () => {
    const { playback } = createPlaybackSpy()
    const startedRequests: number[] = []
    const pendingRequests = [
      deferred<string>(),
      deferred<string>(),
      deferred<string>(),
    ]
    let inFlight = 0
    let maxInFlight = 0

    const pipeline = createSpeechPipeline<string>({
      ttsMaxConcurrent: 2,
      segmenter: createSegmenter(['alpha', 'beta', 'gamma']),
      playback,
      async tts(request: TtsRequest) {
        startedRequests.push(request.sequence)
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)

        try {
          return await pendingRequests[request.sequence]!.promise
        }
        finally {
          inFlight -= 1
        }
      },
    })

    const intentFinished = new Promise<void>((resolve) => {
      pipeline.on('onIntentEnd', () => resolve())
    })

    const intent = pipeline.openIntent()
    intent.end()

    await delay(0)

    expect(startedRequests).toEqual([0, 1])
    expect(maxInFlight).toBe(2)

    pendingRequests[0]!.resolve('alpha')
    pendingRequests[1]!.resolve('beta')
    await delay(0)

    expect(startedRequests).toEqual([0, 1, 2])

    pendingRequests[2]!.resolve('gamma')
    await intentFinished

    expect(maxInFlight).toBe(2)
  })

  it('resolves a dynamic concurrency cap per intent (Phase 7.6 item 17-H)', async () => {
    // Serialized local engines (AllTalk/XTTS) ask for 1: parallel requests
    // onto a serialized queue only add contention. The cap may be a FUNCTION,
    // re-read for every intent, so swapping providers mid-session takes
    // effect on the very next reply - never a Promise.all-style burst.
    const { playback } = createPlaybackSpy()
    let cap = 1
    let capReads = 0

    let inFlight = 0
    let maxInFlight = 0
    const pendingRequests: Array<PromiseWithResolvers<string>> = []

    const pipeline = createSpeechPipeline<string>({
      ttsMaxConcurrent: () => {
        capReads += 1
        return cap
      },
      segmenter: createSegmenter(['first', 'second', 'third']),
      playback,
      async tts() {
        // `request.sequence` restarts per intent; the gate below indexes the
        // PUSH position instead, so the second intent's tasks are controlled
        // by THEIR OWN resolvers.
        const slot = Promise.withResolvers<string>()
        const slotIndex = pendingRequests.push(slot) - 1
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        try {
          return await pendingRequests[slotIndex]!.promise
        }
        finally {
          inFlight -= 1
        }
      },
    })

    const intentFinished = new Promise<void>((resolve) => {
      pipeline.on('onIntentEnd', () => resolve())
    })

    const intent = pipeline.openIntent()
    intent.end()

    await delay(0)

    // Exactly one in flight, never an unbounded burst.
    expect(maxInFlight).toBe(1)
    expect(capReads).toBeGreaterThan(0)

    pendingRequests[0]!.resolve('alpha')
    // Wait for the NEXT task to actually start before resolving it.
    while (pendingRequests.length < 2)
      await delay(1)
    expect(maxInFlight).toBe(1)
    pendingRequests[1]!.resolve('beta')
    while (pendingRequests.length < 3)
      await delay(1)
    pendingRequests[2]!.resolve('gamma')
    await intentFinished
    expect(maxInFlight).toBe(1)

    // A remote provider (cap 4) on the NEXT intent gets its own resolution.
    cap = 4
    const secondFinished = new Promise<void>((resolve) => {
      let count = 0
      pipeline.on('onIntentEnd', () => {
        count += 1
        if (count >= 1)
          resolve()
      })
    })
    const second = pipeline.openIntent()
    second.end()
    while (pendingRequests.length < 5)
      await delay(1)
    expect(maxInFlight).toBeGreaterThan(1)
    pendingRequests[3]!.resolve('delta')
    pendingRequests[4]!.resolve('echo')
    pendingRequests[5]!.resolve('foxtrot')
    await secondFinished
  })

  it('drops a failed segment and keeps the queue moving (Phase 7.6 item 17-L)', async () => {
    // A single TTS failure must NOT stop the queue: the failed segment is
    // dropped, later segments are scheduled normally, in textual order.
    const { scheduled, playback } = createPlaybackSpy()

    const pipeline = createSpeechPipeline<string>({
      ttsMaxConcurrent: 1,
      segmenter: createSegmenter(['first', 'broken', 'third']),
      playback,
      async tts(request) {
        if (request.text === 'broken')
          return null // the host converts provider errors to null (fallback policy exhausted)
        return request.text
      },
    })

    const intentFinished = new Promise<void>((resolve) => {
      pipeline.on('onIntentEnd', () => resolve())
    })

    const intent = pipeline.openIntent()
    intent.end()

    await intentFinished

    expect(scheduled.map(item => item.text)).toEqual(['first', 'third'])
  })

  it('cancels in-flight TTS work without scheduling stale playback', async () => {
    const { scheduled, playback } = createPlaybackSpy()
    const abortedRequests: number[] = []

    const pipeline = createSpeechPipeline<string>({
      ttsMaxConcurrent: 2,
      segmenter: createSegmenter(['left', 'right']),
      playback,
      tts(request, signal) {
        return new Promise<string | null>((resolve) => {
          signal.addEventListener('abort', () => {
            abortedRequests.push(request.sequence)
            resolve(null)
          }, { once: true })
        })
      },
    })

    const intentCanceled = new Promise<void>((resolve) => {
      pipeline.on('onIntentCancel', () => resolve())
    })

    const intent = pipeline.openIntent()
    intent.end()

    await delay(0)
    intent.cancel('test-cancel')
    await intentCanceled

    expect(abortedRequests.sort()).toEqual([0, 1])
    expect(scheduled).toEqual([])
  })

  it('dispatches special controls only after the preceding playback item ends', async () => {
    const { scheduled, playback, end } = createPlaybackSpy({ autoEnd: false })
    const events: string[] = []

    const pipeline = createSpeechPipeline<string>({
      ttsMaxConcurrent: 2,
      segmenter: (_tokens, meta) => {
        return new ReadableStream<TextSegment>({
          start(controller) {
            controller.enqueue({
              turnId: meta.turnId,
              streamId: meta.streamId,
              intentId: meta.intentId,
              segmentId: 'segment:0',
              text: 'before',
              special: null,
              reason: 'flush',
              createdAt: Date.now(),
            })
            controller.enqueue({
              turnId: meta.turnId,
              streamId: meta.streamId,
              intentId: meta.intentId,
              segmentId: 'segment:1',
              text: '',
              special: '<|CALL ["plugin.action"]|>',
              reason: 'special',
              createdAt: Date.now(),
            })
            controller.close()
          },
        })
      },
      playback,
      async tts(request) {
        events.push(`tts:${request.text}`)
        return request.text
      },
    })

    pipeline.on('onSpecial', (segment) => {
      events.push(`special:${segment.special}`)
      events.push(`turn:${segment.turnId}`)
    })

    const intent = pipeline.openIntent({ turnId: 'turn-1' })
    intent.end()

    await delay(0)
    expect(scheduled.map(item => item.text)).toEqual(['before'])
    expect(events).toEqual(['tts:before'])

    end(scheduled[0]!)
    await delay(0)

    expect(events).toEqual([
      'tts:before',
      'special:<|CALL ["plugin.action"]|>',
      'turn:turn-1',
    ])
  })

  it('does not schedule queued timeline playback after the owning intent is cancelled', async () => {
    const { scheduled, playback, end } = createPlaybackSpy({ autoEnd: false })

    const pipeline = createSpeechPipeline<string>({
      ttsMaxConcurrent: 2,
      segmenter: (_tokens, meta) => {
        return new ReadableStream<TextSegment>({
          start(controller) {
            controller.enqueue({
              turnId: meta.turnId,
              streamId: meta.streamId,
              intentId: meta.intentId,
              segmentId: 'segment:0',
              text: 'first',
              special: null,
              reason: 'flush',
              createdAt: Date.now(),
            })
            controller.enqueue({
              turnId: meta.turnId,
              streamId: meta.streamId,
              intentId: meta.intentId,
              segmentId: 'segment:1',
              text: 'second',
              special: null,
              reason: 'flush',
              createdAt: Date.now(),
            })
            controller.close()
          },
        })
      },
      playback,
      async tts(request) {
        return request.text
      },
    })

    const intent = pipeline.openIntent({ intentId: 'intent-1', turnId: 'turn-1' })
    intent.end()

    await delay(0)
    expect(scheduled.map(item => item.text)).toEqual(['first'])

    intent.cancel('newer-intent')
    end(scheduled[0]!)
    await delay(0)

    expect(scheduled.map(item => item.text)).toEqual(['first'])
  })
})
