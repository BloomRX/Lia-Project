import type { Session, User } from 'better-auth'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { triggerSignIn } from '../libs/auth'
import { requestAuthSession } from '../libs/auth-client'
import { refreshAccessToken } from '../libs/auth-oidc'
import { useAuthStore } from './auth'

const { creditsRequest } = vi.hoisted(() => ({ creditsRequest: vi.fn() }))

vi.mock('../composables/api', () => ({
  client: { api: { v1: { flux: { $get: creditsRequest } } } },
}))

vi.mock('../libs/auth', () => ({
  triggerSignIn: vi.fn(),
}))

vi.mock('../libs/auth-client', () => ({
  authClient: {
    listSessions: vi.fn(),
  },
  requestAuthSession: vi.fn(),
}))

vi.mock('../libs/auth-oidc', () => ({
  refreshAccessToken: vi.fn(),
}))

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const user: User = {
  id: 'user-1',
  name: 'AIRI User',
  email: 'user@example.com',
  emailVerified: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

const session: Session = {
  id: 'session-1',
  token: 'server-session-token',
  userId: user.id,
  expiresAt: new Date('2026-12-01T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

describe('auth store sign-in requests', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    setActivePinia(createPinia())
    vi.mocked(triggerSignIn).mockReset()
    vi.mocked(triggerSignIn).mockResolvedValue()
    vi.mocked(requestAuthSession).mockReset()
    vi.mocked(requestAuthSession).mockResolvedValue({ user, session })
    vi.mocked(refreshAccessToken).mockReset()
    creditsRequest.mockReset()
    creditsRequest.mockResolvedValue({ ok: true, json: async () => ({ flux: 10 }) })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('allows sign-in to be requested again after an external flow is canceled', async () => {
    const authStore = useAuthStore()

    // ROOT CAUSE:
    //
    // Pocket remains mounted after launching the external login page. If the
    // user returns without authenticating, `needsLogin` used to remain true,
    // so a later click could not produce the transition that triggers sign-in.
    // Consuming each request restores the false -> true transition.
    authStore.needsLogin = true
    await nextTick()

    expect(triggerSignIn).toHaveBeenCalledTimes(1)
    expect(authStore.needsLogin).toBe(false)

    authStore.needsLogin = true
    await nextTick()

    expect(triggerSignIn).toHaveBeenCalledTimes(2)
    expect(authStore.needsLogin).toBe(false)
  })

  it('queries the session with the token from the completed sign-in', async () => {
    const authStore = useAuthStore()

    // ROOT CAUSE:
    //
    // The old callback queried the session through a raw localStorage read.
    // VueUse writes storage on the next microtask, so that request could use
    // the previous token and then clear the complete auth state.
    await authStore.completeSignIn({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      idToken: 'new-id-token',
      expiresIn: 3600,
      clientId: 'airi-stage-electron',
    })

    expect(requestAuthSession).toHaveBeenCalledWith('new-access-token')
    expect(authStore.token).toBe('new-access-token')
    expect(authStore.refreshToken).toBe('new-refresh-token')
    expect(authStore.idToken).toBe('new-id-token')
    expect(authStore.user).toEqual(user)
    expect(authStore.session).toEqual(session)
    expect(storage.getItem('auth/v1/token')).toBe('new-access-token')
    expect(storage.getItem('auth/v1/refresh-token')).toBe('new-refresh-token')
    expect(storage.getItem('auth/v1/oidc-id-token')).toBe('new-id-token')
    expect(storage.getItem('auth/v1/oidc-client-id')).toBe('airi-stage-electron')
    expect(storage.getItem('auth/v1/oidc-token-expiry')).not.toBeNull()

    await authStore.clearAllAuthState()
  })

  it('loads persisted credentials only when the store initializes', async () => {
    storage.values.set('auth/v1/token', 'persisted-access-token')
    storage.values.set('auth/v1/refresh-token', 'persisted-refresh-token')
    storage.values.set('auth/v1/oidc-id-token', 'persisted-id-token')
    storage.values.set('auth/v1/oidc-client-id', 'airi-stage-web')
    storage.values.set('auth/v1/oidc-token-expiry', String(Date.now() + 60_000))
    const authStore = useAuthStore()

    expect(authStore.token).toBeNull()

    await authStore.initialize()

    expect(requestAuthSession).toHaveBeenCalledWith('persisted-access-token')
    expect(authStore.token).toBe('persisted-access-token')
  })

  it('clears immediately and discards refresh that completes after logout', async () => {
    const refresh = Promise.withResolvers<Awaited<ReturnType<typeof refreshAccessToken>>>()
    const logout = Promise.withResolvers<Response>()
    vi.mocked(refreshAccessToken).mockReturnValue(refresh.promise)
    vi.stubGlobal('fetch', vi.fn(() => logout.promise))
    const authStore = useAuthStore()
    await authStore.completeSignIn({ accessToken: 'old-access', refreshToken: 'old-refresh', idToken: 'old-id', expiresIn: 3600, clientId: 'client' })
    const pending = authStore.refreshTokenNow()
    const signingOut = authStore.signOut()
    expect(storage.values.size).toBe(0)
    expect(authStore.isAuthenticated).toBe(false)
    refresh.resolve({ access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 3600, token_type: 'Bearer' })
    expect(await pending).toBeNull()
    expect(storage.values.size).toBe(0)
    expect(authStore.token).toBeNull()
    logout.resolve(new Response(null, { status: 204 }))
    await signingOut
  })

  it('fails closed when a replacement login cannot fetch its session', async () => {
    const authStore = useAuthStore()
    await authStore.completeSignIn({ accessToken: 'old-access', expiresIn: 3600, clientId: 'client' })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(requestAuthSession).mockRejectedValueOnce(new Error('SYNTHETIC_PRIVATE_SESSION'))
    expect(await authStore.completeSignIn({ accessToken: 'new-access', expiresIn: 3600, clientId: 'client' })).toBe(false)
    expect(authStore.isAuthenticated).toBe(false)
    expect(authStore.token).toBeNull()
    expect(storage.values.size).toBe(0)
    expect(JSON.stringify(log.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_SESSION')
    log.mockRestore()
  })

  it('shares a refresh in one generation and ignores a stale failure after a new login', async () => {
    const oldRefresh = Promise.withResolvers<Awaited<ReturnType<typeof refreshAccessToken>>>()
    vi.mocked(refreshAccessToken).mockReturnValueOnce(oldRefresh.promise)
    const authStore = useAuthStore()
    await authStore.completeSignIn({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresIn: 3600, clientId: 'client' })
    const first = authStore.refreshTokenNow()
    const second = authStore.refreshTokenNow()
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    await authStore.clearAllAuthState()
    await authStore.completeSignIn({ accessToken: 'new-access', expiresIn: 3600, clientId: 'client' })
    oldRefresh.reject(new Error('SYNTHETIC_STALE_SECRET'))
    expect(await first).toBeNull()
    expect(await second).toBeNull()
    expect(authStore.token).toBe('new-access')
    expect(authStore.isAuthenticated).toBe(true)
    await authStore.clearAllAuthState()
  })

  it('does not let a stale session response undo a replacement login', async () => {
    const sessionResponse = Promise.withResolvers<Awaited<ReturnType<typeof requestAuthSession>>>()
    const authStore = useAuthStore()
    await authStore.completeSignIn({ accessToken: 'old-access', expiresIn: 3600, clientId: 'client' })
    vi.mocked(requestAuthSession).mockReturnValueOnce(sessionResponse.promise)
    const oldSession = authStore.fetchSession()
    await authStore.clearAllAuthState()
    await authStore.completeSignIn({ accessToken: 'new-access', expiresIn: 3600, clientId: 'client' })
    sessionResponse.resolve(null)
    expect(await oldSession).toBe(false)
    expect(authStore.token).toBe('new-access')
    expect(authStore.isAuthenticated).toBe(true)
    expect(storage.getItem('auth/v1/token')).toBe('new-access')
    await authStore.clearAllAuthState()
  })

  it('does not log credentials from a failing authenticated hook', async () => {
    const authStore = useAuthStore()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    authStore.onAuthenticated(() => {
      throw new Error('SYNTHETIC_HOOK_SECRET')
    })
    await authStore.completeSignIn({ accessToken: 'access', expiresIn: 3600, clientId: 'client' })
    await nextTick()
    expect(log).toHaveBeenCalledWith('auth hook error')
    expect(JSON.stringify(log.mock.calls)).not.toContain('SYNTHETIC_HOOK_SECRET')
    log.mockRestore()
    await authStore.clearAllAuthState()
  })

  it('does not request credits without an authenticated session', async () => {
    const authStore = useAuthStore()
    await authStore.updateCredits()
    await nextTick()
    expect(creditsRequest).not.toHaveBeenCalled()
    expect(authStore.creditsStatus).toBe('idle')
  })

  it('classifies authorization, server and transport failures without logging error payloads', async () => {
    const authStore = useAuthStore()
    await authStore.completeSignIn({ accessToken: 'access', expiresIn: 3600, clientId: 'client' })
    await nextTick()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    creditsRequest.mockResolvedValueOnce({ ok: false, status: 401 })
    await authStore.updateCredits()
    expect(authStore.creditsStatus).toBe('auth-error')
    creditsRequest.mockResolvedValueOnce({ ok: false, status: 403 })
    await authStore.updateCredits()
    expect(authStore.creditsStatus).toBe('auth-error')
    creditsRequest.mockResolvedValueOnce({ ok: false, status: 503 })
    await authStore.updateCredits()
    expect(authStore.creditsStatus).toBe('error')
    creditsRequest.mockRejectedValueOnce(new Error('SYNTHETIC_SECRET'))
    await authStore.updateCredits()
    expect(authStore.creditsStatus).toBe('error')
    creditsRequest.mockResolvedValueOnce({ ok: true, json: async () => ({ flux: 'invalid' }) })
    await authStore.updateCredits()
    expect(authStore.creditsStatus).toBe('error')
    expect(JSON.stringify(log.mock.calls)).not.toContain('SYNTHETIC_SECRET')
    log.mockRestore()
    await authStore.clearAllAuthState()
  })

  it('only applies the latest credits response within one session', async () => {
    const authStore = useAuthStore()
    await authStore.completeSignIn({ accessToken: 'access', expiresIn: 3600, clientId: 'client' })
    await nextTick()
    const response = Promise.withResolvers<{ ok: boolean, json: () => Promise<{ flux: number }> }>()
    creditsRequest.mockReturnValueOnce(response.promise)
    creditsRequest.mockResolvedValueOnce({ ok: true, json: async () => ({ flux: 20 }) })
    const first = authStore.updateCredits()
    await authStore.updateCredits()
    response.resolve({ ok: true, json: async () => ({ flux: 5 }) })
    await first
    expect(authStore.credits).toBe(20)
    expect(authStore.creditsStatus).toBe('ready')
    await authStore.clearAllAuthState()
  })

  it('does not restore credits when a request completes after logout', async () => {
    const authStore = useAuthStore()
    await authStore.completeSignIn({ accessToken: 'access', expiresIn: 3600, clientId: 'client' })
    await nextTick()
    const response = Promise.withResolvers<{ ok: boolean, json: () => Promise<{ flux: number }> }>()
    creditsRequest.mockReturnValueOnce(response.promise)
    const pending = authStore.updateCredits()
    await authStore.clearAllAuthState()
    response.resolve({ ok: true, json: async () => ({ flux: 123 }) })
    await pending
    expect(authStore.credits).toBe(0)
    expect(authStore.creditsStatus).toBe('idle')
  })

  it('does not persist state patches received from another window', async () => {
    const authStore = useAuthStore()

    // ROOT CAUSE:
    //
    // `useLocalStorage` observed every Pinia patch and wrote it to storage.
    // The storage event then reached another window, whose synced Pinia patch
    // wrote the same value back. This formed an unbounded cross-window loop.
    // Auth persistence now runs only inside auth commands.
    authStore.$patch({ token: 'synced-access-token' })
    await nextTick()

    expect(storage.values.size).toBe(0)
  })
})
