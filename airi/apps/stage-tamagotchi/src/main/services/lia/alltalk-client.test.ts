import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  ALLTALK_LANGUAGES,
  createAllTalkClient,
  DEFAULT_ALLTALK_BASE_URL,
  toAllTalkLanguage,
} from './alltalk-client'

/**
 * Driven against a real local HTTP server rather than a mocked `fetch`, so the
 * request actually goes over a socket: method, content type, form encoding and
 * the two-hop generate -> fetch-audio flow are all genuinely exercised.
 */

interface RecordedRequest {
  body: string
  contentType: string | undefined
  method: string
  url: string
}

let server: Server
let baseUrl = ''
const recorded: RecordedRequest[] = []

/** What the fake AllTalk answers with; tests set this per case. */
let behaviour: {
  audioBytes: number
  generateStatus: number
  generateBody: unknown
  omitAudioUrl?: boolean
  voicesStatus: number
} = {
  audioBytes: 256,
  generateStatus: 200,
  generateBody: { status: 'generate-success', output_file_url: '/audio/out.wav' },
  voicesStatus: 200,
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      recorded.push({
        method: req.method ?? '',
        url: req.url ?? '',
        contentType: req.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8'),
      })

      if (req.url === '/api/voices') {
        res.writeHead(behaviour.voicesStatus, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ voices: ['lia.wav', 'female_01.wav'] }))
        return
      }

      if (req.url === '/api/tts-generate') {
        res.writeHead(behaviour.generateStatus, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(behaviour.generateBody))
        return
      }

      if (req.url?.startsWith('/audio/')) {
        res.writeHead(200, { 'Content-Type': 'audio/wav' })
        res.end(Buffer.alloc(behaviour.audioBytes, 3))
        return
      }

      res.writeHead(404)
      res.end('{}')
    })
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

beforeEach(() => {
  recorded.length = 0
  behaviour = {
    audioBytes: 256,
    generateStatus: 200,
    generateBody: { status: 'generate-success', output_file_url: '/audio/out.wav' },
    voicesStatus: 200,
  }
})

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
})

function form(url: string): URLSearchParams {
  const request = recorded.find(item => item.url === url)
  if (!request)
    throw new Error(`no request recorded for ${url}`)
  return new URLSearchParams(request.body)
}

describe('allTalk language mapping', () => {
  it('reduces pt-BR to the pt code the API documents', () => {
    // The documented language table has no region variants, so sending `pt-BR`
    // would be rejected.
    expect(toAllTalkLanguage('pt-BR')).toBe('pt')
    expect(toAllTalkLanguage('pt')).toBe('pt')
    expect(toAllTalkLanguage('PT-br')).toBe('pt')
    expect(toAllTalkLanguage('en-US')).toBe('en')
  })

  it('falls back to auto for something AllTalk does not list', () => {
    expect(toAllTalkLanguage('tlh')).toBe('auto')
    expect(toAllTalkLanguage(undefined)).toBe('auto')
    expect(toAllTalkLanguage('')).toBe('auto')
  })

  it('lists only documented codes', () => {
    expect(ALLTALK_LANGUAGES).toContain('pt')
    expect(ALLTALK_LANGUAGES).not.toContain('pt-BR')
    expect(ALLTALK_LANGUAGES).toContain('auto')
  })
})

describe('allTalk client', () => {
  it('reports connected with the voice list when the server answers', async () => {
    const client = createAllTalkClient({ baseUrl, timeoutMs: 5000 })

    const status = await client.status()

    expect(status).toEqual({ ok: true, state: 'connected', voices: ['lia.wav', 'female_01.wav'] })
    expect(recorded[0]).toMatchObject({ method: 'GET', url: '/api/voices' })
  })

  it('reports offline - not error - when nothing is listening', async () => {
    // A port with no listener: the normal "AllTalk is not running" case.
    const client = createAllTalkClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 1000 })

    expect(await client.status()).toEqual({ ok: false, state: 'offline' })
  })

  it('reports error when the server answers with a failure status', async () => {
    behaviour.voicesStatus = 500
    const client = createAllTalkClient({ baseUrl, timeoutMs: 5000 })

    const status = await client.status()
    expect(status.ok).toBe(false)
    if (!status.ok)
      expect(status.state).toBe('error')
  })

  it('sends the documented form fields, including the pt language code', async () => {
    const client = createAllTalkClient({ baseUrl, timeoutMs: 5000 })

    await client.synthesize({
      text: 'Olá! Eu sou a Lia.',
      characterVoiceGen: 'lia.wav',
      language: toAllTalkLanguage('pt-BR'),
    })

    const generate = recorded.find(item => item.url === '/api/tts-generate')
    expect(generate?.method).toBe('POST')
    expect(generate?.contentType).toContain('application/x-www-form-urlencoded')

    const fields = form('/api/tts-generate')
    expect(fields.get('text_input')).toBe('Olá! Eu sou a Lia.')
    expect(fields.get('character_voice_gen')).toBe('lia.wav')
    expect(fields.get('language')).toBe('pt')
    expect(fields.get('narrator_enabled')).toBe('false')
    // Timestamped output so concurrent requests cannot clobber one another.
    expect(fields.get('output_file_timestamp')).toBe('true')
    expect(fields.get('autoplay')).toBe('false')
  })

  it('follows output_file_url and returns the audio bytes', async () => {
    behaviour.audioBytes = 512
    const client = createAllTalkClient({ baseUrl, timeoutMs: 5000 })

    const audio = await client.synthesize({
      text: 'Olá!',
      characterVoiceGen: 'lia.wav',
      language: 'pt',
    })

    // The generation endpoint returns JSON; the bytes come from the second hop.
    expect(audio.byteLength).toBe(512)
    expect(new Uint8Array(audio)[0]).toBe(3)
    expect(recorded.some(item => item.url === '/audio/out.wav')).toBe(true)
  })

  it('throws on generate-failure instead of returning silence', async () => {
    behaviour.generateBody = { status: 'generate-failure' }
    const client = createAllTalkClient({ baseUrl, timeoutMs: 5000 })

    await expect(client.synthesize({ text: 'Oi', characterVoiceGen: 'lia.wav', language: 'pt' }))
      .rejects
      .toThrow(/generate-failure/)
  })

  it('throws when success carries no audio location', async () => {
    behaviour.generateBody = { status: 'generate-success' }
    const client = createAllTalkClient({ baseUrl, timeoutMs: 5000 })

    await expect(client.synthesize({ text: 'Oi', characterVoiceGen: 'lia.wav', language: 'pt' }))
      .rejects
      .toThrow(/no audio location/)
  })

  it('throws on an HTTP error from the generation endpoint', async () => {
    behaviour.generateStatus = 503
    const client = createAllTalkClient({ baseUrl, timeoutMs: 5000 })

    await expect(client.synthesize({ text: 'Oi', characterVoiceGen: 'lia.wav', language: 'pt' }))
      .rejects
      .toThrow(/503/)
  })

  it('throws on an empty audio file rather than playing nothing', async () => {
    behaviour.audioBytes = 0
    const client = createAllTalkClient({ baseUrl, timeoutMs: 5000 })

    await expect(client.synthesize({ text: 'Oi', characterVoiceGen: 'lia.wav', language: 'pt' }))
      .rejects
      .toThrow(/empty audio/)
  })

  it('refuses to call the server without text or a reference voice', async () => {
    const client = createAllTalkClient({ baseUrl, timeoutMs: 5000 })

    await expect(client.synthesize({ text: '   ', characterVoiceGen: 'lia.wav', language: 'pt' }))
      .rejects
      .toThrow(/Nothing to synthesize/)
    await expect(client.synthesize({ text: 'Oi', characterVoiceGen: '', language: 'pt' }))
      .rejects
      .toThrow(/no reference audio/)
    expect(recorded).toHaveLength(0)
  })

  it('has a documented default base URL and port', () => {
    expect(DEFAULT_ALLTALK_BASE_URL).toBe('http://127.0.0.1:7851')
  })
})
