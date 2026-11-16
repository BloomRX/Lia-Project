import type { Session, User } from 'better-auth'
import type {} from 'pinia-plugin-synced'

import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { useTimeoutFn, whenever } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { client } from '../composables/api'
import { useBreakpoints } from '../composables/use-breakpoints'
import { triggerSignIn } from '../libs/auth'
import { authClient, requestAuthSession } from '../libs/auth-client'
import { refreshAccessToken } from '../libs/auth-oidc'
import { isOidcEnabled } from '../libs/oidc-capability'
import { SERVER_URL } from '../libs/server'

function createLocalStorageForAuth() {
  const keys = {
    accessToken: 'auth/v1/token',
    refreshToken: 'auth/v1/refresh-token',
    idToken: 'auth/v1/oidc-id-token',
    oidcClientId: 'auth/v1/oidc-client-id',
    tokenExpiry: 'auth/v1/oidc-token-expiry',
  } as const

  function setOptional(key: string, value: string | null): void {
    if (value === null) {
      localStorage.removeItem(key)
      return
    }

    localStorage.setItem(key, value)
  }

  return {
    clear() {
      for (const key of Object.values(keys))
        localStorage.removeItem(key)
    },
    getAccessToken: () => localStorage.getItem(keys.accessToken),
    getRefreshToken: () => localStorage.getItem(keys.refreshToken),
    getIdToken: () => localStorage.getItem(keys.idToken),
    getOidcClientId: () => localStorage.getItem(keys.oidcClientId),
    getTokenExpiry() {
      const expiry = Number.parseInt(localStorage.getItem(keys.tokenExpiry) ?? '', 10)
      return Number.isFinite(expiry) ? expiry : null
    },
    setAccessToken: (value: string | null) => setOptional(keys.accessToken, value),
    setRefreshToken: (value: string | null) => setOptional(keys.refreshToken, value),
    setIdToken: (value: string | null) => setOptional(keys.idToken, value),
    setOidcClientId: (value: string | null) => setOptional(keys.oidcClientId, value),
    setTokenExpiry: (value: number | null) => setOptional(keys.tokenExpiry, value?.toString() ?? null),
  }
}

/** Tokens that complete one OIDC sign-in flow. */
export interface AuthTokenSet {
  accessToken: string
  refreshToken?: string
  idToken?: string
  expiresIn: number
  clientId: string
}

/**
 * Auth store — holds identity state and credits.
 *
 * This store has no dependency on `stores/providers`, which allows
 * `providers` to safely depend on it without creating a circular import.
 */
export const useAuthStore = defineStore('auth', () => {
  const storage = createLocalStorageForAuth()
  const oidcEnabled = computed(isOidcEnabled)

  // Pinia owns live auth state. Persistence is command-driven so a state patch
  // received from another window cannot write back into the transport.
  const user = ref<User | null>(null)
  const session = ref<Session | null>(null)
  const token = ref<string | null>(null)
  const refreshToken = ref<string | null>(null)
  // NOTICE:
  // Persisted to drive `id_token_hint` on RP-Initiated Logout
  // (`/api/auth/oauth2/end-session`). The `sid` claim inside the ID token is
  // what lets the OIDC provider locate the server-side session row to delete
  // — without this we'd be back to relying on cross-site session cookies.
  const idToken = ref<string | null>(null)
  const isAuthenticated = computed(() => oidcEnabled.value && !!user.value && !!session.value)
  const userId = computed(() => isAuthenticated.value ? user.value?.id ?? 'local' : 'local')
  const signedOutReason = ref<'signed-out' | 'expired' | 'error'>('signed-out')
  const authStatus = computed(() => {
    if (!oidcEnabled.value)
      return 'disabled'
    return isAuthenticated.value ? 'active' : signedOutReason.value
  })

  // --- OIDC token refresh state ---
  const oidcClientId = ref<string | null>(null)
  const tokenExpiry = ref<number | null>(null)
  const initialized = ref(false)

  const credits = ref(0)
  const creditsStatus = ref<'idle' | 'loading' | 'ready' | 'auth-error' | 'error'>('idle')
  let authGeneration = 0
  let sessionRequest = 0
  let creditsRequest = 0

  // Cross-app "user must log in" flag. Setting this to true triggers an
  // immediate OIDC redirect on web (mobile + desktop). Electron skips this
  // path because controls-island-auth-button listens for IPC and handles
  // sign-in in the main process.
  const needsLogin = ref(false)
  const { isMobile } = useBreakpoints()

  whenever(needsLogin, async () => {
    if (!oidcEnabled.value) {
      needsLogin.value = false
      return
    }

    if (isStageTamagotchi())
      return

    // Consume the request before opening an external browser. Pocket stays
    // mounted when the user cancels there, so leaving this true would make
    // the next button click a no-op instead of starting a new OIDC flow.
    needsLogin.value = false
    await triggerSignIn()
  })

  // Reset the flag if the viewport class flips, so a stale needsLogin from a
  // previous breakpoint does not surface again on resize.
  watch(isMobile, () => needsLogin.value = false)

  // --- Lifecycle hooks ---
  type AuthHook = () => void | Promise<void>
  const authenticatedHooks: AuthHook[] = []
  const logoutHooks: AuthHook[] = []

  function onAuthenticated(hook: AuthHook) {
    authenticatedHooks.push(hook)
    // If already authenticated when hook is registered, fire immediately.
    // This covers the case where auth resolves before the hook is registered.
    if (isAuthenticated.value) {
      hook()
    }
    return () => {
      const idx = authenticatedHooks.indexOf(hook)
      if (idx >= 0)
        authenticatedHooks.splice(idx, 1)
    }
  }

  function onLogout(hook: AuthHook) {
    logoutHooks.push(hook)
    return () => {
      const idx = logoutHooks.indexOf(hook)
      if (idx >= 0)
        logoutHooks.splice(idx, 1)
    }
  }

  // --- OIDC token refresh scheduling ---
  // Uses useTimeoutFn for automatic cleanup on store teardown.
  // The delay ref is updated by scheduleTokenRefresh before calling start().

  const refreshDelayMs = ref(0)
  // Single-flight refresh: multiple concurrent callers (timer + 401 retry + restore)
  // must not trigger multiple token exchanges. All share one in-flight promise.
  let inflightRefresh: Promise<string | null> | null = null
  let refreshFailedGeneration: number | undefined

  async function refreshTokenNow(): Promise<string | null> {
    if (!oidcEnabled.value)
      return null

    if (inflightRefresh)
      return inflightRefresh

    const credential = refreshToken.value
    const clientId = oidcClientId.value
    if (!credential || !clientId)
      return null

    const generation = authGeneration
    const accessToken = token.value
    const identity = user.value?.id
    const ownsRefresh = () => authGeneration === generation
      && token.value === accessToken
      && refreshToken.value === credential
      && oidcClientId.value === clientId
      && user.value?.id === identity
    const attempt = Promise.resolve().then(async () => {
      if (!ownsRefresh())
        return null

      let tokens: Awaited<ReturnType<typeof refreshAccessToken>>
      try {
        tokens = await refreshAccessToken(clientId, credential)
      }
      catch {
        if (ownsRefresh()) {
          console.error('OIDC token refresh failed')
          clearAuthState('error')
          refreshFailedGeneration = generation
        }
        return null
      }

      if (!ownsRefresh())
        return null

      token.value = tokens.access_token
      storage.setAccessToken(tokens.access_token)
      if (tokens.refresh_token) {
        refreshToken.value = tokens.refresh_token
        storage.setRefreshToken(tokens.refresh_token)
      }
      if (tokens.expires_in) {
        tokenExpiry.value = Date.now() + tokens.expires_in * 1000
        storage.setTokenExpiry(tokenExpiry.value)
        scheduleTokenRefresh(tokens.expires_in)
      }

      const authenticated = await readSession(tokens.access_token, generation)
      return authenticated && generation === authGeneration && token.value === tokens.access_token
        ? tokens.access_token
        : null
    }).finally(() => {
      if (inflightRefresh === attempt)
        inflightRefresh = null
    })

    inflightRefresh = attempt
    return attempt
  }

  const { start: startRefreshTimer, stop: stopRefreshTimer } = useTimeoutFn(
    () => { void useAuthStore().refreshTokenNow() },
    refreshDelayMs,
    { immediate: false },
  )

  function scheduleTokenRefresh(expiresInSeconds: number): void {
    stopRefreshTimer()
    // Guard against missing/invalid lifetimes (e.g. token response omitted
    // expires_in). useTimeoutFn with NaN/<=0 delay would fire immediately
    // and spin a refresh loop — skip scheduling instead.
    if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0)
      return
    // Refresh at 80% of lifetime
    refreshDelayMs.value = expiresInSeconds * 0.8 * 1000
    startRefreshTimer()
  }

  /**
   * Restore refresh scheduling from persisted state after page reload.
   * Returns a promise that resolves after an immediate refresh completes
   * (when the persisted token is already expired) so callers can avoid
   * racing `fetchSession()` against a stale Bearer token.
   */
  async function restoreRefreshSchedule(): Promise<boolean> {
    if (!refreshToken.value || !oidcClientId.value)
      return false

    if (tokenExpiry.value) {
      const remainingMs = tokenExpiry.value - Date.now()
      if (remainingMs > 0) {
        scheduleTokenRefresh(remainingMs / 1000)
        return false
      }
    }

    // Already expired — refresh synchronously so subsequent requests use fresh token
    return !!(await refreshTokenNow())
  }

  async function initialize(): Promise<void> {
    if (initialized.value)
      return

    initialized.value = true
    if (!oidcEnabled.value) {
      clearAuthState()
      return
    }

    token.value = storage.getAccessToken()
    refreshToken.value = storage.getRefreshToken()
    idToken.value = storage.getIdToken()
    oidcClientId.value = storage.getOidcClientId()
    tokenExpiry.value = storage.getTokenExpiry()

    const hasRefreshToken = !!refreshToken.value
    const hasClientId = !!oidcClientId.value
    if (hasRefreshToken !== hasClientId) {
      clearAuthState('error')
      return
    }
    if (!hasRefreshToken && tokenExpiry.value !== null && tokenExpiry.value <= Date.now()) {
      clearAuthState('expired')
      return
    }

    const generation = authGeneration
    const restoredToken = token.value
    const refreshed = await restoreRefreshSchedule()
    if (!refreshed && generation === authGeneration && restoredToken && token.value === restoredToken)
      await fetchSession(token.value)
  }

  async function completeSignIn(tokens: AuthTokenSet): Promise<boolean> {
    if (!oidcEnabled.value)
      return false

    clearAuthState()
    token.value = tokens.accessToken
    refreshToken.value = tokens.refreshToken ?? null
    idToken.value = tokens.idToken ?? null
    oidcClientId.value = tokens.clientId
    tokenExpiry.value = Number.isFinite(tokens.expiresIn)
      ? Date.now() + tokens.expiresIn * 1000
      : null
    scheduleTokenRefresh(tokens.expiresIn)
    storage.setAccessToken(token.value)
    storage.setRefreshToken(refreshToken.value)
    storage.setIdToken(idToken.value)
    storage.setOidcClientId(oidcClientId.value)
    storage.setTokenExpiry(tokenExpiry.value)

    return await fetchSession(tokens.accessToken)
  }

  async function fetchSession(accessToken: string | null = token.value): Promise<boolean> {
    return await readSession(accessToken)
  }

  async function readSession(accessToken: string | null, refreshGeneration?: number): Promise<boolean> {
    if (!oidcEnabled.value || accessToken !== token.value)
      return false
    const generation = authGeneration
    const request = ++sessionRequest
    const isCurrent = () => generation === authGeneration
      && request === sessionRequest
      && accessToken === token.value

    const data = await requestAuthSession(accessToken).catch(() => {
      if (isCurrent())
        console.error('OIDC session lookup failed')
      return null
    })
    if (!isCurrent())
      return false

    if (data) {
      user.value = data.user
      session.value = data.session
      return true
    }

    if (tokenExpiry.value !== null && tokenExpiry.value <= Date.now())
      clearAuthState('expired')
    else
      clearAuthState(accessToken ? 'error' : 'signed-out')
    if (refreshGeneration === generation)
      refreshFailedGeneration = generation
    return false
  }

  async function listSessions() {
    if (!oidcEnabled.value)
      return { data: null, error: { status: 403, statusText: 'Forbidden', message: 'OIDC disabled' } }

    return await authClient.listSessions({
      fetchOptions: {
        auth: {
          type: 'Bearer',
          token: token.value ?? '',
        },
      },
    })
  }

  async function signOut(): Promise<void> {
    const idTokenHint = idToken.value
    const clientId = oidcClientId.value
    const bearerToken = token.value
    clearAuthState()
    if (!oidcEnabled.value)
      return

    // Revoke the captured session after invalidating local work. The remote
    // response has no authority over a login that has since replaced it.
    try {
      if (idTokenHint && clientId) {
        const url = new URL('/api/auth/oauth2/end-session', SERVER_URL)
        url.searchParams.set('id_token_hint', idTokenHint)
        url.searchParams.set('client_id', clientId)
        await fetch(url.toString(), { method: 'GET' })
      }
      else if (bearerToken) {
        const url = new URL('/api/auth/sign-out', SERVER_URL)
        await fetch(url.toString(), {
          method: 'POST',
          headers: { Authorization: `Bearer ${bearerToken}` },
        })
      }
    }
    catch {
      console.error('Server sign-out failed')
    }
  }

  /**
   * Reset every auth-related field atomically.
   *
   * Use when: signing out, refresh fails, session is rejected by server, or
   * persisted state is detected inconsistent.
   *
   * Why atomic: `refreshToken` and `oidcClientId` must either both exist or
   * both be absent. A "half-cleared" state (one present, one null) makes
   * `refreshTokenNow()` early-return without attempting refresh, so 401s
   * loop silently until the user lands on a page that calls fetchSession.
   */
  function clearAuthState(reason: typeof signedOutReason.value = 'signed-out'): void {
    authGeneration++
    inflightRefresh = null
    refreshFailedGeneration = undefined
    stopRefreshTimer()
    user.value = null
    session.value = null
    token.value = null
    refreshToken.value = null
    oidcClientId.value = null
    tokenExpiry.value = null
    idToken.value = null
    credits.value = 0
    creditsStatus.value = 'idle'
    needsLogin.value = false
    signedOutReason.value = reason
    storage.clear()
  }

  function getAuthGeneration(): number {
    return authGeneration
  }

  function requestReLoginAfterAuthFailure(generation: number, failedToken: string | null): void {
    if (!oidcEnabled.value)
      return
    if (generation === authGeneration && failedToken === token.value) {
      clearAuthState()
      needsLogin.value = true
    }
    else if (generation === refreshFailedGeneration && !token.value) {
      refreshFailedGeneration = undefined
      needsLogin.value = true
    }
  }

  async function clearAllAuthState(): Promise<void> {
    clearAuthState()
  }

  const updateCredits = async () => {
    if (!isAuthenticated.value)
      return
    const generation = authGeneration
    const request = ++creditsRequest
    const identity = user.value?.id
    const isCurrent = () => generation === authGeneration && request === creditsRequest
      && isAuthenticated.value && user.value?.id === identity
    creditsStatus.value = 'loading'

    try {
      const res = await client.api.v1.flux.$get()
      if (!isCurrent())
        return
      if (!res.ok) {
        creditsStatus.value = res.status === 401 || res.status === 403 ? 'auth-error' : 'error'
        return
      }
      const data = await res.json()
      if (!isCurrent())
        return
      if (typeof data?.flux !== 'number' || !Number.isFinite(data.flux)) {
        creditsStatus.value = 'error'
        return
      }
      credits.value = data.flux
      creditsStatus.value = 'ready'
    }
    catch {
      if (isCurrent()) {
        creditsStatus.value = 'error'
        console.error('Credits lookup failed')
      }
    }
  }

  // This is the only watcher that reacts to an auth-state transition. Each
  // window runs its own lifecycle hooks, while persistence remains owned by
  // the auth commands above.
  watch(isAuthenticated, async (authenticated, wasAuthenticated) => {
    if (authenticated) {
      void updateCredits()
      needsLogin.value = false

      if (!wasAuthenticated)
        await dispatchHooks(authenticatedHooks, 'auth hook error')
    }
    else {
      credits.value = 0
      creditsStatus.value = 'idle'

      if (wasAuthenticated)
        await dispatchHooks(logoutHooks, 'logout hook error')
    }
  }, { immediate: true })

  async function dispatchHooks(hooks: AuthHook[], errorLabel: string): Promise<void> {
    for (const hook of hooks) {
      try {
        await hook()
      }
      catch {
        console.error(errorLabel)
      }
    }
  }

  return {
    user,
    userId,
    session,
    token,
    refreshToken,
    idToken,
    oidcEnabled,
    authStatus,
    isAuthenticated,
    credits,
    creditsStatus,
    updateCredits,
    needsLogin,
    onAuthenticated,
    onLogout,

    // OIDC token refresh
    oidcClientId,
    tokenExpiry,
    scheduleTokenRefresh,
    initialize,
    completeSignIn,
    fetchSession,
    listSessions,
    signOut,
    refreshTokenNow,
    getAuthGeneration,
    requestReLoginAfterAuthFailure,
    clearAllAuthState,
  }
}, {
  ...(isOidcEnabled() && {
    synced: {
      actions: [
        'initialize',
        'completeSignIn',
        'fetchSession',
        'signOut',
        'refreshTokenNow',
        'clearAllAuthState',
      ],
      state: true,
    },
  }),
})
