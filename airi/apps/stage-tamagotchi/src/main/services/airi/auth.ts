import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from '@proj-airi/stage-shared/auth'
import { shell } from 'electron'

import {
  electronAuthCallback,
  electronAuthCallbackError,
  electronAuthCancelled,
  electronAuthLogout,
  electronAuthStartLogin,
} from '../../../shared/eventa'
import { startLoopbackServer } from './http-server/http/auth'

const log = useLogg('auth-service').useGlobalConfig()
const signInFailure = 'OIDC signing in failed'

type MainContext = ReturnType<typeof createContext>['context']

// OIDC configuration for the Electron client.
const OIDC_CLIENT_ID = import.meta.env.VITE_OIDC_CLIENT_ID || 'airi-stage-electron'
const OIDC_SCOPES = 'openid profile email offline_access'
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://api.airi.build'
const OIDC_AUTHORIZE_PATH = '/api/auth/oauth2/authorize'
const OIDC_TOKEN_PATH = '/api/auth/oauth2/token'

interface LoginAttempt {
  windowId: number
  controller: AbortController
  notifyCancelled: () => void
  closeLoopback?: () => void
}

let activeLogin: LoginAttempt | undefined

function cancelLogin(notify = false) {
  const attempt = activeLogin
  if (!attempt)
    return

  activeLogin = undefined
  attempt.controller.abort()
  attempt.closeLoopback?.()
  if (notify)
    attempt.notifyCancelled()
}

class TokenExchangeRejected extends Error {
  constructor(readonly status: number) {
    super(signInFailure)
  }
}

/**
 * Create the auth service IPC handlers for a given window context.
 */
export function createAuthService(params: {
  context: MainContext
  window: BrowserWindow
}): void {
  const windowId = params.window.webContents.id

  async function publish(phase: string, emit: () => unknown) {
    try {
      if (!params.window.isDestroyed())
        await emit()
    }
    catch {
      log.withFields({ phase }).error('OIDC event delivery failed')
    }
  }

  params.window.once('closed', () => {
    if (activeLogin?.windowId === windowId)
      cancelLogin()
  })

  defineInvokeHandler(params.context, electronAuthStartLogin, async (_, options) => {
    if (windowId !== options?.raw.ipcMainEvent.sender.id) {
      return
    }

    cancelLogin(activeLogin?.windowId !== windowId)
    const attempt: LoginAttempt = {
      windowId,
      controller: new AbortController(),
      notifyCancelled: () => { void publish('cancelled', () => params.context.emit(electronAuthCancelled, undefined)) },
    }
    activeLogin = attempt
    const { signal } = attempt.controller

    function finish() {
      if (activeLogin === attempt) {
        activeLogin = undefined
        attempt.closeLoopback?.()
      }
    }

    async function reportFailure(phase: string, error: unknown) {
      if (signal.aborted)
        return

      const status = error instanceof TokenExchangeRejected ? error.status : undefined
      log.withFields({ phase, status }).error(signInFailure)
      await publish('failure', () => params.context.emit(electronAuthCallbackError, { error: signInFailure }))
    }

    let phase = 'pkce'
    try {
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)
      signal.throwIfAborted()
      const state = generateState()

      phase = 'loopback'
      const loopback = await startLoopbackServer(state)
      // Cancellation or callback rejection can occur while openExternal is pending.
      void loopback.result.catch(() => {})
      attempt.closeLoopback = loopback.close
      if (signal.aborted) {
        loopback.close()
        return
      }

      // Use the server-side relay as redirect_uri. The relay page serves HTML
      // that forwards the authorization code to the loopback via JS fetch().
      // The loopback port is encoded in the state parameter as "{port}:{state}".
      const redirectUri = `${SERVER_URL}/api/auth/oidc/electron-callback`
      const stateWithPort = `${loopback.port}:${state}`

      // Build authorization URL
      // NOTICE: prompt=login forces the authorization server to show the login
      // page even if the system browser has an existing session cookie. Without
      // this, the OIDC flow auto-completes silently using the stale cookie.
      const url = new URL(OIDC_AUTHORIZE_PATH, SERVER_URL)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', OIDC_CLIENT_ID)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('scope', OIDC_SCOPES)
      url.searchParams.set('state', stateWithPort)
      url.searchParams.set('code_challenge', codeChallenge)
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('prompt', 'login')
      url.searchParams.set('resource', SERVER_URL)

      phase = 'browser'
      await shell.openExternal(url.toString())
      signal.throwIfAborted()

      phase = 'callback'
      void loopback.result
        .then(async ({ code }) => {
          signal.throwIfAborted()
          phase = 'exchange'
          const tokens = await exchangeCode(code, codeVerifier, redirectUri, signal)
          signal.throwIfAborted()
          await publish('success', () => params.context.emit(electronAuthCallback, tokens))
        })
        .catch(error => reportFailure(phase, error))
        .finally(finish)
    }
    catch (error) {
      finish()
      await reportFailure(phase, error)
    }
  })

  defineInvokeHandler(params.context, electronAuthLogout, async (_, options) => {
    if (windowId !== options?.raw.ipcMainEvent.sender.id) {
      return
    }

    cancelLogin(true)
  })
}

// --- Internal helpers ---

interface TokenExchangeResult {
  accessToken: string
  refreshToken?: string
  idToken?: string
  expiresIn: number
}

async function exchangeCode(code: string, codeVerifier: string, redirectUri: string, signal: AbortSignal): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: OIDC_CLIENT_ID,
    code_verifier: codeVerifier,
    resource: SERVER_URL,
  })

  const response = await fetch(new URL(OIDC_TOKEN_PATH, SERVER_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'error',
    signal,
  })

  if (signal.aborted || !response.ok) {
    void response.body?.cancel().catch(() => {})
    signal.throwIfAborted()
    throw new TokenExchangeRejected(response.status)
  }

  const data = await response.json() as Record<string, unknown>
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string | undefined,
    idToken: data.id_token as string | undefined,
    expiresIn: data.expires_in as number,
  }
}
