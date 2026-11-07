import type { TransportRecord } from '../../../../../../../lia/core/src/transports/contracts'
import type { LiaTranscriptionRunRequest } from '../../../shared/eventa/lia-transcription'

import { Buffer } from 'node:buffer'

import { ProviderError } from '../../../../../../../lia/core/src/providers/contracts'
import { isCuratedChatProvider } from '../../../shared/lia/provider-catalog'
import { supportsMainTranscription } from '../../../shared/lia/transcription-transport'

const MAX_TEXT = 200_000

export function isNativeRecordingTranscriptionProvider(id: string): boolean {
  return supportsMainTranscription(id)
}

function supported(id: string): boolean {
  return isNativeRecordingTranscriptionProvider(id) || isCuratedChatProvider(id)
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
}

function audioFormat(mimeType: string): string {
  const format = mimeType.split(';')[0].split('/')[1]
  if (format === 'webm' || format === 'mp4')
    return format
  return format === 'mpeg' || format === 'mp3' ? 'mp3' : 'wav'
}

/** Endpoint and credential are resolved by Main, never taken from the audio request. */
export function prepareTranscriptionRequest(
  record: TransportRecord,
  request: LiaTranscriptionRunRequest,
  credential: string | undefined,
): { url: URL, init: RequestInit } {
  if (!supported(record.definitionId) || record.providerId !== request.providerId)
    throw new ProviderError('configuration')
  if (!/^audio\/[a-z0-9.+-]+(?:;[a-z0-9= .+-]+)?$/i.test(request.mimeType)
    || (credential !== undefined && (!/^[\x21-\x7E]+$/.test(credential) || credential.length > 16384))) {
    throw new ProviderError('configuration')
  }
  let base: URL
  try {
    base = new URL(record.baseUrl)
  }
  catch {
    throw new ProviderError('configuration')
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  if ((base.protocol !== 'https:' && (base.protocol !== 'http:' || !loopback)) || base.username || base.password || base.search || base.hash)
    throw new ProviderError('configuration')
  if (!base.pathname.endsWith('/'))
    base.pathname += '/'
  const keylessLocal = record.definitionId === 'app-local-audio-transcription' && loopback
  if (!credential && !keylessLocal)
    throw new ProviderError('credentials')

  if (record.definitionId === 'mimo-audio-transcription') {
    return {
      url: new URL('chat/completions', base),
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': credential! },
        body: JSON.stringify({
          model: request.model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Transcribe the audio content.' },
              { type: 'input_audio', input_audio: { data: Buffer.from(request.bytes).toString('base64'), format: audioFormat(request.mimeType) } },
            ],
          }],
        }),
      },
    }
  }

  const body = new FormData()
  body.append('model', request.model)
  const audio = Uint8Array.from(request.bytes).buffer
  body.append('file', new Blob([audio], { type: request.mimeType }), request.fileName)
  body.append('response_format', request.responseFormat ?? 'json')
  if (request.responseFormat === 'verbose_json')
    body.append('timestamp_granularities[]', 'segment')
  if (request.language !== undefined)
    body.append('language', request.language)
  if (request.prompt !== undefined)
    body.append('prompt', request.prompt)
  if (request.temperature !== undefined)
    body.append('temperature', String(request.temperature))
  return {
    url: new URL('audio/transcriptions', base),
    init: { method: 'POST', headers: credential ? { authorization: `Bearer ${credential}` } : {}, body },
  }
}

interface TranscriptionSegment {
  text?: string
  start?: number
  end?: number
  avg_logprob?: number
  no_speech_prob?: number
}

/** Projects only the fields consumed by the hearing pipeline across the IPC boundary. */
export function parseTranscriptionResponse(providerId: string, json: unknown): { text: string, segments?: TranscriptionSegment[], language?: string } {
  if (!supported(providerId) || !object(json))
    throw new ProviderError('protocol')
  let recognized = json.text
  if (providerId === 'mimo-audio-transcription') {
    const first = Array.isArray(json.choices) ? json.choices[0] : undefined
    recognized = object(first) && object(first.message) ? first.message.content : undefined
  }
  if (typeof recognized !== 'string' || recognized.length > MAX_TEXT)
    throw new ProviderError('protocol')
  if (Array.isArray(json.segments) && (json.segments.length > 10_000 || json.segments.reduce((sum, segment) => sum + (object(segment) && typeof segment.text === 'string' ? segment.text.length : 0), 0) > MAX_TEXT))
    throw new ProviderError('protocol')
  const segments = Array.isArray(json.segments) && providerId !== 'mimo-audio-transcription'
    ? json.segments.filter(object).map((segment) => {
        const projected: TranscriptionSegment = {}
        if (typeof segment.text === 'string' && segment.text.length <= MAX_TEXT)
          projected.text = segment.text
        for (const key of ['start', 'end', 'avg_logprob', 'no_speech_prob'] as const) {
          if (typeof segment[key] === 'number' && Number.isFinite(segment[key]))
            projected[key] = segment[key]
        }
        return projected
      })
    : undefined
  return {
    text: recognized,
    ...(segments ? { segments } : {}),
    ...(providerId !== 'mimo-audio-transcription' && typeof json.language === 'string' && json.language.length <= 32 ? { language: json.language } : {}),
  }
}
