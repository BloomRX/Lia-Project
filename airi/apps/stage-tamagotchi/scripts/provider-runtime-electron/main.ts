import process from 'node:process'

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createContext } from '@moeru/eventa/adapters/electron/main'
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'

import { createLiaProductConfig } from '../../src/main/configs/lia'
import { registerLiaProviderConfigBridge } from '../../src/main/services/lia/provider-config-service'
import { createLiaSecretVault, registerLiaSecretsBridge } from '../../src/main/services/lia/secrets-service'
import { canRendererReadLegacySecret, registerLiaTransportConfigBridge } from '../../src/main/services/lia/transport-config-service'

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

const metrics = { mainPid: process.pid, rendererPid: 0, encryptionAvailable: false, readScopes: [] as string[], rendererGone: [] as { reason: string, exitCode: number }[] }
const saveMetrics = () => writeFileSync(join(root, 'main-state.json'), JSON.stringify(metrics))
void app.whenReady().then(async () => {
  metrics.encryptionAvailable = safeStorage.isEncryptionAvailable()
  const vault = createLiaSecretVault()
  const { context } = createContext(ipcMain)
  const measuredVault = {
    ...vault,
    getSecret(scope: string, key: string) {
      metrics.readScopes.push(scope)
      saveMetrics()
      return vault.getSecret(scope, key)
    },
  }
  registerLiaSecretsBridge({ context, vault: measuredVault, allowRendererRead: canRendererReadLegacySecret })
  registerLiaProviderConfigBridge({ context, liaProductConfig: createLiaProductConfig() })
  registerLiaTransportConfigBridge({ context, vault: measuredVault })

  const window = new BrowserWindow({
    title: 'Lia — Gate Electron local',
    width: 800,
    height: 620,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false },
  })
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
