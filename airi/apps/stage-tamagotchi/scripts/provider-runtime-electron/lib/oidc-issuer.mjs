import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'

import { exportJWK, generateKeyPair, SignJWT } from 'jose'

export async function startOidcFixtureIssuer() {
  const client = 'lia-electron-oidc-fixture'
  const access = `synthetic-oidc-access-${randomUUID()}`
  const refresh = `synthetic-oidc-refresh-${randomUUID()}`
  const rotated = `synthetic-oidc-rotated-${randomUUID()}`
  const privateValues = [access, refresh, rotated]
  const signing = await generateKeyPair('ES256')
  const jwk = { ...await exportJWK(signing.publicKey), kid: 'fixture-key', use: 'sig' }
  const consumed = new Map()
  const counts = { wrongStateRejected: 0, exchanged: 0, refreshed: 0, authenticatedProfiles: 0, revoked: 0 }
  let origin
  let variant = 'valid'
  let refreshAllowed = true
  let revoked = false
  const reply = (response, value, status = 200) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin)
      const params = url.searchParams
      if (request.method === 'GET' && url.pathname === '/api/auth/oauth2/authorize') {
        const [port, state] = (params.get('state') ?? '').split(':')
        const redirect = `${origin}/api/auth/oidc/electron-callback`
        const nonce = params.get('nonce')
        const challenge = params.get('code_challenge')
        if (!/^\d{4,5}$/.test(port) || Number(port) > 65535 || !state || !nonce || nonce === state
          || params.get('client_id') !== client || params.get('redirect_uri') !== redirect
          || params.get('code_challenge_method') !== 'S256' || !challenge) {
          return reply(response, {}, 400)
        }
        const code = `synthetic-oidc-code-${randomUUID()}`
        privateValues.push(code)
        const callback = new URL(`http://127.0.0.1:${port}/callback`)
        callback.searchParams.set('code', code)
        callback.searchParams.set('state', 'rejected-fixture-state')
        const tampered = await fetch(callback)
        await tampered.body?.cancel()
        if (tampered.status !== 400)
          return reply(response, {}, 400)
        counts.wrongStateRejected++
        consumed.set(code, { nonce, challenge, redirect })
        callback.searchParams.set('state', state)
        const correct = await fetch(callback)
        await correct.body?.cancel()
        return reply(response, {}, correct.status)
      }
      if (request.method === 'GET' && url.pathname === '/api/auth/jwks')
        return reply(response, { keys: [jwk] })
      if (request.method === 'GET' && url.pathname === '/api/auth/get-session') {
        if (revoked || ![`Bearer ${access}`, `Bearer ${rotated}`].includes(request.headers.authorization))
          return reply(response, {}, 401)
        counts.authenticatedProfiles++
        return reply(response, { user: { id: 'fixture-account', name: 'Conta de teste', email: 'fixture@example.invalid' }, session: { token: access } })
      }
      if (request.method !== 'POST')
        return reply(response, {}, 404)
      let raw = ''
      for await (const chunk of request) {
        raw += chunk
        if (raw.length > 16_384)
          return reply(response, {}, 413)
      }
      const body = new URLSearchParams(raw)
      if (body.get('client_id') !== client)
        return reply(response, { error: 'invalid_client' }, 400)
      if (url.pathname === '/api/auth/oauth2/revoke') {
        if (body.get('token') !== refresh)
          return reply(response, {}, 400)
        revoked = true
        counts.revoked++
        return reply(response, {})
      }
      if (url.pathname !== '/api/auth/oauth2/token' || body.get('resource') !== origin)
        return reply(response, {}, 404)
      if (body.get('grant_type') === 'refresh_token') {
        if (revoked || !refreshAllowed || body.get('refresh_token') !== refresh)
          return reply(response, { error: 'invalid_grant' }, 400)
        counts.refreshed++
        return reply(response, { access_token: rotated, expires_in: 60 })
      }
      const code = body.get('code')
      const pending = consumed.get(code)
      consumed.delete(code)
      const challenge = createHash('sha256').update(body.get('code_verifier') ?? '').digest('base64url')
      if (body.get('grant_type') !== 'authorization_code' || !pending || pending.challenge !== challenge || pending.redirect !== body.get('redirect_uri'))
        return reply(response, { error: 'invalid_grant' }, 400)
      counts.exchanged++
      const now = Math.floor(Date.now() / 1000)
      const identity = await new SignJWT({
        nonce: variant === 'nonce' ? 'wrong-fixture-nonce' : pending.nonce,
      }).setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).setIssuer(variant === 'issuer' ? 'https://wrong.example.invalid/api/auth' : `${origin}/api/auth`).setAudience(variant === 'audience' ? 'another-fixture-client' : client).setSubject('fixture-account').setIssuedAt(now).setExpirationTime(variant === 'expired' ? now - 1 : now + 60).sign(signing.privateKey)
      privateValues.push(identity)
      revoked = false
      return reply(response, { access_token: access, refresh_token: refresh, id_token: identity, expires_in: 2 })
    }
    catch {
      if (!response.headersSent)
        reply(response, {}, 500)
      else
        response.destroy()
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin,
    counts,
    privateValues,
    select: (next) => { variant = next },
    rejectRefresh: () => { refreshAllowed = false },
    async close() {
      const closed = once(server, 'close')
      server.close()
      server.closeAllConnections()
      await closed
    },
  }
}
