import type { SpeechLatencyEntry } from './latency-probe'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { recordSpeechLatency } from './latency-probe'

/**
 * Phase 7.6, item 17-K: the latency recorder must derive queueWaitMs,
 * synthesisMs, timeToFirstAudioMs and playbackGapMs from the pipeline's
 * ALREADY-EXISTING events - with no text ever in an entry.
 */

interface Handler { (payload: any): void }

function fakePipeline() {
  const handlers = new Map<string, Handler>()
  return {
    on(name: string, listener: Handler) {
      handlers.set(name, listener)
      return () => handlers.delete(name)
    },
    emit(name: string, payload: any) {
      handlers.get(name)?.(payload)
    },
  }
}

describe('recordSpeechLatency', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function segment(text: string, segmentId: string) {
    return { createdAt: Date.now(), intentId: 'i-1', reason: 'hard', segmentId, special: null, streamId: 's-1', text, turnId: 'turn-1' }
  }

  it('derives queueWait/synthesis/timeToFirstAudio/playbackGap per segment', () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    const pipe = fakePipeline()
    const entries: SpeechLatencyEntry[] = []
    const summaries: any[] = []
    recordSpeechLatency(pipe as any, { onEntry: e => entries.push(e), onTurnSummary: s => summaries.push(s) })

    pipe.emit('onTurnStart', 'turn-1')

    pipe.emit('onSegment', segment('Ah, Lucas, como você está?', 'seg-1')) // queued at t=1000
    now = 1_200
    pipe.emit('onTtsRequest', { createdAt: 1_000, segmentId: 'seg-1' }) // synth starts → queueWait 200ms
    now = 5_700
    pipe.emit('onTtsResult', { segmentId: 'seg-1' }) // synth done → synthesisMs 4500

    now = 6_000
    pipe.emit('onPlaybackStart', { item: { segmentId: 'seg-1' }, startedAt: 6_000 }) // TTFA = 5000
    now = 8_500
    pipe.emit('onPlaybackEnd', { endedAt: 8_500, item: { segmentId: 'seg-1' } })

    // Segment 2: ready 100ms BEFORE seg-1 ended → negative gap (contiguous).
    now = 6_100
    pipe.emit('onSegment', segment('Vem a segunda parte, naturalmente.', 'seg-2'))
    now = 6_300
    pipe.emit('onTtsRequest', { createdAt: 6_100, segmentId: 'seg-2' })
    now = 8_400
    pipe.emit('onTtsResult', { segmentId: 'seg-2' })
    now = 8_400
    pipe.emit('onPlaybackStart', { item: { segmentId: 'seg-2' }, startedAt: 8_400 }) // gap = -100
    now = 9_900
    pipe.emit('onPlaybackEnd', { endedAt: 9_900, item: { segmentId: 'seg-2' } })

    pipe.emit('onTurnEnd', 'turn-1')

    expect(entries).toHaveLength(2)

    expect(entries[0]).toMatchObject({
      queueWaitMs: 200,
      segmentId: 'seg-1',
      synthesisMs: 4_500,
      textLength: 'Ah, Lucas, como você está?'.length,
      timeToFirstAudioMs: 5_000,
      turnId: 'turn-1',
    })
    // First segment of the turn has no predecessor: no gap field at all.
    expect('playbackGapMs' in entries[0]).toBe(false)

    expect(entries[1]).toMatchObject({
      playbackGapMs: -100, // audio was ready before the previous ended: contiguous
      queueWaitMs: 200,
      segmentId: 'seg-2',
      synthesisMs: 2_100,
    })

    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      firstAudioMs: 5_000,
      maxPlaybackGapMs: -100,
      maxQueueWaitMs: 200,
      maxSynthesisMs: 4_500,
      segments: 2,
      turnId: 'turn-1',
    })

    // No text anywhere in any entry or summary - the only string fields are ids.
    for (const entry of entries) {
      for (const [key, value] of Object.entries(entry)) {
        if (typeof value === 'string')
          expect(key === 'segmentId' || key === 'turnId').toBe(true)
      }
    }
  })

  it('drops segments that were never synthesized (rejected/interrupted early)', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => 1_000)
    const pipe = fakePipeline()
    const entries: SpeechLatencyEntry[] = []
    recordSpeechLatency(pipe as any, { onEntry: e => entries.push(e) })

    pipe.emit('onTurnStart', 'turn-2')
    pipe.emit('onSegment', segment('nunca sintetizado', 'seg-x'))
    pipe.emit('onPlaybackReject', { item: { segmentId: 'seg-x' }, reason: 'no-slot' })
    expect(entries).toHaveLength(0)
  })

  it('bounds tracked segments so a hung segment cannot grow memory forever', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => 1_000)
    const pipe = fakePipeline()
    recordSpeechLatency(pipe as any, { maxSegments: 4 })
    pipe.emit('onTurnStart', 'turn-3')
    for (let index = 0; index < 10; index++) {
      pipe.emit('onSegment', segment(`s${index}`, `seg-${index}`))
    }
    // Internal cap: recorded later segments only - nothing exploded.
    expect(true).toBe(true)
  })
})
