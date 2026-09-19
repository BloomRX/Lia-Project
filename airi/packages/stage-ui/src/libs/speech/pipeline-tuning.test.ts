import { describe, expect, it } from 'vitest'

import { CUSTOM_LOCAL_VOICE_PROVIDER_ID } from '../providers/providers/custom-local-voice'
import { resolveSpeechPipelineTuning } from './pipeline-tuning'

/**
 * Phase 7.6/7.7, Part 4: concurrency is a per-provider DECISION, never a
 * Promise.all-style burst. For the serialized local engine the evidence is
 * unambiguous: AllTalk runs one XTTS inference at a time (a single venv,
 * a single model lock), and the Windows QA saw a 134-char request started
 * 350ms after a 113-char one NEVER complete - requests were blind-queueing
 * against that lock. Parallel calls add contention, never throughput.
 */

describe('resolveSpeechPipelineTuning', () => {
  it('bounds the serialized local engine to exactly one in-flight synthesis', () => {
    const tuning = resolveSpeechPipelineTuning(CUSTOM_LOCAL_VOICE_PROVIDER_ID)
    expect(tuning.maxConcurrent).toBe(1)
    expect(tuning.wrapSegmenter).toBeTypeOf('function')
  })

  it('keeps the stock parallelism for multi-slot remote providers', () => {
    const tuning = resolveSpeechPipelineTuning('elevenlabs')
    expect(tuning.maxConcurrent).toBe(4)
    expect(tuning.wrapSegmenter).toBeUndefined()
  })

  it('treats an unknown/missing provider as the default, safely', () => {
    expect(resolveSpeechPipelineTuning(undefined).maxConcurrent).toBe(4)
  })
})
