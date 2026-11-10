import { Buffer } from 'node:buffer'

import { createLiaSecretVault } from '@lia/core/secrets/vault'
import { describe, expect, it, vi } from 'vitest'

import { oidcSessionScope } from '../lia/secrets-service'
import { createOidcAccountService } from './oidc-account'
import { createOidcSessionOwner } from './oidc-session'

const origin = new URL('https://issuer.example')
const signal = () => new AbortController().signal
const privateCheck = expect.any(Function)
const exchange = { access_token: 'SYNTHETIC_ACCESS', refresh_token: 'SYNTHETIC_REFRESH', id_token: 'SYNTHETIC_ID', expires_in: 1 }
const rotated = { ...exchange, access_token: 'ROTATED_ACCESS', refresh_token: 'ROTATED_REFRESH' }

function setup() {
  let disk: string | undefined
  let time = 10_000
  let beforeWrite: (() => void) | undefined
  const fetch = vi.fn<typeof globalThis.fetch>()
  function makeVault() {
    return createLiaSecretVault({
      filePath: 'test-vault.json',
      // Test fixture cipher. The Electron adapter supplies safeStorage.
      cipher: { available: () => true, encrypt: text => Buffer.from(text).reverse(), decrypt: bytes => bytes.reverse().toString() },
      read: () => {
        if (disk === undefined)
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        return disk
      },
      write: async (_, content, signal) => {
        beforeWrite?.()
        signal?.throwIfAborted()
        disk = content
      },
    })
  }
  const vault = makeVault()
  const options = { origin, clientId: 'desktop', fetch, now: () => time }
  return {
    vault,
    owner: createOidcSessionOwner({ ...options, vault }),
    fetch,
    expire: () => { time += 1000 },
    restore: (issuer = origin) => createOidcSessionOwner({ ...options, origin: issuer, vault: makeVault() }),
    disk: () => disk,
    beforeWrite: (hook: () => void) => { beforeWrite = hook },
  }
}

describe('main-only OIDC session owner', () => {
  it('accepts trusted login data, stores only ciphertext and restores for the same issuer', async () => {
    const { owner, restore, disk } = setup()
    expect(await owner.establish(exchange, signal(), owner.beginLogin()!)).toBe(true)
    expect(disk()).toContain('session-v1')
    for (const secret of [exchange.access_token, exchange.refresh_token, exchange.id_token])
      expect(disk()).not.toContain(secret)
    const internal = vi.fn(async () => ({ status: 'signed-in' }))
    expect(await restore().withAccess(signal(), internal)).toEqual({ status: 'signed-in' })
    expect(internal).toHaveBeenCalledExactlyOnceWith(exchange.access_token, expect.any(AbortSignal), privateCheck)
    expect(await restore(new URL('https://other.example')).withAccess(signal(), internal)).toBeUndefined()
    expect(internal).toHaveBeenCalledOnce()
  })

  it('rejects malformed token responses and HTTP origins outside loopback', async () => {
    const { owner, vault } = setup()
    expect(await owner.establish({ ...exchange, access_token: 'bad\r\nheader' }, signal(), owner.beginLogin()!)).toBe(false)
    expect(await owner.establish({ ...exchange, expires_in: 0 }, signal(), owner.beginLogin()!)).toBe(false)
    expect(vault.hasSecret(oidcSessionScope, 'session-v1')).toBe(false)
    expect(() => createOidcSessionOwner({ origin: new URL('http://issuer.example'), clientId: 'desktop', vault })).toThrow('Invalid desktop OIDC origin')
  })

  it('shares one refresh across windows and persists rotated credentials', async () => {
    const { owner, fetch, expire, restore } = setup()
    await owner.establish(exchange, signal(), owner.beginLogin()!)
    expire()
    const response = Promise.withResolvers<Response>()
    fetch.mockReturnValue(response.promise)
    const call = vi.fn(async () => true)
    const first = owner.withAccess(signal(), call)
    const second = owner.withAccess(signal(), call)
    expect(fetch).toHaveBeenCalledOnce()
    expect(call).not.toHaveBeenCalled()
    response.resolve(Response.json(rotated))
    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(await restore().withAccess(signal(), call)).toBe(true)
    expect(call.mock.calls).toEqual(Array.from({ length: 3 }, () => [rotated.access_token, expect.any(AbortSignal), privateCheck]))
  })

  it('does not reuse an expired token after a failed refresh and clears invalid grants', async () => {
    const { owner, vault, fetch, expire } = setup()
    await owner.establish(exchange, signal(), owner.beginLogin()!)
    expire()
    const call = vi.fn()
    fetch.mockResolvedValueOnce(Response.json({ error: 'SYNTHETIC_PRIVATE_ERROR' }, { status: 503 }))
    expect(await owner.withAccess(signal(), call)).toBeUndefined()
    expect(vault.hasSecret(oidcSessionScope, 'session-v1')).toBe(true)
    fetch.mockResolvedValueOnce(Response.json({ error: 'invalid_grant', error_description: 'SYNTHETIC_PRIVATE_ERROR' }, { status: 400 }))
    expect(await owner.withAccess(signal(), call)).toBeUndefined()
    await vi.waitFor(() => expect(vault.hasSecret(oidcSessionScope, 'session-v1')).toBe(false))
    expect(call).not.toHaveBeenCalled()
  })

  it('requires sign-in after persistence fails for a rotated refresh token', async () => {
    const { owner, vault, fetch, expire } = setup()
    await owner.establish(exchange, signal(), owner.beginLogin()!)
    expire()
    vi.spyOn(vault, 'changeSecret').mockResolvedValueOnce(undefined)
    fetch.mockResolvedValueOnce(Response.json(rotated))
    const call = vi.fn()
    expect(await owner.withAccess(signal(), call)).toBeUndefined()
    expect(await owner.withAccess(signal(), call)).toBeUndefined()
    expect(fetch).toHaveBeenCalledOnce()
    expect(call).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(vault.hasSecret(oidcSessionScope, 'session-v1')).toBe(false))
  })

  it('revokes in the Main, clears persistence and rejects a late refresh after logout', async () => {
    const { owner, fetch, expire, restore, vault } = setup()
    await owner.establish(exchange, signal(), owner.beginLogin()!)
    expire()
    const response = Promise.withResolvers<Response>()
    fetch.mockReturnValueOnce(response.promise).mockResolvedValueOnce(new Response(null, { status: 200 }))
    const call = vi.fn()
    const pending = owner.withAccess(signal(), call)
    expect(await owner.logout()).toEqual({ cleared: true, revocation: 'accepted' })
    expect(await pending).toBeUndefined()
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    const [url, request] = fetch.mock.calls[1]!
    expect(String(url)).toBe(`${origin.origin}/api/auth/oauth2/revoke`)
    expect(request?.redirect).toBe('error')
    expect((request?.body as URLSearchParams | undefined)?.get('token')).toBe(exchange.refresh_token)
    const late = Response.json(rotated)
    const cancel = vi.spyOn(late.body!, 'cancel')
    response.resolve(late)
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    expect(vault.hasSecret(oidcSessionScope, 'session-v1')).toBe(false)
    expect(await restore().withAccess(signal(), call)).toBeUndefined()
    expect(call).not.toHaveBeenCalled()
  })

  it('discards a closed window result without aborting another window request', async () => {
    const { owner } = setup()
    await owner.establish(exchange, signal(), owner.beginLogin()!)
    const first = new AbortController()
    const response = Promise.withResolvers<string>()
    const read = owner.withAccess(first.signal, () => response.promise)
    first.abort()
    expect(await read).toBeUndefined()
    expect(await owner.withAccess(signal(), async () => 'current')).toBe('current')
    response.resolve('late')
  })

  it('keeps the previous session when a login is cancelled before vault commit', async () => {
    const { owner, beforeWrite, restore } = setup()
    await owner.establish(exchange, signal(), owner.beginLogin()!)
    const candidate = new AbortController()
    beforeWrite(() => candidate.abort())
    expect(await owner.establish(rotated, candidate.signal, owner.beginLogin()!)).toBe(false)
    const call = vi.fn(async () => true)
    expect(await restore().withAccess(signal(), call)).toBe(true)
    expect(call).toHaveBeenCalledExactlyOnceWith(exchange.access_token, expect.any(AbortSignal), privateCheck)
  })

  it('supplies the bearer internally and projects an account DTO without session credentials', async () => {
    const { owner, fetch } = setup()
    await owner.establish(exchange, signal(), owner.beginLogin()!)
    const account = createOidcAccountService({ origin, fetch, withAccess: owner.withAccess })
    const profile = { id: 'user-1', name: 'Lia', email: 'lia@example.test', image: null }
    fetch.mockResolvedValueOnce(Response.json({ user: profile, session: { token: exchange.access_token, refreshToken: exchange.refresh_token } }))
    expect(await account.execute({ kind: 'get-profile' }, signal())).toEqual({ ok: true, profile })
    expect(fetch).toHaveBeenCalledExactlyOnceWith(new URL('/api/auth/get-session', origin), expect.objectContaining({
      headers: { Authorization: `Bearer ${exchange.access_token}` },
      redirect: 'error',
    }))
    fetch.mockResolvedValueOnce(Response.json({ user: { ...profile, name: exchange.id_token } }))
    expect(await account.execute({ kind: 'get-profile' }, signal())).toEqual({ ok: false, code: 'unavailable' })
  })

  it('suppresses a response from an authenticated operation after a different login succeeds', async () => {
    const { owner } = setup()
    await owner.establish(exchange, signal(), owner.beginLogin()!)
    const previous = Promise.withResolvers<string>()
    const pending = owner.withAccess(signal(), () => previous.promise)
    expect(await owner.establish(rotated, signal(), owner.beginLogin()!)).toBe(true)
    expect(await pending).toBeUndefined()
    previous.resolve('late')
    expect(await owner.withAccess(signal(), async token => token === rotated.access_token)).toBe(true)
  })

  it('rejects a pending login when another owner logs out while no session exists', async () => {
    const { owner, restore } = setup()
    const revision = owner.beginLogin()!
    expect(await restore().logout()).toEqual({ cleared: true, revocation: 'absent' })
    expect(await owner.establish(exchange, signal(), revision)).toBe(false)
    expect(await restore().withAccess(signal(), async () => true)).toBeUndefined()
  })

  it.each(['logout', 'replacement', 'invalid-grant'] as const)('fences a refresh against another owner’s %s', async (operation) => {
    const { owner, restore, fetch, expire } = setup()
    await owner.establish(exchange, signal(), owner.beginLogin()!)
    const other = restore()
    expire()
    const pendingResponse = Promise.withResolvers<Response>()
    fetch.mockReturnValueOnce(pendingResponse.promise).mockResolvedValue(new Response(null, { status: 200 }))
    const call = vi.fn(async () => true)
    const pending = owner.withAccess(signal(), call)
    const logout = operation === 'logout'
    if (logout)
      expect((await other.logout()).cleared).toBe(true)
    else
      expect(await other.establish(rotated, signal(), other.beginLogin()!)).toBe(true)

    pendingResponse.resolve(operation === 'invalid-grant'
      ? Response.json({ error: 'invalid_grant' }, { status: 400 })
      : Response.json({ ...rotated, access_token: 'STALE_ROTATION' }))
    expect(await pending).toBeUndefined()
    expect(call).not.toHaveBeenCalled()
    expect(await restore().withAccess(signal(), async token => token === rotated.access_token)).toBe(logout ? undefined : true)
  })
})
