import type { LiaRuntimeService } from '../../../core/src/runtime/index.ts'

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveVoiceRuntimeHome } from '@lia/core/bootstrap/runtime-root'
import { liaProductPaths } from '@lia/core/paths/product-paths'
import { readLiaProductConfig } from '@lia/core/product/config'
import { createLiaSecretVault } from '@lia/core/secrets/vault'
import { createWindowsUserCipher } from '@lia/core/secrets/windows-user-cipher'
import { createKokoroVoiceEngine } from '@lia/core/voice/engines/kokoro'
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'

import { startLiaRuntimeService } from '../../../core/src/runtime/index.ts'
import { createTransportRepository } from '../../../core/src/transports/repository.ts'
import { stageChatCancel, stageChatSend, stageChatSpeak } from '../shared/chat-ipc.ts'
import { createStageChat } from './stage-chat.ts'
import { createStageHost } from './stage-host.ts'
import { createStageVoice } from './stage-voice.ts'

async function main(): Promise<void> {
  const profile = process.env.LIA_STAGE_PROFILE_DIR?.trim()
  if (profile) {
    mkdirSync(profile, { recursive: true })
    app.setPath('userData', profile)
  }
  if (!app.requestSingleInstanceLock()) {
    app.exit(1)
    return
  }
  await app.whenReady()
  const paths = liaProductPaths()
  const repository = createTransportRepository(join(paths.userDataDir, 'lia-transports.json'))
  let voiceInstallDir: string | undefined
  const readProduct = () => readLiaProductConfig(paths.productConfigFile)
  const voice = createStageVoice(createKokoroVoiceEngine({
    installDirOverride: () => voiceInstallDir,
    runtimeHome: () => resolveVoiceRuntimeHome({ userDataDir: paths.userDataDir }),
  }), async () => {
    const config = await readProduct()
    voiceInstallDir = config.status === 'ok' ? config.value.voice?.runtime?.installDir : undefined
    return config
  })
  const vault = createLiaSecretVault({
    filePath: paths.vaultFile,
    cipher: createWindowsUserCipher({
      available: () => safeStorage.isEncryptionAvailable(),
      decrypt: payload => safeStorage.decryptString(payload),
      encrypt: value => safeStorage.encryptString(value),
    }),
  })
  const send = createStageChat({
    readCredential: providerId => vault.getSecret(providerId, 'apiKey'),
    readProduct,
    readTransports: repository.read,
  })
  let window: BrowserWindow | undefined
  let runtimeService: LiaRuntimeService | undefined
  let active: AbortController | undefined
  let lastAnswer: string | undefined
  const cancel = () => active?.abort()
  const authorized = (event: Electron.IpcMainInvokeEvent) =>
    window && !window.isDestroyed() && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame

  ipcMain.handle(stageChatSend, async (event, input: unknown) => {
    if (!authorized(event))
      return { ok: false, code: 'invalid' }
    if (active)
      return { ok: false, code: 'busy' }
    const controller = new AbortController()
    active = controller
    try {
      const result = await send(input, controller.signal)
      if (result.ok)
        lastAnswer = result.text
      return result
    }
    finally {
      active = undefined
    }
  })
  ipcMain.handle(stageChatCancel, (event) => {
    if (authorized(event))
      cancel()
  })
  ipcMain.handle(stageChatSpeak, event => authorized(event) ? voice.speak(lastAnswer) : { ok: false, code: 'unavailable' })
  const host = createStageHost({
    createWindow: async () => {
      const stageWindow = new BrowserWindow({
        width: 480,
        height: 640,
        show: false,
        title: 'Lia',
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
        },
      })
      window = stageWindow
      stageWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      stageWindow.webContents.on('will-navigate', event => event.preventDefault())
      stageWindow.webContents.on('did-start-navigation', (details) => {
        if (details.isMainFrame && !details.isSameDocument)
          cancel()
      })
      stageWindow.webContents.on('render-process-gone', cancel)
      stageWindow.once('closed', cancel)
      try {
        const devUrl = import.meta.env.DEV && process.env.ELECTRON_RENDERER_URL
        if (devUrl)
          await stageWindow.loadURL(devUrl)
        else
          await stageWindow.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
      }
      catch {
        if (!stageWindow.isDestroyed())
          stageWindow.destroy()
        throw new Error('Falha ao carregar a janela do Stage')
      }
      return {
        show: () => stageWindow.show(),
        close: async () => {
          if (!stageWindow.isDestroyed())
            stageWindow.destroy()
        },
      }
    },
    terminate: async () => { app.quit() },
    nextPid: () => process.pid,
    onLog: line => console.log(`[lia-stage] ${line}`),
  })

  app.on('window-all-closed', () => { void host.stop().finally(() => app.quit()) })
  let cleaned = false
  let cleanup: Promise<unknown> | undefined
  app.on('before-quit', (event) => {
    if (cleaned)
      return
    event.preventDefault()
    cancel()
    cleanup ??= Promise.allSettled([runtimeService?.stop(), voice.stop()]).then(() => {
      cleaned = true
      app.quit()
    })
  })
  const snapshot = await host.start()
  if (snapshot.phase !== 'running') {
    app.exit(1)
    return
  }

  // Standalone development windows do not replace the Launcher's runtime record.
  const stateDir = process.env.LIA_RUNTIME_STATE_DIR?.trim()
  if (process.env.LIA_MANAGED === '1' && stateDir) {
    const result = await startLiaRuntimeService({
      stateDir,
      appVersion: app.getVersion(),
      startedBy: 'launcher',
      requestExit: () => host.stop(),
      forceExit: code => app.exit(code),
      status: () => ({ windows: BrowserWindow.getAllWindows().length }),
    })
    if (!result.ok) {
      await host.stop()
      return
    }
    runtimeService = result.service
  }
}

void main().catch(() => app.exit(1))
