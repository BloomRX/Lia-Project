import { useAuthStore } from '../stores/auth'
import { getAnalyticsIdentitySnapshot } from './analytics'
import { isOidcEnabled, oidcDisabledResponse } from './oidc-capability'
import { SERVER_URL } from './server'

/**
 * Fetch wrapper that transparently refreshes the OIDC access token on 401
 * and retries the original request once. Refresh is single-flight across
 * concurrent callers via the auth store's `refreshTokenNow()` action.
 *
 * Why not rely on the proactive 80%-lifetime scheduler alone: clock skew,
 * suspended tabs, and the post-reload race (fetchSession firing before
 * restoreRefreshSchedule resolves) can all leak an expired Bearer through.
 * The reactive 401 path is the safety net.
 *
 * When refresh cannot succeed — missing state (refreshToken/oidcClientId),
 * refresh endpoint errors, or a retried request that still returns 401 —
 * clear local auth state and flip `needsLogin` so the user is prompted to
 * sign in immediately, instead of letting the dead session linger until the
 * next fetchSession call on the home page.
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!isOidcEnabled()) {
    const request = input instanceof Request ? input : undefined
    const url = new URL(request?.url ?? String(input), SERVER_URL)
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    if (url.origin !== new URL(SERVER_URL).origin || url.pathname !== '/api/v1/stripe/packages' || method !== 'GET')
      return oidcDisabledResponse()

    // The catalog is public. Create a fresh request so an inherited Request
    // cannot carry an auth header, cookie policy, or redirect to another route.
    return fetch(url, { credentials: 'omit', redirect: 'error', signal: init?.signal ?? request?.signal })
  }

  const authStore = useAuthStore()
  const doFetch = (token: string | null): Promise<Response> => {
    const headers = new Headers(init?.headers)
    if (token)
      headers.set('Authorization', `Bearer ${token}`)
    const posthogIdentity = shouldAttachPosthogIdentity(input) ? getAnalyticsIdentitySnapshot() : null
    if (posthogIdentity) {
      headers.set('x-posthog-distinct-id', posthogIdentity.distinctId)
      if (posthogIdentity.sessionId)
        headers.set('x-posthog-session-id', posthogIdentity.sessionId)
    }
    return fetch(input, { ...init, headers, credentials: 'omit' })
  }

  const generation = authStore.getAuthGeneration()
  const originalToken = authStore.token
  const response = await doFetch(originalToken)
  if (response.status !== 401)
    return response

  if (generation !== authStore.getAuthGeneration() || originalToken !== authStore.token)
    return response

  // Don't recurse on the token endpoint itself
  const url = typeof input === 'string'
    ? input
    : input instanceof URL ? input.toString() : input.url
  if (url.includes('/oauth2/token'))
    return response

  const newToken = await authStore.refreshTokenNow()
  if (!newToken) {
    authStore.requestReLoginAfterAuthFailure(generation, originalToken)
    return response
  }

  if (generation !== authStore.getAuthGeneration() || newToken !== authStore.token)
    return response

  const retried = await doFetch(newToken)
  if (retried.status === 401)
    authStore.requestReLoginAfterAuthFailure(generation, newToken)
  return retried
}

function shouldAttachPosthogIdentity(input: RequestInfo | URL): boolean {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL ? input.toString() : input.url

  return new URL(url, SERVER_URL).origin === new URL(SERVER_URL).origin
}
