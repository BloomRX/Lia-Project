import type { LiaRuntimeService } from '../../../core/src/runtime/index.ts'
import type { LiaMemoryMutation } from '../../../core/src/memory/contracts.ts'

import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveVoiceRuntimeHome } from '@lia/core/bootstrap/runtime-root'
import { liaProductPaths } from '@lia/core/paths/product-paths'
import { readLiaProductConfig, updateLiaProductConfig } from '@lia/core/product/config'
import { createLiaSecretVault } from '@lia/core/secrets/vault'
import { createWindowsUserCipher } from '@lia/core/secrets/windows-user-cipher'
import { createKokoroVoiceEngine } from '@lia/core/voice/engines/kokoro'
import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron'

import { createLiaMemoryStore } from '../../../core/src/memory/store.ts'
import { readPublishedHubCatalog } from '../../../core/src/hub/published-catalog.ts'
import { startLiaRuntimeService } from '../../../core/src/runtime/index.ts'
import { createTransportRepository } from '../../../core/src/transports/repository.ts'
import { stageChatCancel, stageChatSend, stageChatSpeak, stageMemoryGet, stageMemoryMutate, stageMicrophoneArm, stagePresenceClose, stagePresenceCommand, stagePresenceOpen, stagePresenceRead, stagePresenceRendered, stageTranscribe, stageTranscriptionCancel } from '../shared/chat-ipc.ts'
import { stageConversationChange, stageHistoryChange, stageHistoryGet, stageHistoryImport, stageHistoryRemoveMessage, stageLanguageGet, stagePresenceDisplays } from '../shared/chat-ipc.ts'
import { stagePersonaChange, stagePersonaGet } from '../shared/chat-ipc.ts'
import { stagePresenceReadPackagedAvatar } from '../shared/chat-ipc.ts'
import { stageHubCatalogGet, stageMemoryExport } from '../shared/chat-ipc.ts'
import { stageChatStopSpeech, stageVoiceAutoPlay } from '../shared/chat-ipc.ts'
import { stageLocale, stageText } from '../shared/locale.ts'
import { createStageChat } from './stage-chat.ts'
import { createStageHistory } from './stage-history.ts'
import { createStageHost } from './stage-host.ts'
import { createStagePersona, defaultTraits, readPackagedAvatar } from './stage-persona.ts'
import { createStageRemoteSpeech } from './stage-remote-speech.ts'
import { createStagePresence } from './stage-presence.ts'
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
  const readLocale = async () => {
    const config = await readProduct()
    return stageLocale(config.status === 'ok' ? config.value.preferences?.language : undefined)
  }
  let window: BrowserWindow | undefined
  const remoteSpeech = createStageRemoteSpeech({
    readProduct,
    readTransports: repository.read,
    readCredential: providerId => vault.getSecret(providerId, 'apiKey'),
    async approve(origin, signal) {
      const owner = window
      if (!owner || owner.isDestroyed())
        return false
      const locale = await readLocale()
      if (signal.aborted || owner.isDestroyed())
        return false
      const { response } = await dialog.showMessageBox(owner, {
        type: 'question', title: 'Lia',
        message: stageText(locale, 'Enviar a resposta da Lia para síntese de voz?'),
        detail: `${stageText(locale, 'O texto da resposta será enviado a')} ${origin}.`,
        buttons: [stageText(locale, 'Cancelar'), stageText(locale, 'Enviar resposta')],
        defaultId: 0, cancelId: 0, noLink: true, signal,
      })
      return response === 1 && !signal.aborted && !owner.isDestroyed()
    },
  })
  const presence = createStagePresence({
    isHostFullscreen: () => Boolean(window && !window.isDestroyed() && window.isFullScreen()),
    async loadConfig() {
      const config = await readProduct()
      return config.status === 'ok' ? config.value.presence : undefined
    },
    async saveConfig(value) {
      const result = await updateLiaProductConfig(paths.productConfigFile, { presence: value })
      if (result.status !== 'ok')
        throw new Error('presence-storage')
    },
  })
  const voice = createStageVoice(createKokoroVoiceEngine({
    installDirOverride: () => voiceInstallDir,
    runtimeHome: () => resolveVoiceRuntimeHome({ userDataDir: paths.userDataDir }),
  }), async () => {
    const config = await readProduct()
    voiceInstallDir = config.status === 'ok' ? config.value.voice?.runtime?.installDir : undefined
    return config
  }, remoteSpeech)
  const vault = createLiaSecretVault({
    filePath: paths.vaultFile,
    cipher: createWindowsUserCipher({
      available: () => safeStorage.isEncryptionAvailable(),
      decrypt: payload => safeStorage.decryptString(payload),
      encrypt: value => safeStorage.encryptString(value),
    }),
  })
  const memory = createLiaMemoryStore({ filePath: join(app.getPath('userData'), 'lia-memory.json') })
  const memoryImport = await memory.importIfMissing(join(paths.userDataDir, 'stage-profile', 'lia-memory.json'))
  if (!memoryImport.ok)
    console.warn('Lia: não foi possível migrar as notas do perfil anterior.')
  const history = createStageHistory(join(app.getPath('userData'), 'lia-chat-history.json'))
  const persona = createStagePersona(join(app.getPath('userData'), 'personality'))
  const send = createStageChat({
    storage: history,
    recallMemory: memory.recall,
    readCredential: providerId => vault.getSecret(providerId, 'apiKey'),
    readPersona: async id => (await persona.read(id))?.prompt,
    readProduct,
    readTransports: repository.read,
  })
  const transcribe = createStageTranscription({
    readCredential: providerId => vault.getSecret(providerId, 'apiKey'),
    readProduct,
    readTransports: repository.read,
  })
  let runtimeService: LiaRuntimeService | undefined
  let active: AbortController | undefined
  let recording: AbortController | undefined
  let updatingHistory = false
  let lastAnswer: string | undefined
  const updateAnswer = (answer?: string) => {
    void voice.cancel().catch(() => {})
    lastAnswer = answer
  }
  let microphoneUntil = 0
  const cancel = () => active?.abort()
  const cancelOperations = () => {
    microphoneUntil = 0
    cancel()
    recording?.abort()
    void voice.cancel().catch(() => {})
  }
  const authorized = (event: Electron.IpcMainInvokeEvent) =>
    window && !window.isDestroyed() && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame
  let readingHubCatalog: ReturnType<typeof readPublishedHubCatalog> | undefined
  const hubHome = process.env.LIA_AGENTHUB_HOME?.trim() || undefined
  ipcMain.handle(stageHubCatalogGet, async (event) => {
    if (!authorized(event))
      return { status: 'unavailable' }
    readingHubCatalog ??= readPublishedHubCatalog(homedir(), hubHome).finally(() => { readingHubCatalog = undefined })
    return readingHubCatalog
  })
  let readingPackagedAvatar = false
  ipcMain.handle(stagePresenceReadPackagedAvatar, async (event, input: unknown) => {
    if (!authorized(event) || readingPackagedAvatar)
      return undefined
    readingPackagedAvatar = true
    try {
      return await readPackagedAvatar(input)
    }
    catch {
      return undefined
    }
    finally {
      readingPackagedAvatar = false
    }
  })

  ipcMain.handle(stageMemoryGet, event => authorized(event) ? memory.get() : { ok: false, code: 'invalid' })
  let exportingMemory = false
  ipcMain.handle(stageMemoryExport, async (event) => {
    const owner = window
    if (!owner || !authorized(event) || exportingMemory)
      return { ok: false, code: 'unavailable' }
    exportingMemory = true
    try {
      const locale = await readLocale()
      if (!authorized(event))
        return { ok: false, code: 'cancelled' }
      const result = await dialog.showSaveDialog(owner, {
        title: stageText(locale, 'Exportar notas'),
        defaultPath: 'lia-memoria.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePath || !authorized(event))
        return { ok: false, code: 'cancelled' }
      const snapshot = await memory.get()
      if (!snapshot.ok || !authorized(event))
        return { ok: false, code: 'unavailable' }
      await writeFile(result.filePath, JSON.stringify(snapshot.value, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      return { ok: true }
    }
    catch { return { ok: false, code: 'unavailable' } }
    finally { exportingMemory = false }
  })
  let confirmingMemoryClear = false
  ipcMain.handle(stageMemoryMutate, async (event, request: LiaMemoryMutation) => {
    const owner = window
    if (!owner || !authorized(event) || active || confirmingMemoryClear)
      return { ok: false, code: 'unavailable' }
    if (request?.action !== 'clear' || request.confirmed !== true)
      return memory.mutate(request)
    confirmingMemoryClear = true
    try {
      const locale = await readLocale()
      if (!authorized(event))
        return { ok: false, code: 'cancelled' }
      const { response } = await dialog.showMessageBox(owner, {
        type: 'warning', title: 'Lia',
        message: stageText(locale, 'Apagar todas as notas salvas?'),
        detail: stageText(locale, 'Esta ação apaga as notas de memória deste perfil. O histórico da conversa será mantido.'),
        buttons: [stageText(locale, 'Cancelar'), stageText(locale, 'Apagar notas')],
        defaultId: 0, cancelId: 0, noLink: true,
      })
      if (response !== 1 || !authorized(event))
        return { ok: false, code: 'cancelled' }
      return active ? { ok: false, code: 'unavailable' } : await memory.mutate({ action: 'clear', confirmed: true })
    }
    catch {
      return { ok: false, code: 'unavailable' }
    }
    finally {
      confirmingMemoryClear = false
    }
  })
  ipcMain.handle(stagePresenceOpen, (event, bytes: unknown) => Boolean(authorized(event)) && presence.open(bytes))
  ipcMain.handle(stagePresenceClose, (event) => {
    if (authorized(event))
      presence.close()
  })
  ipcMain.handle(stagePresenceCommand, (event, action: unknown) => Boolean(authorized(event)) && presence.command(action))
  ipcMain.handle(stagePresenceDisplays, event => authorized(event) ? presence.displays() : undefined)
  ipcMain.handle(stagePresenceRead, presence.takeAsset)
  ipcMain.on(stagePresenceRendered, presence.reportRender)
  ipcMain.handle(stageLanguageGet, event => (authorized(event) || presence.ownsOverlay(event)) ? readLocale() : undefined)
  ipcMain.handle(stageHistoryGet, async event => {
    if (!authorized(event))
      return undefined
    return history.get().catch(() => undefined)
  })
  ipcMain.handle(stageHistoryRemoveMessage, async (event, id: unknown, revision: unknown, index: unknown, side: unknown) => {
    const owner = window
    if (!owner || !authorized(event) || updatingHistory || active
      || typeof id !== 'string' || id.length > 36 || typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)
      || typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= 24
      || (side !== 'user' && side !== 'assistant'))
      return { status: 'unavailable' }
    updatingHistory = true
    try {
      const locale = await readLocale()
      if (!authorized(event))
        return { status: 'cancelled' }
      const { response } = await dialog.showMessageBox(owner, {
        type: 'warning', title: 'Lia',
        message: stageText(locale, 'Apagar esta mensagem?'),
        detail: stageText(locale, 'Somente esta mensagem será apagada. O restante da conversa será preservado.'),
        buttons: [stageText(locale, 'Cancelar'), stageText(locale, 'Apagar mensagem')],
        defaultId: 0, cancelId: 0, noLink: true,
      })
      if (response !== 1 || !authorized(event))
        return { status: 'cancelled' }
      const state = await history.removeMessage(id, revision, index, side)
      if (!state)
        return { status: 'unavailable' }
      updateAnswer()
      send.clearContext()
      return { status: 'removed', state }
    }
    catch {
      return { status: 'unavailable' }
    }
    finally {
      updatingHistory = false
    }
  })
  ipcMain.handle(stagePersonaGet, async (event) => {
    if (!authorized(event))
      return undefined
    try {
      const config = await readProduct()
      const active = config.status === 'ok' ? config.value.persona?.activeCardId : undefined
      if (!active || active === 'lia' || active === 'lia-default')
        return { name: 'Lia', traits: defaultTraits }
      const selected = await persona.read(active)
      return { name: selected?.name, traits: selected?.traits ?? defaultTraits }
    }
    catch {
      return undefined
    }
  })
  ipcMain.handle(stagePersonaChange, async (event, input: unknown) => {
    if (!authorized(event) || updatingHistory || active)
      return undefined
    updatingHistory = true
    try {
      const card = input === null ? { id: 'lia', name: 'Lia' }
        : typeof input === 'string' || input instanceof Uint8Array ? await persona.import(input)
          : await persona.customize(input)
      const result = await updateLiaProductConfig(paths.productConfigFile, { persona: { activeCardId: card.id } })
      if (result.status !== 'ok')
        return undefined
      updateAnswer()
      send.clearContext()
      return card.name
    }
    catch {
      return undefined
    }
    finally {
      updatingHistory = false
    }
  })
  ipcMain.handle(stageConversationChange, async (event, action: unknown, id: unknown) => {
    if (!authorized(event) || updatingHistory || active)
      return undefined
    if (action !== 'create' && action !== 'select' && action !== 'delete')
      return undefined
    if (action === 'select' ? typeof id !== 'string' || id.length > 36 : id !== undefined)
      return undefined
    updatingHistory = true
    try {
      const state = await history.changeConversation(action, typeof id === 'string' ? id : undefined)
      if (state) {
        updateAnswer()
        send.clearContext()
      }
      return state
    }
    catch {
      return undefined
    }
    finally {
      updatingHistory = false
    }
  })
  ipcMain.handle(stageHistoryImport, async (event, input: unknown) => {
    if (!authorized(event) || updatingHistory || active)
      return undefined
    updatingHistory = true
    try {
      return await history.importLegacy(input)
    }
    catch {
      return undefined
    }
    finally {
      updatingHistory = false
    }
  })
  ipcMain.handle(stageHistoryChange, async (event, action: unknown) => {
    if (!authorized(event) || updatingHistory || active || (action !== 'enable' && action !== 'disable' && action !== 'clear'))
      return false
    updatingHistory = true
    try {
      if (action === 'clear')
        await history.clear()
      else
        await history.setEnabled(action === 'enable')
      if (action !== 'enable') {
        updateAnswer()
        send.clearContext()
      }
      return true
    }
    catch {
      return false
    }
    finally {
      updatingHistory = false
    }
  })

  ipcMain.handle(stageChatSend, async (event, input: unknown, image?: unknown, allowClock?: unknown) => {
    if (!authorized(event))
      return { ok: false, code: 'invalid' }
    if (active || updatingHistory)
      return { ok: false, code: 'busy' }
    const controller = new AbortController()
    active = controller
    try {
      const owner = window
      const intent = allowClock === true ? { capability: 'local-clock', mode: 'request' } : allowClock
      const result = await send(input, controller.signal, image, intent, async () => {
        const locale = await readLocale()
        if (!owner || controller.signal.aborted || !authorized(event))
          return false
        const { response } = await dialog.showMessageBox(owner, {
          type: 'question', title: 'Lia',
          message: stageText(locale, 'Consultar a data e a hora deste computador nesta mensagem?'),
          buttons: [stageText(locale, 'Cancelar'), stageText(locale, 'Consultar')],
          defaultId: 0, cancelId: 0, noLink: true,
          signal: controller.signal,
        })
        return response === 1 && !controller.signal.aborted && Boolean(authorized(event))
      })
      if (result.ok)
        updateAnswer(result.text)
      return result
    }
    catch {
      return { ok: false, code: controller.signal.aborted ? 'cancelled' : 'unavailable' }
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
  ipcMain.handle(stageChatStopSpeech, async (event) => {
    if (authorized(event))
      await voice.cancel().catch(() => {})
  })
  ipcMain.handle(stageVoiceAutoPlay, async (event, enabled: unknown) => {
    if (!authorized(event) || (enabled !== undefined && typeof enabled !== 'boolean'))
      return undefined
    const result = enabled === undefined
      ? await readProduct()
      : await updateLiaProductConfig(paths.productConfigFile, { voice: { autoPlay: enabled } })
    if (result.status === 'missing' && enabled === undefined)
      return false
    return result.status === 'ok' ? result.value.voice?.autoPlay === true : undefined
  })
  ipcMain.handle(stageTranscribe, async (event, bytes: unknown, mimeType: unknown) => {
    const owner = window
    if (!owner || !authorized(event) || recording)
      return { ok: false, code: 'configuration' }
    const controller = new AbortController()
    recording = controller
    try {
      return await transcribe(bytes, mimeType, controller.signal, async (providerId, destination, signal) => {
        const locale = await readLocale()
        if (signal.aborted || owner.isDestroyed())
          return false
        const { response } = await dialog.showMessageBox(owner, {
          type: 'question',
          title: 'Lia',
          message: stageText(locale, 'Enviar esta gravação para transcrição?'),
          detail: `${stageText(locale, 'O áudio será enviado a')} ${providerId} (\n${destination}\n).`,
          buttons: [stageText(locale, 'Cancelar'), stageText(locale, 'Enviar gravação')],
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
      stageWindow.once('closed', presence.close)
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
