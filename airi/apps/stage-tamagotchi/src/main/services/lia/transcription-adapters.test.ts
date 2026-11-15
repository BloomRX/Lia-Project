import type { TransportRecord } from '../../../../../../../lia/core/src/transports/contracts'
import type { LiaTranscriptionRunRequest } from '../../../shared/eventa/lia-transcription'

import { describe, expect, it } from 'vitest'

import { isNativeRecordingTranscriptionProvider, parseTranscriptionResponse, prepareTranscriptionRequest } from './transcription-adapters'

function record(providerId: string, baseUrl = 'https://service.invalid/v1/'): TransportRecord {
  return {
    id: providerId,
    providerId,
    definitionId: providerId,
    type: 'http',
    protocol: 'chat-completions',
    baseUrl,
    adapterOptions: {},
    modelIds: [],
    enabled: true,
    metadata: {},
    credentialRef: { scope: providerId, key: 'apiKey' },
  }
}

function request(providerId: string, overrides: Partial<LiaTranscriptionRunRequest> = {}): LiaTranscriptionRunRequest {
  return {
    providerId,
    model: 'configured-model',
    bytes: new Uint8Array([0, 1, 254, 255]),
    mimeType: 'audio/webm',
    fileName: 'recording.webm',
    ...overrides,
  }
}

describe('recording transcription adapters', () => {
  it.each(['openai-audio-transcription', 'openai-compatible-audio-transcription', 'comet-api-transcription', 'app-local-audio-transcription', 'mimo-audio-transcription'])('recognizes migrated recording id %s', (id) => {
    expect(isNativeRecordingTranscriptionProvider(id)).toBe(true)
  })

  it.each(['browser-local-audio-transcription', 'unknown', 'groq', 'mimo-audio-speech'])('does not extend the recording migration to %s', (id) => {
    expect(isNativeRecordingTranscriptionProvider(id)).toBe(false)
  })

  it.each(['openai-audio-transcription', 'openai-compatible-audio-transcription', 'comet-api-transcription', 'app-local-audio-transcription', 'groq'])('preserves multipart audio and options for %s', async (id) => {
    const bytes = new Uint8Array([33, 0, 1, 254, 255, 44]).subarray(1, 5)
    const { url, init } = prepareTranscriptionRequest(record(id), request(id, {
      bytes,
      responseFormat: 'verbose_json',
      language: 'pt',
      prompt: 'Nomes próprios',
      temperature: 0,
    }), 'synthetic-key')
    expect(url.href).toBe('https://service.invalid/v1/audio/transcriptions')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer synthetic-key')
    expect(new Headers(init.headers).has('content-type')).toBe(false)
    const body = init.body as FormData
    expect([...body.keys()]).toEqual(['model', 'file', 'response_format', 'timestamp_granularities[]', 'language', 'prompt', 'temperature'])
    expect(body.get('model')).toBe('configured-model')
    expect(body.get('language')).toBe('pt')
    expect(body.get('prompt')).toBe('Nomes próprios')
    expect(body.get('temperature')).toBe('0')
    expect(body.get('timestamp_granularities[]')).toBe('segment')
    expect(body.get('response_format')).toBe('verbose_json')
    const file = body.get('file') as File
    expect(file.name).toBe('recording.webm')
    expect(file.type).toBe('audio/webm')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
  })

  it('defaults multipart format and leaves unconfigured options absent', () => {
    const id = 'openai-compatible-audio-transcription'
    const { init } = prepareTranscriptionRequest(record(id), request(id), 'synthetic-key')
    expect([...(init.body as FormData).keys()]).toEqual(['model', 'file', 'response_format'])
    expect((init.body as FormData).get('response_format')).toBe('json')
  })

  it.each(['openai-compatible-audio-transcription', 'mimo-audio-transcription', 'app-local-audio-transcription'])('uses saved definition %s for a custom provider id', (definitionId) => {
    const providerId = 'saved-transcription-instance'
    const saved = { ...record(providerId), definitionId }
    const { url, init } = prepareTranscriptionRequest(saved, request(providerId), 'synthetic-key')
    expect(url.pathname).toBe(definitionId === 'mimo-audio-transcription' ? '/v1/chat/completions' : '/v1/audio/transcriptions')
    expect(new Headers(init.headers).get(definitionId === 'mimo-audio-transcription' ? 'api-key' : 'authorization')).toBe(definitionId === 'mimo-audio-transcription' ? 'synthetic-key' : 'Bearer synthetic-key')
    expect(typeof init.body === 'string').toBe(definitionId === 'mimo-audio-transcription')
  })

  it('allows a custom instance of the keyless local definition on loopback', () => {
    const providerId = 'saved-local-instance'
    const saved = { ...record(providerId, 'http://localhost/v1/'), definitionId: 'app-local-audio-transcription' }
    expect(new Headers(prepareTranscriptionRequest(saved, request(providerId), undefined).init.headers).has('authorization')).toBe(false)
  })

  it.each(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/webm;codecs=opus'])('preserves the legacy JSON audio format for %s', (mimeType) => {
    const id = 'mimo-audio-transcription'
    const { url, init } = prepareTranscriptionRequest(record(id), request(id, { mimeType, language: 'pt', temperature: 0.5, prompt: 'unused', responseFormat: 'verbose_json' }), 'synthetic-key')
    expect(url.href).toBe('https://service.invalid/v1/chat/completions')
    expect(new Headers(init.headers).get('api-key')).toBe('synthetic-key')
    expect(new Headers(init.headers).get('authorization')).toBeNull()
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'configured-model',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Transcribe the audio content.' },
          { type: 'input_audio', input_audio: { data: 'AAH+/w==', format: mimeType.startsWith('audio/webm') ? 'webm' : mimeType === 'audio/mp4' ? 'mp4' : ['audio/mp3', 'audio/mpeg'].includes(mimeType) ? 'mp3' : 'wav' } },
        ],
      }],
    })
  })

  it.each(['http://localhost/v1/', 'http://127.0.0.1/v1/', 'http://[::1]/v1/'])('permits keyless local recording only at %s', (baseUrl) => {
    const id = 'app-local-audio-transcription'
    const { init } = prepareTranscriptionRequest(record(id, baseUrl), request(id), undefined)
    expect(new Headers(init.headers).has('authorization')).toBe(false)
  })

  it.each(['https://service.invalid/v1/', 'https://localhost.service.invalid/v1/', 'https://192.168.1.2/v1/'])('requires a credential outside loopback %s', (baseUrl) => {
    const id = 'app-local-audio-transcription'
    expect(() => prepareTranscriptionRequest(record(id, baseUrl), request(id), undefined)).toThrow(expect.objectContaining({ code: 'credentials' }))
  })

  it.each(['openai-audio-transcription', 'openai-compatible-audio-transcription', 'comet-api-transcription', 'mimo-audio-transcription', 'groq'])('requires a credential for %s even on loopback', (id) => {
    expect(() => prepareTranscriptionRequest(record(id, 'http://localhost/v1/'), request(id), undefined)).toThrow(expect.objectContaining({ code: 'credentials' }))
  })

  it('refuses unknown providers, mismatched records and invalid addresses', () => {
    expect(() => prepareTranscriptionRequest(record('unknown'), request('unknown'), 'key')).toThrow()
    expect(() => prepareTranscriptionRequest(record('groq'), request('mimo-audio-transcription'), 'key')).toThrow()
    expect(() => prepareTranscriptionRequest(record('groq', 'file:///v1/'), request('groq'), 'key')).toThrow()
    expect(() => prepareTranscriptionRequest(record('groq', 'https://user:pass@service.invalid/'), request('groq'), 'key')).toThrow()
  })

  it.each(['http://service.invalid/v1/', 'http://localhost.service.invalid/v1/', 'http://192.168.1.2/v1/', 'https://service.invalid/v1/?token=synthetic', 'https://service.invalid/v1/#fragment', 'https://user@service.invalid/v1/', 'invalid-url'])('refuses unsafe persisted address %s', (baseUrl) => {
    const id = 'openai-compatible-audio-transcription'
    expect(() => prepareTranscriptionRequest(record(id, baseUrl), request(id), 'synthetic-key')).toThrow(expect.objectContaining({ code: 'configuration' }))
  })

  it.each(['https://service.invalid/v1', 'http://localhost/v1', 'http://127.0.0.1/v1', 'http://[::1]/v1'])('accepts safe address and preserves its path %s', (baseUrl) => {
    const id = 'openai-compatible-audio-transcription'
    const { url } = prepareTranscriptionRequest(record(id, baseUrl), request(id), 'synthetic-key')
    expect(url.pathname).toBe('/v1/audio/transcriptions')
  })

  it.each(['', 'text/plain', 'audio/webm\r\nx-injected: true', 'audio/webm\0', 'audio/'])('refuses invalid audio MIME %j', (mimeType) => {
    const id = 'openai-compatible-audio-transcription'
    expect(() => prepareTranscriptionRequest(record(id), request(id, { mimeType }), 'synthetic-key')).toThrow(expect.objectContaining({ code: 'configuration' }))
  })

  it.each(['openai-compatible-audio-transcription', 'mimo-audio-transcription'])('refuses an injected credential header for %s', (id) => {
    expect(() => prepareTranscriptionRequest(record(id), request(id), 'synthetic\r\nx-injected: true')).toThrow(expect.objectContaining({ code: 'configuration' }))
    expect(() => prepareTranscriptionRequest(record(id), request(id), 'synthetic\0key')).toThrow(expect.objectContaining({ code: 'configuration' }))
  })

  it('projects bounded text, language and only finite confidence/timing fields', () => {
    expect(parseTranscriptionResponse('groq', {
      text: ' Olá ',
      language: 'pt',
      secret: 'discard',
      segments: [null, 'bad', { text: 'Olá', start: 0, end: 2, avg_logprob: -0.2, no_speech_prob: 0.1, tokens: [123], secret: 'discard' }, { text: 5, start: Number.NaN, end: Infinity, avg_logprob: 'wrong', no_speech_prob: -Infinity }],
    })).toEqual({ text: ' Olá ', language: 'pt', segments: [{ text: 'Olá', start: 0, end: 2, avg_logprob: -0.2, no_speech_prob: 0.1 }, {}] })
  })

  it('bounds optional text and language and accepts an empty transcript', () => {
    expect(parseTranscriptionResponse('groq', { text: '', language: 'x'.repeat(33), segments: [{ text: '' }] })).toEqual({ text: '', segments: [{ text: '' }] })
    expect(() => parseTranscriptionResponse('groq', { text: 'x'.repeat(200_001) })).toThrow(expect.objectContaining({ code: 'protocol' }))
  })

  it('bounds aggregate segment text at 200000 characters', () => {
    const segments = [{ text: 'a'.repeat(100_000) }, { text: 'b'.repeat(100_000) }]
    expect(parseTranscriptionResponse('groq', { text: '', segments }).segments).toEqual(segments)
    expect(() => parseTranscriptionResponse('groq', { text: '', segments: [...segments, { text: 'x' }] })).toThrow(expect.objectContaining({ code: 'protocol' }))
    expect(() => parseTranscriptionResponse('groq', { text: '', segments: [{ text: 'x'.repeat(200_001) }] })).toThrow(expect.objectContaining({ code: 'protocol' }))
  })

  it('bounds segment count at 10000 including malformed entries', () => {
    expect(parseTranscriptionResponse('groq', { text: '', segments: Array.from({ length: 10_000 }, () => ({})) }).segments).toHaveLength(10_000)
    expect(() => parseTranscriptionResponse('groq', { text: '', segments: Array.from({ length: 10_001 }).fill(null) })).toThrow(expect.objectContaining({ code: 'protocol' }))
  })

  it('extracts only the JSON audio transcription message', () => {
    expect(parseTranscriptionResponse('mimo-audio-transcription', { choices: [{ message: { content: 'Olá' } }], text: 'wrong', language: 'pt', segments: [{}] })).toEqual({ text: 'Olá' })
  })

  it.each([null, {}, { choices: [] }, { choices: [{ message: { content: [] } }] }])('refuses malformed JSON audio response %j', (json) => {
    expect(() => parseTranscriptionResponse('mimo-audio-transcription', json)).toThrow(expect.objectContaining({ code: 'protocol' }))
  })
})
