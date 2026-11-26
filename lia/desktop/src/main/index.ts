import type { SupervisorQuitFlow } from './shutdown-coordinator'

import process from 'node:process'

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { KOKORO_DEFAULT_VOICE_ID, KOKORO_VOICES } from '@lia/core/voice/engines/kokoro'
import { createWindowsUserCipher } from '@lia/core/secrets/windows-user-cipher'
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { statSync as physicalStatSync } from 'original-fs'

import { allTalkSpeechProvider, isAllTalkVoiceFile } from '../../../core/src/providers/alltalk-speech.ts'
import { allTalkLocalOrigin, createLocalAllTalk, listLocalAllTalkVoices } from '../../../core/src/providers/local-alltalk.ts'
import { createLiaDevflowAutorun } from './devflow-autorun'
import { createLiaEventPublisher } from './event-publisher'
import { registerLiaIpc } from './ipc'
import { registerLauncherOidc, resolveDevelopmentOidc } from './launcher-oidc'
import { launcherProfilePath } from './launcher-profile'
import { createLiaHost } from './lia-host'
import { resolveNativeStage } from './native-stage'
import { resolvePackagedStage } from './packaged-stage'
import { createSupervisorQuitFlow } from './shutdown-coordinator'
import { enforceSingleInstance } from './single-instance'
import { createLiaBootTimer } from './timing'
import { createLiaVoiceEngineService } from './voice-engine-service'
import { createLiaVoiceInstallInspector } from './voice-install-inspector'
import { createLiaVoiceProvisioning } from './voice-provisioning'
import { LIA_MAIN_WEB_PREFERENCES } from './web-preferences'

/**
 * The Lia launcher entry (Phase 7, architecture items 1/11/15).
 *
 * Boot contract: the window appears with ONLY Lia loaded - no AIRI spawn,
 * no stage UI, no plugin host, no chat initialization. The stage rises
 * exclusively from the user's "Conversar com Lia" (or a future explicit
 * autostart preference), through the managed Stage child process.
 *
 * The four boot marks (`lia-app.start`, `lia-app.window-created`,
 * `lia-app.renderer-ready`, `lia-core.ready`) are logged as evidence that
 * the launcher no longer waits for AIRI - never as invented targets.
 */

const timer = createLiaBootTimer()
timer.mark('lia-app.start')

let mainWindow: BrowserWindow | undefined
// The packaged name must not select the Stage's active Chromium profile or
// abandon an existing safeStorage cipher profile.
const chromiumProfile = launcherProfilePath(app.getPath('appData'))
mkdirSync(chromiumProfile, { recursive: true })
app.setPath('userData', chromiumProfile)
/**
 * The ONE quit path (Phase 7.1, item 3). Exists only after the host does;
 * an exit signal before that means nothing was spawned and the process may
 * simply leave.
 */
let quitFlow: SupervisorQuitFlow | undefined

/**
 * ONE supervisor, ever (ownership correction, item 5). Must precede any
 * host/window/spawn: the losing process owns nothing and leaves at once;
 * the primary receives copies as focus requests on its existing window.
 */
const instanceRole = enforceSingleInstance({
  focusPrimaryWindow: () => {
    if (mainWindow) {
      if (mainWindow.isMinimized())
        mainWindow.restore()
      mainWindow.focus()
    }
  },
  leaveImmediately: () => app.exit(0),
  log: line => console.info(line),
  onSecondInstance: handler => app.on('second-instance', handler),
  requestLock: () => app.requestSingleInstanceLock(),
})

const isDevelopment = process.env.NODE_ENV !== 'production'

/** The ONE renderer-facing event sink, guarded for the window's lifetime. */
const publishLiaEvent = createLiaEventPublisher({
  getWindow: () => mainWindow,
  log: line => console.info(line),
})

async function bootstrap(): Promise<void> {
  await app.whenReady()

  // Lia Core comes up with the user's own cipher before the window even
  // finishes its first paint - but WITHOUT starting the voice runtime
  // (contract item 12) and without touching AIRI (contract item 11).
  const host = createLiaHost({
    // O cofre agora pertence ao RUNTIME (D04-B2). O Launcher não abre mais o
    // pipe de credenciais: quando ele fecha, não existe pipe para cair e o
    // Stage continua resolvendo os próprios provedores.
    launcherChromiumProfile: chromiumProfile,
    // Electron's patched fs presents an app.asar archive as a directory.
    nativeStagePreview: true,
    packagedStage: app.isPackaged
      ? () => resolvePackagedStage(process.resourcesPath, physicalStatSync)
      : () => resolveNativeStage(join(import.meta.dirname, '..', '..', '..', 'stage')),
    cipher: createWindowsUserCipher({
      available: () => safeStorage.isEncryptionAvailable(),
      decrypt: payload => safeStorage.decryptString(payload),
      encrypt: value => safeStorage.encryptString(value),
    }),
    // Phase 7.9E.2: the REAL install proof - without this the gate defaulted
    // to not-installed even with the validated Kokoro tree on disk.
    inspectInstallImpl: createLiaVoiceInstallInspector(),
    // Host events are never secret; the renderer log strip mirrors them
    // through the bounded publisher (item 6: terminal sink always,
    // renderer best-effort, delivery errors never escape).
    onEvent: (event, detail) => publishLiaEvent(event, detail),
  })
  timer.mark('lia-core.ready')

  // Phase 7.9H: local fan-out of the shared install path's events. The
  // provisioning module needs completion/step notifications; the renderer
  // rail keeps its normal terminal sink. One listener set, bounded.
  const installEventListeners = new Set<(event: string, detail?: string) => void>()
  const fanOutEvent = (event: string, detail?: string): void => {
    publishLiaEvent(event, detail)
    for (const listener of Array.from(installEventListeners))
      listener(event, detail)
  }

  // Phase 7.9G: the Voice Engine surface reuses the SAME real install proof
  // (7.9E.2), the host-owned effective runtime home (7.4), the canonical
  // snapshot for the selection model (7.9F) and the bounded event rail
  // (item 6). No path or layout knowledge is duplicated here.
  const voiceEngine = createLiaVoiceEngineService({
    effectiveHome: async () => (await host.runtimeLocationStatus()).effectiveInstallDir,
    inspector: createLiaVoiceInstallInspector(),
    onEvent: fanOutEvent,
    snapshot: async () => await host.productSnapshot(),
  })

  // Phase 7.9H: automatic first-run voice provisioning. It DELEGATES every
  // real action (install proof: 7.9E.2 inspector; installation: the same
  // 7.9G single-flight service the manual card uses; home: host resolution
  // honoring the QA installDir override) and owns only the readiness model
  // and its exactly-one-attempt semantics.
  const voiceProvisioning = createLiaVoiceProvisioning({
    effectiveHome: async () => (await host.runtimeLocationStatus()).effectiveInstallDir,
    install: async () => await voiceEngine.install(),
    installEvents: (listener) => {
      installEventListeners.add(listener)
      return () => installEventListeners.delete(listener)
    },
    isInstalled: runtimeHome => createLiaVoiceInstallInspector()(runtimeHome),
    onStatus: (status) => {
      // Metadata-only rail event: the renderer derives its human copy from
      // state+step; the terminal log keeps the same honest detail.
      const parts = [`state=${status.state}`]
      if (status.engineId)
        parts.push(`engine=${status.engineId}`)
      if (status.step)
        parts.push(`step=${status.step}`)
      if (status.retryable !== undefined)
        parts.push(`retryable=${String(status.retryable)}`)
      if (status.errorDetail)
        parts.push(`errorDetail=${status.errorDetail}`)
      publishLiaEvent('lia-app.voice-readiness', parts.join(' '))
    },
    snapshot: async () => await host.productSnapshot(),
  })
  // Boot reconcile is fire-and-forget: launch stays responsive; the outcome
  // rides the readiness rail and the provisioning IPC channel.
  void voiceProvisioning.reconcile('boot')

  // The supervisor quit flow: every exit route runs the coordinator first.
  // `app.exit` (not `app.quit`) ends the process - it does not re-fire
  // before-quit, and even if it did the guard below makes it a no-op.
  quitFlow = createSupervisorQuitFlow({
    coordinator: host.coordinator,
    endProcess: code => app.exit(code),
    log: line => console.info(line),
  })

  const devflowAutorun = createLiaDevflowAutorun({
    conversar: () => host.conversar(),
    log: line => console.info(line),
  })

  const ownsWindow = (event: Electron.IpcMainInvokeEvent) => mainWindow && !mainWindow.isDestroyed()
    && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame
  ipcMain.handle('lia:ai:connection:remove', async (event, providerId: unknown, revision: unknown) => {
    if (!ownsWindow(event) || !mainWindow || typeof providerId !== 'string' || providerId.length > 256
      || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)
      return { ok: false, code: 'invalid' }
    const english = (await host.productSnapshot())?.preferences?.language?.toLowerCase().startsWith('en')
    if (!ownsWindow(event) || !mainWindow)
      return { ok: false, code: 'cancelled' }
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      message: english ? 'Remove this AI connection?' : 'Remover esta conexão de IA?',
      detail: english ? 'The address, model, and key for this connection will be removed from this profile.' : 'O endereço, o modelo e a chave desta conexão serão removidos deste perfil.',
      buttons: english ? ['Cancel', 'Remove'] : ['Cancelar', 'Remover'],
      defaultId: 0,
      cancelId: 0,
    })
    if (response !== 1 || !ownsWindow(event))
      return { ok: false, code: 'cancelled' }
    return host.aiConnection.remove(providerId, revision)
  })
  ipcMain.handle('lia:voice:speech-connection', event => ownsWindow(event) ? host.speechConnection().catch(() => undefined) : undefined)
  ipcMain.handle('lia:voices:remove', async (event, id: unknown) => {
    if (!mainWindow || !ownsWindow(event) || typeof id !== 'string' || !/^[\da-z][\da-z_-]{0,63}$/i.test(id))
      return 'failed'
    const profile = (await host.listVoices()).find(item => item.id === id)
    if (!profile || !mainWindow || !ownsWindow(event))
      return 'failed'
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning', title: 'Lia',
      message: 'Remover esta voz importada?',
      detail: 'As cópias da biblioteca da Lia serão removidas. Os arquivos originais serão preservados.',
      buttons: ['Cancelar', 'Remover voz'], defaultId: 0, cancelId: 0, noLink: true,
    })
    if (response !== 1 || !ownsWindow(event))
      return 'cancelled'
    return await host.removeVoice(id).catch(() => false) ? 'removed' : 'failed'
  })
  ipcMain.handle('lia:voice:speech-save', (event, input: unknown) => ownsWindow(event) ? host.saveSpeechConnection(input).catch(() => false) : false)
  ipcMain.handle('lia:voice:transcription-connection', (event, local: unknown) => ownsWindow(event) && (local === undefined || typeof local === 'boolean') ? host.transcriptionConnection(local).catch(() => undefined) : undefined)
  ipcMain.handle('lia:voice:transcription-save', (event, input: unknown) => ownsWindow(event) ? host.saveTranscriptionConnection(input).catch(() => false) : false)
  let customVoiceCatalog: ReturnType<typeof listLocalAllTalkVoices> | undefined
  ipcMain.handle('lia:voice:speech-custom-catalog', (event, ...args: unknown[]) => {
    if (!ownsWindow(event) || args.length)
      return { ok: false }
    customVoiceCatalog ??= listLocalAllTalkVoices().finally(() => { customVoiceCatalog = undefined })
    return customVoiceCatalog
  })
  const synthesizePreview = createLocalAllTalk(new URL(allTalkLocalOrigin))
  let customPreview: AbortController | undefined
  const cancelCustomPreview = () => customPreview?.abort()
  ipcMain.handle('lia:voice:speech-custom-preview', async (event, ...args: unknown[]) => {
    const [voice] = args
    if (!ownsWindow(event) || args.length !== 1 || !isAllTalkVoiceFile(voice) || customPreview)
      return { ok: false, code: 'unavailable' }
    const preview = new AbortController()
    customPreview = preview
    try {
      const language = (await host.productSnapshot())?.preferences?.language
      const text = language?.toLowerCase().startsWith('en') ? 'Hello. This is a preview of my voice.' : 'Olá. Esta é uma prévia da minha voz.'
      const result = await synthesizePreview({ voice, text, language }, preview.signal)
      return ownsWindow(event) && !preview.signal.aborted ? result : { ok: false, code: 'cancelled' }
    }
    catch {
      return { ok: false, code: 'unavailable' }
    }
    finally {
      customPreview = undefined
    }
  })
  ipcMain.handle('lia:voice:speech-custom-preview-cancel', (event, ...args: unknown[]) => {
    if (ownsWindow(event) && !args.length)
      cancelCustomPreview()
  })
  ipcMain.handle('lia:voice:speech-custom-options', async (event, ...args: unknown[]) => {
    if (!ownsWindow(event) || args.length)
      return undefined
    const selected = (await host.productSnapshot())?.voice?.tts?.preferred
    return selected?.providerId === allTalkSpeechProvider && isAllTalkVoiceFile(selected.voiceId)
      ? { active: true, voiceId: selected.voiceId }
      : { active: false, voiceId: '' }
  })
  ipcMain.handle('lia:voice:speech-custom-save', async (event, ...args: unknown[]) => {
    const [voiceId] = args
    if (!ownsWindow(event) || args.length !== 1 || !isAllTalkVoiceFile(voiceId))
      return false
    const result = await host.updateConfig({ update: { voice: { tts: { preferred: { providerId: allTalkSpeechProvider, voiceId } } } } })
    return result.status === 'ok'
  })
  ipcMain.handle('lia:voice:speech-local-options', async event => {
    if (!ownsWindow(event))
      return undefined
    const selected = (await host.productSnapshot())?.voice?.tts?.preferred
    const active = selected?.providerId === 'kokoro'
    const voices = KOKORO_VOICES.map(voice => voice.name)
    return { voices, active, voiceId: active ? selected.voiceId ?? KOKORO_DEFAULT_VOICE_ID : KOKORO_DEFAULT_VOICE_ID }
  })
  ipcMain.handle('lia:voice:speech-local', async (event, input: unknown) => {
    if (!ownsWindow(event))
      return false
    const voiceId = input === undefined ? KOKORO_DEFAULT_VOICE_ID : input
    if (typeof voiceId !== 'string' || !KOKORO_VOICES.some(voice => voice.name === voiceId))
      return false
    const result = await host.updateConfig({ update: { voice: { tts: { preferred: { providerId: 'kokoro', voiceId } } } } })
    return result.status === 'ok'
  })
  registerLiaIpc(host, timer, {
    pickVoiceFiles: async () => {
      if (!mainWindow)
        return []
      const picked = await dialog.showOpenDialog(mainWindow, {
        filters: [{ extensions: ['flac', 'm4a', 'mp3', 'ogg', 'wav'], name: 'Arquivos de áudio' }],
        properties: ['multiSelections', 'openFile'],
        title: 'Escolha os arquivos da voz',
      })
      return picked.canceled ? [] : picked.filePaths
    },
    requestQuit: () => {
      quitFlow?.onBeforeQuit()
    },
    voiceEngine,
    // Phase 7.9H: automatic first-run readiness surface (read + honest retry).
    voiceProvisioning,
    // Phase 7.4 Part J: native folder picker for the heavy runtime root.
    pickDirectory: async () => {
      if (!mainWindow)
        return null
      const picked = await dialog.showOpenDialog(mainWindow, {
        properties: ['createDirectory', 'openDirectory'],
        title: 'Escolha a pasta do sistema de voz',
      })
      return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0]
    },
  })

  mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: '#0d0a12',
    height: 860,
    title: 'Lia',
    webPreferences: {
      ...LIA_MAIN_WEB_PREFERENCES,
      preload: join(import.meta.dirname, '../preload/index.cjs'),
    },
    width: 1320,
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  mainWindow.webContents.on('did-start-navigation', details => {
    if (details.isMainFrame && !details.isSameDocument)
      cancelCustomPreview()
  })
  mainWindow.webContents.on('render-process-gone', cancelCustomPreview)
  mainWindow.once('closed', cancelCustomPreview)
  timer.mark('lia-app.window-created')

  registerLauncherOidc({
    ipc: ipcMain,
    window: mainWindow,
    vault: host.vault,
    connection: resolveDevelopmentOidc(app.isPackaged, process.env.LIA_OIDC_TEST_ORIGIN, process.env.LIA_OIDC_TEST_CLIENT_ID),
    openAuthorization: url => shell.openExternal(url),
  })
  mainWindow.webContents.once('did-finish-load', () => {
    timer.mark('lia-app.renderer-ready')
  })

  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  }
  else {
    await mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  // DEVFLOW-ONLY. Replaces the human "click Conversar com Lia" step by calling
  // the SAME host.conversar() the button reaches through lia:stage:start, so
  // the round still validates Lia.bat -> Launcher -> NativeStageManager -> Stage.
  // Inert unless LIA_DEVFLOW_AUTORUN=conversar; a normal launch still needs the
  // explicit click. Not awaited: boot must not block on the stage, and the
  // stage manager's single-flight already collapses any concurrent start.
  if (devflowAutorun.applies()) {
    void devflowAutorun.run().catch((error: unknown) => {
      console.info(`lia-devflow autorun=failed reason=${error instanceof Error ? error.name : 'unknown'}`)
    })
  }
}

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', (event) => {
  // Phase 7.1, items 1/3: closing Lia is a supervised teardown - stop the
  // owned stage and the owned voice runtime, confirm, THEN leave. EVERY
  // quit attempt joins the single graceful run (repeated clicks never
  // bypass it); `app.exit` in endProcess ends the process without
  // re-firing this hook.
  event.preventDefault()
  if (quitFlow) {
    quitFlow.onBeforeQuit()
  }
  else {
    // The host never came up: nothing is ours, nothing to stop.
    app.exit(0)
  }
})

// Ctrl+C and service-stop in dev take the SAME supervised path (test E
// covers the flow logic; here it is just wired to the real process).
process.on('SIGINT', () => {
  if (quitFlow) {
    quitFlow.onSigint()
  }
  else {
    process.exit(130)
  }
})
process.on('SIGTERM', () => {
  if (quitFlow) {
    quitFlow.onSigterm()
  }
  else {
    process.exit(143)
  }
})

if (instanceRole === 'primary') {
  void bootstrap().catch((error) => {
    console.error('[lia] the launcher failed to start:', error)
    app.quit()
  })
}
