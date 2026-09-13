import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { GodotStageManager } from '../../../services/airi/godot-stage'
import type { McpStdioManager } from '../../../services/airi/mcp-servers'
import type { AutoUpdater } from '../../../services/electron/auto-updater'
import type { GlobalShortcutService } from '../../../services/electron/global-shortcut'
import type { DevtoolsWindowManager } from '../../devtools'
import type { SpotlightWindowManager } from '../../spotlight'
import type { WidgetsWindowManager } from '../../widgets'
import type { MainWindowSizeSettingsController } from '../../main/window-size-settings'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { ipcMain } from 'electron'

import {
  electronCenterMainWindow,
  electronMainWindowSizeGet,
  electronMainWindowSizeSet,
  electronOpenDevtoolsWindow,
  electronOpenSettingsDevtools,
  electronSpotlightShortcutGet,
  electronSpotlightShortcutSet,
} from '../../../../shared/eventa'
import { createAuthService } from '../../../services/airi/auth'
import { createGodotStageService } from '../../../services/airi/godot-stage'
import { createMcpServersService } from '../../../services/airi/mcp-servers'
import { createWidgetsService } from '../../../services/airi/widgets'
import { createAutoUpdaterService } from '../../../services/electron'
import { centerWindowOnDisplay } from '../../shared/display'
import { setupBaseWindowElectronInvokes } from '../../shared/window'

export async function setupSettingsWindowInvokes(params: {
  settingsWindow: BrowserWindow
  widgetsManager: WidgetsWindowManager
  autoUpdater: AutoUpdater
  devtoolsWindow: DevtoolsWindowManager
  getMainWindow?: () => BrowserWindow | undefined
  getMainWindowSizeSettings?: () => MainWindowSizeSettingsController | undefined
  serverChannel: ServerChannel
  godotStageManager: GodotStageManager
  mcpStdioManager: McpStdioManager
  i18n: I18n
  globalShortcut: GlobalShortcutService
  spotlightWindow: SpotlightWindowManager
}) {
  // TODO: once we refactored eventa to support window-namespaced contexts,
  // we can remove the setMaxListeners call below since eventa will be able to dispatch and
  // manage events within eventa's context system.
  ipcMain.setMaxListeners(0)

  const { context } = createContext(ipcMain, params.settingsWindow)

  await setupBaseWindowElectronInvokes({ context, window: params.settingsWindow, i18n: params.i18n, serverChannel: params.serverChannel })

  createWidgetsService({ context, widgetsManager: params.widgetsManager, window: params.settingsWindow })
  createAutoUpdaterService({ context, window: params.settingsWindow, service: params.autoUpdater })
  createMcpServersService({ context, manager: params.mcpStdioManager })
  createGodotStageService({ context, manager: params.godotStageManager, window: params.settingsWindow })
  createAuthService({ context, window: params.settingsWindow })

  // Register the global shortcut service for the settings window.
  params.globalShortcut.registerWindow({ context, window: params.settingsWindow })

  defineInvokeHandler(context, electronMainWindowSizeGet, () => {
    const controller = params.getMainWindowSizeSettings?.()
    if (!controller)
      throw new Error('Main window size settings are not ready yet')
    return controller.getSnapshot()
  })

  defineInvokeHandler(context, electronMainWindowSizeSet, (payload) => {
    if (!payload || (payload.mode !== 'home' && payload.mode !== 'stage'))
      throw new TypeError('electronMainWindowSizeSet called with invalid mode')
    const size = payload.size
    if (size !== null && (typeof size.width !== 'number' || typeof size.height !== 'number'))
      throw new TypeError('electronMainWindowSizeSet called with invalid size')
    const controller = params.getMainWindowSizeSettings?.()
    if (!controller)
      throw new Error('Main window size settings are not ready yet')
    controller.setInitialSize(payload.mode, size)
  })

  defineInvokeHandler(context, electronCenterMainWindow, () => centerWindowOnDisplay(params.getMainWindow?.()))
  defineInvokeHandler(context, electronSpotlightShortcutGet, () => params.spotlightWindow.getShortcutAccelerator())
  defineInvokeHandler(context, electronSpotlightShortcutSet, (payload) => {
    if (payload?.accelerator === undefined)
      throw new TypeError('electronSpotlightShortcutSet called with invalid payload')

    return params.spotlightWindow.updateShortcutAccelerator(payload.accelerator)
  })

  defineInvokeHandler(context, electronOpenSettingsDevtools, async () => params.settingsWindow.webContents.openDevTools({ mode: 'detach' }))
  defineInvokeHandler(context, electronOpenDevtoolsWindow, async (payload) => {
    await params.devtoolsWindow.openWindow(payload)
  })

  return context
}
