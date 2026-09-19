/**
 * Phase 7.6, item 3: bounded, metadata-only speech latency instrumentation.
 *
 * QA on the Windows box showed \"Lia starts late\" and \"silence between
 * sentences\" with no data to separate the suspects: XTTS inference time,
 * AllTalk-internal queueing, local HTTP overhead, or renderer playback
 * scheduling. This recorder attaches to the ALREADY-EXISTING pipeline events
 * and computes exactly four derivatives per segment:
 *
 * - `queueWaitMs`         = synth task start - segment creation
 * - `synthesisMs`         = result arrival - synth task start
 * - `timeToFirstAudioMs`  = first playback start of the turn - turn start
 * - `playbackGapMs`       = playback start of segment N - playback end of N-1
 *   (negative means the audio was contiguous/overlapping - the happy case)
 *
 * Contract: NO TEXT. Never the segment body, never a response, only numbers,
 * ids and flags. `textLength` is the richest field and is enough to spot the
 * \"Ah,\" (3 chars) pattern without leaking the message.
 */

export interface SpeechLatencyEntry {
  turnId?: string
  segmentId: string
  /** Characters in the spoken segment - never the text itself. */
  textLength: number
  queueWaitMs: number
  synthesisMs: number
  timeToFirstAudioMs?: number
  playbackGapMs?: number
}

export interface SpeechLatencySummary {
  turnId?: string
  segments: number
  totalTextLength: number
  firstAudioMs?: number
  maxSynthesisMs: number
  maxQueueWaitMs: number
  /** Largest inter-segment silence; negative = contiguous playback. */
  maxPlaybackGapMs?: number
}

interface SegmentTiming {
  turnId?: string
  segmentId: string
  textLength: number
  queuedAt: number
  synthesisStartedAt?: number
  synthesisFinishedAt?: number
  playbackStartedAt?: number
  playbackFinishedAt?: number
  /** start(N) - end(N-1), captured while the previous end is still current. */
  playbackGapMs?: number
}

export interface SpeechLatencyRecorder {
  /** Fired once per segment when its playback ENDS (or is interrupted). */
  onEntry?: (entry: SpeechLatencyEntry) => void
  /** Fired once per turn end with the folded summary. */
  onTurnSummary?: (summary: SpeechLatencySummary) => void
  /** Max tracked segments; older, never-finished ones are dropped. */
  maxSegments?: number
}

/**
 * Structural type, wider than the pipeline's own generic `on<K>`, so BOTH the
 * real pipeline (whose event names are a literal union) and the test double
 * fit. Event names are still passed literally below - `any` here only spares
 * this adapter from importing the full generic pipeline type.
 */
interface SpeechPipelineLike {
  on: (event: any, listener: (payload: any) => void) => unknown
}

export function recordSpeechLatency(
  pipeline: SpeechPipelineLike,
  hooks: SpeechLatencyRecorder = {},
): () => void {
  const timings = new Map<string, SegmentTiming>()
  const maxSegments = hooks.maxSegments ?? 512
  let currentTurnId: string | undefined
  let turnStartedAt = 0
  let lastPlaybackEndedAt: number | undefined
  let turnSegments = 0
  let turnTextLength = 0
  let turnFirstAudioMs: number | undefined
  let turnMaxSynth = 0
  let turnMaxQueueWait = 0
  let turnMaxGap: number | undefined

  function resetTurn(turnId: string | undefined) {
    currentTurnId = turnId
    turnStartedAt = Date.now()
    lastPlaybackEndedAt = undefined
    turnSegments = 0
    turnTextLength = 0
    turnFirstAudioMs = undefined
    turnMaxSynth = 0
    turnMaxQueueWait = 0
    turnMaxGap = undefined
  }

  function track(id: string): SegmentTiming {
    let timing = timings.get(id)
    if (!timing) {
      if (timings.size >= maxSegments) {
        const oldest = timings.keys().next().value
        if (oldest != null)
          timings.delete(oldest)
      }
      timing = { queuedAt: Date.now(), segmentId: id, textLength: 0, turnId: currentTurnId }
      timings.set(id, timing)
    }
    return timing
  }

  function summaryAndReset(): SpeechLatencySummary {
    const summary: SpeechLatencySummary = {
      segments: turnSegments,
      totalTextLength: turnTextLength,
      maxQueueWaitMs: turnMaxQueueWait,
      maxSynthesisMs: turnMaxSynth,
      ...(currentTurnId != null ? { turnId: currentTurnId } : {}),
      ...(turnFirstAudioMs != null ? { firstAudioMs: turnFirstAudioMs } : {}),
      ...(turnMaxGap != null ? { maxPlaybackGapMs: turnMaxGap } : {}),
    }
    resetTurn(undefined)
    return summary
  }

  const disposers = [
    pipeline.on('onTurnStart', (turnId: string) => {
      resetTurn(turnId)
    }),
    pipeline.on('onSegment', (segment: any) => {
      const timing = track(segment.segmentId)
      timing.queuedAt = segment.createdAt ?? Date.now()
      timing.textLength = (segment.text ?? '').length
      timing.turnId = segment.turnId ?? currentTurnId
      turnSegments += 1
      turnTextLength += timing.textLength
    }),
    pipeline.on('onTtsRequest', (request: any) => {
      const timing = track(request.segmentId)
      timing.synthesisStartedAt = Date.now()
      const wait = timing.synthesisStartedAt - (timing.queuedAt || timing.synthesisStartedAt)
      if (wait > turnMaxQueueWait)
        turnMaxQueueWait = wait
    }),
    pipeline.on('onTtsResult', (result: any) => {
      const timing = track(result.segmentId)
      timing.synthesisFinishedAt = Date.now()
      if (timing.synthesisStartedAt != null) {
        const synth = timing.synthesisFinishedAt - timing.synthesisStartedAt
        if (synth > turnMaxSynth)
          turnMaxSynth = synth
      }
    }),
    pipeline.on('onPlaybackStart', (event: any) => {
      const item = event?.item ?? event
      const timing = track(item.segmentId)
      const startedAt = event?.startedAt ?? Date.now()
      timing.playbackStartedAt = startedAt
      if (turnFirstAudioMs == null && turnStartedAt)
        turnFirstAudioMs = startedAt - turnStartedAt
      if (lastPlaybackEndedAt != null) {
        const gap = startedAt - lastPlaybackEndedAt
        timing.playbackGapMs = gap
        if (turnMaxGap == null || gap > turnMaxGap)
          turnMaxGap = gap
      }
    }),
    pipeline.on('onPlaybackEnd', (event: any) => {
      const item = event?.item ?? event
      const timing = track(item.segmentId)
      const endedAt = event?.endedAt ?? Date.now()
      timing.playbackFinishedAt = endedAt
      lastPlaybackEndedAt = endedAt
      emitEntry(timing)
    }),
    pipeline.on('onPlaybackInterrupt', (event: any) => {
      const item = event?.item ?? event
      const timing = timings.get(item.segmentId)
      if (timing) {
        timing.playbackFinishedAt = event?.interruptedAt ?? Date.now()
        emitEntry(timing)
      }
    }),
    pipeline.on('onPlaybackReject', (event: any) => {
      const item = event?.item ?? event
      timings.delete(item.segmentId)
    }),
    pipeline.on('onTurnEnd', () => {
      hooks.onTurnSummary?.(summaryAndReset())
    }),
    pipeline.on('onTurnCancel', () => {
      hooks.onTurnSummary?.(summaryAndReset())
    }),
  ]

  function emitEntry(timing: SegmentTiming) {
    if (timing.synthesisStartedAt == null || timing.synthesisFinishedAt == null)
      return // never synthesized: nothing meaningful to report
    const entry: SpeechLatencyEntry = {
      segmentId: timing.segmentId,
      textLength: timing.textLength,
      queueWaitMs: timing.synthesisStartedAt - timing.queuedAt,
      synthesisMs: timing.synthesisFinishedAt - timing.synthesisStartedAt,
      ...(timing.turnId != null ? { turnId: timing.turnId } : {}),
      ...(timing.playbackStartedAt != null && turnStartedAt
        ? { timeToFirstAudioMs: timing.playbackStartedAt - turnStartedAt }
        : {}),
    }
    if (timing.playbackGapMs != null)
      entry.playbackGapMs = timing.playbackGapMs
    hooks.onEntry?.(entry)
    timings.delete(timing.segmentId)
  }

  return () => {
    for (const dispose of disposers) {
      if (typeof dispose === 'function')
        dispose()
    }
    timings.clear()
  }
}
