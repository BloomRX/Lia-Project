import type { OidcHttpPort } from '../../../shared/eventa/lia-oidc-http'

import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'

import { createLiaSecretVault } from '@lia/core/secrets/vault'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createOidcHttpService } from './oidc-http'
import { createOidcSessionOwner } from './oidc-session'

const tokens = { access_token: 'SYNTHETIC_HTTP_ACCESS', refresh_token: 'SYNTHETIC_HTTP_REFRESH', id_token: 'SYNTHETIC_HTTP_ID', expires_in: 60 }
const chat = { id: 'chat-1', type: 'private', title: 'Example', createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z' }
const request = { kind: 'chat', body: { model: 'selected/model', stream: true, messages: [{ role: 'user', content: 'Hello' }] } }
const cleanup: (() => void | Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse())
    await dispose()
  vi.useRealTimers()
})

async function setup(transport: typeof fetch, origin = new URL('https://issuer.example'), exchange = tokens) {
  let disk: string | undefined
  const vault = createLiaSecretVault({
    filePath: `http-test-${crypto.randomUUID()}.json`,
    cipher: { available: () => true, encrypt: value => Buffer.from(value).reverse(), decrypt: value => Buffer.from(value).reverse().toString() },
    read: () => {
      if (disk === undefined)
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return disk
    },
    write: async (_, content) => { disk = content },
  })
  const refresh = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...tokens, access_token: 'ROTATED_HTTP_ACCESS' }))
  const owner = createOidcSessionOwner({ vault, origin, clientId: 'desktop', fetch: refresh })
  await owner.establish(exchange, new AbortController().signal, owner.beginLogin()!)
  const service = createOidcHttpService({ origin, session: owner, fetch: transport })
  cleanup.push(() => service.dispose())
  return { owner, refresh, service, port: service.forWindow(1) }
}

function open(port: OidcHttpPort, payload: unknown = request): string {
  const result = port.open(payload)
  expect(result.ok).toBe(true)
  if (!result.ok)
    throw new Error('Failed to start fixture')
  return result.id
}

async function collect(port: OidcHttpPort, id: string) {
  const chunks: number[] = []
  while (true) {
    const result = await port.pull(id)
    if (!result.ok)
      return { result, body: Buffer.from(chunks).toString() }
    chunks.push(...result.bytes)
    if (result.done)
      return { result, body: Buffer.from(chunks).toString() }
  }
}

describe('prepared Main OIDC HTTP ports', () => {
  it('preserves selected model and ordered SSE without returning tokens or response headers', async () => {
    const wire = 'data: {"choices":[{"delta":{"content":"Olá "}}]}\n\ndata: {"choices":[{"delta":{"content":"Lia"}}]}\n\ndata: [DONE]\n\n'
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(wire.slice(0, 24)))
        controller.enqueue(new TextEncoder().encode(wire.slice(24)))
        controller.close()
      },
    }), { headers: { 'Content-Type': 'text/event-stream', 'Set-Cookie': tokens.id_token, 'X-Private': tokens.refresh_token } }))
    const { port } = await setup(transport)
    const result = await collect(port, open(port))
    expect(result.body).toBe(wire)
    expect(result.result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC')
    expect(String(transport.mock.calls[0][0])).toBe('https://issuer.example/api/v1/openai/chat/completions')
    const init = transport.mock.calls[0][1]!
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${tokens.access_token}` })
    expect(JSON.parse(String(init.body))).toEqual(request.body)
    expect(init).toMatchObject({ redirect: 'error', credentials: 'omit' })
  })

  it.each([
    `data: {"delta":"${tokens.access_token}"}\n\n`,
    `data: {"delta":"${tokens.refresh_token.replace('S', '\\u0053')}"}\n\n`,
    'data: {"error":{"message":"PRIVATE_UPSTREAM_SENTINEL"}}\n\n',
    'data: {"delta":"incomplete"}',
  ])('rejects unsafe or incomplete SSE before publishing its event', async (wire) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } }))
    const { port } = await setup(transport)
    expect(await collect(port, open(port))).toEqual({ result: { ok: false, code: 'unavailable' }, body: '' })
  })

  it('projects sync metadata, strips secret fields and preserves idempotent create 409', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ chats: [{ ...chat, token: tokens.access_token }] }))
      .mockResolvedValueOnce(new Response('private conflict body', { status: 409 }))
      .mockResolvedValueOnce(Response.json({ chats: [chat] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const { port } = await setup(transport)
    expect(JSON.parse((await collect(port, open(port, { kind: 'list-chats' }))).body)).toEqual({ chats: [chat] })
    expect(JSON.parse((await collect(port, open(port, { kind: 'create-chat', chat: { id: chat.id } }))).body)).toEqual(chat)
    expect(JSON.parse((await collect(port, open(port, { kind: 'delete-chat', chatId: '../id?' }))).body)).toEqual({ ok: true })
    expect(String(transport.mock.calls[3][0])).toBe('https://issuer.example/api/v1/chats/..%2Fid%3F')
  })

  it.each(['sse', 'audio'])('blocks a private value split across %s chunks before any fragment escapes', async (kind) => {
    const first = tokens.refresh_token.slice(0, 10)
    const second = tokens.refresh_token.slice(10)
    const wire = kind === 'sse'
      ? [`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: first } }] })}\n\n`, ': keepalive\n\n', `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: second } }] })}\n\n`]
      : [first, second]
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        for (const chunk of wire)
          controller.enqueue(new TextEncoder().encode(chunk))
        controller.close()
      },
    }), { headers: { 'Content-Type': kind === 'sse' ? 'text/event-stream' : 'audio/mpeg' } }))
    const { port } = await setup(transport)
    const payload = kind === 'sse' ? request : { kind: 'speech', model: 'selected', voice: 'chosen', input: 'Olá' }
    expect(await collect(port, open(port, payload))).toEqual({ result: { ok: false, code: 'unavailable' }, body: '' })
  })

  it('preserves an innocent private-value prefix when the stream ends', async () => {
    const wire = 'data: {"choices":[{"delta":{"content":"S"}}]}\n\ndata: [DONE]\n\n'
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } }))
    const { port } = await setup(transport)
    expect((await collect(port, open(port))).body).toBe(wire)
  })

  it('checks escaped tool arguments across events before publishing any reconstructable fragment', async () => {
    const fragments = ['{"value":"\\u00', `53${tokens.access_token.slice(1, 10)}`, `${tokens.access_token.slice(10)}"}`]
    const wire = fragments.map(argumentsText => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: argumentsText } }] } }] })}\n\n`).join('')
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } }))
    const { port } = await setup(transport)
    expect(await collect(port, open(port))).toEqual({ result: { ok: false, code: 'unavailable' }, body: '' })
  })

  it('preserves ordinary tool arguments with escapes and Unicode', async () => {
    const fragments = ['{"query":"hello\\u0', '0e1 \\"', 'world\\""}']
    const wire = fragments.map(argumentsText => `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: argumentsText } }] } }] })}\n\n`).join('')
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } }))
    const { port } = await setup(transport)
    expect((await collect(port, open(port))).body).toBe(wire)
  })

  it('checks raw tool fragments when an access value itself contains a literal escape', async () => {
    const fragments = ['{"value":"SYNTHETIC_\\u00', '53_TOKEN"}']
    const wire = fragments.map(fragment => `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: fragment } }] } }] })}\n\n`).join('')
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } }))
    const { port } = await setup(transport, new URL('https://issuer.example'), { ...tokens, access_token: 'SYNTHETIC_\\u0053_TOKEN' })
    expect(await collect(port, open(port))).toEqual({ result: { ok: false, code: 'unavailable' }, body: '' })
  })

  it('rejects reflected secrets in public sync fields and hides failure bodies', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ chats: [{ ...chat, title: tokens.id_token }] }))
      .mockResolvedValueOnce(new Response('PRIVATE_UPSTREAM_SENTINEL', { status: 503 }))
    const { port } = await setup(transport)
    expect((await collect(port, open(port, { kind: 'list-chats' }))).result).toEqual({ ok: false, code: 'unavailable' })
    expect((await collect(port, open(port))).result).toEqual({ ok: false, code: 'unavailable', status: 503 })
  })

  it('rejects dot segments before constructing a chat deletion URL', async () => {
    const transport = vi.fn<typeof fetch>()
    const { port } = await setup(transport)
    for (const chatId of ['.', '..'])
      expect(port.open({ kind: 'delete-chat', chatId })).toEqual({ ok: false, code: 'invalid-request' })
    expect(transport).not.toHaveBeenCalled()
  })

  it('retains transcription fragments across snapshots for the delta-only text stream', async () => {
    const events = [
      { type: 'transcript.text.delta', delta: tokens.refresh_token.slice(0, 10) },
      { type: 'transcript.text.snapshot', text: 'texto revisado' },
      { type: 'transcript.text.done', delta: '' },
      { type: 'transcript.text.delta', delta: tokens.refresh_token.slice(10) },
    ]
    const wire = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } }))
    const { port } = await setup(transport)
    expect(await collect(port, open(port, { kind: 'transcription' }))).toEqual({ result: { ok: false, code: 'unavailable' }, body: '' })
  })

  it('renews on 401 before expiry and retries a read once, without replaying a mutation', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ chats: [chat] }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
    const { port, refresh } = await setup(transport)
    expect((await collect(port, open(port, { kind: 'list-chats' }))).result.ok).toBe(true)
    expect(transport.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer ROTATED_HTTP_ACCESS' })
    expect((await collect(port, open(port, { kind: 'create-chat', chat: { id: chat.id } }))).result).toEqual({ ok: false, code: 'unauthenticated', status: 401 })
    expect(transport).toHaveBeenCalledTimes(3)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['content', 'refusal'],
    ['reasoning', 'reasoning_content'],
  ])('checks combined chat fields %s and %s as the consumer reads them', async (firstField, secondField) => {
    const event = (index: number, field: string, value: string) => `data: ${JSON.stringify({ choices: [{ index, delta: { [field]: value } }] })}`
    const wire = `${event(0, firstField, tokens.access_token.slice(0, 10))}\r\r${event(1, secondField, tokens.access_token.slice(10))}\r\r`
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } }))
    const { port } = await setup(transport)
    expect(await collect(port, open(port))).toEqual({ result: { ok: false, code: 'unavailable' }, body: '' })
  })

  it('normalizes CRLF across network chunks without losing events', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        for (const chunk of ['data: {"choices":[{"delta":{"content":"Olá"}}]}\r', '\n\r', '\ndata: [DONE]\r\n\r', '\n'])
          controller.enqueue(new TextEncoder().encode(chunk))
        controller.close()
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } }))
    const { port } = await setup(transport)
    expect((await collect(port, open(port))).body).toBe('data: {"choices":[{"delta":{"content":"Olá"}}]}\n\ndata: [DONE]\n\n')
  })

  it('does not renew or replay an unauthorized read once its owner generation ends', async () => {
    const controller = new AbortController()
    const refreshAccess = vi.fn(async () => true)
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }))
    const service = createOidcHttpService({
      origin: new URL('https://issuer.example'),
      fetch: transport,
      session: {
        refreshAccess,
        async withAccess(_, action) {
          await action(tokens.access_token, controller.signal, () => false)
          controller.abort()
          return undefined
        },
      },
    })
    cleanup.push(() => service.dispose())
    const port = service.forWindow(1)
    expect((await collect(port, open(port, { kind: 'list-chats' }))).result).toEqual({ ok: false, code: 'cancelled' })
    expect(refreshAccess).not.toHaveBeenCalled()
    expect(transport).toHaveBeenCalledOnce()
  })

  it('cancels pending starts and closes late responses exactly once', async () => {
    const pending = Promise.withResolvers<Response>()
    const cancel = vi.fn()
    const transport = vi.fn<typeof fetch>().mockReturnValue(pending.promise)
    const { port } = await setup(transport)
    const id = open(port)
    const pull = port.pull(id)
    expect(port.cancel(id)).toBe(true)
    expect(port.cancel(id)).toBe(false)
    expect(await pull).toEqual({ ok: false, code: 'cancelled' })
    pending.resolve(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'text/event-stream' } }))
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })

  it('logout aborts active SSE and pending reads, and windows cannot reach each other', async () => {
    const cancel = vi.fn()
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'text/event-stream' } }))
    const { owner, service, port } = await setup(transport)
    const id = open(port)
    expect(await service.forWindow(2).pull(id)).toEqual({ ok: false, code: 'invalid-request' })
    expect(service.forWindow(2).cancel(id)).toBe(false)
    const pull = port.pull(id)
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce())
    await owner.logout()
    expect(await pull).toEqual({ ok: false, code: 'cancelled' })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    port.dispose()
    expect(port.open(request)).toEqual({ ok: false, code: 'cancelled' })
  })

  it('bounds operations, rejects transport controls and stops after deadline or global dispose', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Promise(() => {}))
    const { port, service } = await setup(transport)
    for (const payload of [{ ...request, token: 'arbitrary' }, { ...request, url: 'https://outside.test' }, { ...request, body: { ...request.body, headers: {} } }, { kind: 'transcription', headers: {} }])
      expect(port.open(payload)).toEqual({ ok: false, code: 'invalid-request' })
    expect(transport).not.toHaveBeenCalled()
    vi.useFakeTimers()
    const ids = Array.from({ length: 4 }, () => open(port))
    expect(port.open(request)).toEqual({ ok: false, code: 'busy' })
    const pull = port.pull(ids[0])
    await vi.advanceTimersByTimeAsync(120_000)
    expect(await pull).toEqual({ ok: false, code: 'timeout' })
    service.dispose()
    expect(service.forWindow(3).open(request)).toEqual({ ok: false, code: 'cancelled' })
  })

  it('streams bounded HTTP speech bytes and cancels for barge-in', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } }))
    const { port } = await setup(transport)
    const id = open(port, { kind: 'speech', model: 'voice/model', voice: 'chosen', input: 'Olá', speed: 1.25, responseFormat: 'mp3', extraBody: { audio: { rate: 1 } } })
    expect(await port.pull(id)).toMatchObject({ ok: true, contentType: 'audio/mpeg', bytes: [1, 2, 3] })
    expect(port.cancel(id)).toBe(true)
    expect(await port.pull(id)).toEqual({ ok: false, code: 'cancelled' })
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual({ model: 'voice/model', voice: 'chosen', input: 'Olá', speed: 1.25, response_format: 'mp3', extra_body: { audio: { rate: 1 } } })
  })

  it('uploads incremental audio to real HTTP while receiving ordered transcript SSE', async () => {
    const received: number[] = []
    const server = createServer((req, res) => {
      expect(req.url).toBe('/api/v1/audio/transcriptions/stream')
      expect(req.headers.authorization).toBe(`Bearer ${tokens.access_token}`)
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      req.on('data', (chunk: Buffer) => {
        received.push(...chunk)
        res.write('data: {"type":"transcript.text.delta","delta":"Olá"}\n\n')
      })
      req.on('end', () => res.end('data: {"type":"transcript.text.done","delta":""}\n\n'))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanup.push(() => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    }))
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Missing HTTP address')
    const { port } = await setup(globalThis.fetch, new URL(`http://127.0.0.1:${address.port}`))
    const id = open(port, { kind: 'transcription' })
    expect(await port.write(id, new Uint8Array([1, 2]))).toEqual({ ok: true })
    const first = await port.pull(id)
    expect(first).toMatchObject({ ok: true, done: false, contentType: 'text/event-stream' })
    expect(first.ok && Buffer.from(first.bytes).toString()).toContain('transcript.text.delta')
    expect(await port.write(id, new Uint8Array([3, 4]))).toEqual({ ok: true })
    expect(await port.write(id, null)).toEqual({ ok: true })
    expect((await collect(port, id)).body).toContain('transcript.text.done')
    expect(received).toEqual([1, 2, 3, 4])
  })
})
