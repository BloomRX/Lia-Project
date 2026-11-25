import { describe, expect, it, vi } from 'vitest'

import { createOidcAccountService } from './oidc-account'

const origin = new URL('https://accounts.example.test')
const accessToken = 'SYNTHETIC_ACCESS_DO_NOT_EXPORT'
const upstreamToken = 'SYNTHETIC_UPSTREAM_TOKEN_DO_NOT_EXPORT'
const refreshToken = 'SYNTHETIC_REFRESH_"/DO_NOT_EXPORT'
const date = '2026-11-09T01:00:00.000Z'
const profile = { id: 'user-123', name: 'Example', email: 'example@example.test', image: 'https://images.example.test/avatar.png' }
const upstreamSession = { user: { ...profile, refreshToken: upstreamToken }, session: { id: 'session-id', token: accessToken } }

function harness() {
  const transport = vi.fn<typeof fetch>()
  const session = new AbortController()
  const caller = new AbortController()
  const hasAccess = vi.fn(() => true)
  async function withAccess<T>(_signal: AbortSignal, action: (token: string, signal: AbortSignal, containsPrivateValue: (text: string) => boolean) => Promise<T>): Promise<T | undefined> {
    const containsPrivateValue = (text: string) => [accessToken, refreshToken, upstreamToken].some(token => text.includes(token))
    return hasAccess() ? await action(accessToken, session.signal, containsPrivateValue) : undefined
  }
  const service = createOidcAccountService({ origin, fetch: transport, withAccess })
  return { execute: (value: unknown) => service.execute(value, caller.signal), transport, session, caller, hasAccess }
}

describe('account REST service for Main OIDC', () => {
  it('returns only profile fields and attaches a Main-owned bearer to the fixed origin', async () => {
    const { execute, transport } = harness()
    transport.mockResolvedValue(Response.json(upstreamSession, { headers: { 'Set-Cookie': `session=${upstreamToken}` } }))
    expect(await execute({ kind: 'get-profile' })).toEqual({ ok: true, profile })
    expect(transport).toHaveBeenCalledExactlyOnceWith(new URL('/api/auth/get-session', origin), {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: undefined,
      credentials: 'omit',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    })
  })

  it('limits linked-account lists to the fields shown in the UI', async () => {
    const { execute, transport } = harness()
    const linked = { providerId: 'github', createdAt: date }
    transport.mockResolvedValueOnce(Response.json([{ ...linked, id: 'link-1', accountId: 'account-1', accessToken, refreshToken, idToken: upstreamToken }]))
    expect(await execute({ kind: 'list-linked-accounts' })).toEqual({ ok: true, linkedAccounts: [linked] })
    expect(transport.mock.calls.map(([url]) => String(url))).toEqual(['https://accounts.example.test/api/auth/list-accounts'])
  })

  it('rejects a reflected token even when JSON or URL escaping would hide the match', async () => {
    const { execute, transport } = harness()
    transport.mockResolvedValueOnce(Response.json({ ...upstreamSession, user: { ...profile, name: `Echo ${refreshToken}` } }))
    transport.mockResolvedValueOnce(Response.json({ ...upstreamSession, user: { ...profile, image: `${profile.image}?echo=${encodeURIComponent(refreshToken)}` } }))
    expect(await execute({ kind: 'get-profile' })).toEqual({ ok: false, code: 'unavailable' })
    expect(await execute({ kind: 'get-profile' })).toEqual({ ok: false, code: 'unavailable' })
  })

  it('omits an unsafe avatar URL without discarding the profile', async () => {
    const { execute, transport } = harness()
    transport.mockResolvedValueOnce(Response.json({ ...upstreamSession, user: { ...profile, image: 'file:///secret' } }))
    expect(await execute({ kind: 'get-profile' })).toEqual({ ok: true, profile: { ...profile, image: null } })
  })

  it('rejects unexpected properties, operation names, URLs and oversized values before using the owner', async () => {
    const { execute, hasAccess, transport } = harness()
    for (const payload of [
      null,
      ['get-profile'],
      { kind: 'get-profile', token: accessToken },
      { kind: 'get-profile', url: 'https://outside.example.test' },
      { kind: 'http', path: '/api/auth/get-access-token' },
      { kind: 'list-sessions' },
      { kind: 'unlink-account', provider: 'credential' },
      { kind: 'update-name', name: 'x'.repeat(257) },
      { kind: 'update-name', name: ' ' },
      { kind: 'request-password-reset', email: 'someone@example.test' },
      { kind: 'delete-account', confirmationEmail: profile.email, callbackURL: 'https://outside.example.test' },
    ]) {
      expect(await execute(payload)).toEqual({ ok: false, code: 'invalid-request' })
    }
    expect(hasAccess).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })

  it.each(['http://outside.example.test', 'https://user:pass@accounts.example.test', 'https://accounts.example.test/path', 'file:///a'])('rejects an invalid Main origin (%s)', (value) => {
    const withAccess = vi.fn()
    expect(() => createOidcAccountService({ origin: new URL(value), withAccess })).toThrow('Invalid account origin')
    expect(withAccess).not.toHaveBeenCalled()
  })

  it('calls fixed update, change-password and unlink operations without replay or credential-bearing replies', async () => {
    const { execute, transport } = harness()
    transport.mockImplementation(async url => new URL(String(url)).pathname.endsWith('/change-password')
      ? Response.json({ token: upstreamToken, user: profile })
      : Response.json({ status: true, token: upstreamToken }))
    expect(await execute({ kind: 'update-name', name: '  Renamed  ' })).toEqual({ ok: true })
    expect(await execute({ kind: 'change-password', currentPassword: 'old-pass', newPassword: 'new-pass' })).toEqual({ ok: true })
    expect(await execute({ kind: 'unlink-account', provider: 'steam' })).toEqual({ ok: true })
    expect(transport.mock.calls.map(([url, init]) => [new URL(String(url)).pathname, init?.method, JSON.parse(String(init?.body))])).toEqual([
      ['/api/auth/update-user', 'POST', { name: 'Renamed' }],
      ['/api/auth/change-password', 'POST', { currentPassword: 'old-pass', newPassword: 'new-pass', revokeOtherSessions: true }],
      ['/api/auth/unlink-account', 'POST', { providerId: 'steam' }],
    ])
  })

  it('uses the authenticated email for reset and verifies the confirmation email before deletion', async () => {
    const { execute, transport } = harness()
    transport.mockImplementation(async url => new URL(String(url)).pathname.endsWith('/get-session')
      ? Response.json(upstreamSession)
      : Response.json({ status: true, success: true, message: upstreamToken }))
    expect(await execute({ kind: 'request-password-reset' })).toEqual({ ok: true })
    expect(await execute({ kind: 'delete-account', confirmationEmail: 'another@example.test' })).toEqual({ ok: false, code: 'confirmation-required' })
    expect(await execute({ kind: 'delete-account', confirmationEmail: ` ${profile.email.toUpperCase()} ` })).toEqual({ ok: true })
    expect(transport.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url, init]) => [new URL(String(url)).pathname, JSON.parse(String(init?.body))])).toEqual([
      ['/api/auth/request-password-reset', { email: profile.email, redirectTo: 'https://accounts.example.test/auth/reset-password' }],
      ['/api/auth/delete-user', { callbackURL: 'https://accounts.example.test/auth/delete-account' }],
    ])
  })

  it('rejects unavailable authentication without issuing a request', async () => {
    const { execute, transport, hasAccess } = harness()
    hasAccess.mockReturnValueOnce(false)
    expect(await execute({ kind: 'get-profile' })).toEqual({ ok: false, code: 'unauthenticated' })
    expect(transport).not.toHaveBeenCalled()
  })

  it('returns only safe failure codes for response bodies, redirects and transport errors', async () => {
    const { execute, transport } = harness()
    const rejected = Response.json({ token: upstreamToken }, { status: 401 })
    const cancelBody = vi.spyOn(rejected.body!, 'cancel')
    transport.mockResolvedValueOnce(rejected)
    transport.mockResolvedValueOnce(Response.redirect('https://outside.example.test'))
    transport.mockRejectedValueOnce(new Error(`Transport contained ${upstreamToken}`))
    expect(await execute({ kind: 'update-name', name: 'Alice' })).toEqual({ ok: false, code: 'unauthenticated' })
    expect(cancelBody).toHaveBeenCalledOnce()
    expect(await execute({ kind: 'get-profile' })).toEqual({ ok: false, code: 'rejected' })
    expect(await execute({ kind: 'get-profile' })).toEqual({ ok: false, code: 'unavailable' })
    expect(transport).toHaveBeenCalledTimes(3)
  })

  it('maps operation-specific Better Auth rejections without forwarding their messages or unknown codes', async () => {
    const { execute, transport } = harness()
    const change = { kind: 'change-password', currentPassword: 'old-pass', newPassword: 'new-pass' }
    const unlink = { kind: 'unlink-account', provider: 'github' }
    for (const [operation, code, expected] of [
      [change, 'INVALID_PASSWORD', 'invalid-password'],
      [change, 'PASSWORD_TOO_SHORT', 'password-too-short'],
      [change, 'PASSWORD_TOO_LONG', 'password-too-long'],
      [change, 'CREDENTIAL_ACCOUNT_NOT_FOUND', 'password-unset'],
      [unlink, 'FAILED_TO_UNLINK_LAST_ACCOUNT', 'last-sign-in-method'],
      [unlink, 'INVALID_PASSWORD', 'rejected'],
      [change, upstreamToken, 'rejected'],
    ] as const) {
      transport.mockResolvedValueOnce(Response.json({ code, message: upstreamToken, token: accessToken }, { status: 400 }))
      expect(await execute(operation)).toEqual({ ok: false, code: expected })
    }
    transport.mockResolvedValueOnce(Response.json({ code: 'INVALID_PASSWORD', message: 'x'.repeat(8 * 1024) }, { status: 400 }))
    expect(await execute(change)).toEqual({ ok: false, code: 'rejected' })
  })

  it('rejects malformed and oversized upstream data without releasing it', async () => {
    const { execute, transport } = harness()
    transport.mockResolvedValueOnce(Response.json({ user: { id: 'only-an-id' } }))
    transport.mockResolvedValueOnce(Response.json({ user: profile, padding: 'x'.repeat(257 * 1024) }))
    expect(await execute({ kind: 'get-profile' })).toEqual({ ok: false, code: 'unavailable' })
    expect(await execute({ kind: 'get-profile' })).toEqual({ ok: false, code: 'unavailable' })
  })

  it('requires the upstream acknowledgement before reporting a mutation as successful', async () => {
    const { execute, transport } = harness()
    transport.mockResolvedValueOnce(Response.json({ status: false, message: upstreamToken }))
    expect(await execute({ kind: 'update-name', name: 'Example' })).toEqual({ ok: false, code: 'unavailable' })
  })

  it.each(['caller', 'session'] as const)('cancels stalled response reads when the %s closes', async (source) => {
    const rig = harness()
    const stalled = Promise.withResolvers<void>()
    const cancel = vi.fn()
    const response = new Response(new ReadableStream<Uint8Array>({ pull: () => stalled.resolve(), cancel }))
    rig.transport.mockResolvedValue(response)
    const running = rig.execute({ kind: 'get-profile' })
    await stalled.promise
    rig[source].abort()
    expect(await running).toEqual({ ok: false, code: 'cancelled' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('drops a transport response that completes after the originating window is cancelled', async () => {
    const { execute, transport, caller } = harness()
    const late = Promise.withResolvers<Response>()
    transport.mockReturnValueOnce(late.promise)
    const running = execute({ kind: 'get-profile' })
    expect(transport).toHaveBeenCalledOnce()
    caller.abort()
    late.resolve(Response.json(upstreamSession))
    expect(await running).toEqual({ ok: false, code: 'cancelled' })
    expect(await execute({ kind: 'get-profile' })).toEqual({ ok: false, code: 'cancelled' })
    expect(transport).toHaveBeenCalledOnce()
  })
})
