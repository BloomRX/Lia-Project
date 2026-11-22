import process from 'node:process'

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createContext } from '@moeru/eventa/adapters/electron/main'
import { app, BrowserWindow, ipcMain } from 'electron'

import { createLiaProductConfig } from '../../src/main/configs/lia'
import { createAuthService } from '../../src/main/services/airi/auth'
import { createOidcAccountService } from '../../src/main/services/airi/oidc-account'
import { createOidcSessionOwner } from '../../src/main/services/airi/oidc-session'
import { registerLiaProviderConfigBridge } from '../../src/main/services/lia/provider-config-service'
import { createLiaSecretVault, registerLiaSecretsBridge } from '../../src/main/services/lia/secrets-service'
import { registerLiaTranscriptionBridge } from '../../src/main/services/lia/transcription-service'
import { canRendererReadLegacySecret, getApplicationRepository, registerLiaTransportConfigBridge } from '../../src/main/services/lia/transport-config-service'
import { createStageWebPreferences } from '../../src/main/windows/secure-web-preferences'

const root = process.env.LIA_PROVIDER_GATE_DIR
const preload = process.env.LIA_PROVIDER_GATE_PRELOAD
if (!root || !preload)
  throw new Error('Gate requires an isolated directory and production preload.')
const profile = join(root, 'profile')
mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
mkdirSync(join(profile, 'crash-dumps'), { recursive: true })
app.setPath('crashDumps', join(profile, 'crash-dumps'))
app.setName('Lia provider integration fixture')

const metrics = { mainPid: process.pid, rendererPid: 0, encryptionAvailable: false, readScopes: [] as string[], rendererGone: [] as { reason: string, exitCode: number }[], writes: [] as { scope: string, ok: boolean }[] }
const saveMetrics = () => writeFileSync(join(root, 'main-state.json'), JSON.stringify(metrics))
void app.whenReady().then(async () => {
  const vault = createLiaSecretVault()
  metrics.encryptionAvailable = vault.isEncryptionAvailable()
  const { context } = createContext(ipcMain)
  const measuredVault = {
    ...vault,
    getSecret(scope: string, key: string) {
      metrics.readScopes.push(scope)
      saveMetrics()
      return vault.getSecret(scope, key)
    },
    async setSecret(...args: Parameters<typeof vault.setSecret>) {
      const ok = await vault.setSecret(...args)
      metrics.writes.push({ scope: args[0], ok })
      saveMetrics()
      return ok
    },
  }
  // Harness has a single measured window and no product windows; the sender
  // policy exists to separate product surfaces, which this script does not have.
  registerLiaSecretsBridge({
    context,
    vault: measuredVault,
    allowRendererRead: canRendererReadLegacySecret,
    isAllowedSender: () => true,
  })
  registerLiaProviderConfigBridge({ context, liaProductConfig: createLiaProductConfig() })
  const window = new BrowserWindow({
    title: 'Lia — Gate Electron local',
    width: 800,
    height: 620,
    webPreferences: createStageWebPreferences(preload),
  })
  if (process.env.LIA_GATE_OIDC_ORIGIN) {
    const origin = new URL(process.env.LIA_GATE_OIDC_ORIGIN)
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1')
      throw new Error('The test issuer must use literal loopback')
    const clientId = 'lia-electron-oidc-fixture'
    const session = createOidcSessionOwner({ vault, origin, clientId })
    const account = createOidcAccountService({ origin, withAccess: session.withAccess })
    const authContext = createContext(ipcMain, window).context
    createAuthService({
      context: authContext,
      window,
      sessionOwner: session,
      account,
      connection: {
        origin,
        clientId,
        async openAuthorization(url) {
          if (new URL(url).origin !== origin.origin)
            throw new Error('Unexpected test issuer')
          const response = await fetch(url, { redirect: 'error' })
          if (!response.ok)
            throw new Error('Test issuer refused authorization')
          await response.body?.cancel()
        },
      },
    })
  }
  registerLiaTransportConfigBridge({
    context,
    vault: measuredVault,
    isAllowedSpeechConfigSender: event => !window.isDestroyed() && event?.sender === window.webContents
      && event.senderFrame !== null && event.senderFrame === window.webContents.mainFrame,
  })
  let pendingConsent: { resolve: (approved: boolean) => void } | undefined
  if (process.env.LIA_STT_GATE_TLS_DIR) {
    // Only the test driver in Main can deliver a decision.
    app.on('lia-fixture-stt-consent', (approved: boolean) => pendingConsent?.resolve(approved === true))
  }
  const transcription = registerLiaTranscriptionBridge({
    context,
    repository: getApplicationRepository(),
    vault: measuredVault,
    isAllowedSender: event => !window.isDestroyed()
      && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame,
    async approveRemote(_owner, provider, destination, signal) {
      if (!process.env.LIA_STT_GATE_TLS_DIR || pendingConsent || signal.aborted)
        return false
      const decision = Promise.withResolvers<boolean>()
      pendingConsent = decision
      const abort = () => decision.resolve(false)
      signal.addEventListener('abort', abort, { once: true })
      try {
        writeFileSync(join(root, 'stt-consent.json'), JSON.stringify({ provider, destination }))
        return await decision.promise
      }
      finally {
        signal.removeEventListener('abort', abort)
        pendingConsent = undefined
      }
    },
  })
  app.on('before-quit', () => transcription.dispose())
  window.webContents.on('did-finish-load', () => {
    metrics.rendererPid = window.webContents.getOSProcessId()
    saveMetrics()
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    metrics.rendererGone.push({ reason: details.reason, exitCode: details.exitCode })
    saveMetrics()
  })
  app.on('before-quit', saveMetrics)
  app.on('window-all-closed', () => app.quit())
  await window.loadFile(join(root, 'renderer', 'index.html'))
  saveMetrics()
}).catch(() => {
  process.stderr.write('Gate main initialization failed\n')
  app.exit(1)
})
