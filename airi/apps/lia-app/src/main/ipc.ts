import type { LiaHost } from './lia-host'
import type { LiaBootTimer } from './timing'

import { ipcMain } from 'electron'

/**
 * The launcher's IPC surface (Phase 7). Plain `ipcMain.handle` channels,
 * `lia:`-prefixed: no AIRI eventa, no shared framework - the smallest
 * stable contract (architecture item 6) between the launcher window and
 * the launcher process. The renderer never receives secret VALUES: a
 * boolean presence map only (item 17).
 */
export function registerLiaIpc(host: LiaHost, timer: LiaBootTimer): void {
  ipcMain.handle('lia:home-status', async () => await host.homeStatus())
  ipcMain.handle('lia:product-config', async () => {
    const snapshot = await host.productSnapshot()
    return {
      filePath: host.paths.productConfigFile,
      snapshot,
      status: (await host.homeStatus()).config.status,
    }
  })
  ipcMain.handle('lia:voices:list', async () => await host.listVoices())
  ipcMain.handle('lia:runtime:state', async () => {
    const runtime = await host.runtime()
    return { installed: await runtime.isInstalled(), state: runtime.state() }
  })
  ipcMain.handle('lia:bridge', async () => {
    // The stage adapter contract, rendered read-only for the diagnostics
    // tab. `hasSecret` is a function and cannot serialize; the renderer
    // receives the boolean map only.
    const bridge = await host.bridgeConfig()
    const safe: unknown = {
      ...bridge,
      secrets: { vaultFile: bridge.secrets.vaultFile },
    }
    return safe
  })
  ipcMain.handle('lia:secrets:presence', async (_event, providerId: string) => {
    if (typeof providerId !== 'string' || providerId.length === 0 || providerId.length > 64)
      return false
    return host.vault.hasSecret(providerId, 'apiKey')
  })
  ipcMain.handle('lia:stage:state', () => host.stage.state())
  ipcMain.handle('lia:stage:start', async () => await host.conversar())
  ipcMain.handle('lia:stage:stop', async () => {
    await host.stage.stop()
    return host.stage.state()
  })
  ipcMain.handle('lia:timings', () => timer.marks())
}
