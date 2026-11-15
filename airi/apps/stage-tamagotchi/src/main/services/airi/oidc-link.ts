import { randomBytes } from 'node:crypto'

import { startLoopbackServer } from './http-server/http/auth'

type Provider = 'github' | 'google' | 'steam'
type LinkError = 'invalid-request' | 'unauthenticated' | 'cancelled' | 'timeout' | 'busy' | 'rejected' | 'unavailable'
export type OidcLinkResult = { ok: true } | { ok: false, code: LinkError }

interface Options {
  origin: URL
  fetch?: typeof fetch
  withAccess: <T>(signal: AbortSignal, action: (token: string, signal: AbortSignal, containsPrivateValue: (text: string) => boolean) => Promise<T>) => Promise<T | undefined>
  openExternal: (url: string) => Promise<unknown>
  startLoopback?: typeof startLoopbackServer
  timeoutMs?: number
}

class LinkFailure extends Error {
  constructor(readonly code: LinkError) { super(code) }
}

function loopback(host: string) {
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]'
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
}

async function active<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new LinkFailure('cancelled'))
    if (signal.aborted)
      abort()
    else
      signal.addEventListener('abort', abort, { once: true })
  })
  try {
    const value = await Promise.race([work, cancelled])
    signal.throwIfAborted()
    return value
  }
  finally { signal.removeEventListener('abort', abort) }
}

async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader)
    throw new LinkFailure('unavailable')
  let body = ''
  let bytes = 0
  const decoder = new TextDecoder('utf-8', { fatal: true })
  try {
    for (;;) {
      const chunk = await active(reader.read(), signal)
      if (chunk.done)
        return JSON.parse(body + decoder.decode())
      bytes += chunk.value.byteLength
      if (bytes > 256 * 1024)
        throw new LinkFailure('unavailable')
      body += decoder.decode(chunk.value, { stream: true })
    }
  }
  finally {
    try {
      await reader.cancel().catch(() => {})
    }
    finally {
      reader.releaseLock()
    }
  }
}

function externalUrl(value: unknown, containsPrivateValue: (text: string) => boolean, allowLoopbackHttp: boolean): string {
  if (typeof value !== 'string' || value.length > 16_384)
    throw new LinkFailure('unavailable')
  const url = new URL(value)
  if ((url.protocol !== 'https:' && (url.protocol !== 'http:' || !allowLoopbackHttp || !loopback(url.hostname))) || url.username || url.password)
    throw new LinkFailure('unavailable')
  let decoded = url.href
  for (let i = 0; i < 4; i++) {
    if (containsPrivateValue(decoded))
      throw new LinkFailure('unavailable')
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded)
        break
      decoded = next
    }
    catch { throw new LinkFailure('unavailable') }
  }
  if (containsPrivateValue(decoded))
    throw new LinkFailure('unavailable')
  return url.href
}

/** Prepared Main-only link flow. No credentials or handoff URLs leave this service. */
export function createOidcLinkService(options: Options) {
  const { origin, withAccess, openExternal } = options
  if ((origin.protocol !== 'https:' && (origin.protocol !== 'http:' || !loopback(origin.hostname)))
    || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Invalid link origin')
  }
  const server = origin.origin
  const transport = options.fetch ?? fetch
  const start = options.startLoopback ?? startLoopbackServer
  const timeoutMs = options.timeoutMs ?? 300_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
    throw new Error('Invalid link timeout')
  const attempts = new Map<number, AbortController>()
  const closed = new Set<number>()
  let disposed = false

  async function execute(windowId: number, payload: unknown, caller: AbortSignal): Promise<OidcLinkResult> {
    const fail = (code: LinkError): OidcLinkResult => ({ ok: false, code })
    if (!Number.isSafeInteger(windowId) || windowId < 0 || !record(payload) || Object.keys(payload).length !== 1
      || typeof payload.provider !== 'string' || !['github', 'google', 'steam'].includes(payload.provider)) {
      return fail('invalid-request')
    }
    if (disposed || closed.has(windowId) || caller.aborted)
      return fail('cancelled')
    if (attempts.has(windowId) || attempts.size >= 32)
      return fail('busy')
    const provider = payload.provider as Provider
    const controller = new AbortController()
    attempts.set(windowId, controller)
    const deadline = AbortSignal.timeout(timeoutMs)
    const initial = AbortSignal.any([controller.signal, caller, deadline])
    let signal = initial
    try {
      const result = await withAccess<OidcLinkResult>(initial, async (token, session, privateValue) => {
        signal = AbortSignal.any([initial, session])
        signal.throwIfAborted()
        const state = randomBytes(32).toString('base64url')
        const marker = randomBytes(32).toString('base64url')
        const pending = start(state).then((listener) => {
          // A listener can finish binding after cancellation.
          void listener.result.catch(() => {})
          if (signal.aborted)
            listener.close()
          return listener
        })
        const listener = await active(pending, signal)
        const close = () => listener.close()
        signal.addEventListener('abort', close, { once: true })
        try {
          const callback = new URL(`http://127.0.0.1:${listener.port}/callback`)
          callback.searchParams.set('state', state)
          callback.searchParams.set('code', marker)
          async function request(path: string, body?: Record<string, unknown>) {
            signal.throwIfAborted()
            const response = await active(transport(new URL(`/api/auth/${path}`, server), {
              method: body ? 'POST' : 'GET',
              headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
              body: body ? JSON.stringify(body) : undefined,
              credentials: 'omit',
              redirect: 'error',
              signal,
            }).then((response) => {
              if (signal.aborted)
                void response.body?.cancel().catch(() => {})
              return response
            }), signal)
            if (!response.ok) {
              void response.body?.cancel().catch(() => {})
              throw new LinkFailure(response.status === 401 ? 'unauthenticated' : response.status < 500 ? 'rejected' : 'unavailable')
            }
            return json(response, signal)
          }
          const data = await request(provider === 'steam' ? 'link/steam' : 'link-social', {
            ...(provider !== 'steam' && { provider }),
            callbackURL: callback.href,
            errorCallbackURL: callback.href,
            disableRedirect: true,
          })
          if (!record(data))
            throw new LinkFailure('unavailable')
          const url = externalUrl(data.url, privateValue, origin.protocol === 'http:')
          signal.throwIfAborted()
          await active(openExternal(url), signal)
          const response = await active(listener.result.catch(() => {
            throw new LinkFailure('rejected')
          }), signal)
          if (response.code !== marker)
            throw new LinkFailure('rejected')
          const accounts = await request('list-accounts')
          if (!Array.isArray(accounts) || accounts.length > 256
            || !accounts.some(account => record(account) && account.providerId === provider)) {
            throw new LinkFailure('rejected')
          }
          signal.throwIfAborted()
          return { ok: true }
        }
        finally {
          signal.removeEventListener('abort', close)
          close()
        }
      })
      signal.throwIfAborted()
      return result ?? fail('unauthenticated')
    }
    catch (error) {
      if (caller.aborted || controller.signal.aborted || (signal.aborted && !deadline.aborted))
        return fail('cancelled')
      if (deadline.aborted)
        return fail('timeout')
      return fail(error instanceof LinkFailure ? error.code : 'unavailable')
    }
    finally { attempts.delete(windowId) }
  }

  function cancel(windowId: number) {
    attempts.get(windowId)?.abort()
  }
  function disposeWindow(windowId: number) {
    closed.add(windowId)
    cancel(windowId)
  }
  function dispose() {
    disposed = true
    for (const attempt of attempts.values())
      attempt.abort()
    closed.clear()
  }
  return { execute, cancel, disposeWindow, dispose }
}
