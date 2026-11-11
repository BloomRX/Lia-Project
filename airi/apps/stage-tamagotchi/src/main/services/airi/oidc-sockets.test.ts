import type { AddressInfo } from 'node:net'

import type { OidcPrivateValueCheck } from './oidc-session'
import type { OidcSpeechEvent } from './oidc-sockets'

import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'

import { createLiaSecretVault } from '@lia/core/secrets/vault'
import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/websocket/native'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { authenticate, newMessages, pullMessages, sendMessages } from '../../../../../../server/packages/server-sdk-shared/src/v2'
import { createOidcSessionOwner } from './oidc-session'
import { createOidcSocketService } from './oidc-sockets'

// Use the already installed workspace transport; no fixture dependency install.
const require = createRequire(new URL('../../../../../../node_modules/.pnpm/fixture.cjs', import.meta.url))
interface Peer extends WebSocket {
  on: (event: 'message', listener: (data: { toString: () => string }) => void) => void
  terminate: () => void
}
interface Server {
  clients: Set<Peer>
  address: () => AddressInfo
  on: (event: 'connection', listener: (socket: Peer, request: { url?: string }) => void) => void
  once: (event: 'listening', listener: () => void) => void
  close: (callback: () => void) => void
}
const { WebSocketServer } = require('ws') as { WebSocketServer: new (options: { host: string, port: number }) => Server }

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse())
    await cleanup()
  cleanups.length = 0
  vi.restoreAllMocks()
})

async function fixture() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.once('listening', resolve))
  const urls: string[] = []
  const chats: Peer[] = []
  const speech: Peer[] = []
  const auth: string[] = []
  const sent: unknown[] = []
  const frames: unknown[] = []
  const contexts: ReturnType<typeof createContext>['context'][] = []
  let authReject = 0
  let holdSend = false
  server.on('connection', (socket, request) => {
    urls.push(request.url!)
    if (request.url!.startsWith('/api/v1/audio/speech/ws')) {
      speech.push(socket)
      socket.on('message', (data) => {
        frames.push(JSON.parse(data.toString()))
      })
      return
    }
    chats.push(socket)
    const context = createContext(socket).context
    contexts.push(context)
    defineInvokeHandler(context, authenticate, ({ token }) => {
      auth.push(token)
      if (authReject-- > 0) {
        socket.close(4001, 'private rejection')
        return new Promise<{ userId: string }>(() => {})
      }
      return { userId: 'user-1' }
    })
    defineInvokeHandler(context, sendMessages, (request) => {
      sent.push(request)
      return holdSend ? new Promise<{ seq: number }>(() => {}) : { seq: 2 }
    })
    defineInvokeHandler(context, pullMessages, () => ({ messages: [], seq: 2 }))
  })
  const session = new AbortController()
  let token = 'FIXTURE_ACCESS'
  const owner = vi.fn(async <T>(caller: AbortSignal, action: (token: string, signal: AbortSignal, contains: (value: string) => boolean) => Promise<T>): Promise<T | undefined> => {
    const signal = AbortSignal.any([caller, session.signal])
    if (signal.aborted)
      return undefined
    const contains: OidcPrivateValueCheck = (value, partial = false) => [token, 'FIXTURE_REFRESH_"/'].some(secret => value.includes(secret) || (partial && Array.from({ length: secret.length - 1 }, (_, index) => index + 1).some(size => value.endsWith(secret.slice(0, size)))))
    return action(token, signal, contains)
  })
  const refresh = vi.fn(async () => {
    token = 'FIXTURE_ROTATED'
    return true
  })
  const urlsCreated: string[] = []
  const origin = new URL(`http://127.0.0.1:${server.address().port}`)
  const service = createOidcSocketService({
    origin,
    withAccess: owner as Parameters<typeof createOidcSocketService>[0]['withAccess'],
    refreshAccess: refresh,
    createWebSocket(url) {
      urlsCreated.push(url)
      return new WebSocket(url)
    },
  })
  cleanups.push(async () => {
    service.dispose()
    for (const context of contexts)
      context.abort(new Error('fixture closed'))
    for (const socket of server.clients)
      socket.terminate()
    await new Promise<void>(resolve => server.close(resolve))
  })
  return {
    service,
    origin,
    session,
    chats,
    speech,
    auth,
    sent,
    frames,
    urls,
    urlsCreated,
    contexts,
    owner,
    refresh,
    serverClients: () => server.clients.size,
    rejectAuth: (count: number) => {
      authReject = count
    },
    holdSend: () => {
      holdSend = true
    },
  }
}

const message = { chatId: 'chat-1', messages: [{ id: 'm1', role: 'user', content: 'Hello 100%' }] }

describe('inactive Main OIDC socket adapters', () => {
  it('uses the real Eventa protocol without putting the chat bearer in its URL', async () => {
    const f = await fixture()
    const port = f.service.forWindow(1)
    expect(await port.chat.connect()).toBe(true)
    expect(await port.chat.sendMessages(message)).toEqual({ seq: 2 })
    expect(await port.chat.pullMessages({ chatId: 'chat-1', afterSeq: 0, limit: 2 })).toEqual({ messages: [], seq: 2 })
    expect(f.sent).toEqual([message])
    expect(f.auth).toEqual(['FIXTURE_ACCESS'])
    expect(f.urls).toEqual(['/ws/v2/chat'])
    const received = vi.fn()
    port.chat.onNewMessages(received)
    await f.contexts[0].emit(newMessages, { chatId: 'chat-1', messages: [], fromSeq: 0, toSeq: 2 })
    await vi.waitFor(() => expect(received).toHaveBeenCalledWith({ chatId: 'chat-1', messages: [], fromSeq: 0, toSeq: 2 }))
  })

  it('orders speech start/text/finish and binary/control output and strips unknown fields', async () => {
    const f = await fixture()
    const events: OidcSpeechEvent[] = []
    const handle = f.service.forWindow(1).speech.start({ model: 'model-1', voice: 'voice-1' }, event => events.push(event))
    handle.appendText('Hello')
    handle.appendText(' world')
    handle.finish()
    await vi.waitFor(() => expect(f.frames).toHaveLength(4))
    expect(f.frames).toEqual([{ event: 'start', model: 'model-1', voice: 'voice-1', response_format: 'mp3' }, { event: 'text', text: 'Hello' }, { event: 'text', text: ' world' }, { event: 'finish' }])
    expect(new URL(f.urlsCreated[0]).searchParams.get('token')).toBe('FIXTURE_ACCESS')
    f.speech[0].send(JSON.stringify({ event: 'sentence.start', payload: { text: 'Hello', index: 0, hidden: 'omit' } }))
    f.speech[0].send(new Uint8Array([1, 2, 3]))
    f.speech[0].send(JSON.stringify({ event: 'subtitle', text: '100%' }))
    f.speech[0].send(JSON.stringify({ event: 'session.finished' }))
    await handle.done
    expect(events.map(event => event.event)).toEqual(['sentence.start', 'audio', 'subtitle', 'session.finished'])
    expect(events[0]).toEqual({ event: 'sentence.start', payload: { text: 'Hello', index: 0 }, text: undefined })
    expect(new Uint8Array((events[1] as { audio: ArrayBuffer }).audio)).toEqual(new Uint8Array([1, 2, 3]))
    expect(() => handle.appendText('late')).toThrow('OIDC socket unavailable')
  })

  it('isolates windows and cancels pending RPC and speech on owner logout', async () => {
    const f = await fixture()
    const first = f.service.forWindow(1)
    const second = f.service.forWindow(2)
    expect(await first.chat.connect()).toBe(true)
    expect(await second.chat.connect()).toBe(true)
    const one = vi.fn()
    const two = vi.fn()
    first.chat.onNewMessages(one)
    second.chat.onNewMessages(two)
    await f.contexts[0].emit(newMessages, { chatId: 'chat-1', messages: [], fromSeq: 0, toSeq: 1 })
    await vi.waitFor(() => expect(one).toHaveBeenCalledOnce())
    expect(two).not.toHaveBeenCalled()
    f.holdSend()
    const pending = first.chat.sendMessages(message)
    const rejected = expect(pending).rejects.toThrow('OIDC socket unavailable')
    const handle = second.speech.start({ model: 'm', voice: 'v' }, vi.fn())
    f.session.abort()
    await rejected
    await expect(handle.done).rejects.toThrow('OIDC socket unavailable')
    await vi.waitFor(() => expect(first.chat.status()).toBe('closed'))
    const count = f.owner.mock.calls.length
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(f.owner).toHaveBeenCalledTimes(count)
  })

  it('refreshes a rejected chat authorization once and reconnects using the owner', async () => {
    const f = await fixture()
    f.rejectAuth(1)
    const port = f.service.forWindow(1)
    expect(await port.chat.connect()).toBe(false)
    await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(port.chat.status()).toBe('open'), { timeout: 2000 })
    expect(f.auth).toEqual(['FIXTURE_ACCESS', 'FIXTURE_ROTATED'])
    expect(f.sent).toEqual([])
  })

  it('does not let a late refresh disable a replacement connection', async () => {
    const f = await fixture()
    const pending = Promise.withResolvers<boolean>()
    f.refresh.mockReturnValueOnce(pending.promise)
    f.rejectAuth(1)
    const port = f.service.forWindow(1)
    expect(await port.chat.connect()).toBe(false)
    await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledOnce())
    port.chat.disconnect()
    expect(await port.chat.connect()).toBe(true)
    pending.resolve(false)
    f.chats[1].close(1001)
    await vi.waitFor(() => {
      expect(f.auth).toHaveLength(3)
      expect(port.chat.status()).toBe('open')
    }, { timeout: 2000 })
  })

  it('stops after a second unauthorized socket rather than refreshing in a loop', async () => {
    const f = await fixture()
    f.rejectAuth(3)
    const port = f.service.forWindow(1)
    await port.chat.connect()
    await vi.waitFor(() => expect(f.auth).toHaveLength(2), { timeout: 2000 })
    await vi.waitFor(() => expect(port.chat.status()).toBe('closed'))
    expect(f.refresh).toHaveBeenCalledOnce()
  })

  it.each(['not json', JSON.stringify({ event: 'error', message: 'FIXTURE_ACCESS' }), JSON.stringify({ event: 'subtitle', text: 'FIXTURE_REFRESH_"/' }), JSON.stringify({ event: 'subtitle', text: encodeURIComponent('FIXTURE_REFRESH_"/') })])('sanitizes malformed or private speech output %#', async (frame) => {
    const f = await fixture()
    const callback = vi.fn()
    const handle = f.service.forWindow(1).speech.start({ model: 'm', voice: 'v' }, callback)
    await vi.waitFor(() => expect(f.speech).toHaveLength(1))
    f.speech[0].send(frame)
    await expect(handle.done).rejects.toThrow(/^OIDC socket unavailable$/)
    expect(callback).not.toHaveBeenCalled()
  })

  it('blocks malformed Eventa envelopes before the native adapter can log raw data', async () => {
    const f = await fixture()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const port = f.service.forWindow(1)
    await port.chat.connect()
    f.chats[0].send('FIXTURE_ACCESS {malformed')
    await vi.waitFor(() => expect(port.chat.status()).toBe('closed'))
    expect(error).not.toHaveBeenCalled()
    port.chat.disconnect()
  })

  it('rejects renderer authority fields, bounded queues, and disposed handles', async () => {
    const f = await fixture()
    const port = f.service.forWindow(1)
    expect(() => port.speech.start({ model: 'm', voice: 'v', token: 'external' }, vi.fn())).toThrow()
    await expect(port.chat.sendMessages({ ...message, url: 'https://external.test' })).rejects.toThrow()
    await expect(port.chat.pullMessages({ chatId: 'c', afterSeq: 0, limit: 257 })).rejects.toThrow()
    const delayed = vi.fn(async <T>(_caller: AbortSignal, _action: (token: string, signal: AbortSignal, contains: (value: string) => boolean) => Promise<T>): Promise<T | undefined> => new Promise(() => {}))
    const waiting = createOidcSocketService({ origin: new URL('https://issuer.test'), withAccess: delayed as Parameters<typeof createOidcSocketService>[0]['withAccess'] })
    cleanups.push(() => waiting.dispose())
    const handle = waiting.forWindow(4).speech.start({ model: 'm', voice: 'v' }, vi.fn())
    for (let i = 0; i < 128; i++)
      handle.appendText('x')
    expect(() => handle.appendText('overflow')).toThrow()
    await expect(handle.done).rejects.toThrow()
    f.service.disposeWindow(1)
    expect(await port.chat.connect()).toBe(false)
    expect(() => port.speech.start({ model: 'm', voice: 'v' }, vi.fn())).toThrow()
    f.service.dispose()
    expect(() => f.service.forWindow(2)).toThrow()
  })

  it('cancel before open suppresses output and truncation never succeeds or replays', async () => {
    const f = await fixture()
    const callback = vi.fn()
    const port = f.service.forWindow(1)
    const cancelled = port.speech.start({ model: 'm', voice: 'v' }, callback)
    cancelled.cancel()
    await expect(cancelled.done).rejects.toThrow()
    const active = port.speech.start({ model: 'm', voice: 'v' }, callback)
    await vi.waitFor(() => expect(f.frames.some(frame => (frame as { event: string }).event === 'start')).toBe(true))
    const socket = f.speech.at(-1)!
    socket.close(1011, 'FIXTURE_ACCESS')
    await expect(active.done).rejects.toThrow(/^OIDC socket unavailable$/)
    expect(callback).not.toHaveBeenCalled()
    expect(f.refresh).not.toHaveBeenCalled()
  })

  it('rejects pending sends on network loss and reconnects without replay', async () => {
    const f = await fixture()
    const port = f.service.forWindow(1)
    await port.chat.connect()
    f.holdSend()
    const pending = port.chat.sendMessages(message)
    const rejected = expect(pending).rejects.toThrow(/^OIDC socket unavailable$/)
    await vi.waitFor(() => expect(f.sent).toHaveLength(1))
    f.chats[0].close(1011, 'private close reason')
    await rejected
    await vi.waitFor(() => expect(f.auth).toHaveLength(2), { timeout: 2000 })
    expect(f.sent).toEqual([message])
    expect(f.owner).toHaveBeenCalledTimes(2)
  })

  it('supports immediate explicit reconnect and drops late speech after window disposal', async () => {
    const f = await fixture()
    const port = f.service.forWindow(1)
    await port.chat.connect()
    port.chat.disconnect()
    expect(await port.chat.connect()).toBe(true)
    expect(f.auth).toHaveLength(2)
    const received = vi.fn()
    const handle = port.speech.start({ model: 'm', voice: 'v' }, received)
    await vi.waitFor(() => expect(f.speech).toHaveLength(1))
    f.service.disposeWindow(1)
    f.speech[0].send(JSON.stringify({ event: 'subtitle', text: 'late' }))
    await expect(handle.done).rejects.toThrow()
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(received).not.toHaveBeenCalled()
    expect(f.service.forWindow(1)).not.toBe(port)
  })

  it('bounds concurrent speech sessions and open chat RPC calls', async () => {
    const f = await fixture()
    const port = f.service.forWindow(1)
    await port.chat.connect()
    const first = port.speech.start({ model: 'm', voice: 'v' }, vi.fn())
    const second = port.speech.start({ model: 'm', voice: 'v' }, vi.fn())
    expect(() => port.speech.start({ model: 'm', voice: 'v' }, vi.fn())).toThrow()
    f.holdSend()
    const pending = Array.from({ length: 16 }, () => port.chat.sendMessages(message).catch(error => error))
    await expect(port.chat.sendMessages(message)).rejects.toThrow()
    port.dispose()
    expect((await Promise.all(pending)).every(error => error instanceof Error && error.message === 'OIDC socket unavailable')).toBe(true)
    await expect(first.done).rejects.toThrow()
    await expect(second.done).rejects.toThrow()
    await vi.waitFor(() => expect(f.serverClients()).toBe(0))
  })

  it('fails closed for malformed push', async () => {
    const f = await fixture()
    const port = f.service.forWindow(1)
    await port.chat.connect()
    const received = vi.fn()
    port.chat.onNewMessages(received)
    await f.contexts[0].emit(newMessages, { chatId: 'chat-1', messages: [], fromSeq: 9, toSeq: 1 })
    await vi.waitFor(() => expect(port.chat.status()).toBe('closed'))
    expect(received).not.toHaveBeenCalled()
    port.chat.disconnect()
  })

  it.each(['text', 'audio'])('holds split private %s frames without releasing their prefix', async (kind) => {
    const f = await fixture()
    const received = vi.fn()
    const handle = f.service.forWindow(1).speech.start({ model: 'm', voice: 'v' }, received)
    await vi.waitFor(() => expect(f.speech).toHaveLength(1))
    const send = (value: string) => f.speech[0].send(kind === 'audio' ? new TextEncoder().encode(value) : JSON.stringify({ event: 'subtitle', text: value }))
    send('FIXTURE_')
    send('ACCESS')
    await expect(handle.done).rejects.toThrow(/^OIDC socket unavailable$/)
    expect(received).not.toHaveBeenCalled()
  })

  it('preserves validated speech tuning and analytics while refusing transport authority in extraBody', async () => {
    const f = await fixture()
    const port = f.service.forWindow(1)
    expect(() => port.speech.start({ model: 'm', voice: 'v', extraBody: { headers: { Authorization: 'external' } } }, vi.fn())).toThrow()
    const extraBody = { audio: { speed: 1.2 }, additions: { enabled: true }, context_texts: ['hello'] }
    const handle = port.speech.start({ model: 'm', voice: 'v', extraBody, ttsTrigger: 'auto', ttsSource: 'chat_auto_tts', ttsVoiceType: 'custom_configured' }, vi.fn())
    await vi.waitFor(() => expect(f.frames).toHaveLength(1))
    expect(f.frames[0]).toEqual({ event: 'start', model: 'm', voice: 'v', response_format: 'mp3', extra_body: extraBody })
    const target = new URL(f.urlsCreated[0])
    expect(target.searchParams.get('tts_trigger')).toBe('auto')
    expect(target.searchParams.get('tts_source')).toBe('chat_auto_tts')
    expect(target.searchParams.get('tts_voice_type')).toBe('custom_configured')
    handle.cancel()
    await expect(handle.done).rejects.toThrow()
  })

  it('rejects forged speech control frames before and after the socket opens', async () => {
    const f = await fixture()
    const handle = f.service.forWindow(1).speech.start({ model: 'm', voice: 'v' }, vi.fn())
    const invalid = [
      { event: 'start', extra_body: { headers: { Authorization: 'FORGED_AUTH' } } },
      { event: 'text', text: 'forged', token: 'FORGED_TOKEN' },
      { event: 'finish', token: 'FORGED_TOKEN' },
      { event: 'unknown' },
      { event: 'cancel' },
      { event: 'text' },
      { event: 'text', text: 42 },
      null,
      ['finish'],
      Object.create({ event: 'text', text: 'inherited' }),
    ]
    for (const frame of invalid)
      expect(() => handle.send(frame)).toThrow(/^OIDC socket unavailable$/)
    await vi.waitFor(() => expect(f.frames).toHaveLength(1))
    for (const frame of invalid)
      expect(() => handle.send(frame)).toThrow(/^OIDC socket unavailable$/)
    handle.send({ event: 'text', text: 'valid barrier' })
    handle.send({ event: 'finish' })
    await vi.waitFor(() => expect(f.frames).toHaveLength(3))
    expect(f.frames).toEqual([
      { event: 'start', model: 'm', voice: 'v', response_format: 'mp3' },
      { event: 'text', text: 'valid barrier' },
      { event: 'finish' },
    ])
    handle.cancel()
    await expect(handle.done).rejects.toThrow()
  })

  it('never creates a transport without owner authorization and rejects unsafe origins', async () => {
    const factory = vi.fn<(url: string) => WebSocket>()
    const withAccess = async <T>(): Promise<T | undefined> => undefined
    for (const origin of ['http://issuer.test', 'https://user:password@issuer.test', 'https://issuer.test/path', 'https://issuer.test/?token=x', 'https://issuer.test/#fragment'])
      expect(() => createOidcSocketService({ origin: new URL(origin), withAccess, createWebSocket: factory })).toThrow('Invalid desktop OIDC origin')
    const service = createOidcSocketService({ origin: new URL('https://issuer.test'), withAccess, createWebSocket: factory })
    cleanups.push(() => service.dispose())
    const port = service.forWindow(1)
    expect(await port.chat.connect()).toBe(false)
    const handle = port.speech.start({ model: 'm', voice: 'v' }, vi.fn())
    await expect(handle.done).rejects.toThrow()
    expect(factory).not.toHaveBeenCalled()
  })

  it('composes the real vault owner, early authorization refresh, socket RPC and logout', async () => {
    const f = await fixture()
    let disk: string | undefined
    const vault = createLiaSecretVault({
      filePath: 'socket-fixture-vault.json',
      cipher: { available: () => true, encrypt: text => Buffer.from(text).reverse(), decrypt: bytes => bytes.reverse().toString() },
      read() {
        if (disk === undefined)
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        return disk
      },
      async write(_, value, signal) {
        signal?.throwIfAborted()
        disk = value
      },
    })
    const transport = vi.fn<typeof fetch>()
    transport.mockResolvedValueOnce(Response.json({ access_token: 'REAL_OWNER_ROTATED', refresh_token: 'REAL_OWNER_REFRESH_NEXT', expires_in: 3600 }))
    transport.mockResolvedValueOnce(new Response(null, { status: 200 }))
    const owner = createOidcSessionOwner({ vault, origin: f.origin, clientId: 'desktop-fixture', fetch: transport })
    expect(await owner.establish({ access_token: 'REAL_OWNER_INITIAL', refresh_token: 'REAL_OWNER_REFRESH', expires_in: 3600 }, new AbortController().signal, owner.beginLogin()!)).toBe(true)
    const service = createOidcSocketService({ origin: f.origin, withAccess: owner.withAccess, refreshAccess: owner.refreshAccess })
    cleanups.push(() => service.dispose())
    const port = service.forWindow(1)
    f.rejectAuth(1)
    expect(await port.chat.connect()).toBe(false)
    await vi.waitFor(() => expect(port.chat.status()).toBe('open'), { timeout: 2000 })
    expect(f.auth).toEqual(['REAL_OWNER_INITIAL', 'REAL_OWNER_ROTATED'])
    expect(transport).toHaveBeenCalledOnce()
    const fields = transport.mock.calls[0][1]?.body as URLSearchParams
    expect(fields.get('grant_type')).toBe('refresh_token')
    expect(fields.get('refresh_token')).toBe('REAL_OWNER_REFRESH')
    f.holdSend()
    const rpc = port.chat.sendMessages(message)
    const rejected = expect(rpc).rejects.toThrow(/^OIDC socket unavailable$/)
    const speech = port.speech.start({ model: 'm', voice: 'v' }, vi.fn())
    await vi.waitFor(() => expect(f.sent).toHaveLength(1))
    expect((await owner.logout()).cleared).toBe(true)
    await rejected
    await expect(speech.done).rejects.toThrow(/^OIDC socket unavailable$/)
    await vi.waitFor(() => expect(f.serverClients()).toBe(0))
    expect(port.chat.status()).toBe('closed')
    expect(f.sent).toHaveLength(1)
  })
})
