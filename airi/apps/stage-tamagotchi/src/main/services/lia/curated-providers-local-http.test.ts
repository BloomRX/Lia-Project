import type { TransportRecord, TransportSnapshot } from '../../../../../../../lia/core/src/transports/contracts'

import { Buffer } from 'node:buffer'
import { EventEmitter, once } from 'node:events'
import { createServer } from 'node:http'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CURATED_CHAT_PROVIDER_IDS } from '../../../shared/lia/provider-catalog'
import { createLiaTransportExecutionService } from './transport-execution-service'

/**
 * The ten curated providers, executed by the REAL main-process service against a
 * real HTTP server on a real socket.
 *
 * What is real here: `createLiaTransportExecutionService`, the `lia/core`
 * registry and runtime inside it, the Lia-owned header wrapper, the request body,
 * the multipart/SSE handling, cancellation, deadlines and the byte pulls.
 *
 * What is a stand-in: the Electron `WebContents` owner (an EventEmitter) and the
 * transport repository/vault (in-memory maps). Those are process plumbing, not
 * policy.
 *
 * What this is NOT: an Electron gate. It proves the provider set executes and
 * that each credential is spent only on its own endpoint, but it does not prove
 * Electron wiring, preload isolation, window lifecycle or `safeStorage`. That
 * gate is `scripts/provider-runtime-electron/gate.test.mjs` and requires a real
 * Electron binary.
 */

const SECRETS = Object.fromEntries(CURATED_CHAT_PROVIDER_IDS.map((id, index) => [id, `SYNTHETIC_${index}_${id}`]))
const MODELS = Object.fromEntries(CURATED_CHAT_PROVIDER_IDS.map(id => [id, `model/${id}:Q4`]))
/** Providers whose credential is optional and therefore not seeded. */
const KEYLESS = new Set(['lm-studio', 'ollama'])

interface Captured {
  provider: string
  url: string
  authorization?: string
  title?: string
  model?: string
  stream?: boolean
  closed: boolean
}

const servers: Array<ReturnType<typeof createServer>> = []
const services: Array<ReturnType<typeof createLiaTransportExecutionService>> = []

function owner() {
  return Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false }) as never
}

function record(providerId: string, baseUrl: string): TransportRecord {
  return {
    id: providerId,
    providerId,
    definitionId: providerId,
    type: 'http',
    protocol: 'chat-completions',
    baseUrl,
    enabled: true,
    adapterOptions: {},
    modelIds: [MODELS[providerId]],
    metadata: {},
    credentialRef: { scope: providerId, key: 'apiKey' },
  }
}

function snapshot(records: TransportRecord[]): TransportSnapshot {
  return { schemaVersion: 1, revision: 1, records, tombstones: [], migration: { version: 1, imported: [] } }
}

/**
 * One local server that answers per provider, with SSE for `stream: true` and a
 * deliberately hostile error route.
 *
 * It records only what an upstream would observe: the path, the bearer (so a
 * test can prove WHICH credential was spent), and the model. No secret is ever
 * printed.
 */
async function serve(captured: Captured[]) {
  const server = createServer(async (request, response) => {
    const [, provider = ''] = String(request.url).split('/')
    const entry: Captured = {
      provider,
      url: String(request.url),
      authorization: request.headers.authorization,
      title: request.headers['x-openrouter-title'] as string | undefined,
      closed: false,
    }
    captured.push(entry)
    response.on('close', () => {
      entry.closed = true
    })
    let body = ''
    for await (const chunk of request)
      body += chunk.toString()
    entry.model = body ? (JSON.parse(body) as { model?: string }).model : undefined
    entry.stream = body ? Boolean((JSON.parse(body) as { stream?: boolean }).stream) : false

    const expected = SECRETS[provider as keyof typeof SECRETS]
    const authorized = KEYLESS.has(provider) ? !entry.authorization : entry.authorization === `Bearer ${expected}`
    if (!authorized) {
      response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'denied' } }))
      return
    }
    if (String(request.url).includes('/http-error/')) {
      response.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'upstream detail' } }))
      return
    }
    // A route that never answers, so cancellation and the deadline can be observed.
    if (String(request.url).includes('/hang/'))
      return
    if (!entry.stream) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `${provider} ok` }, finish_reason: 'stop' }] }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `${provider} ` }, finish_reason: null }] })}\n\n`)
    // Leave a hanging stream for the cancellation routes.
    if (String(request.url).includes('/cancel/'))
      return
    response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] })}\n\ndata: [DONE]\n\n`)
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as { port: number }
  return `http://127.0.0.1:${port}`
}

function service(records: TransportRecord[], useDirectFetch = true) {
  // Only keyed providers have a stored secret; a local provider with one would
  // send an `Authorization` header the real application never sends.
  const secrets = new Map(Object.entries(SECRETS).filter(([id]) => !KEYLESS.has(id)))
  const instance = createLiaTransportExecutionService({
    repository: { read: async () => snapshot(records) },
    // Mirrors `canRendererReadLegacySecret`: every curated scope is readable BY
    // MAIN, and by nothing else. The renderer never sees this map.
    vault: { getSecret: (scope: string) => secrets.get(scope) } as never,
    ...(useDirectFetch ? {} : {}),
  })
  services.push(instance)
  return instance
}

async function collect(target: ReturnType<typeof createLiaTransportExecutionService>, who: ReturnType<typeof owner>, id: string) {
  const chunks: number[] = []
  while (true) {
    const result = await target.pull(who, { id, action: 'read' })
    if (!result.ok)
      return { bytes: Buffer.from(chunks).toString('utf8'), failure: result }
    if (result.bytes?.length)
      chunks.push(...result.bytes)
    if (result.done)
      return { bytes: Buffer.from(chunks).toString('utf8'), failure: undefined }
  }
}

async function waitFor(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 5000
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for: ${label}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

async function run(target: ReturnType<typeof createLiaTransportExecutionService>, who: ReturnType<typeof owner>, providerId: string, extra: Record<string, unknown> = {}) {
  const start = target.start(who, {
    providerId,
    operation: 'chat',
    body: { model: MODELS[providerId], messages: [{ role: 'user', content: 'fixture' }], ...extra },
  })
  expect(start.ok).toBe(true)
  if (!start.ok)
    throw new Error('expected a job')
  return start.id
}

afterEach(() => {
  services.splice(0).forEach(instance => instance.dispose())
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    server.close()
  }
})

describe('curated providers executed by main against a local server', () => {
  it('covers exactly the ten curated ids', () => {
    expect(CURATED_CHAT_PROVIDER_IDS).toHaveLength(10)
    expect(Object.keys(SECRETS).sort()).toEqual([...CURATED_CHAT_PROVIDER_IDS].sort())
  })

  it.each(CURATED_CHAT_PROVIDER_IDS)('executes %s with its own credential on its own endpoint', async (providerId) => {
    const captured: Captured[] = []
    const base = await serve(captured)
    const target = service(CURATED_CHAT_PROVIDER_IDS.map(id => record(id, `${base}/${id}/v1/`)))
    const who = owner()

    const id = await run(target, who, providerId)
    const { bytes, failure } = await collect(target, who, id)

    expect(failure).toBeUndefined()
    expect(bytes).toContain(`${providerId} ok`)
    expect(captured).toHaveLength(1)
    const [request] = captured
    expect(request.provider).toBe(providerId)
    expect(request.url).toBe(`/${providerId}/v1/chat/completions`)
    expect(request.model).toBe(MODELS[providerId])
    expect(request.closed).toBe(true)
    // The credential spent is THIS provider's, and no other's.
    if (KEYLESS.has(providerId))
      expect(request.authorization).toBeUndefined()
    else
      expect(request.authorization).toBe(`Bearer ${SECRETS[providerId as keyof typeof SECRETS]}`)
  })

  it('adds the Lia header only for OpenRouter and never an AIRI identity', async () => {
    const captured: Captured[] = []
    const base = await serve(captured)
    const target = service(CURATED_CHAT_PROVIDER_IDS.map(id => record(id, `${base}/${id}/v1/`)))
    for (const providerId of ['openrouter-ai', 'openai']) {
      const who = owner()
      const id = await run(target, who, providerId)
      await collect(target, who, id)
    }
    const [openrouter, openai] = captured
    expect(openrouter.title).toBe('Lia')
    expect(openai.title).toBeUndefined()
    expect(JSON.stringify(captured)).not.toMatch(/moeru|Project AIRI/i)
  })

  it('streams the whole body for every provider', async () => {
    const captured: Captured[] = []
    const base = await serve(captured)
    const target = service(CURATED_CHAT_PROVIDER_IDS.map(id => record(id, `${base}/${id}/v1/`)))
    for (const providerId of CURATED_CHAT_PROVIDER_IDS) {
      const who = owner()
      const id = await run(target, who, providerId, { stream: true })
      const head = await target.pull(who, { id, action: 'head' })
      expect(head).toMatchObject({ ok: true, status: 200, contentType: 'text/event-stream' })
      const { bytes } = await collect(target, who, id)
      expect(bytes).toContain(`${providerId} `)
      expect(bytes).toContain('[DONE]')
    }
    expect(captured.filter(entry => entry.stream)).toHaveLength(10)
  })

  it('cancels mid-stream and releases the socket', async () => {
    const captured: Captured[] = []
    const base = await serve(captured)
    const target = service([record('groq', `${base}/groq/cancel/v1/`)])
    const who = owner()

    const id = await run(target, who, 'groq', { stream: true })
    const head = await target.pull(who, { id, action: 'head' })
    expect(head).toMatchObject({ ok: true, status: 200 })
    await target.pull(who, { id, action: 'read' })
    expect(target.cancel(who, { id })).toBe(true)

    expect(await target.pull(who, { id, action: 'read' })).toEqual({ ok: false, code: 'cancelled' })
    await waitFor(() => captured[0]?.closed === true, 'the cancelled socket')
    expect(captured[0].closed).toBe(true)
  })

  it('sanitizes an invalid HTTP response: a code, a status, no upstream body', async () => {
    const captured: Captured[] = []
    const base = await serve(captured)
    const target = service([record('anthropic', `${base}/anthropic/http-error/v1/`)])
    const who = owner()

    const id = await run(target, who, 'anthropic')
    const head = await target.pull(who, { id, action: 'head' })
    expect(head).toEqual({ ok: false, code: 'http', status: 503 })
    expect(JSON.stringify(head)).not.toContain('upstream detail')
    expect(JSON.stringify(head)).not.toContain(SECRETS.anthropic)
  })

  it('reports a wrong credential as credentials, without placing it in the error', async () => {
    const captured: Captured[] = []
    const base = await serve(captured)
    // A record that names `groq` but points at the cerebras route: the server
    // expects cerebras' secret, so the request is rejected.
    const target = service([record('groq', `${base}/cerebras-ai/v1/`)])
    const who = owner()

    const id = await run(target, who, 'groq')
    const head = await target.pull(who, { id, action: 'head' })
    expect(head).toEqual({ ok: false, code: 'credentials', status: 401 })
    // The failure names the class, never the value — the capture above holds the
    // header because the FIXTURE recorded it, which is not what a caller sees.
    expect(JSON.stringify(head)).not.toContain(SECRETS.groq)
    expect(captured[0].provider).toBe('cerebras-ai')
  })

  it('keeps concurrent requests on different providers isolated', async () => {
    const captured: Captured[] = []
    const base = await serve(captured)
    const target = service(CURATED_CHAT_PROVIDER_IDS.map(id => record(id, `${base}/${id}/v1/`)))
    const who = owner()

    const picks = ['openai', 'groq', 'anthropic', 'openrouter-ai', 'ollama']
    const jobs = await Promise.all(picks.map(providerId => run(target, who, providerId)))
    const bodies = await Promise.all(jobs.map(id => collect(target, who, id)))
    for (const [index, providerId] of picks.entries())
      expect(bodies[index].bytes).toContain(`${providerId} ok`)
    // Every request was authorized with the credential OF ITS OWN provider.
    const seen = captured.map(entry => `${entry.provider}:${entry.authorization ?? 'none'}`).sort()
    expect(seen).toEqual(picks.map(providerId => `${providerId}:${KEYLESS.has(providerId) ? 'none' : `Bearer ${SECRETS[providerId as keyof typeof SECRETS]}`}`).sort())
  })

  it('tears every in-flight job down when the execution port is disposed', async () => {
    const captured: Captured[] = []
    const base = await serve(captured)
    const target = service([record('mistral-ai', `${base}/mistral-ai/hang/v1/`), record('xai', `${base}/xai/hang/v1/`)])
    const who = owner()

    const first = await run(target, who, 'mistral-ai')
    const second = await run(target, who, 'xai')
    // Both requests are on the wire and will never answer on their own.
    await waitFor(() => captured.length === 2, 'both hanging requests')
    expect(target.activeJobCount).toBe(2)

    target.dispose()
    expect(target.activeJobCount).toBe(0)
    expect(await target.pull(who, { id: first, action: 'read' })).toEqual({ ok: false, code: 'cancelled' })
    expect(await target.pull(who, { id: second, action: 'read' })).toEqual({ ok: false, code: 'cancelled' })
    // Both sockets are released: nothing survives the port that owned them.
    await waitFor(() => captured.filter(entry => entry.closed).length === 2, 'both sockets released')
    expect(captured.filter(entry => entry.closed)).toHaveLength(2)
  })

  it('cancels a provider job when its window is destroyed', async () => {
    const captured: Captured[] = []
    const base = await serve(captured)
    const target = service([record('cerebras-ai', `${base}/cerebras-ai/hang/v1/`)])
    const who = owner()

    const id = await run(target, who, 'cerebras-ai')
    await waitFor(() => captured.length === 1, 'the hanging request')
    expect(target.activeJobCount).toBe(1)
    ;(who as unknown as EventEmitter).emit('destroyed')
    expect(target.activeJobCount).toBe(0)
    expect(await target.pull(who, { id, action: 'read' })).toEqual({ ok: false, code: 'cancelled' })
    const deadline = Date.now() + 5000
    while (!captured[0]?.closed && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 20))
    expect(captured[0].closed).toBe(true)
  })

  it('rejects a disabled provider before touching the network or the vault', async () => {
    const captured: Captured[] = []
    const base = await serve(captured)
    const disabled = { ...record('xai', `${base}/xai/v1/`), enabled: false }
    const target = service([disabled])
    const who = owner()
    const id = await run(target, who, 'xai')
    expect(await target.pull(who, { id, action: 'head' })).toEqual({ ok: false, code: 'unknown-provider' })
    expect(captured).toHaveLength(0)
  })

  it('never logs or returns a credential from any of the ten', async () => {
    const captured: Captured[] = []
    const base = await serve(captured)
    const target = service(CURATED_CHAT_PROVIDER_IDS.map(id => record(id, `${base}/${id}/v1/`)))
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {})
    const results: string[] = []
    for (const providerId of CURATED_CHAT_PROVIDER_IDS) {
      const who = owner()
      const id = await run(target, who, providerId)
      results.push((await collect(target, who, id)).bytes)
    }
    const everything = JSON.stringify(results) + JSON.stringify(logs.mock.calls)
    for (const secret of Object.values(SECRETS))
      expect(everything).not.toContain(secret)
    logs.mockRestore()
  })
})
