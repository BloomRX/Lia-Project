/**
 * Entrada do Stage no Electron.
 *
 * Este arquivo e a UNICA parte que conhece Electron. Ele existe para ser fino:
 * toda a logica esta em `stage-host.ts`, testada sem display. Se este arquivo
 * ficar grande, a fronteira esta errada.
 *
 * NAO EXECUTADO neste repositorio: o binario do Electron nao esta disponivel
 * no ambiente de desenvolvimento do agente (sem display, sem download). Ver
 * docs/architecture/LIA-STAGE-ARCHITECTURE.md §6 para o gate de Windows.
 */

import { createStageHost } from './stage-host.ts'

// Importado dinamicamente para que o modulo possa ser carregado em teste sem
// Electron instalado.
export async function main(): Promise<void> {
  const { app, BrowserWindow } = await import('electron')

  const host = createStageHost({
    createWindow: async () => {
      const window = new BrowserWindow({
        width: 480,
        height: 640,
        show: false,
        title: 'Lia',
        webPreferences: { sandbox: true, contextIsolation: true },
      })
      await window.loadFile(new URL('../renderer/index.html', import.meta.url).pathname)
      return {
        show: () => window.show(),
        close: async () => { window.destroy() },
      }
    },
    terminate: async (pid) => {
      // No Windows, matar so o pai deixa filhos orfaos (ver airi-stage-manager).
      // Aqui o padrao e o mesmo caminho que o Launcher ja usa.
      if (process.platform === 'win32')
        app.quit()
      else
        process.kill(pid, 'SIGTERM')
    },
    onLog: line => console.log(`[lia-stage] ${line}`),
  })

  app.whenReady().then(async () => {
    const snapshot = await host.start()
    if (snapshot.phase !== 'running')
      app.exit(1)
  })

  app.on('window-all-closed', () => { void host.stop().finally(() => app.quit()) })
}
