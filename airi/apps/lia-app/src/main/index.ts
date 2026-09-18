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
    // Host events are never secret; the renderer log strip mirrors them
    // through the bounded publisher (item 6: terminal sink always,
    // renderer best-effort, delivery errors never escape).
    onEvent: (event, detail) => publishLiaEvent(event, detail),
  })
  timer.mark('lia-core.ready')

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
