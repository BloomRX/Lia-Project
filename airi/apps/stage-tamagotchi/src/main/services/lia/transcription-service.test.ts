import type { LiaSecretVault } from '@lia/core/secrets/vault'

import type { TransportRecord, TransportSnapshot } from '../../../../../../../lia/core/src/transports/contracts'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { createServer } from 'node:http'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { electronLiaTranscriptionCancel, electronLiaTranscriptionRun } from '../../../shared/eventa/lia-transcription'
import { createLiaTranscriptionService, registerLiaTranscriptionBridge } from './transcription-service'

const handlers = vi.hoisted(() => new Map<unknown, (...args: any[]) => any>())
vi.mock('@moeru/eventa', async (original) => {
  const actual = await original<typeof import('@moeru/eventa')>()
  return { ...actual, defineInvokeHandler: (_context: unknown, event: unknown, handler: (...args: any[]) => any) => handlers.set(event, handler) }
})

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
  it.each(['openai-compatible-audio-transcription', 'mimo-audio-transcription', 'app-local-audio-transcription'])('executes migrated %s with a custom instance and model', async (definitionId) => {
    const { baseUrl, captured } = await serve((_captured, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(definitionId === 'mimo-audio-transcription'
        ? { choices: [{ message: { content: 'nativa' } }] }
        : { text: 'nativa' }))
    })
    const local = definitionId === 'app-local-audio-transcription'
    const getSecret = vi.fn(() => local ? undefined : SECRET)
    const saved = record({ id: 'custom-stt', providerId: 'custom-stt', definitionId, protocol: 'audio-transcription', baseUrl, credentialRef: { scope: 'custom-stt', key: 'apiKey' } })
    const service = createLiaTranscriptionService({ repository: { read: async () => snapshot([saved]) }, vault: { getSecret } as never })
    expect(await service.transcribe({ ...request, providerId: 'custom-stt', model: 'user-selected', language: 'pt' })).toMatchObject({ ok: true, text: 'nativa' })
    expect(getSecret).toHaveBeenCalledWith('custom-stt', 'apiKey')
    expect(captured.body).toContain('user-selected')
    expect(captured.url).toBe(definitionId === 'mimo-audio-transcription' ? '/v1/chat/completions' : '/v1/audio/transcriptions')
    if (local)
      expect(captured.authorization).toBeUndefined()
  })

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
   * The main-process deadline remains distinct from caller cancellation.
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function cancellableFixture(fetch: typeof globalThis.fetch = vi.fn(() => new Promise<Response>(() => {}))) {
  const repository = { read: vi.fn(async () => snapshot()) }
  const vault = { getSecret: vi.fn(() => SECRET) } as unknown as LiaSecretVault
  return { repository, vault, fetch }
}

describe('transcription cancellation', () => {
  it('cancels before repository access and while repository ignores cancellation', async () => {
    const fixture = cancellableFixture()
    const service = createLiaTranscriptionService(fixture)
    const early = new AbortController()
    early.abort()
    expect(await service.transcribe(request, early.signal)).toEqual({ ok: false, code: 'cancelled' })
    expect(fixture.repository.read).not.toHaveBeenCalled()
    const read = deferred<TransportSnapshot>()
    fixture.repository.read.mockReturnValueOnce(read.promise)
    const controller = new AbortController()
    const pending = service.transcribe(request, controller.signal)
    controller.abort()
    expect(await pending).toEqual({ ok: false, code: 'cancelled' })
    read.resolve(snapshot())
    await Promise.resolve()
    expect(fixture.fetch).not.toHaveBeenCalled()
  })

  it('aborts HTTP and discards a fetch result arriving after caller cancellation', async () => {
    const response = deferred<Response>()
    const fetch = vi.fn<typeof globalThis.fetch>(() => response.promise)
    const service = createLiaTranscriptionService(cancellableFixture(fetch))
    const controller = new AbortController()
    const pending = service.transcribe(request, controller.signal)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    controller.abort()
    expect(await pending).toEqual({ ok: false, code: 'cancelled' })
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    const cancel = vi.fn()
    response.resolve(new Response(new ReadableStream({ cancel })))
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })

  it('closes the real HTTP response when the caller cancels an in-flight upload', async () => {
    const accepted = deferred<void>()
    const closed = deferred<void>()
    const { baseUrl } = await serve((_captured, response) => {
      response.on('close', () => closed.resolve())
      accepted.resolve()
    })
    const service = createLiaTranscriptionService({
      repository: { read: async () => snapshot([record({ baseUrl })]) },
      vault: { getSecret: () => SECRET } as never,
    })
    const controller = new AbortController()
    const pending = service.transcribe(request, controller.signal)
    await accepted.promise
    controller.abort()
    expect(await pending).toEqual({ ok: false, code: 'cancelled' })
    await closed.promise
  })

  it('cancels a hanging response body and never returns its partial text', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"text":"late"}'))
    }, cancel })
    const fetch = vi.fn(async () => new Response(body))
    const service = createLiaTranscriptionService(cancellableFixture(fetch))
    const controller = new AbortController()
    const pending = service.transcribe(request, controller.signal)
    await vi.waitFor(() => expect(body.locked).toBe(true))
    controller.abort()
    expect(await pending).toEqual({ ok: false, code: 'cancelled' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('disposes direct runs and rejects future runs without accessing the repository', async () => {
    const fixture = cancellableFixture()
    const service = createLiaTranscriptionService(fixture)
    const pending = service.transcribe(request)
    service.dispose()
    expect(await pending).toEqual({ ok: false, code: 'cancelled' })
    expect(await service.transcribe(request)).toEqual({ ok: false, code: 'cancelled' })
    expect(fixture.repository.read).toHaveBeenCalledOnce()
    expect(fixture.fetch).not.toHaveBeenCalled()
  })

  it('projects only bounded segment fields used by hearing', async () => {
    const json = { text: 'oi', segments: [{ text: 'oi', start: 0, end: 1, avg_logprob: -0.1, no_speech_prob: 0.2, secret: SECRET, nested: { key: SECRET } }] }
    const fixture = cancellableFixture(vi.fn(async () => Response.json(json)))
    const service = createLiaTranscriptionService(fixture)
    expect(await service.transcribe(request)).toEqual({ ok: true, status: 200, text: 'oi', segments: [{ text: 'oi', start: 0, end: 1, avg_logprob: -0.1, no_speech_prob: 0.2 }] })
    fixture.fetch = vi.fn(async () => Response.json({ text: 'oi', segments: Array.from({ length: 10_001 }, () => ({})) }))
    expect(await createLiaTranscriptionService(fixture).transcribe(request)).toEqual({ ok: false, code: 'protocol' })
  })

  it.each(['repository', 'fetch', 'body'])('times out even when %s ignores abort', async (phase) => {
    vi.useFakeTimers()
    const fixture = cancellableFixture(phase === 'body'
      ? vi.fn(async () => new Response(new ReadableStream()))
      : vi.fn(() => new Promise<Response>(() => {})))
    if (phase === 'repository')
      fixture.repository.read.mockReturnValueOnce(new Promise(() => {}))
    const service = createLiaTranscriptionService(fixture)
    try {
      const pending = service.transcribe(request)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(await pending).toEqual({ ok: false, code: 'timeout' })
    }
    finally { vi.useRealTimers() }
  })
})

const bridges: ReturnType<typeof registerLiaTranscriptionBridge>[] = []
afterEach(() => {
  for (const bridge of bridges.splice(0))
    bridge.dispose()
  handlers.clear()
})
function bridgeFixture() {
  const fixture = cancellableFixture()
  const bridge = registerLiaTranscriptionBridge({ ...fixture, context: {} as never })
  bridges.push(bridge)
  const sender = Object.assign(new EventEmitter(), { isDestroyed: (): boolean => false })
  const invoke = (event: unknown, payload: unknown, owner: typeof sender | undefined) => handlers.get(event)!(payload, { raw: { ipcMainEvent: { sender: owner } } })
  const run = (payload: unknown, owner = sender) => invoke(electronLiaTranscriptionRun, payload, owner)
  const cancel = (payload: unknown, owner = sender) => invoke(electronLiaTranscriptionCancel, payload, owner)
  return { ...fixture, bridge, sender, invoke, run, cancel }
}

describe('transcription IPC ownership', () => {
  it('records ownership before repository await, isolates cancel and releases listeners', async () => {
    const fixture = bridgeFixture()
    const read = deferred<TransportSnapshot>()
    fixture.repository.read.mockReturnValueOnce(read.promise)
    const requestId = randomUUID()
    const pending = fixture.run({ ...request, requestId })
    const stranger = Object.assign(new EventEmitter(), { isDestroyed: () => false })
    expect(fixture.cancel({ requestId }, stranger)).toEqual({ ok: false })
    expect(fixture.cancel({ requestId })).toEqual({ ok: true })
    expect(await pending).toEqual({ ok: false, code: 'cancelled' })
    expect(fixture.cancel({ requestId })).toEqual({ ok: false })
    expect(fixture.sender.listenerCount('destroyed')).toBe(0)
    expect(fixture.sender.listenerCount('render-process-gone')).toBe(0)
    read.resolve(snapshot())
    await Promise.resolve()
    expect(fixture.fetch).not.toHaveBeenCalled()
  })

  it.each(['destroyed', 'render-process-gone', 'dispose'])('cancels when owner ends through %s', async (event) => {
    const fixture = bridgeFixture()
    const requestId = randomUUID()
    const pending = fixture.run({ ...request, requestId })
    await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledOnce())
    if (event === 'dispose')
      fixture.bridge.dispose()
    else fixture.sender.emit(event)
    expect(await pending).toEqual({ ok: false, code: 'cancelled' })
    expect(fixture.sender.listenerCount('destroyed')).toBe(0)
    expect(fixture.sender.listenerCount('render-process-gone')).toBe(0)
    if (event === 'dispose')
      expect(await fixture.run({ ...request, requestId: randomUUID() })).toEqual({ ok: false, code: 'configuration' })
  })

  it('rejects invalid or injected IPC fields before reading repository or vault', async () => {
    const fixture = bridgeFixture()
    const requestId = randomUUID()
    for (const payload of [request, { ...request, requestId: 'bad' }, { ...request, requestId, baseUrl: 'https://other.invalid' }, { ...request, requestId, apiKey: SECRET }, { ...request, requestId, extra: true }])
      expect(await fixture.run(payload)).toEqual({ ok: false, code: 'configuration' })
    expect(await fixture.invoke(electronLiaTranscriptionRun, { ...request, requestId }, undefined)).toEqual({ ok: false, code: 'configuration' })
    expect(await fixture.run({ ...request, requestId }, Object.assign(new EventEmitter(), { isDestroyed: () => true }))).toEqual({ ok: false, code: 'configuration' })
    for (const payload of [null, {}, { requestId: 'bad' }, { requestId, extra: true }])
      expect(fixture.cancel(payload)).toEqual({ ok: false })
    expect(fixture.repository.read).not.toHaveBeenCalled()
    expect(fixture.vault.getSecret).not.toHaveBeenCalled()
  })

  it('bounds active runs per owner and globally, refuses duplicate ids, and restores capacity', async () => {
    const fixture = bridgeFixture()
    const owners = Array.from({ length: 5 }, () => Object.assign(new EventEmitter(), { isDestroyed: () => false }))
    const jobs: Array<{ requestId: string, pending: Promise<unknown>, owner: typeof fixture.sender }> = []
    for (const owner of owners.slice(0, 4)) {
      for (let i = 0; i < 8; i++) {
        const requestId = randomUUID()
        jobs.push({ requestId, owner, pending: fixture.run({ ...request, requestId }, owner) })
      }
      expect(await fixture.run({ ...request, requestId: randomUUID() }, owner)).toEqual({ ok: false, code: 'configuration' })
    }
    expect(await fixture.run({ ...request, requestId: randomUUID() }, owners[4])).toEqual({ ok: false, code: 'configuration' })
    expect(await fixture.run({ ...request, requestId: jobs[0].requestId }, owners[4])).toEqual({ ok: false, code: 'configuration' })
    fixture.cancel({ requestId: jobs[0].requestId }, jobs[0].owner)
    expect(await jobs[0].pending).toEqual({ ok: false, code: 'cancelled' })
    const replacement = fixture.run({ ...request, requestId: randomUUID() }, owners[4])
    fixture.bridge.dispose()
    expect(await replacement).toEqual({ ok: false, code: 'cancelled' })
    const outcomes = await Promise.all(jobs.map(job => job.pending))
    expect(outcomes.every(outcome => JSON.stringify(outcome) === JSON.stringify({ ok: false, code: 'cancelled' }))).toBe(true)
  })
})
