import type { JWTPayload } from 'jose'

import { once } from 'node:events'
import { createServer } from 'node:http'

import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { expect, it } from 'vitest'

import { createOidcIdTokenVerifier } from './oidc-id-token'

it('validates a signed identity using the configured loopback issuer over HTTP', async () => {
  const signing = await generateKeyPair('ES256')
  const unrelated = await generateKeyPair('ES256')
  const jwk = await exportJWK(signing.publicKey)
  const requests: { url?: string, authenticated: boolean }[] = []
  const server = createServer((request, response) => {
    requests.push({ url: request.url, authenticated: !!request.headers.authorization })
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ keys: [{ ...jwk, use: 'sig', kid: 'fixture-key' }] }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Missing test issuer')
    const origin = new URL(`http://127.0.0.1:${address.port}`)
    const claims: JWTPayload = { iss: new URL('/api/auth', origin).href, aud: 'stage-fixture', sub: 'synthetic-account', exp: 1060, iat: 1000, nonce: 'attempt-one' }
    const mint = (overrides: JWTPayload = {}, key = signing.privateKey) => new SignJWT({ ...claims, ...overrides })
      .setProtectedHeader({ alg: 'ES256', kid: 'fixture-key' })
      .sign(key)
    const verify = createOidcIdTokenVerifier({ origin, clientId: 'stage-fixture', now: () => 1_000_000 })
    const signal = new AbortController().signal
    const expected = { nonce: 'attempt-one', subject: 'synthetic-account' }

    await expect(verify(await mint(), expected, signal)).resolves.toEqual({ subject: 'synthetic-account' })
    for (const overrides of [
      { iss: 'https://untrusted.example/api/auth' },
      { aud: 'another-client' },
      { aud: ['stage-fixture', 'another-client'] },
      { azp: 'another-client' },
      { exp: 900 },
      { iat: 1010 },
      { nonce: 'attempt-two' },
      { sub: 'another-account' },
    ]) {
      await expect(verify(await mint(overrides), expected, signal)).rejects.toThrow()
    }
    await expect(verify(await mint({}, unrelated.privateKey), expected, signal)).rejects.toThrow(/^OIDC ID token signature or claims were invalid$/)
    await expect(verify(await mint({ nonce: undefined }), { ...expected, renewal: true }, signal)).resolves.toEqual({ subject: 'synthetic-account' })
    await expect(verify(await mint({ nonce: 'invalid-renewal-nonce' }), { ...expected, renewal: true }, signal)).rejects.toThrow()
    await expect(verify(undefined, expected, signal)).rejects.toThrow('OIDC ID token was invalid')
    await expect(verify(await mint(), expected, AbortSignal.abort())).rejects.toThrow()
    expect(requests).toHaveLength(12)
    expect(requests.every(request => request.url === '/api/auth/jwks' && !request.authenticated)).toBe(true)

  }
  finally {
    server.closeAllConnections()
    server.close()
    await once(server, 'close')
  }
})
