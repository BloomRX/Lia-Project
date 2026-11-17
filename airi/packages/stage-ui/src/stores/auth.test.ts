import type { Session, User } from 'better-auth'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { triggerSignIn } from '../libs/auth'
import { authClient, requestAuthSession } from '../libs/auth-client'
import { refreshAccessToken } from '../libs/auth-oidc'
import { useAuthStore } from './auth'

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

const { requestCredits } = vi.hoisted(() => ({ requestCredits: vi.fn<() => Promise<Response>>() }))
vi.mock('../composables/api', () => ({ client: { api: { v1: { flux: { $get: requestCredits } } } } }))

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

const credentials = {
  accessToken: 'initial-access-token',
  refreshToken: 'initial-refresh-token',
  idToken: 'initial-id-token',
  clientId: 'fixture-client',
  expiresIn: 3600,
}
const refreshedCredentials = { access_token: 'refresh-result', token_type: 'Bearer', expires_in: 3600 }

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
    requestCredits.mockReset()
    requestCredits.mockImplementation(async () => Response.json({ flux: 10 }))
  })

  afterEach(() => {
    useAuthStore().$dispose()
    vi.restoreAllMocks()
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

  it('keeps recovery and logout decisions with the session owner for a stale caller', async () => {
    const owner = useAuthStore()
    await owner.completeSignIn(credentials)
    const observedGeneration = owner.getAuthGeneration()
    const observedRevision = owner.bearerRevision
    await owner.completeSignIn({ ...credentials, accessToken: 'replacement-token' })

    expect(await owner.refreshAfterUnauthorized(observedGeneration, observedRevision)).toBeNull()
    owner.requestReLoginAfterAuthFailure(observedGeneration, observedRevision)
    expect(refreshAccessToken).not.toHaveBeenCalled()
    expect(owner.token).toBe('replacement-token')
    expect(owner.needsLogin).toBe(false)
  })

  it('requests sign-in on the session owner when recovery fails', async () => {
    const owner = useAuthStore()
    await owner.completeSignIn(credentials)
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error('synthetic-refresh-failure'))
    expect(await owner.refreshAfterUnauthorized(owner.getAuthGeneration(), owner.bearerRevision)).toBeNull()
    await nextTick()
    expect(triggerSignIn).toHaveBeenCalledOnce()
    expect(owner.token).toBeNull()
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

  it('joins refresh and drops its late result when logout has already cleared storage', async () => {
    const auth = useAuthStore()
    await auth.completeSignIn(credentials)
    const exchange = Promise.withResolvers<typeof refreshedCredentials>()
    const logout = Promise.withResolvers<Response>()
    vi.mocked(refreshAccessToken).mockReturnValue(exchange.promise)
    vi.stubGlobal('fetch', vi.fn(() => logout.promise))

    const first = auth.refreshTokenNow()
    const second = auth.refreshTokenNow()
    await Promise.resolve()
    expect(refreshAccessToken).toHaveBeenCalledExactlyOnceWith(credentials.clientId, credentials.refreshToken)
    const signedOut = auth.signOut()
    expect(auth.isAuthenticated).toBe(false)
    expect(storage.values.size).toBe(0)
    expect(auth.credits).toBe(0)
    expect(auth.creditsStatus).toBe('idle')
    exchange.resolve(refreshedCredentials)
    expect(await Promise.all([first, second])).toEqual([null, null])
    logout.resolve(new Response(null, { status: 204 }))
    await signedOut
    expect(storage.values.size).toBe(0)
    expect(auth.isAuthenticated).toBe(false)
  })

  it('keeps the login that replaced a failed refresh and a pending remote logout', async () => {
    const auth = useAuthStore()
    await auth.completeSignIn(credentials)
    const exchange = Promise.withResolvers<typeof refreshedCredentials>()
    const logout = Promise.withResolvers<Response>()
    vi.mocked(refreshAccessToken).mockReturnValue(exchange.promise)
    vi.stubGlobal('fetch', vi.fn(() => logout.promise))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    const refresh = auth.refreshTokenNow()
    await Promise.resolve()
    const remoteLogout = auth.signOut()
    await auth.completeSignIn({ ...credentials, accessToken: 'replacement' })
    exchange.reject(new Error('synthetic-refresh-secret'))
    expect(await refresh).toBeNull()
    logout.reject(new Error('synthetic-logout-secret'))
    await remoteLogout
    expect(auth.token).toBe('replacement')
    expect(storage.getItem('auth/v1/token')).toBe('replacement')
    expect(log).toHaveBeenCalledExactlyOnceWith('Server sign-out failed')
  })

  it('ignores a delayed session lookup after logout without consulting storage again', async () => {
    const auth = useAuthStore()
    const lookup = Promise.withResolvers<{ user: User, session: Session }>()
    vi.mocked(requestAuthSession).mockReturnValueOnce(lookup.promise)
    const signIn = auth.completeSignIn(credentials)
    await auth.clearAllAuthState()
    lookup.resolve({ user, session })

    expect(await signIn).toBe(false)
    expect(auth.isAuthenticated).toBe(false)
    expect(storage.values.size).toBe(0)
  })

  it('refreshes an expired persisted session on restart before restoring identity', async () => {
    storage.setItem('auth/v1/token', credentials.accessToken)
    storage.setItem('auth/v1/refresh-token', credentials.refreshToken)
    storage.setItem('auth/v1/oidc-client-id', credentials.clientId)
    storage.setItem('auth/v1/oidc-token-expiry', String(Date.now() - 1))
    vi.mocked(refreshAccessToken).mockResolvedValue(refreshedCredentials)
    const auth = useAuthStore()
    await auth.initialize()

    expect(requestAuthSession).toHaveBeenCalledExactlyOnceWith(refreshedCredentials.access_token)
    expect(auth.token).toBe(refreshedCredentials.access_token)
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.authStatus).toBe('active')
  })

  it('exposes the expired state when no refresh is available at initialization', async () => {
    storage.setItem('auth/v1/token', credentials.accessToken)
    storage.setItem('auth/v1/oidc-token-expiry', String(Date.now() - 1))
    const auth = useAuthStore()
    expect(auth.authStatus).toBe('signed-out')

    await auth.initialize()

    expect(auth.authStatus).toBe('expired')
    expect(auth.token).toBeNull()
    expect(requestAuthSession).not.toHaveBeenCalled()
  })

  it('clears identity and records only a fixed label when a current refresh fails', async () => {
    const auth = useAuthStore()
    await auth.completeSignIn(credentials)
    vi.mocked(refreshAccessToken).mockRejectedValueOnce(new Error('synthetic-refresh-secret'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await auth.refreshTokenNow()).toBeNull()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.authStatus).toBe('error')
    expect(storage.values.size).toBe(0)
    expect(log).toHaveBeenCalledExactlyOnceWith('OIDC token refresh failed')
  })

  it('accepts only finite balances and marks authorization and network failures while preserving the last value', async () => {
    const auth = useAuthStore()
    await auth.completeSignIn(credentials)
    requestCredits.mockResolvedValueOnce(Response.json({ flux: 42 }))
    await auth.updateCredits()
    expect(auth.credits).toBe(42)
    expect(auth.creditsStatus).toBe('ready')

    requestCredits.mockResolvedValueOnce(new Response(null, { status: 403 }))
    await auth.updateCredits()
    expect(auth.creditsStatus).toBe('auth-error')
    requestCredits.mockResolvedValueOnce(Response.json({ flux: '100' }))
    await auth.updateCredits()
    expect(auth.creditsStatus).toBe('error')

    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    requestCredits.mockRejectedValueOnce(new Error('synthetic-credits-secret'))
    await auth.updateCredits()
    expect(auth.creditsStatus).toBe('error')
    expect(auth.credits).toBe(42)
    expect(log).toHaveBeenCalledExactlyOnceWith('Credits lookup failed')
  })

  it('discards out-of-order balances and balances returned after a logout', async () => {
    const auth = useAuthStore()
    await auth.completeSignIn(credentials)
    const older = Promise.withResolvers<Response>()
    requestCredits.mockReturnValueOnce(older.promise).mockResolvedValueOnce(Response.json({ flux: 42 }))
    const pending = auth.updateCredits()
    await auth.updateCredits()
    older.resolve(Response.json({ flux: 33 }))
    await pending
    expect(auth.credits).toBe(42)

    const latest = Promise.withResolvers<Response>()
    requestCredits.mockReturnValueOnce(latest.promise)
    const pendingLogout = auth.updateCredits()
    await auth.clearAllAuthState()
    latest.resolve(Response.json({ flux: 51 }))
    await pendingLogout
    expect(auth.credits).toBe(0)
    expect(auth.creditsStatus).toBe('idle')
  })

  it('deletes legacy keys without loading them and rejects auth commands when Desktop has OIDC off', async () => {
    vi.stubGlobal('window', { liaOidcEnabled: false })
    storage.setItem('auth/v1/token', 'residual-access')
    storage.setItem('auth/v1/refresh-token', 'residual-refresh')
    storage.setItem('auth/v1/oidc-id-token', 'residual-id')
    storage.setItem('auth/v1/oidc-client-id', 'residual-client')
    storage.setItem('auth/v1/oidc-token-expiry', '0')
    storage.setItem('unrelated/setting', 'keep')
    const getItem = vi.spyOn(storage, 'getItem')
    const auth = useAuthStore()

    await auth.initialize()
    expect(auth.oidcEnabled).toBe(false)
    expect(auth.authStatus).toBe('disabled')
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.userId).toBe('local')
    expect(auth.token).toBeNull()
    expect(getItem).not.toHaveBeenCalled()
    expect([...storage.values.entries()]).toEqual([['unrelated/setting', 'keep']])
    expect(await auth.completeSignIn(credentials)).toBe(false)
    expect(await auth.refreshTokenNow()).toBeNull()
    expect(await auth.fetchSession(credentials.accessToken)).toBe(false)
    expect((await auth.listSessions()).error?.status).toBe(403)
    expect(authClient.listSessions).not.toHaveBeenCalled()
    expect(requestAuthSession).not.toHaveBeenCalled()
    expect(refreshAccessToken).not.toHaveBeenCalled()
    expect(requestCredits).not.toHaveBeenCalled()
  })
})
