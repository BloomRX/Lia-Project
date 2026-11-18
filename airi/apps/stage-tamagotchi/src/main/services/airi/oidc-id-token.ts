import type { JSONWebKeySet } from 'jose'

import { createLocalJWKSet, jwtVerify } from 'jose'

import { readOidcJson } from './oidc-json'

export interface VerifiedOidcIdentity {
  subject: string
}

export type VerifyOidcIdToken = (token: string | undefined, expected: { nonce?: string, subject?: string, renewal?: boolean }, signal: AbortSignal) => Promise<VerifiedOidcIdentity>

/** Only the Main-configured issuer may provide keys. Token headers cannot select an endpoint. */
export function createOidcIdTokenVerifier(options: { origin: URL, clientId: string, fetch?: typeof fetch, now?: () => number }): VerifyOidcIdToken {
  const { origin, clientId } = options
  const local = ['127.0.0.1', '[::1]'].includes(origin.hostname)
  if (!(origin.protocol === 'https:' || (origin.protocol === 'http:' && local))
    || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !clientId)
    throw new Error('Invalid desktop OIDC issuer')

  const issuer = new URL('/api/auth', origin).href
  const jwksUrl = new URL('/api/auth/jwks', origin)
  const fetchKeys = options.fetch ?? globalThis.fetch
  const now = options.now ?? Date.now
  return async (token, expected, signal) => {
    if (!token || token.length > 16_384)
      throw new Error('OIDC ID token was invalid')
    const verificationSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
    const response = await fetchKeys(jwksUrl, { credentials: 'omit', redirect: 'error', signal: verificationSignal })
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      throw new Error('OIDC signing keys were unavailable')
    }
    const jwks = await readOidcJson(response, verificationSignal)
    if (!jwks || typeof jwks !== 'object' || !('keys' in jwks) || !Array.isArray(jwks.keys) || !jwks.keys.length || jwks.keys.length > 32)
      throw new Error('OIDC signing keys were invalid')

    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks as JSONWebKeySet), {
      algorithms: ['EdDSA', 'ES256', 'RS256'],
      audience: clientId,
      currentDate: new Date(now()),
      issuer,
      requiredClaims: ['sub', 'iat', 'exp'],
    })
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
    const checkNonce = expected.nonce !== undefined && (!expected.renewal || payload.nonce !== undefined)
    if (audiences.length !== 1 || (payload.azp !== undefined && payload.azp !== clientId)
      || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 1024
      || typeof payload.iat !== 'number' || !Number.isSafeInteger(payload.iat) || payload.iat > Math.floor(now() / 1000)
      || (checkNonce && payload.nonce !== expected.nonce)
      || (expected.subject !== undefined && payload.sub !== expected.subject))
      throw new Error('OIDC identity claims were invalid')
    verificationSignal.throwIfAborted()
    return { subject: payload.sub }
  }
}
