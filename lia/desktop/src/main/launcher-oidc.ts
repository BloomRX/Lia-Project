import type { LiaSecretVault } from '@lia/core/secrets/vault'

import { createOidcAccountService } from '@lia/core/secrets/oidc-account'
import { createOidcLogin } from '@lia/core/secrets/oidc-login'
import { createOidcSessionOwner } from '@lia/core/secrets/oidc-session'

export function resolveDevelopmentOidc(packaged: boolean, rawOrigin: string | undefined, clientId: string | undefined) {
  if (packaged || !rawOrigin || !clientId || !/^[\w.-]{1,128}$/.test(clientId))
    return undefined
  const origin = URL.parse(rawOrigin)
  if (!origin || !['127.0.0.1', '[::1]'].includes(origin.hostname) || origin.protocol !== 'http:' || origin.username
    || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    return undefined
  return { origin, clientId }
}

export function registerLauncherOidc(options: {
  ipc: Pick<Electron.IpcMain, 'handle' | 'removeHandler'>
  window: Electron.BrowserWindow
  vault: LiaSecretVault
  connection?: ReturnType<typeof resolveDevelopmentOidc>
  openAuthorization: (url: string) => Promise<unknown>
}) {
  const { ipc, window, vault, connection, openAuthorization } = options
  const contents = window.webContents
  const owner = connection && createOidcSessionOwner({ ...connection, vault })
  const login = connection && owner && createOidcLogin({ ...connection, owner, openAuthorization })
  const account = connection && owner && createOidcAccountService({ ...connection, withAccess: owner.withAccess })
  let lifetime = new AbortController()
  let inFlight = false
  const replaceDocument = () => {
    lifetime.abort()
    lifetime = new AbortController()
  }
  contents.on('did-start-navigation', details => {
    if (details.isMainFrame && !details.isSameDocument)
      replaceDocument()
  })
  contents.on('render-process-gone', replaceDocument)
  contents.once('destroyed', () => lifetime.abort())

  type Operation = (signal: AbortSignal) => Promise<unknown> | unknown
  function register(channel: string, operation: Operation) {
    ipc.handle(channel, async (event, ...args: unknown[]) => {
      if (args.length || window.isDestroyed() || contents.isDestroyed() || event.sender !== contents
        || !event.senderFrame || event.senderFrame !== contents.mainFrame)
        return { ok: false, code: 'invalid-request' }
      const { signal } = lifetime
      try {
        const result = await operation(signal)
        return signal.aborted ? { ok: false, code: 'cancelled' } : result
      }
      catch {
        return { ok: false, code: signal.aborted ? 'cancelled' : 'unavailable' }
      }
    })
    window.once('closed', () => ipc.removeHandler(channel))
  }

  register('lia:oidc:status', () => ({ ok: true, available: Boolean(login && vault.isEncryptionAvailable()) }))
  register('lia:oidc:login', async signal => login && vault.isEncryptionAvailable() ? login.login(signal) : { ok: false, code: 'unavailable' })
  register('lia:oidc:cancel', () => {
    login?.cancel()
    return { ok: true }
  })
  register('lia:oidc:profile', async (signal) => {
    if (!account || inFlight)
      return { ok: false, code: 'unavailable' }
    inFlight = true
    try {
      return await account.execute({ kind: 'get-profile' }, signal)
    }
    finally {
      inFlight = false
    }
  })
  register('lia:oidc:logout', async () => {
    login?.cancel()
    if (!owner)
      return { ok: false, code: 'unavailable' }
    const result = await owner.logout()
    return { ok: result.cleared, revocation: result.revocation }
  })
}
