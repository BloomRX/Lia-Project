import type { LiaRuntimeService } from '../../../core/src/runtime/index.ts'
import type { LiaMemoryMutation } from '../../../core/src/memory/contracts.ts'

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveVoiceRuntimeHome } from '@lia/core/bootstrap/runtime-root'
import { liaProductPaths } from '@lia/core/paths/product-paths'
import { readLiaProductConfig } from '@lia/core/product/config'
import { createLiaSecretVault } from '@lia/core/secrets/vault'
import { createWindowsUserCipher } from '@lia/core/secrets/windows-user-cipher'
import { createKokoroVoiceEngine } from '@lia/core/voice/engines/kokoro'
import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron'

import { createLiaMemoryStore } from '../../../core/src/memory/store.ts'
import { startLiaRuntimeService } from '../../../core/src/runtime/index.ts'
import { createTransportRepository } from '../../../core/src/transports/repository.ts'
import { stageChatCancel, stageChatSend, stageChatSpeak, stageMemoryGet, stageMemoryMutate, stageMicrophoneArm, stageTranscribe, stageTranscriptionCancel } from '../shared/chat-ipc.ts'
import { createStageChat } from './stage-chat.ts'
import { createStageHost } from './stage-host.ts'
import { createStageTranscription } from './stage-transcription.ts'
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
  const memory = createLiaMemoryStore({ filePath: join(app.getPath('userData'), 'lia-memory.json') })
  const send = createStageChat({
    recallMemory: memory.recall,
    readCredential: providerId => vault.getSecret(providerId, 'apiKey'),
    readProduct,
    readTransports: repository.read,
  })
  const transcribe = createStageTranscription({
    readCredential: providerId => vault.getSecret(providerId, 'apiKey'),
    readProduct,
    readTransports: repository.read,
  })
  let window: BrowserWindow | undefined
  let runtimeService: LiaRuntimeService | undefined
  let active: AbortController | undefined
  let recording: AbortController | undefined
  let lastAnswer: string | undefined
  let microphoneUntil = 0
  const cancel = () => active?.abort()
  const cancelOperations = () => {
    microphoneUntil = 0
    cancel()
    recording?.abort()
  }
  const authorized = (event: Electron.IpcMainInvokeEvent) =>
    window && !window.isDestroyed() && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame

  ipcMain.handle(stageMemoryGet, event => authorized(event) ? memory.get() : { ok: false, code: 'invalid' })
  ipcMain.handle(stageMemoryMutate, (event, request: LiaMemoryMutation) =>
    authorized(event) && !active ? memory.mutate(request) : { ok: false, code: 'unavailable' })

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
  ipcMain.handle(stageTranscribe, async (event, bytes: unknown, mimeType: unknown) => {
    const owner = window
    if (!owner || !authorized(event) || recording)
      return { ok: false, code: 'configuration' }
    const controller = new AbortController()
    recording = controller
    try {
      return await transcribe(bytes, mimeType, controller.signal, async (providerId, destination, signal) => {
        if (signal.aborted || owner.isDestroyed())
          return false
        const { response } = await dialog.showMessageBox(owner, {
          type: 'question',
          title: 'Lia',
          message: 'Enviar esta gravação para transcrição?',
          detail: `O áudio será enviado a ${providerId} (\n${destination}\n).`,
          buttons: ['Cancelar', 'Enviar gravação'],
          cancelId: 0,
          defaultId: 0,
          noLink: true,
          signal,
        })
        return response === 1 && !signal.aborted && !owner.isDestroyed()
      })
    }
    finally {
      recording = undefined
    }
  })
  ipcMain.handle(stageTranscriptionCancel, (event) => {
    if (authorized(event)) {
      microphoneUntil = 0
      recording?.abort()
    }
  })
  ipcMain.handle(stageMicrophoneArm, (event) => {
    if (!authorized(event))
      return false
    microphoneUntil = Date.now() + 15_000
    return true
  })
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
      const ownsMicrophoneRequest = (owner: Electron.WebContents | null, isMainFrame: boolean, requestingUrl?: string) =>
        !stageWindow.isDestroyed() && owner === stageWindow.webContents && isMainFrame
        && requestingUrl === owner.getURL() && Date.now() < microphoneUntil
      const stageSession = stageWindow.webContents.session
      stageSession.setPermissionCheckHandler((owner, permission, _origin, details) =>
        permission === 'media' && details.mediaType === 'audio'
        && ownsMicrophoneRequest(owner, details.isMainFrame, details.requestingUrl))
      stageSession.setPermissionRequestHandler((owner, permission, reply, details) => {
        const allowed = permission === 'media' && 'mediaTypes' in details
          && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio'
          && ownsMicrophoneRequest(owner, details.isMainFrame, details.requestingUrl)
        if (allowed)
          microphoneUntil = 0
        reply(allowed)
      })
      stageWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      stageWindow.webContents.on('will-navigate', event => event.preventDefault())
      stageWindow.webContents.on('did-start-navigation', (details) => {
        if (details.isMainFrame && !details.isSameDocument)
          cancelOperations()
      })
      stageWindow.webContents.on('render-process-gone', cancelOperations)
      stageWindow.once('closed', cancelOperations)
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
    cancelOperations()
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
