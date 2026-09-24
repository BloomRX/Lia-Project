import type { SupervisorQuitFlow } from './shutdown-coordinator'

import process from 'node:process'

import { join } from 'node:path'

import { app, BrowserWindow, dialog, safeStorage } from 'electron'

import { createLiaEventPublisher } from './event-publisher'
import { registerLiaIpc } from './ipc'
import { createLiaHost } from './lia-host'
import { createSupervisorQuitFlow } from './shutdown-coordinator'
import { enforceSingleInstance } from './single-instance'
import { createLiaBootTimer } from './timing'
import { createLiaVoiceEngineService } from './voice-engine-service'
import { createLiaVoiceInstallInspector } from './voice-install-inspector'
import { createLiaVoiceProvisioning } from './voice-provisioning'

/**
 * The Lia launcher entry (Phase 7, architecture items 1/11/15).
 *
 * Boot contract: the window appears with ONLY Lia loaded - no AIRI spawn,
 * no stage UI, no plugin host, no chat initialization. The stage rises
 * exclusively from the user's "Conversar com Lia" (or a future explicit
 * autostart preference), through the AiriStageManager child process.
 *
 * The four boot marks (`lia-app.start`, `lia-app.window-created`,
 * `lia-app.renderer-ready`, `lia-core.ready`) are logged as evidence that
 * the launcher no longer waits for AIRI - never as invented targets.
 */

const timer = createLiaBootTimer()
timer.mark('lia-app.start')

let mainWindow: BrowserWindow | undefined
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
    cipher: {
      available: () => safeStorage.isEncryptionAvailable(),
      decrypt: payload => safeStorage.decryptString(payload),
      encrypt: value => safeStorage.encryptString(value),
    },
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
    for (const listener of [...installEventListeners])
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
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: false,
    },
    width: 1320,
  })
  timer.mark('lia-app.window-created')

  mainWindow.webContents.once('did-finish-load', () => {
    timer.mark('lia-app.renderer-ready')
  })

  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  }
  else {
    await mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
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
