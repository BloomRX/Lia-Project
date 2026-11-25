import type { createOidcSessionOwner } from './oidc-session'

import { createHash, randomBytes } from 'node:crypto'

import { readOidcJson } from './oidc-json'
import { startOidcLoopback } from './oidc-loopback'

type Owner = Pick<ReturnType<typeof createOidcSessionOwner>, 'beginLogin' | 'establish'>

type LoginResult
  = | { ok: true }
    | { ok: false, code: 'cancelled' | 'unavailable' | 'rejected' }

export function createOidcLogin(options: {
  origin: URL
  clientId: string
  owner: Owner
  openAuthorization: (url: string) => Promise<unknown>
  fetch?: typeof fetch
}) {
  const { origin, clientId, owner, openAuthorization } = options
  const loopback = ['127.0.0.1', '[::1]'].includes(origin.hostname)
  if ((origin.protocol !== 'https:' && !(loopback && origin.protocol === 'http:'))
    || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !clientId)
    throw new Error('Invalid desktop OIDC login origin')
  const issuer = origin.origin
  const request = options.fetch ?? globalThis.fetch
  const redirectUri = new URL('/api/auth/oidc/electron-callback', issuer).href
  const tokenEndpoint = new URL('/api/auth/oauth2/token', issuer)
  let active: AbortController | undefined

  async function login(caller: AbortSignal): Promise<LoginResult> {
    if (caller.aborted)
      return { ok: false, code: 'cancelled' }
    if (active)
      return { ok: false, code: 'unavailable' }
    const attempt = new AbortController()
    active = attempt
    const signal = AbortSignal.any([caller, attempt.signal, AbortSignal.timeout(5 * 60 * 1_000)])
    const cancelled = Promise.withResolvers<never>()
    const abort = () => cancelled.reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    void cancelled.promise.catch(() => {})
    let receiver: Awaited<ReturnType<typeof startOidcLoopback>> | undefined
    try {
      const revision = owner.beginLogin()
      if (revision === undefined)
        return { ok: false, code: 'unavailable' }
      const verifier = randomBytes(48).toString('base64url')
      const state = randomBytes(32).toString('base64url')
      const nonce = randomBytes(32).toString('base64url')
      receiver = await startOidcLoopback(state, issuer, signal)
      signal.throwIfAborted()
      const authorize = new URL('/api/auth/oauth2/authorize', issuer)
      authorize.search = new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
        scope: 'openid profile email offline_access', state: `${receiver.port}:${state}`, nonce,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256', prompt: 'login', resource: issuer,
      }).toString()
      const [code] = await Promise.race([
        Promise.all([receiver.result, openAuthorization(authorize.href)]),
        cancelled.promise,
      ])
      signal.throwIfAborted()
      const exchangeSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      const response = await request(tokenEndpoint, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'authorization_code', code, redirect_uri: redirectUri,
          client_id: clientId, code_verifier: verifier, resource: issuer,
        }),
        credentials: 'omit', redirect: 'error', signal: exchangeSignal,
      })
      if (exchangeSignal.aborted || !response.ok) {
        void response.body?.cancel().catch(() => {})
        exchangeSignal.throwIfAborted()
        return { ok: false, code: response.status < 500 ? 'rejected' : 'unavailable' }
      }
      const exchange = await readOidcJson(response, exchangeSignal)
      if (!await owner.establish(exchange, signal, revision, nonce))
        return { ok: false, code: signal.aborted ? 'cancelled' : 'rejected' }
      return { ok: true }
    }
    catch {
      return { ok: false, code: signal.aborted ? 'cancelled' : 'unavailable' }
    }
    finally {
      signal.removeEventListener('abort', abort)
      receiver?.close()
      active = undefined
    }
  }

  return { login, cancel: () => active?.abort() }
}
