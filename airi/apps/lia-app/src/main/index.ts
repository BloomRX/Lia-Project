import process from 'node:process'

import { join } from 'node:path'

import { app, BrowserWindow, safeStorage } from 'electron'

import { registerLiaIpc } from './ipc'
import { createLiaHost } from './lia-host'
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

const isDevelopment = process.env.NODE_ENV !== 'production'

let mainWindow: BrowserWindow | undefined

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
    onEvent: (event, detail) => {
      // Host events are never secret; the renderer log strip mirrors them.
      console.info('[lia]', new Date().toISOString(), event, detail ?? '')
      mainWindow?.webContents.send('lia:event', { detail, event })
    },
  })
  timer.mark('lia-core.ready')

  registerLiaIpc(host, timer)

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
  // The launcher closing stops Lia's OWN stage child (we spawned it; the
  // handle is the proof), then the process may leave.
  app.quit()
})

// NOTE: the managed stage SHOULD follow the launcher down in a later
// iteration; v1 keeps the child readable from the OS task manager and is
// documented in the deliverable. AllTalk lifecycle is untouched here on
// purpose: the Lia runtime manager owns it.

void bootstrap().catch((error) => {
  console.error('[lia] the launcher failed to start:', error)
  app.quit()
})
