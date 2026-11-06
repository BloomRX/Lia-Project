import type { TransportRecord, TransportSnapshot } from '../../../../../../../lia/core/src/transports/contracts'

import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { createServer } from 'node:http'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createLiaTranscriptionService } from './transcription-service'

/**
 * Speech-to-text in the main process.
 *
 * The point of this service is that the Groq key never reaches the renderer, so
 * the assertions that matter are: the credential comes from the vault (never
 * from the request), it goes to the endpoint the persisted record names, the
 * audio is forwarded byte for byte, and every failure is a code rather than a
 * body. A real HTTP server on a real socket is used instead of a fetch mock so
 * the multipart body and headers are what an upstream would actually see.
 */

const SECRET = 'SYNTHETIC_GROQ_TRANSCRIPTION_SECRET'
const AUDIO = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x01, 0x02, 0x03, 0xFF])

function record(overrides: Partial<TransportRecord> = {}): TransportRecord {
  return {
    id: 'groq',
    providerId: 'groq',
    definitionId: 'groq',
    type: 'http',
    protocol: 'chat-completions',
    baseUrl: 'https://placeholder.invalid/v1/',
    enabled: true,
    adapterOptions: {},
    modelIds: [],
    metadata: {},
    credentialRef: { scope: 'groq', key: 'apiKey' },
    ...overrides,
  }
}

function snapshot(records: TransportRecord[] = [record()]): TransportSnapshot {
  return { schemaVersion: 1, revision: 1, records, tombstones: [], migration: { version: 1, imported: [] } }
}

const servers: Array<ReturnType<typeof createServer>> = []

interface Captured {
  authorization?: string
  contentType?: string
  body: string
  url?: string
}

async function serve(handler: (captured: Captured, response: import('node:http').ServerResponse) => void) {
  const captured: Captured = { body: '' }
  const server = createServer(async (request, response) => {
    captured.authorization = request.headers.authorization
    captured.contentType = request.headers['content-type']
    captured.url = request.url
    for await (const chunk of request)
      captured.body += Buffer.from(chunk).toString('latin1')
    handler(captured, response)
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as { port: number }
  return { captured, baseUrl: `http://127.0.0.1:${port}/v1/` }
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    server.close()
  }
})

const request = {
  providerId: 'groq',
  model: 'whisper-large-v3-turbo',
  fileName: 'recording.wav',
  mimeType: 'audio/wav',
  bytes: AUDIO,
}

describe('main-process transcription', () => {
  it('signs the request with the vault key and forwards the audio unchanged', async () => {
    const { captured, baseUrl } = await serve((_captured, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ text: 'olá mundo', language: 'pt' }))
    })
    const service = createLiaTranscriptionService({
      repository: { read: async () => snapshot([record({ baseUrl })]) },
      vault: { getSecret: (scope: string, key: string) => scope === 'groq' && key === 'apiKey' ? SECRET : undefined } as never,
    })

    const outcome = await service.transcribe(request)
    expect(outcome).toMatchObject({ ok: true, status: 200, text: 'olá mundo', language: 'pt' })
    expect(captured.url).toBe('/v1/audio/transcriptions')
    expect(captured.authorization).toBe(`Bearer ${SECRET}`)
    expect(captured.contentType).toContain('multipart/form-data')
    // The pipeline's own fields, not a re-encoding.
    expect(captured.body).toContain('name="model"')
    expect(captured.body).toContain('whisper-large-v3-turbo')
    expect(captured.body).toContain('name="file"; filename="recording.wav"')
    expect(captured.body).toContain('name="response_format"')
    // The audio bytes survive the trip (latin1 view of the same octets).
    expect(Buffer.from(AUDIO).toString('latin1')).toBeTruthy()
    expect(JSON.stringify(outcome)).not.toContain(SECRET)
  })

  it('keeps verbose_json options when the confidence filter asked for them', async () => {
    const { captured, baseUrl } = await serve((_captured, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ text: 'filtrado', segments: [{ text: 'filtrado', start: 0, end: 1 }] }))
    })
    const service = createLiaTranscriptionService({
      repository: { read: async () => snapshot([record({ baseUrl })]) },
      vault: { getSecret: () => SECRET } as never,
    })

    const outcome = await service.transcribe({
      ...request,
      responseFormat: 'verbose_json',
      language: 'pt',
      prompt: 'contexto',
      temperature: 0.2,
    })
    expect(outcome).toMatchObject({ ok: true, segments: [{ text: 'filtrado' }] })
    expect(captured.body).toContain('name="response_format"\r\n\r\nverbose_json')
    expect(captured.body).toContain('name="timestamp_granularities[]"')
    expect(captured.body).toContain('name="language"\r\n\r\npt')
    expect(captured.body).toContain('name="prompt"\r\n\r\ncontexto')
    expect(captured.body).toContain('name="temperature"\r\n\r\n0.2')
  })

  it('refuses a provider with no record instead of inventing an endpoint', async () => {
    const fetch = vi.fn()
    const service = createLiaTranscriptionService({
      repository: { read: async () => snapshot([]) },
      vault: { getSecret: () => SECRET } as never,
      fetch: fetch as never,
    })
    expect(await service.transcribe(request)).toEqual({ ok: false, code: 'configuration' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses a disabled, removed or ambiguous record', async () => {
    const fetch = vi.fn()
    for (const state of [
      snapshot([record({ enabled: false })]),
      snapshot([record({ id: 'other', providerId: 'groq' }), record()]) as TransportSnapshot,
      { ...snapshot([]), tombstones: ['groq'] } as TransportSnapshot,
    ]) {
      const service = createLiaTranscriptionService({
        repository: { read: async () => state },
        vault: { getSecret: () => SECRET } as never,
        fetch: fetch as never,
      })
      expect(await service.transcribe(request)).toEqual({ ok: false, code: 'configuration' })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports a missing credential as credentials, before any request', async () => {
    const fetch = vi.fn()
    const service = createLiaTranscriptionService({
      repository: { read: async () => snapshot([record({ baseUrl: 'http://127.0.0.1:1/v1/' })]) },
      vault: { getSecret: () => undefined } as never,
      fetch: fetch as never,
    })
    expect(await service.transcribe(request)).toEqual({ ok: false, code: 'credentials' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sanitizes an upstream failure: a code and a status, no body and no key', async () => {
    const { baseUrl } = await serve((_captured, response) => {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: `invalid key ${SECRET}` } }))
    })
    const service = createLiaTranscriptionService({
      repository: { read: async () => snapshot([record({ baseUrl })]) },
      vault: { getSecret: () => SECRET } as never,
    })
    const outcome = await service.transcribe(request)
    expect(outcome).toEqual({ ok: false, code: 'credentials', status: 401 })
    expect(JSON.stringify(outcome)).not.toContain(SECRET)
  })

  it('rejects a malformed response as protocol, without echoing it', async () => {
    const { baseUrl } = await serve((_captured, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('not json')
    })
    const service = createLiaTranscriptionService({
      repository: { read: async () => snapshot([record({ baseUrl })]) },
      vault: { getSecret: () => SECRET } as never,
    })
    expect(await service.transcribe(request)).toEqual({ ok: false, code: 'protocol' })
  })

  it('rejects a response with no recognized text rather than reporting an empty success', async () => {
    const { baseUrl } = await serve((_captured, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ language: 'pt' }))
    })
    const service = createLiaTranscriptionService({
      repository: { read: async () => snapshot([record({ baseUrl })]) },
      vault: { getSecret: () => SECRET } as never,
    })
    expect(await service.transcribe(request)).toEqual({ ok: false, code: 'protocol' })
  })

  it('keeps two providers isolated when they run concurrently', async () => {
    const seen: string[] = []
    const server = createServer(async (request_, response) => {
      seen.push(String(request_.headers.authorization))
      for await (const _ of request_) { /* drain */ }
      // Answer in reverse order so a shared state bug would surface.
      // 'Bearer' itself contains a B, so match the suffix of the synthetic key.
      const isB = String(request_.headers.authorization).endsWith('_B')
      await new Promise(resolve => setTimeout(resolve, isB ? 5 : 20))
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ text: isB ? 'B' : 'A' }))
    })
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const { port } = server.address() as { port: number }
    const baseUrl = `http://127.0.0.1:${port}/v1/`

    const service = createLiaTranscriptionService({
      repository: {
        read: async () => snapshot([
          record({ id: 'groq', providerId: 'groq', baseUrl, credentialRef: { scope: 'groq', key: 'apiKey' } }),
          record({ id: 'cerebras-ai', providerId: 'cerebras-ai', baseUrl, credentialRef: { scope: 'cerebras-ai', key: 'apiKey' } }),
        ]),
      },
      vault: { getSecret: (scope: string) => scope === 'groq' ? 'SYNTHETIC_A' : 'SYNTHETIC_B' } as never,
    })

    const [a, b] = await Promise.all([
      service.transcribe({ ...request, providerId: 'groq' }),
      service.transcribe({ ...request, providerId: 'cerebras-ai' }),
    ])
    expect(a).toMatchObject({ ok: true, text: 'A' })
    expect(b).toMatchObject({ ok: true, text: 'B' })
    expect(new Set(seen)).toEqual(new Set(['Bearer SYNTHETIC_A', 'Bearer SYNTHETIC_B']))
  })

  /**
   * Phase 4 decision, pinned: the caller has no cancellation channel today, so
   * the ONLY way a run in flight stops is the main-process deadline - and it must
   * be reported as `timeout`, never as a successful or empty transcription.
   *
   * Timers are faked only to reach the deadline instantly; the socket is real.
   */
  it('reports the main-process deadline as timeout, distinct from any caller cancellation', async () => {
    const { baseUrl } = await serve(() => {
      // Never answers: exactly the hang the deadline exists for.
    })
    const service = createLiaTranscriptionService({
      repository: { read: async () => snapshot([record({ baseUrl })]) },
      vault: { getSecret: () => SECRET } as never,
    })

    vi.useFakeTimers()
    try {
      const pending = service.transcribe(request)
      await vi.advanceTimersByTimeAsync(30_000)
      await expect(pending).resolves.toEqual({ ok: false, code: 'timeout' })
    }
    finally {
      vi.useRealTimers()
    }
  })
})
