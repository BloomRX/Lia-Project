import { fileURLToPath } from 'node:url'

import { app, BrowserWindow } from 'electron'

import { createStageHost } from './stage-host.ts'

async function main(): Promise<void> {
  await app.whenReady()
  const host = createStageHost({
    createWindow: async () => {
      const window = new BrowserWindow({
        width: 480,
        height: 640,
        show: false,
        title: 'Lia',
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', event => event.preventDefault())
      try {
        const devUrl = import.meta.env.DEV && process.env.ELECTRON_RENDERER_URL
        if (devUrl)
          await window.loadURL(devUrl)
        else
          await window.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
      }
      catch {
        window.destroy()
        throw new Error('Falha ao carregar a janela do Stage')
      }
      return {
        show: () => window.show(),
        close: async () => {
          if (!window.isDestroyed())
            window.destroy()
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
