import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isAbortError,
  isRecoverableSpeechError,
  notifySpeechTtsTurnEnded,
  registerSpeechTtsFallbackPolicy,
  resetSpeechTtsFallbackForTesting,
  SPEECH_TTS_FALLBACK_MAX_ATTEMPTS,
  synthesizeWithSpeechFallback,
  withSpeechTtsSegmentFallback,
} from './tts-fallback'

/**
 * The fallback runtime with a stub POLICY only — the retry loop, the error
 * classifiers and the segment wrapper under test are the real ones.
 */

interface SwitchRecord {
  attempt: number
  error: unknown
}

function createPolicyStub(answers: Array<boolean>) {
  const calls: SwitchRecord[] = []
  let index = 0

  return {
    calls,
    policy: {
      onAttemptFailed: (ctx: SwitchRecord) => {
        calls.push({ attempt: ctx.attempt, error: ctx.error })
        return answers[index++] ?? false
      },
    },
  }
}

function createSignal() {
  const controller = new AbortController()
  return { controller, signal: controller.signal }
}

const ABORT_ERROR = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })

describe('speech TTS fallback error classification', () => {
  it('recognises aborts by name and by message', () => {
    expect(isAbortError(ABORT_ERROR)).toBe(true)
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isAbortError(new Error('The user aborted a request.'))).toBe(true)
    expect(isAbortError(new Error('fetch failed'))).toBe(false)
  })

  it('treats provider/network/5xx trouble as recoverable', () => {
    for (const message of [
      'fetch failed',
      'network socket disconnected',
      '500 Internal Server Error',
      '503 Service Unavailable',
      'request timed out',
      'provider unavailable',
      'Failed to initialize speech provider: elevenlabs',
      'ECONNRESET',
    ]) {
      expect(isRecoverableSpeechError(new Error(message)), message).toBe(true)
    }
  })

  it('refuses to fall back on errors every provider would hit', () => {
    for (const message of [
      '401 Unauthorized',
      'invalid api key',
      '403 Forbidden',
      '404 model_not_found',
      '400 Bad Request',
      'no credentials configured',
      'insufficient_quota',
      'certificate has expired',
    ]) {
      expect(isRecoverableSpeechError(new Error(message)), message).toBe(false)
    }
  })

  it('never classifies an abort as recoverable', () => {
    expect(isRecoverableSpeechError(ABORT_ERROR)).toBe(false)
  })
})

describe('synthesizeWithSpeechFallback', () => {
  beforeEach(() => {
    resetSpeechTtsFallbackForTesting()
  })

  it('performs exactly one attempt when the provider succeeds', async () => {
    const stub = createPolicyStub([true, true, true])
    registerSpeechTtsFallbackPolicy(stub.policy)
    const synthesize = vi.fn(async () => 'audio-from-preferred')
    const { signal } = createSignal()

    const result = await synthesizeWithSpeechFallback(synthesize, { signal })

    expect(result).toBe('audio-from-preferred')
    expect(synthesize).toHaveBeenCalledTimes(1)
    expect(stub.calls).toEqual([])
  })

  it('is byte-for-byte one attempt with no policy registered', async () => {
    const synthesize = vi.fn(async () => {
      throw new Error('503 Service Unavailable')
    })
    const { signal } = createSignal()

    await expect(synthesizeWithSpeechFallback(synthesize, { signal })).rejects.toThrow('503')
    expect(synthesize).toHaveBeenCalledTimes(1)
  })

  it('returns null straight through when there is nothing to speak', async () => {
    const stub = createPolicyStub([true])
    registerSpeechTtsFallbackPolicy(stub.policy)
    const { signal } = createSignal()

    const result = await synthesizeWithSpeechFallback(async () => null, { signal })

    // `null` is a result (muted / noop / empty segment), not a failure.
    expect(result).toBeNull()
    expect(stub.calls).toEqual([])
  })

  it('retries the same segment once the policy switches target', async () => {
    const stub = createPolicyStub([true])
    registerSpeechTtsFallbackPolicy(stub.policy)
    const { signal } = createSignal()
    let attempt = 0
    const synthesize = vi.fn(async () => {
      attempt += 1
      if (attempt === 1)
        throw new Error('503 Service Unavailable')
      return 'audio-from-fallback'
    })

    const result = await synthesizeWithSpeechFallback(synthesize, { signal, segmentId: 's0' })

    expect(result).toBe('audio-from-fallback')
    expect(synthesize).toHaveBeenCalledTimes(2)
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]).toMatchObject({ attempt: 1 })
  })

  it('walks the chain and stops as soon as an attempt succeeds', async () => {
    const stub = createPolicyStub([true, true, true])
    registerSpeechTtsFallbackPolicy(stub.policy)
    const { signal } = createSignal()
    let attempt = 0
    const synthesize = vi.fn(async () => {
      attempt += 1
      if (attempt < 3)
        throw new Error('provider unavailable')
      return 'audio-from-fallback-1'
    })

    const result = await synthesizeWithSpeechFallback(synthesize, { signal })

    expect(result).toBe('audio-from-fallback-1')
    expect(synthesize).toHaveBeenCalledTimes(3)
    expect(stub.calls.map(call => call.attempt)).toEqual([1, 2])
  })

  it('propagates the last error when the policy runs out of targets', async () => {
    const stub = createPolicyStub([true, false])
    registerSpeechTtsFallbackPolicy(stub.policy)
    const { signal } = createSignal()
    const synthesize = vi.fn(async () => {
      throw new Error('provider unavailable')
    })

    await expect(synthesizeWithSpeechFallback(synthesize, { signal })).rejects.toThrow('provider unavailable')
    // preferred + fallback[0], then the policy declined: no loop.
    expect(synthesize).toHaveBeenCalledTimes(2)
  })

  it('never executes a fallback on abort', async () => {
    const stub = createPolicyStub([true, true])
    registerSpeechTtsFallbackPolicy(stub.policy)
    const { signal } = createSignal()
    const synthesize = vi.fn(async () => {
      throw ABORT_ERROR
    })

    await expect(synthesizeWithSpeechFallback(synthesize, { signal })).rejects.toBe(ABORT_ERROR)
    expect(synthesize).toHaveBeenCalledTimes(1)
    expect(stub.calls).toEqual([])
  })

  it('does not start the next provider when the signal aborts during a switch', async () => {
    const { controller, signal } = createSignal()
    const synthesize = vi.fn(async () => {
      throw new Error('503 Service Unavailable')
    })
    registerSpeechTtsFallbackPolicy({
      onAttemptFailed: () => {
        // The user pressed stop while the policy was switching target.
        controller.abort('user-stop')
        return true
      },
    })

    await expect(synthesizeWithSpeechFallback(synthesize, { signal })).rejects.toThrow('503')
    expect(synthesize).toHaveBeenCalledTimes(1)
  })

  it('does not fall back on a non-recoverable error', async () => {
    const stub = createPolicyStub([true, true])
    registerSpeechTtsFallbackPolicy(stub.policy)
    const { signal } = createSignal()
    const synthesize = vi.fn(async () => {
      throw new Error('401 invalid api key')
    })

    await expect(synthesizeWithSpeechFallback(synthesize, { signal })).rejects.toThrow('401')
    expect(synthesize).toHaveBeenCalledTimes(1)
    expect(stub.calls).toEqual([])
  })

  it('enforces the attempt ceiling even if the policy always says retry', async () => {
    const stub = createPolicyStub(Array.from({ length: 20 }).fill(true))
    registerSpeechTtsFallbackPolicy(stub.policy)
    const { signal } = createSignal()
    const synthesize = vi.fn(async () => {
      throw new Error('provider unavailable')
    })

    await expect(synthesizeWithSpeechFallback(synthesize, { signal })).rejects.toThrow('provider unavailable')
    expect(synthesize).toHaveBeenCalledTimes(SPEECH_TTS_FALLBACK_MAX_ATTEMPTS)
  })

  it('survives a policy that throws instead of corrupting the segment', async () => {
    registerSpeechTtsFallbackPolicy({
      onAttemptFailed: () => {
        throw new Error('policy exploded')
      },
    })
    const { signal } = createSignal()

    await expect(
      synthesizeWithSpeechFallback(async () => {
        throw new Error('provider unavailable')
      }, { signal }),
    ).rejects.toThrow('policy exploded')
  })
})

describe('withSpeechTtsSegmentFallback', () => {
  beforeEach(() => {
    resetSpeechTtsFallbackForTesting()
  })

  it('has the pipeline tts() signature and passes the result through', async () => {
    const wrapped = withSpeechTtsSegmentFallback<{ audio: string }, { segmentId: string }>(
      async request => ({ audio: request.segmentId }),
    )
    const { signal } = createSignal()

    await expect(wrapped({ segmentId: 's0' }, signal)).resolves.toEqual({ audio: 's0' })
  })

  it('converts a final failure back into null so the segment is dropped', async () => {
    registerSpeechTtsFallbackPolicy({ onAttemptFailed: () => false })
    const wrapped = withSpeechTtsSegmentFallback<string, { segmentId: string }>(async () => {
      throw new Error('provider unavailable')
    })
    const { signal } = createSignal()

    await expect(wrapped({ segmentId: 's0' }, signal)).resolves.toBeNull()
  })

  it('forwards the segment identity to the policy for diagnostics', async () => {
    const seen: unknown[] = []
    registerSpeechTtsFallbackPolicy({
      onAttemptFailed: (ctx) => {
        seen.push({ turnId: ctx.turnId, streamId: ctx.streamId, segmentId: ctx.segmentId })
        return false
      },
    })
    const wrapped = withSpeechTtsSegmentFallback<string, { turnId?: string, streamId?: string, segmentId?: string }>(
      async () => {
        throw new Error('provider unavailable')
      },
    )
    const { signal } = createSignal()

    await wrapped({ turnId: 't1', streamId: 'st1', segmentId: 's7' }, signal)

    expect(seen).toEqual([{ turnId: 't1', streamId: 'st1', segmentId: 's7' }])
  })
})

describe('notifySpeechTtsTurnEnded', () => {
  beforeEach(() => {
    resetSpeechTtsFallbackForTesting()
  })

  it('is a no-op when no policy is registered', () => {
    expect(() => notifySpeechTtsTurnEnded()).not.toThrow()
  })

  it('calls the policy so it can restore its preferred target', () => {
    const onTurnEnded = vi.fn()
    registerSpeechTtsFallbackPolicy({ onAttemptFailed: () => false, onTurnEnded })

    notifySpeechTtsTurnEnded()

    expect(onTurnEnded).toHaveBeenCalledTimes(1)
  })

  it('does not throw when the policy rejects', async () => {
    registerSpeechTtsFallbackPolicy({
      onAttemptFailed: () => false,
      onTurnEnded: async () => {
        throw new Error('restore failed')
      },
    })

    expect(() => notifySpeechTtsTurnEnded()).not.toThrow()
    // Let the caught rejection settle so it cannot surface as an unhandled one.
    await Promise.resolve()
  })
})
