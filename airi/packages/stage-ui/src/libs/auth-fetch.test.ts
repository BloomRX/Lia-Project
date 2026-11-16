import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '../stores/auth'
import { authClient } from './auth-client'
import { authedFetch } from './auth-fetch'
import { SERVER_URL } from './server'

const posthogMocks = vi.hoisted(() => ({
  getAnalyticsIdentitySnapshot: vi.fn<() => { distinctId: string, sessionId: string } | null>(() => ({
    distinctId: 'distinct-1',
    sessionId: 'session-1',
  })),
}))

vi.mock('./analytics', () => ({
  getAnalyticsIdentitySnapshot: posthogMocks.getAnalyticsIdentitySnapshot,
}))

describe('authedFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
    useAuthStore().token = 'access-token'
    posthogMocks.getAnalyticsIdentitySnapshot.mockReturnValue({
      distinctId: 'distinct-1',
      sessionId: 'session-1',
    })
  })

  afterEach(() => {
    useAuthStore().$dispose()
    vi.unstubAllGlobals()
  })

  it('sends PostHog identity headers with authenticated API requests', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await authedFetch('https://api.airi.build/api/v1/stripe/checkout', {
      method: 'POST',
    })

    const headers = fetchMock.mock.calls[0]?.[1]?.headers
    expect(headers).toBeInstanceOf(Headers)
    expect((headers as Headers).get('Authorization')).toBe('Bearer access-token')
    expect((headers as Headers).get('x-posthog-distinct-id')).toBe('distinct-1')
    expect((headers as Headers).get('x-posthog-session-id')).toBe('session-1')
  })

  it('omits PostHog identity headers when analytics has no active identity', async () => {
    posthogMocks.getAnalyticsIdentitySnapshot.mockReturnValue(null)
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await authedFetch('https://api.example.test/api/v1/stripe/checkout')

    const headers = fetchMock.mock.calls[0]?.[1]?.headers
    expect(headers).toBeInstanceOf(Headers)
    expect((headers as Headers).get('Authorization')).toBe('Bearer access-token')
    expect((headers as Headers).get('x-posthog-distinct-id')).toBeNull()
    expect((headers as Headers).get('x-posthog-session-id')).toBeNull()
  })

  it('does not send PostHog identity headers to non-server origins', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await authedFetch('https://third-party.example.test/resource')

    const headers = fetchMock.mock.calls[0]?.[1]?.headers
    expect(headers).toBeInstanceOf(Headers)
    expect((headers as Headers).get('Authorization')).toBe('Bearer access-token')
    expect((headers as Headers).get('x-posthog-distinct-id')).toBeNull()
    expect((headers as Headers).get('x-posthog-session-id')).toBeNull()
  })

  it('does not refresh or clear a replacement login on an old response', async () => {
    const response = Promise.withResolvers<Response>()
    const fetchMock = vi.fn(() => response.promise)
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', { removeItem: vi.fn() })
    const auth = useAuthStore()
    const request = authedFetch(new URL('/api/v1/flux', SERVER_URL))
    const refresh = vi.spyOn(auth, 'refreshTokenNow')
    await auth.clearAllAuthState()
    auth.token = 'replacement'
    response.resolve(new Response(null, { status: 401 }))

    expect((await request).status).toBe(401)
    expect(refresh).not.toHaveBeenCalled()
    expect(auth.token).toBe('replacement')
    expect(auth.needsLogin).toBe(false)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('disables private calls and strips auth from the independent public catalog when desktop OIDC is off', async () => {
    vi.stubGlobal('window', { liaOidcEnabled: false })
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response('[]'))
    vi.stubGlobal('fetch', fetchMock)
    const headers = { Authorization: 'Bearer synthetic-legacy-token', Cookie: 'session=synthetic' }
    const request = (path: string) => new Request(new URL(path, SERVER_URL), { headers })

    expect((await authedFetch(request('/api/v1/flux'))).status).toBe(403)
    expect((await authedFetch(request('/api/v1/stripe/packages'), { method: 'POST' })).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await authedFetch(request('/api/v1/stripe/packages'))).ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(new URL('/api/v1/stripe/packages', SERVER_URL), expect.objectContaining({
      credentials: 'omit',
      redirect: 'error',
    }))
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeUndefined()
  })

  it('rejects a direct account-client call before reading a residual token or accessing the network', async () => {
    vi.stubGlobal('window', { liaOidcEnabled: false })
    const fetchMock = vi.fn()
    const getItem = vi.fn(() => 'residual-token')
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', { getItem })

    const result = await authClient.listSessions()

    expect(result.error?.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getItem).not.toHaveBeenCalled()
  })
})
