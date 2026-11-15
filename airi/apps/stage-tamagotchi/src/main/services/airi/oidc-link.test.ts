import type { AddressInfo } from 'node:net'

import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'

import { createLiaSecretVault } from '@lia/core/secrets/vault'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { oidcSessionScope } from '../lia/secrets-service'
import { createOidcLinkService } from './oidc-link'
import { createOidcSessionOwner } from './oidc-session'

const secret = 'SYNTHETIC_PRIVATE_LINK_SENTINEL'
const cleanup: (() => Promise<unknown> | void)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse())
    await close()
  vi.restoreAllMocks()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function harness(options: { status?: number, browserUrl?: string, timeoutMs?: number, accounts?: unknown, realOwner?: boolean, delayList?: boolean } = {}) {
  const started = deferred<void>()
  const listEntered = deferred<void>()
  const listResponse = deferred<void>()
  const callbacks: string[] = []
  const requests: { path: string, auth: string | undefined, cookie: string | undefined, body: Record<string, unknown> }[] = []
  const session = new AbortController()
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req)
      raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    requests.push({ path: req.url!, auth: req.headers.authorization, cookie: req.headers.cookie, body })
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/api/auth/list-accounts') {
      listEntered.resolve()
      if (options.delayList)
        await listResponse.promise
      res.end(JSON.stringify(options.accounts ?? [{ providerId: body.provider ?? 'github' }, { providerId: 'google' }, { providerId: 'steam' }]))
      return
    }
    callbacks.push(body.callbackURL)
    res.statusCode = options.status ?? 200
    res.end(JSON.stringify({ url: options.browserUrl ?? 'https://consent.example.test/start', secret }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const opened = vi.fn(async () => {
    started.resolve()
  })
  const transport = vi.fn<typeof fetch>((url, init) => fetch(url, init))
  const origin = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  let disk: string | undefined
  const vault = createLiaSecretVault({
    filePath: 'link-test-vault.json',
    cipher: { available: () => true, encrypt: text => Buffer.from(text).reverse(), decrypt: bytes => bytes.reverse().toString() },
    read: () => {
      if (disk === undefined)
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return disk
    },
    write: async (_, content, signal) => {
      signal?.throwIfAborted()
      disk = content
    },
  })
  const owner = createOidcSessionOwner({ origin, clientId: 'desktop', vault, fetch: vi.fn(async () => new Response(null)) })
  if (options.realOwner) {
    expect(await owner.establish({ access_token: secret, refresh_token: `${secret}_REFRESH`, expires_in: 3600 }, new AbortController().signal, owner.beginLogin()!)).toBe(true)
  }
  const service = createOidcLinkService({
    origin,
    fetch: transport,
    openExternal: opened,
    timeoutMs: options.timeoutMs,
    async withAccess<T>(caller: AbortSignal, action: (token: string, signal: AbortSignal, privateValue: (text: string) => boolean) => Promise<T>) {
      return options.realOwner ? owner.withAccess(caller, action) : action(secret, session.signal, text => text.includes(secret))
    },
  })
  cleanup.push(() => service.dispose())
  const execute = (id = 1, provider = 'github', caller = new AbortController()) => service.execute(id, { provider }, caller.signal)
  return { service, execute, callbacks, requests, opened, started: started.promise, session, transport, owner, vault, listEntered: listEntered.promise, completeList: () => listResponse.resolve() }
}

describe('main-only browser account linking', () => {
  it.each(['callback', 'list-accounts'])('composes real session owner and vault logout during %s', async (phase) => {
    const h = await harness({ realOwner: true, delayList: phase === 'list-accounts' })
    const pending = h.execute()
    await h.started
    if (phase === 'list-accounts') {
      await fetch(h.callbacks[0])
      await h.listEntered
    }
    await h.owner.logout()
    expect(await pending).toEqual({ ok: false, code: 'cancelled' })
    expect(h.vault.hasSecret(oidcSessionScope, 'session-v1')).toBe(false)
    h.completeList()
    await expect(fetch(h.callbacks[0])).rejects.toThrow()
    expect(await h.execute(2)).toEqual({ ok: false, code: 'unauthenticated' })
    expect(h.opened).toHaveBeenCalledTimes(1)
    expect(h.requests.filter(request => request.path === '/api/auth/list-accounts')).toHaveLength(phase === 'list-accounts' ? 1 : 0)
  })
  it.each(['github', 'google', 'steam'])('links %s through HTTP and a real one-shot loopback', async (provider) => {
    const h = await harness()
    const pending = h.execute(1, provider)
    await h.started
    const callback = h.callbacks[0]
    expect((await fetch(callback)).status).toBe(200)
    expect(await pending).toEqual({ ok: true })
    expect(h.requests.map(request => request.path)).toEqual([provider === 'steam' ? '/api/auth/link/steam' : '/api/auth/link-social', '/api/auth/list-accounts'])
    expect(h.requests.every(request => request.auth === `Bearer ${secret}` && !request.cookie)).toBe(true)
    expect(h.requests[0].body).toEqual({ ...(provider !== 'steam' && { provider }), callbackURL: callback, errorCallbackURL: callback, disableRedirect: true })
    expect(h.transport.mock.calls.every(([, init]) => init?.credentials === 'omit' && init.redirect === 'error')).toBe(true)
    // A reused keep-alive socket may receive the helper's static HTML while
    // its asynchronous stop drains. It must never confirm a second link.
    await fetch(callback).then(response => response.body?.cancel(), () => undefined)
    expect(h.requests).toHaveLength(2)
  })

  it('ignores wrong state, then accepts only the current marker', async () => {
    const h = await harness()
    const pending = h.execute()
    await h.started
    const invalid = new URL(h.callbacks[0])
    invalid.searchParams.set('state', 'wrong-state')
    expect((await fetch(invalid)).status).toBe(400)
    expect((await fetch(h.callbacks[0])).status).toBe(200)
    expect(await pending).toEqual({ ok: true })
  })

  it.each(['invalid-code', 'error'])('rejects %s without account confirmation or private error reflection', async (mode) => {
    const h = await harness()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pending = h.execute()
    await h.started
    const callback = new URL(h.callbacks[0])
    callback.searchParams.set(mode === 'error' ? 'error' : 'code', secret)
    await fetch(callback)
    const result = await pending
    expect(result).toEqual({ ok: false, code: 'rejected' })
    expect(h.requests).toHaveLength(1)
    expect(JSON.stringify([result, log.mock.calls])).not.toContain(secret)
  })

  it('requires the selected provider in the authenticated confirmation', async () => {
    const h = await harness({ accounts: [{ providerId: 'google', accessToken: secret }] })
    const pending = h.execute()
    await h.started
    await fetch(h.callbacks[0])
    expect(await pending).toEqual({ ok: false, code: 'rejected' })
  })

  it.each([401, 403, 503])('maps HTTP %s without launching the browser', async (status) => {
    const h = await harness({ status })
    expect(await h.execute()).toEqual({ ok: false, code: status === 401 ? 'unauthenticated' : status === 403 ? 'rejected' : 'unavailable' })
    expect(h.opened).not.toHaveBeenCalled()
  })

  it.each([
    'file:///bad',
    'http://outside.example.test',
    'https://user:pass@example.test',
    `https://consent.example.test/?echo=${encodeURIComponent(secret)}`,
    `https://consent.example.test/?invalid=%&echo=%53${secret.slice(1)}`,
    `https://consent.example.test/?echo=%25252553${secret.slice(1)}`,
  ])('blocks unsafe browser URLs (%s)', async (browserUrl) => {
    const h = await harness({ browserUrl })
    expect(await h.execute()).toEqual({ ok: false, code: 'unavailable' })
    expect(h.opened).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'caller', 'logout', 'window', 'global'])('closes the listener on %s and ignores a late callback', async (mode) => {
    const h = await harness()
    const caller = new AbortController()
    const pending = h.execute(1, 'github', caller)
    await h.started
    if (mode === 'cancel')
      h.service.cancel(1)
    if (mode === 'caller')
      caller.abort()
    if (mode === 'logout')
      h.session.abort()
    if (mode === 'window')
      h.service.disposeWindow(1)
    if (mode === 'global')
      h.service.dispose()
    expect(await pending).toEqual({ ok: false, code: 'cancelled' })
    await expect(fetch(h.callbacks[0])).rejects.toThrow()
    expect(h.requests).toHaveLength(1)
    if (mode === 'window' || mode === 'global')
      expect(await h.execute()).toEqual({ ok: false, code: 'cancelled' })
  })

  it('expires abandoned attempts and closes the listener', async () => {
    const h = await harness({ timeoutMs: 100 })
    const pending = h.execute()
    await h.started
    expect(await pending).toEqual({ ok: false, code: 'timeout' })
    await expect(fetch(h.callbacks[0])).rejects.toThrow()
  })

  it('isolates windows, prevents concurrent replacement and rejects replay against another window', async () => {
    const h = await harness()
    const first = h.execute(1)
    await h.started
    const secondStarted = deferred<void>()
    h.opened.mockImplementation(async () => {
      secondStarted.resolve()
    })
    const second = h.execute(2, 'google')
    await secondStarted.promise
    expect(await h.execute(1)).toEqual({ ok: false, code: 'busy' })
    const replay = new URL(h.callbacks[0])
    replay.port = new URL(h.callbacks[1]).port
    expect((await fetch(replay)).status).toBe(400)
    h.service.cancel(1)
    expect(await first).toEqual({ ok: false, code: 'cancelled' })
    await fetch(h.callbacks[1])
    expect(await second).toEqual({ ok: true })
  })

  it('rejects arbitrary payloads before acquiring access or opening a listener', async () => {
    const h = await harness()
    for (const payload of [null, { provider: 'credential' }, { provider: 'github', url: 'https://outside.example.test' }])
      expect(await h.service.execute(1, payload, new AbortController().signal)).toEqual({ ok: false, code: 'invalid-request' })
    expect(h.requests).toHaveLength(0)
  })

  it('sanitizes browser-launch failures and closes the callback', async () => {
    const h = await harness()
    h.opened.mockRejectedValue(new Error(secret))
    expect(await h.execute()).toEqual({ ok: false, code: 'unavailable' })
    await expect(fetch(h.callbacks[0])).rejects.toThrow()
  })

  it('rejects late HTTP responses after cancellation without opening the browser', async () => {
    const h = await harness()
    const requested = deferred<void>()
    const delayed = deferred<Response>()
    h.transport.mockImplementationOnce(async () => {
      requested.resolve()
      return delayed.promise
    })
    const pending = h.execute()
    await requested.promise
    h.service.cancel(1)
    expect(await pending).toEqual({ ok: false, code: 'cancelled' })
    const response = Response.json({ url: `https://consent.example.test/?token=${secret}` })
    delayed.resolve(response)
    await delayed.promise
    expect(h.opened).not.toHaveBeenCalled()
  })

  it('cancels and unlocks a response stream when logout interrupts a pending read', async () => {
    const h = await harness()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"url":')) },
      cancel,
    })
    h.transport.mockResolvedValueOnce(new Response(body))
    const pending = h.execute()
    await vi.waitFor(() => expect(body.locked).toBe(true))
    h.session.abort()
    expect(await pending).toEqual({ ok: false, code: 'cancelled' })
    expect(cancel).toHaveBeenCalledOnce()
    expect(body.locked).toBe(false)
    expect(h.opened).not.toHaveBeenCalled()
  })

  it('closes a loopback binding that finishes after logout and caps concurrent windows', async () => {
    const binding = deferred<{ port: number, result: Promise<{ code: string }>, close: () => void }>()
    const session = new AbortController()
    const entered = deferred<void>()
    const close = vi.fn()
    const service = createOidcLinkService({
      origin: new URL('https://accounts.example.test'),
      openExternal: vi.fn(),
      startLoopback: async () => {
        entered.resolve()
        return binding.promise
      },
      async withAccess<T>(_signal: AbortSignal, action: (token: string, signal: AbortSignal, privateValue: (text: string) => boolean) => Promise<T>) {
        return action(secret, session.signal, text => text.includes(secret))
      },
    })
    cleanup.push(() => service.dispose())
    const pending = Array.from({ length: 32 }, (_, id) => service.execute(id, { provider: 'github' }, new AbortController().signal))
    await entered.promise
    expect(await service.execute(99, { provider: 'github' }, new AbortController().signal)).toEqual({ ok: false, code: 'busy' })
    session.abort()
    expect((await Promise.all(pending)).every(result => !result.ok && result.code === 'cancelled')).toBe(true)
    binding.resolve({ port: 12345, result: Promise.reject(new Error(secret)), close })
    await binding.promise
    await Promise.resolve()
    expect(close).toHaveBeenCalledTimes(32)
  })
})
