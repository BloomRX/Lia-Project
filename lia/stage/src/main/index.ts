import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { liaProductPaths } from '@lia/core/paths/product-paths'
import { readLiaProductConfig } from '@lia/core/product/config'
import { app, BrowserWindow, ipcMain } from 'electron'

import { createTransportRepository } from '../../../core/src/transports/repository.ts'
import { stageChatCancel, stageChatSend } from '../shared/chat-ipc.ts'
import { createLocalChat } from './local-chat.ts'
import { createStageHost } from './stage-host.ts'

async function main(): Promise<void> {
  await app.whenReady()
  const paths = liaProductPaths()
  const repository = createTransportRepository(join(paths.userDataDir, 'lia-transports.json'))
  const send = createLocalChat({
    readProduct: () => readLiaProductConfig(paths.productConfigFile),
    readTransports: repository.read,
  })
  let window: BrowserWindow | undefined
  let active: AbortController | undefined
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
      return await send(input, controller.signal)
    }
    finally {
      active = undefined
    }
  })
  ipcMain.handle(stageChatCancel, (event) => {
    if (authorized(event))
      cancel()
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
  const snapshot = await host.start()
  if (snapshot.phase !== 'running')
    app.exit(1)
}

void main().catch(() => app.exit(1))
