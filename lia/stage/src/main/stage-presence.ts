import type { PresenceConfig } from '../../../core/src/presence/index.ts'

import { fileURLToPath } from 'node:url'

import { BrowserWindow, screen } from 'electron'

import { defaultPresence } from '../../../core/src/presence/index.ts'
import { createPresenceService } from '../../../core/src/presence/service.ts'

export function createStagePresence(options: {
  isHostFullscreen: () => boolean
  loadConfig: () => Promise<PresenceConfig | undefined>
  saveConfig: (value: PresenceConfig) => Promise<void>
}) {
  let window: BrowserWindow | undefined
  let service: ReturnType<typeof createPresenceService> | undefined
  let asset: Uint8Array | undefined
  let settleRender: ((rendered: boolean) => void) | undefined
  let opening = false
  let generation = 0

  function close() {
    generation++
    window?.destroy()
  }

  async function open(input: unknown) {
    if (opening || window || !(input instanceof Uint8Array) || input.byteLength < 20 || input.byteLength > 64 * 1024 * 1024)
      return false
    opening = true
    const request = generation
    try {
      const config = await options.loadConfig() ?? defaultPresence
      if (request !== generation)
        return false
      const overlay = new BrowserWindow({
        width: 240,
        height: 360,
        frame: false,
        transparent: true,
        skipTaskbar: true,
        show: false,
        hasShadow: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
        },
      })
      window = overlay
      asset = input
      const rendered = new Promise<boolean>((resolve) => { settleRender = resolve })
      const controller = createPresenceService({
        window: overlay,
        isHostFullscreen: options.isHostFullscreen,
        screen: {
          getAllDisplays: () => screen.getAllDisplays(),
          getCursorScreenPoint: () => screen.getCursorScreenPoint(),
          on: (event, listener) => {
            if (event === 'display-added')
              screen.on(event, listener)
            else if (event === 'display-removed')
              screen.on(event, listener)
            else
              screen.on(event, listener)
          },
          removeListener: (event, listener) => {
            if (event === 'display-added')
              screen.removeListener(event, listener)
            else if (event === 'display-removed')
              screen.removeListener(event, listener)
            else
              screen.removeListener(event, listener)
          },
        },
        initial: { ...config, mode: 'free' },
        save: value => options.saveConfig({ ...value, mode: config.mode }),
      })
      service = controller
      overlay.once('closed', () => {
        settleRender?.(false)
        settleRender = undefined
        controller.dispose()
        window = undefined
        service = undefined
        asset = undefined
      })
      overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      overlay.webContents.on('will-navigate', event => event.preventDefault())
      overlay.webContents.once('render-process-gone', close)
      const watchdog = setTimeout(close, 15_000)
      try {
        await overlay.loadFile(fileURLToPath(new URL('../renderer/presence.html', import.meta.url)))
        if (!await rendered || overlay.isDestroyed()) {
          close()
          return false
        }
      }
      finally {
        clearTimeout(watchdog)
        settleRender = undefined
      }
      controller.setActive(true)
      overlay.setIgnoreMouseEvents(true)
      overlay.showInactive()
      return true
    }
    catch {
      close()
      return false
    }
    finally {
      opening = false
    }
  }

  function ownsOverlay(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
    return window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
  }

  return {
    open,
    close,
    ownsOverlay,
    displays() {
      const result = service?.get()
      if (!result?.ok)
        return undefined
      const { config, displays } = result.state
      return { displays, monitorId: config.monitorId, allMonitors: config.allMonitors, pauseOnFullscreen: config.pauseOnFullscreen }
    },
    takeAsset(event: Electron.IpcMainInvokeEvent) {
      if (!ownsOverlay(event))
        return undefined
      const bytes = asset
      asset = undefined
      return bytes
    },
    reportRender(event: Electron.IpcMainInvokeEvent, rendered: unknown) {
      if (ownsOverlay(event) && typeof rendered === 'boolean')
        settleRender?.(rendered)
    },
    async command(action: unknown) {
      const current = service
      const result = current?.get()
      if (!current || !result?.ok)
        return false
      if (action === 'home' || action === 'set-home')
        return (await current.action({ action })).ok
      if (action && typeof action === 'object' && 'monitor' in action && Object.keys(action).length === 1) {
        const monitor = action.monitor
        if (monitor !== 'all' && monitor !== null && !result.state.displays.some(display => display.id === monitor))
          return false
        const monitorId = typeof monitor === 'number' ? monitor : null
        return (await current.set({ ...result.state.config, monitorId, allMonitors: monitor === 'all' })).ok
      }
      if (action !== 'paused' && action !== 'pinned' && action !== 'hideOnHover' && action !== 'pauseOnFullscreen')
        return false
      return (await current.set({ ...result.state.config, [action]: !result.state.config[action] })).ok
    },
  }
}
