import type { LiaSecretVault } from '../lia/secrets'

import { oidcSessionScope, serializeWrite } from '../lia/secrets-service'

const sessionKey = 'session-v1'
const maxTokenLength = 16_384
const maxResponseBytes = 96 * 1024

interface Tokens {
  accessToken: string
  refreshToken?: string
  idToken?: string
  expiresAt: number
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && value.length <= maxTokenLength && /^[\x21-\x7E]+$/.test(value)
}

function fromExchange(value: unknown, now: number, previous?: Tokens): Tokens | undefined {
  const data = record(value)
  if (!data || !validToken(data.access_token) || typeof data.expires_in !== 'number'
    || !Number.isSafeInteger(data.expires_in) || data.expires_in <= 0
    || (data.refresh_token !== undefined && !validToken(data.refresh_token))
    || (data.id_token !== undefined && !validToken(data.id_token))) {
    return undefined
  }

  const expiresAt = now + data.expires_in * 1000
  if (!Number.isSafeInteger(expiresAt))
    return undefined
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previous?.refreshToken,
    idToken: data.id_token ?? previous?.idToken,
    expiresAt,
  }
}

/** Stop waiting without cancelling work shared by a different window. */
async function whileActive<T>(work: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  let onAbort: () => void = () => {}
  const cancelled = new Promise<undefined>((resolve) => {
    onAbort = () => resolve(undefined)
    if (signal.aborted)
      onAbort()
    else
      signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    const result = await Promise.race([work, cancelled])
    return signal.aborted ? undefined : result
  }
  catch (error) {
    if (!signal.aborted)
      throw error
    return undefined
  }
  finally {
    signal.removeEventListener('abort', onAbort)
  }
}

async function readTokenResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader)
    return undefined
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', cancel, { once: true })
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      signal.throwIfAborted()
      if (chunk.done)
        return JSON.parse(text + decoder.decode()) as unknown
      bytes += chunk.value.byteLength
      if (bytes > maxResponseBytes)
        return undefined
      text += decoder.decode(chunk.value, { stream: true })
    }
  }
  finally {
    signal.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}

/** Main-only session owner. Instantiate once with the Stage's existing vault. */
export function createOidcSessionOwner(options: {
  vault: LiaSecretVault
  origin: URL
  clientId: string
  fetch?: typeof fetch
  now?: () => number
}) {
  const { vault, clientId } = options
  const origin = options.origin.origin
  const request = options.fetch ?? globalThis.fetch
  const now = options.now ?? Date.now
  const { protocol, hostname, username, password, pathname, search, hash } = options.origin
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  if ((protocol !== 'https:' && (protocol !== 'http:' || !loopback)) || username || password || pathname !== '/' || search || hash) {
    throw new Error('Invalid desktop OIDC origin')
  }

  function restore(): Tokens | undefined {
    try {
      const value = record(JSON.parse(vault.getSecret(oidcSessionScope, sessionKey) ?? 'null'))
      if (value?.origin !== origin || value.clientId !== clientId || !validToken(value.accessToken)
        || typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt)
        || (value.refreshToken !== undefined && !validToken(value.refreshToken))
        || (value.idToken !== undefined && !validToken(value.idToken))) {
        return undefined
      }
      return { accessToken: value.accessToken, refreshToken: value.refreshToken, idToken: value.idToken, expiresAt: value.expiresAt }
    }
    catch {
      // Leave unreadable storage alone. A new explicit login may replace it.
      return undefined
    }
  }

  let tokens = restore()
  let generation = new AbortController()
  let pendingLogin = new AbortController()
  let logoutRevision = 0
  let refreshing: Promise<Tokens | undefined> | undefined

  function invalidate() {
    generation.abort()
    generation = new AbortController()
    refreshing = undefined
    tokens = undefined
  }

  const save = (value: Tokens, signal: AbortSignal) => vault.setSecret(oidcSessionScope, sessionKey, JSON.stringify({ ...value, origin, clientId }), signal)

  async function store(value: Tokens, signal: AbortSignal): Promise<boolean> {
    return serializeWrite(vault, async () => {
      const saved = await save(value, signal)
      if (signal.aborted)
        return false
      if (!saved) {
        // The issuer may have consumed the old refresh token already.
        invalidate()
        await vault.deleteSecret(oidcSessionScope, sessionKey)
        return false
      }
      tokens = value
      return true
    })
  }

  async function establish(exchange: unknown, caller: AbortSignal): Promise<boolean> {
    const value = fromExchange(exchange, now())
    if (!value || caller.aborted)
      return false
    pendingLogin.abort()
    pendingLogin = new AbortController()
    const signal = AbortSignal.any([pendingLogin.signal, caller])
    const revision = logoutRevision
    return serializeWrite(vault, async () => {
      if (!await save(value, signal))
        return false
      // A completed atomic replacement is the login commit point. Logout
      // invalidates first and removes the stored entry in this same write lane.
      if (revision !== logoutRevision)
        return false
      invalidate()
      tokens = value
      return true
    })
  }

  function post(path: '/api/auth/oauth2/token' | '/api/auth/oauth2/revoke', fields: Record<string, string>, signal: AbortSignal) {
    return request(new URL(path, origin), {
      method: 'POST',
      body: new URLSearchParams({ ...fields, client_id: clientId }),
      credentials: 'omit',
      redirect: 'error',
      signal,
    })
  }

  async function renew(previous: Tokens, generationSignal: AbortSignal): Promise<Tokens | undefined> {
    if (!previous.refreshToken)
      return undefined
    const signal = AbortSignal.any([generationSignal, AbortSignal.timeout(15_000)])
    try {
      const response = await post('/api/auth/oauth2/token', {
        grant_type: 'refresh_token',
        refresh_token: previous.refreshToken,
        resource: origin,
      }, signal)
      if (signal.aborted || (!response.ok && response.status !== 400 && response.status !== 401)) {
        void response.body?.cancel().catch(() => {})
        return undefined
      }
      const body = await readTokenResponse(response, signal)
      if (signal.aborted)
        return undefined
      if (!response.ok) {
        if (record(body)?.error === 'invalid_grant') {
          await serializeWrite(vault, async () => {
            if (!generationSignal.aborted) {
              invalidate()
              await vault.deleteSecret(oidcSessionScope, sessionKey)
            }
          })
        }
        return undefined
      }
      const next = fromExchange(body, now(), previous)
      return next && await store(next, generationSignal) ? next : undefined
    }
    catch {
      // HTTP failures, invalid bodies and aborts never carry upstream details out.
      return undefined
    }
  }

  async function withAccess<T>(caller: AbortSignal, action: (accessToken: string, signal: AbortSignal, containsPrivateValue: (text: string) => boolean) => Promise<T>): Promise<T | undefined> {
    const signal = AbortSignal.any([generation.signal, caller])
    if (!tokens || signal.aborted)
      return undefined

    let current: Tokens | undefined = tokens
    if (current.expiresAt <= now()) {
      if (!refreshing) {
        const pending = renew(current, generation.signal).finally(() => {
          if (refreshing === pending)
            refreshing = undefined
        })
        refreshing = pending
      }
      current = await whileActive(refreshing, signal)
    }
    if (!current || signal.aborted || current.expiresAt <= now())
      return undefined
    const secrets = [current.accessToken, current.refreshToken, current.idToken]
    return whileActive(action(current.accessToken, signal, text => secrets.some(secret => secret !== undefined && text.includes(secret))), signal)
  }

  async function logout(): Promise<{ cleared: boolean, revocation: 'accepted' | 'failed' | 'absent' }> {
    const previous = tokens
    logoutRevision++
    pendingLogin.abort()
    invalidate()
    const cleared = await serializeWrite(vault, () => vault.deleteSecret(oidcSessionScope, sessionKey))
    if (!previous)
      return { cleared, revocation: 'absent' }
    try {
      const response = await post('/api/auth/oauth2/revoke', {
        token: previous.refreshToken ?? previous.accessToken,
        token_type_hint: previous.refreshToken ? 'refresh_token' : 'access_token',
      }, AbortSignal.timeout(15_000))
      void response.body?.cancel().catch(() => {})
      return { cleared, revocation: response.ok ? 'accepted' : 'failed' }
    }
    catch {
      return { cleared, revocation: 'failed' }
    }
  }

  return { establish, withAccess, logout }
}
