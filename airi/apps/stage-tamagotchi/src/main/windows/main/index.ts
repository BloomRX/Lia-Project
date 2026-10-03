import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { GodotStageManager } from '../../services/airi/godot-stage'
import type { McpStdioManager } from '../../services/airi/mcp-servers'
import type { AutoUpdater } from '../../services/electron/auto-updater'
import type { EditorWindowManager } from '../editor'
import type { NoticeWindowManager } from '../notice'
import type { OnboardingWindowManager } from '../onboarding'
import type { SettingsWindowManager } from '../settings'
import type { WidgetsWindowManager } from '../widgets'
import type { MainWindowSizeSettingsController } from './window-size-settings'
import type { MainWindowContext } from './window-sizing'

import { dirname, join, resolve } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { is } from '@electron-toolkit/utils'
import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { initScreenCaptureForWindow } from '@proj-airi/electron-screen-capture/main'
import { BrowserWindow, ipcMain } from 'electron'
import { isLinux, isMacOS } from 'std-env'

import icon from '../../../../resources/icon.png?asset'

import { electronStartDraggingWindow } from '../../../shared/eventa'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { createConfig } from '../../libs/electron/persistence'
import { initialMainWindowContext, initialMainWindowRoute } from '../../services/lia/initial-route'
import { isLauncherManaged } from '../../services/lia/lia-managed'
import { protectPrivilegedWindowNavigation, setWindowAlwaysOnTop, transparentWindowConfig } from '../shared'
import { setupMainWindowElectronInvokes } from './rpc/index.electron'
import {
  createMainWindowSizeSettingsController,

} from './window-size-settings'
import {
  createMainWindowContextSizing,
  HOME_WINDOW_PRESET,
  liaMainWindowStateSchema,
  MAIN_WINDOW_MIN_SIZE,
} from './window-sizing'

export async function setupMainWindow(params: {
  editorWindow: EditorWindowManager
  settingsWindow: SettingsWindowManager
  chatWindow: () => Promise<BrowserWindow>
  widgetsManager: WidgetsWindowManager
  noticeWindow: NoticeWindowManager
  autoUpdater: AutoUpdater
  onWindowCreated?: (window: BrowserWindow) => void
  serverChannel: ServerChannel
  godotStageManager: GodotStageManager
  mcpStdioManager: McpStdioManager
  i18n: I18n
  onboardingWindowManager: OnboardingWindowManager
  onSizeSettingsReady?: (controller: MainWindowSizeSettingsController) => void
}) {
  const windowStateConfig = createConfig('lia', 'main-window.json', liaMainWindowStateSchema, {
    default: {},
    autoHeal: true,
  })

  windowStateConfig.setup()

  // NOTE (M1 Phase 2 / Lia): contextual window sizing lives here, separated per
  // mode (home vs stage). We intentionally do NOT read the historical AIRI
  // single-bounds config ('app'/'config.json' windows[] main entry) so a legacy
  // oversized window never leaks into the new Lia launcher-first experience.

  const window = new BrowserWindow({
    title: 'AIRI',
    width: HOME_WINDOW_PRESET.width,
    height: HOME_WINDOW_PRESET.height,
    minWidth: MAIN_WINDOW_MIN_SIZE.width,
    minHeight: MAIN_WINDOW_MIN_SIZE.height,
    show: false,
    icon,
    webPreferences: {
      preload: join(dirname(fileURLToPath(import.meta.url)), '../preload/index.mjs'),
      sandbox: false,
    },
    // Thanks to [@HeartArmy](https://github.com/HeartArmy) for the tip implementation.
    //
    // https://github.com/electron/electron/issues/10078#issuecomment-3410164802
    // https://stackoverflow.com/questions/39835282/set-browserwindow-always-on-top-even-other-app-is-in-fullscreen-electron-mac
    type: isMacOS ? 'panel' : undefined,
    ...transparentWindowConfig(),
  })

  if (params.onWindowCreated) {
    params.onWindowCreated(window)
  }

  const sizing = createMainWindowContextSizing({
    window,
    config: windowStateConfig,
  })

  // Expose per-mode size configuration (used by the Settings window) while
  // keeping the shared override field + persistence fully inside this module.
  const sizeSettings = createMainWindowSizeSettingsController({
    sizing,
    config: windowStateConfig,
  })
  params.onSizeSettingsReady?.(sizeSettings)

  // First open / relaunch applies the mode matching the initial route
  // (Phase 7.2: a Lia-managed stage lands on the companion directly, so it
  // opens at the stage preset - never at the small launcher size).
  const initialContext = initialMainWindowContext()
  sizing.setContext(initialContext, { recenter: true })

  // Persist the *active* mode's size on user resize (not the legacy global
  // bounds), so Home and Stage never overwrite each other silently.
  window.on('resize', () => sizing.captureUserBounds())

  function setMainWindowContext(mode: MainWindowContext): void {
    sizing.setContext(mode)
  }

  let allowClose = false
  onAppBeforeQuit(() => {
    allowClose = true
  })

  // NOTICE: in development mode, open devtools by default
  if (is.dev || env.MAIN_APP_DEBUG || env.APP_DEBUG) {
    try {
      window.webContents.openDevTools({ mode: 'detach' })
    }
    catch (err) {
      console.error('failed to open devtools:', err)
    }
  }

  window.on('close', (event) => {
    if (allowClose) {
      return
    }

    event.preventDefault()
    window.hide()
  })

  // Thanks to [@HeartArmy](https://github.com/HeartArmy) for the tip implementation.
  //
  // https://github.com/electron/electron/issues/10078#issuecomment-3410164802
  // https://stackoverflow.com/questions/39835282/set-browserwindow-always-on-top-even-other-app-is-in-fullscreen-electron-mac
  window.setVisibleOnAllWorkspaces(true)
  if (isMacOS) {
    window.setFullScreenable(false)
    window.setWindowButtonVisibility(false)
  }
  setWindowAlwaysOnTop(window, true)

  window.on('ready-to-show', () => {
    window!.show()
    // Startup bounds (preset or the persisted override of the ACTIVE mode)
    // are now applied and the window is visible. Only now may genuine user
    // resizes be persisted, so a transient startup resize can never
    // overwrite the mode's override.
    sizing.armUserResizeCapture()
  })
  protectPrivilegedWindowNavigation(window)

  await setupMainWindowElectronInvokes({
    window,
    editorWindow: params.editorWindow,
    settingsWindow: params.settingsWindow,
    chatWindow: params.chatWindow,
    widgetsManager: params.widgetsManager,
    noticeWindow: params.noticeWindow,
    autoUpdater: params.autoUpdater,
    serverChannel: params.serverChannel,
    godotStageManager: params.godotStageManager,
    mcpStdioManager: params.mcpStdioManager,
    i18n: params.i18n,
    onboardingWindowManager: params.onboardingWindowManager,
    setMainWindowContext,
  })

  // M1 Phase 2 (Lia): launcher-first WHEN STANDALONE. When the Lia App is
  // the supervisor (LIA_MANAGED=1, Phase 7.2) the stage IS the companion
  // engine and the window lands directly on it - never a second launcher.
  await load(window, withHashRoute(baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')), initialMainWindowRoute(), {
    // `lia-managed` mirrors LIA_MANAGED into the RENDERER read path (the
    // window-context query convention, synced-leader style): env vars stay
    // in the main process, the renderer gets the one boolean it needs for
    // its central managed-route policy - Phase 7.3.
    query: {
      'synced-leader': 'true',
      ...(isLauncherManaged() ? { 'lia-managed': 'true' } : {}),
    },
  }))

  /**
   * This is a know issue (or expected behavior maybe) to Electron.
   * We don't use this approach on Linux because it's not working.
   *
   * Discussion: https://github.com/electron/electron/issues/37789
   * Workaround: https://github.com/noobfromph/electron-click-drag-plugin
   */
  if (!isLinux) {
    const { default: clickDragPlugin } = await import('electron-click-drag-plugin')

    function handleStartDraggingWindow() {
      try {
        const windowId = window.getNativeWindowHandle()
        clickDragPlugin.startDrag(windowId)
      }
      catch (error) {
        console.error(error)
      }
    }

    // TODO: once we refactored eventa to support window-namespaced contexts,
    // we can remove the setMaxListeners call below since eventa will be able to dispatch and
    // manage events within eventa's context system.
    ipcMain.setMaxListeners(0)

    const { context } = createContext(ipcMain, window)
    const cleanUpWindowDraggingInvokeHandler = defineInvokeHandler(context, electronStartDraggingWindow, handleStartDraggingWindow)

    window.on('closed', () => {
      cleanUpWindowDraggingInvokeHandler()
    })
  }

  initScreenCaptureForWindow(window)

  return window
}
