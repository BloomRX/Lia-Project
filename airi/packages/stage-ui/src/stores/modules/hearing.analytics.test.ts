import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useHearingSpeechInputPipeline, useHearingStore } from './hearing'

const analyticsMock = vi.hoisted(() => ({
  allowComposableCall: true,
  trackMicrophonePermissionDenied: vi.fn(),
  trackSttFailed: vi.fn(),
  trackSttSucceeded: vi.fn(),
  trackVoiceInputCancelled: vi.fn(),
  trackVoiceInputStarted: vi.fn(),
}))

const transcriptionMock = vi.hoisted(() => ({
  generateTranscription: vi.fn(async () => ({ text: 'hello' })),
}))

const traceMock = vi.hoisted(() => ({
  addEvent: vi.fn(),
  end: vi.fn(),
  setAttribute: vi.fn(),
}))

vi.mock('../../composables/use-io-tracer', async () => {
  const { shallowRef } = await import('vue')
  return {
    activeTurnSpan: shallowRef(),
    startSpan: () => traceMock,
  }
})

vi.mock('../../composables/use-analytics', () => ({
  useAnalytics: () => {
    if (!analyticsMock.allowComposableCall)
      throw new Error('Must be called at the top of a `setup` function')

    return {
      trackMicrophonePermissionDenied: analyticsMock.trackMicrophonePermissionDenied,
      trackSttFailed: analyticsMock.trackSttFailed,
      trackSttSucceeded: analyticsMock.trackSttSucceeded,
      trackVoiceInputCancelled: analyticsMock.trackVoiceInputCancelled,
      trackVoiceInputStarted: analyticsMock.trackVoiceInputStarted,
    }
  },
}))

vi.mock('@xsai/generate-transcription', () => ({
  generateTranscription: transcriptionMock.generateTranscription,
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'en' },
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('useHearingStore analytics lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    analyticsMock.allowComposableCall = true
    analyticsMock.trackMicrophonePermissionDenied.mockReset()
    analyticsMock.trackSttFailed.mockReset()
    analyticsMock.trackSttSucceeded.mockReset()
    analyticsMock.trackVoiceInputCancelled.mockReset()
    analyticsMock.trackVoiceInputStarted.mockReset()
    transcriptionMock.generateTranscription.mockReset()
    transcriptionMock.generateTranscription.mockResolvedValue({ text: 'hello' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  /**
   * @example
   * await hearingStore.transcription(providerId, provider, model, file)
   */
  it('does not call analytics composables when a recording is transcribed later', async () => {
    const hearingStore = useHearingStore()
    analyticsMock.allowComposableCall = false

    const result = await hearingStore.transcription(
      'openai-compatible-audio-transcription',
      {
        transcription: () => ({}),
      } as any,
      'FunAudioLLM/SenseVoiceSmall',
      new File(['hello'], 'recording.wav', { type: 'audio/wav' }),
    )

    expect(result.text).toBe('hello')
    expect(analyticsMock.trackVoiceInputStarted).toHaveBeenCalledWith({
      stt_provider_id: 'openai-compatible-audio-transcription',
    })
    expect(analyticsMock.trackSttSucceeded).toHaveBeenCalledWith({
      provider: 'openai-compatible-audio-transcription',
      latency_ms: expect.any(Number),
      char_count: 5,
      stream: false,
    })
  }, 10000)

  /**
   * @example
   * await expect(hearingStore.transcription(providerId, provider, model, file)).rejects.toThrow()
   */
  it('normalizes microphone permission failures for analytics', async () => {
    const hearingStore = useHearingStore()
    const permissionError = new DOMException('User denied microphone', 'NotAllowedError')
    transcriptionMock.generateTranscription.mockRejectedValueOnce(permissionError)

    await expect(hearingStore.transcription(
      'openai-compatible-audio-transcription',
      {
        transcription: () => ({}),
      } as any,
      'FunAudioLLM/SenseVoiceSmall',
      new File(['hello'], 'recording.wav', { type: 'audio/wav' }),
    )).rejects.toBe(permissionError)

    expect(analyticsMock.trackSttFailed).toHaveBeenCalledWith({
      provider: 'openai-compatible-audio-transcription',
      error_code: 'permission_denied',
    })
    expect(analyticsMock.trackMicrophonePermissionDenied).toHaveBeenCalledWith({
      stt_provider_id: 'openai-compatible-audio-transcription',
      error_code: 'permission_denied',
    })
  }, 10000)

  it('emits ASR trace events without recording the transcript', async () => {
    class Recognition {
      static latest: Recognition
      onresult?: (result: unknown) => void
      onend?: () => void

      constructor() {
        Recognition.latest = this
      }

      start() {}
    }
    vi.stubGlobal('window', { SpeechRecognition: Recognition })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const hearing = useHearingStore()
    hearing.activeTranscriptionProvider = 'browser-web-speech-api'
    hearing.activeTranscriptionModel = 'fixture-model'
    const onSentenceEnd = vi.fn()
    const onSpeechEnd = vi.fn()
    const pipeline = useHearingSpeechInputPipeline()
    await pipeline.transcribeForMediaStream({} as MediaStream, {
      consumerId: 'fixture',
      onSentenceEnd,
      onSpeechEnd,
      providerOptions: { continuous: false },
    })

    Recognition.latest.onresult?.({
      resultIndex: 0,
      results: [{ 0: { transcript: 'trace-canary' }, isFinal: true }],
    })
    Recognition.latest.onend?.()

    expect(onSentenceEnd).toHaveBeenCalledExactlyOnceWith('trace-canary')
    expect(onSpeechEnd).toHaveBeenCalledExactlyOnceWith('trace-canary ')
    expect(traceMock.addEvent).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\.asr\.sentence_end$/))
    expect(traceMock.setAttribute).not.toHaveBeenCalled()
    expect(traceMock.end).toHaveBeenCalledOnce()
  }, 10000)
})
