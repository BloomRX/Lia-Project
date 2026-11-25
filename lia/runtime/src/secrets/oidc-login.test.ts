import { createHash } from 'node:crypto'

import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it, vi } from 'vitest'

import { createOidcLogin } from './oidc-login'
import { createOidcSessionOwner } from './oidc-session'
import { createLiaSecretVault } from './vault'

// A persistência injetada vive na memória desta suíte. O lock do Windows
// continua sob teste em vault-process.test.ts e no gate Electron.
vi.mock('./vault-lock', () => {
  let pending: Promise<unknown> = Promise.resolve()
  return {
    withVaultWriteLock<T>(write: () => Promise<T>, signal?: AbortSignal) {
      const operation = pending.then(() => {
        signal?.throwIfAborted()
        return write()
      })
      pending = operation.catch(() => {})
      return operation
    },
  }
})

const issuer = new URL('https://issuer.example.test')
const clientId = 'lia-fixture'

async function deliver(url: URL, code = 'fixture-code') {
  const [port, state] = url.searchParams.get('state')!.split(':')
  const receiver = new URL(`http://127.0.0.1:${port}/callback`)
  receiver.search = new URLSearchParams({ state, code }).toString()
  const response = await fetch(receiver, { headers: { Origin: issuer.origin } })
  expect(response.status).toBe(200)
  return receiver
}

describe('Main authorization code flow', () => {
  it('exchanges PKCE, verifies a signed identity and commits only through the existing vault', async () => {
    const pair = await generateKeyPair('ES256')
    let disk = '{}'
    const vault = createLiaSecretVault({
      filePath: 'oidc-login-fixture', read: () => disk, write: async (_, contents) => { disk = contents },
      cipher: { available: () => true, encrypt: text => Buffer.from(text), decrypt: bytes => bytes.toString() },
    })
    let authorization: URL
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      expect(init?.redirect).toBe('error')
      expect(init?.credentials).toBe('omit')
      if (String(url) === `${issuer.origin}/api/auth/jwks`)
        return Response.json({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'fixture' }] })
      expect(String(url)).toBe(`${issuer.origin}/api/auth/oauth2/token`)
      const fields = init?.body as URLSearchParams
      expect(fields.get('code')).toBe('fixture-code')
      expect(fields.get('redirect_uri')).toBe(authorization.searchParams.get('redirect_uri'))
      expect(createHash('sha256').update(fields.get('code_verifier')!).digest('base64url')).toBe(authorization.searchParams.get('code_challenge'))
      const token = await new SignJWT({ nonce: authorization.searchParams.get('nonce') })
        .setProtectedHeader({ alg: 'ES256', kid: 'fixture' })
        .setIssuer(`${issuer.origin}/api/auth`).setAudience(clientId).setSubject('account-fixture').setIssuedAt().setExpirationTime('1m').sign(pair.privateKey)
      return Response.json({ access_token: 'FIXTURE_ACCESS', refresh_token: 'FIXTURE_REFRESH', id_token: token, expires_in: 60 })
    })
    const owner = createOidcSessionOwner({ vault, origin: issuer, clientId, fetch: transport })
    const login = createOidcLogin({
      origin: issuer, clientId, owner, fetch: transport,
      async openAuthorization(url) {
        authorization = new URL(url)
        expect(authorization.origin).toBe(issuer.origin)
        expect(authorization.pathname).toBe('/api/auth/oauth2/authorize')
        await deliver(authorization)
      },
    })
    const signal = new AbortController().signal
    expect(await login.login(signal)).toEqual({ ok: true })
    expect(disk).not.toMatch(/FIXTURE_ACCESS|FIXTURE_REFRESH/)
    expect(await owner.withAccess(signal, async token => token === 'FIXTURE_ACCESS')).toBe(true)
  })

  it('cancels even if the browser adapter remains pending after the callback', async () => {
    const callbackFinished = Promise.withResolvers<void>()
    const browser = Promise.withResolvers<void>()
    const beginLogin = vi.fn(() => 'revision')
    const transport = vi.fn<typeof fetch>()
    const login = createOidcLogin({
      origin: issuer, clientId, owner: { beginLogin, establish: vi.fn() }, fetch: transport,
      async openAuthorization(url) {
        await deliver(new URL(url))
        callbackFinished.resolve()
        await browser.promise
      },
    })
    const pending = login.login(new AbortController().signal)
    await callbackFinished.promise
    expect(await login.login(new AbortController().signal)).toEqual({ ok: false, code: 'unavailable' })
    login.cancel()
    expect(await pending).toEqual({ ok: false, code: 'cancelled' })
    browser.reject(new Error('late browser failure'))
    expect(transport).not.toHaveBeenCalled()
  })
})
