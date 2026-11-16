import { afterEach, describe, expect, it, vi } from 'vitest'

import { streamWebSpeechAPITranscription } from './provider'

describe('web speech diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('delivers recognized text without logging interim or final speech', async () => {
    class Recognition {
      start() {}
    }
    vi.stubGlobal('window', { SpeechRecognition: Recognition })
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const onSentenceEnd = vi.fn()
    const result = streamWebSpeechAPITranscription({} as MediaStream, { continuous: false, onSentenceEnd })

    result.recognition.onresult({
      resultIndex: 0,
      results: [
        { 0: { transcript: 'interim-voice-canary' }, isFinal: false },
        { 0: { transcript: 'final-voice-canary' }, isFinal: true },
      ],
    })
    result.recognition.onend()

    await expect(result.text).resolves.toBe('final-voice-canary ')
    expect(onSentenceEnd).toHaveBeenCalledExactlyOnceWith('final-voice-canary')
    expect(info).toHaveBeenCalledWith('Web Speech API produced a final result.')
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/(?:interim|final)-voice-canary/)
  })
})
