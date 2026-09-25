import type { BrowserWindow } from 'electron'

import type { FileLoggerHandle } from './app/file-logger'
import type { MainWindowSizeSettingsController } from './windows/main/window-size-settings'

import process, { env, platform } from 'node:process'

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import messages from '@proj-airi/i18n/locales'

import { electronApp, optimizer } from '@electron-toolkit/utils'
import { Format, LogLevel, setGlobalFormat, setGlobalHookPostLog, setGlobalLogLevel, useLogg } from '@guiiai/logg'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { hasSelectedScreenCaptureSource, initScreenCaptureForMain } from '@proj-airi/electron-screen-capture/main'
import { app, ipcMain, session } from 'electron'
import { noop } from 'es-toolkit'
import { createLoggLogger, injeca, lifecycle } from 'injeca'
import { isLinux } from 'std-env'

import icon from '../../resources/icon.png?asset'

import { openDebugger, setupDebugger } from './app/debugger'
import { nullFileLoggerHandle, setupFileLogger } from './app/file-logger'
import { ingestMainProcessLog } from './app/main-process-log-bus'
import { resolveIsWayland } from './app/ozone'
import { installSingleInstanceGuard } from './app/single-instance'
import { createArtistryConfig } from './configs/artistry'
import { createGlobalAppConfig } from './configs/global'
import { createLiaProductConfig } from './configs/lia'
import { emitAppBeforeQuit, emitAppReady, emitAppWindowAllClosed } from './libs/bootkit/lifecycle'
import { setElectronMainDirname } from './libs/electron/location'
import { createI18n } from './libs/i18n'
import { setupAppleSpeechTranscriptionService } from './services/airi/apple-speech-transcription'
import { setupServerChannel } from './services/airi/channel-server'
import { setupGodotStageManager } from './services/airi/godot-stage'
import { setupBuiltInServer } from './services/airi/http-server'
import { setupMcpStdioManager } from './services/airi/mcp-servers'
import { setupExtensionHost } from './services/airi/plugins'
import { setupArtistryBridge } from './services/airi/widgets/artistry-bridge'
import { setupAutoUpdater } from './services/electron/auto-updater'
import { setupGlobalShortcutService } from './services/electron/global-shortcut'
import { setupPermissionHandlers } from './services/electron/media-permissions'
import { createLiaBrainCorrelationService } from './services/lia/brain-correlation-service'
import { registerLiaBrainDecisionBridge } from './services/lia/brain-decision-service'
import { registerLiaBrainExecutionReportHandler } from './services/lia/brain-execution-report-service'
import { createLiaBrainService } from './services/lia/lia-brain-service'
import { startLiaMainWindowVoiceRuntime } from './services/lia/main-window-voice-runtime'
import { registerLiaProviderConfigBridge } from './services/lia/provider-config-service'
import { createLiaSecretVault, registerLiaSecretsBridge } from './services/lia/secrets-service'
import { registerLiaVoiceConfigBridge } from './services/lia/voice-config-service'
import { createLiaVoiceProfileStore } from './services/lia/voice-profiles'
import { registerLiaVoiceProfilesBridge } from './services/lia/voice-profiles-service'
import { setupTray } from './tray'
import { setupAboutWindowReusable } from './windows/about'
import { setupBeatSync } from './windows/beat-sync'
import { setupCaptionWindowManager } from './windows/caption'
import { setupChatWindowReusableFunc } from './windows/chat'
import { isDesktopOverlayEnabled, setupDesktopOverlayWindow } from './windows/desktop-overlay'
import { setupDevtoolsWindow } from './windows/devtools'
import { setupEditorWindowManager } from './windows/editor'
import { setupMainWindow } from './windows/main'
import { setupNoticeWindowManager } from './windows/notice'
import { setupOnboardingWindowManager } from './windows/onboarding'
import { setupSettingsWindowReusableFunc } from './windows/settings'
import { setupSpotlightWindowManager } from './windows/spotlight'
import { setupWidgetsWindowManager } from './windows/widgets'

// TODO: once we refactored eventa to support window-namespaced contexts,
// we can remove the setMaxListeners call below since eventa will be able to dispatch and
// manage events within eventa's context system.
ipcMain.setMaxListeners(100)

setElectronMainDirname(dirname(fileURLToPath(import.meta.url)))
setGlobalFormat(Format.Pretty)
setGlobalLogLevel(LogLevel.Log)
setupDebugger()

const log = useLogg('main').useGlobalConfig()

const appUserDataPath = env.APP_USER_DATA_PATH?.trim()
if (appUserDataPath) {
  app.setPath('userData', appUserDataPath)
}

// Thanks to [@blurymind](https://github.com/blurymind),
//
// When running Electron on Linux, navigator.gpu.requestAdapter() fails.
// In order to enable WebGPU and process the shaders fast enough, we need the following
// command line switches to be set.
//
// https://github.com/electron/electron/issues/41763#issuecomment-2051725363
// https://github.com/electron/electron/issues/41763#issuecomment-3143338995
if (isLinux) {
  // NOTICE:
  // All enabled features must be joined into a single comma-separated string
  // instead of calling appendSwitch('enable-features', ...) once per feature.
  // Root cause: Chromium's commandLine stores switches by key, so each
  // appendSwitch('enable-features', ...) call overwrites the previous value and
  // only the last feature survives.
  // Source: Chromium base::CommandLine behavior; see
  // https://github.com/electron/electron/issues/41763 for the WebGPU setup this supports.
  // Removal condition: never for the join itself; this block can be deleted once
  // WebGPU works on Linux Electron without manual feature switches.
  const enabledFeatures = [
    'SharedArrayBuffer',
  ]

  app.commandLine.appendSwitch('enable-unsafe-webgpu')

  // Check explicit command-line switches before falling back to session environment variables.
  // When running with XWayland (e.g. '--ozone-platform=x11'), session variables like WAYLAND_DISPLAY
  // are still inherited from the Wayland desktop, but Chromium uses the explicitly specified Ozone backend.
  // Treat explicit 'auto' as an unresolved platform selection and resolve using session environment variables.
  const isWayland = resolveIsWayland({
    explicitOzonePlatform: app.commandLine.getSwitchValue('ozone-platform'),
    ozonePlatformHint: app.commandLine.getSwitchValue('ozone-platform-hint'),
    env,
  })

  if (isWayland) {
    enabledFeatures.push('GlobalShortcutsPortal', 'UseOzonePlatform', 'WaylandWindowDecorations')
    if (!app.commandLine.hasSwitch('ozone-platform-hint')) {
      app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
    }
  }
  else {
    // NOTICE:
    // Vulkan must only be enabled on non-Wayland sessions, otherwise GPU
    // initialization fails or rendering glitches appear.
    // Root cause: Vulkan is incompatible with '--ozone-platform=wayland' in
    // Chromium's surface factory; the Wayland Ozone backend cannot present
    // Vulkan surfaces.
    // Source: Chromium Ozone/Wayland surface factory; workaround tracked via
    // https://github.com/electron/electron/issues/41763 (WebGPU on Linux).
    // Removal condition: when Chromium/Electron supports Vulkan with the Wayland
    // Ozone backend, drop the isWayland guard and always push 'Vulkan'.
    enabledFeatures.push('Vulkan')
  }

  app.commandLine.appendSwitch('enable-features', enabledFeatures.join(','))
}

app.dock?.setIcon(icon)
// Lia identity patch (M1 Phase 1): align Windows AppUserModelID with the Lia appId.
// Updater cache path / single-instance guard are intentionally left as upstream AIRI.
electronApp.setAppUserModelId('ai.lia.app')

// Track the real user-facing AIRI window because the process also owns hidden utility windows.
// The second-instance handler should restore the main UI instead of accidentally surfacing internals.
let userFacingMainWindow: BrowserWindow | undefined
const shouldStartMainProcess = installSingleInstanceGuard({ app, getWindow: () => userFacingMainWindow })

// Per-mode main-window size controller, lazily populated once the main window is
// built (invokes only fire at runtime, so this is safe before then). Read by the
// Settings window via the getter injected below.
let userFacingMainWindowSizeSettings: MainWindowSizeSettingsController | undefined

if (shouldStartMainProcess) {
  initScreenCaptureForMain()
}

let fileLogger: FileLoggerHandle = nullFileLoggerHandle
let skipFileLogging = false

app.whenReady().then(async () => {
  if (!shouldStartMainProcess) {
    return
  }

  setupPermissionHandlers(session.defaultSession, hasSelectedScreenCaptureSource)

  // Initialize file logger and register the hook
  fileLogger = await setupFileLogger()

  // Register the global hook for logging. This is the single AIRI log hook; it
  // both writes to the FileLogger and feeds the Lia Home log viewer buffer.
  setGlobalHookPostLog((_, formatted) => {
    ingestMainProcessLog(formatted)
    if (skipFileLogging || fileLogger.logFileFd === null)
      return
    void fileLogger.appendLog(formatted)
  })

  injeca.setLogger(createLoggLogger(useLogg('injeca').useGlobalConfig()))

  const appConfig = injeca.provide('configs:app', () => createGlobalAppConfig())
  const artistryConfig = injeca.provide('configs:artistry', () => createArtistryConfig())
  // Lia product preferences (namespace `lia`, file `product.json`). Built eagerly
  // at boot (see the dedicated invoke below) so `schemaVersion` is validated and
  // the config is ready for later subphases (persona/provider/voice/preferences).
  const liaProductConfig = injeca.provide('configs:lia-product', () => createLiaProductConfig())
  // Lia secure secret vault (M1 Phase 4C). Provider API keys live encrypted in
  // the Electron main process, never in renderer localStorage or lia-product.json.
  const liaSecrets = injeca.provide('services:lia-secrets', () => createLiaSecretVault())
  // One voice-library instance for the whole main process: the voice bridge
  // and the profiles bridge read and write the same registry.
  const liaVoiceProfiles = injeca.provide('services:lia-voice-profiles', () =>
    createLiaVoiceProfileStore({ rootDir: join(app.getPath('userData'), 'lia-voices') }))
  // Phase 8.0D-5: the Lia Brain service - ONE instance per main-process
  // lifetime, created through its own factory so the production Brain catalog
  // (composed and validated during construction) has a single owner. It has
  // NO consumers yet: the boot invoke below only materializes the instance so
  // a broken catalog invariant fails loudly at startup instead of at a future
  // first use. Startup evaluates nothing about routing - brain mode,
  // preferences, capability requirements and selection policies are all
  // caller inputs that arrive only through the service's own decide(...).
  const liaBrain = injeca.provide('services:lia-brain', {
    dependsOn: { liaProductConfig },
    build: ({ dependsOn }) => createLiaBrainService({ liaProductConfig: dependsOn.liaProductConfig }),
  })
  // Phase 8.0D-10B-4B2: the Lia Brain correlation store - ONE ephemeral,
  // bounded, diagnostic-only in-memory instance for the whole main process,
  // built by its own factory with the production bounds it owns. It depends on
  // nothing (the store is pure memory), and nothing records into it yet: the
  // decision bridge and the execution report handler stay unaware of it in
  // this phase.
  const liaBrainCorrelation = injeca.provide('services:lia-brain-correlation', () =>
    createLiaBrainCorrelationService())
  const electronApp = injeca.provide('host:electron:app', () => app)
  const autoUpdater = injeca.provide('services:auto-updater', {
    dependsOn: { appConfig },
    build: ({ dependsOn }) => setupAutoUpdater({
      enabled: import.meta.env.VITE_DISTRIBUTION !== 'steam',
      getStoredUpdateLane: () => dependsOn.appConfig.get()?.updateChannel,
      setStoredUpdateLane: (lane) => {
        const currentConfig = dependsOn.appConfig.get()
        dependsOn.appConfig.update({
          language: currentConfig?.language ?? 'en',
          updateChannel: lane,
        })
      },
    }),
  })

  const i18n = injeca.provide('libs:i18n', {
    dependsOn: { appConfig },
    build: ({ dependsOn }) => createI18n({
      messages,
      locale: dependsOn.appConfig.get()?.language,
      // Missing keys in a locale fall back to English (parity with the renderer
      // i18n) instead of leaking the raw lookup key to the UI.
      fallbackLocale: 'en',
    }),
  })

  const serverChannel = injeca.provide('modules:channel-server', {
    dependsOn: { app: electronApp, lifecycle },
    build: async ({ dependsOn }) => setupServerChannel(dependsOn),
  })

  const airiHttpServer = injeca.provide('modules:airi-http-server', {
    build: async () => setupBuiltInServer({ servers: [] }),
  })

  const godotStageManager = injeca.provide('modules:godot-stage-manager', {
    build: async () => setupGodotStageManager(),
  })

  const appleSpeechTranscription = injeca.provide('modules:apple-speech-transcription', {
    dependsOn: { lifecycle },
    build: ({ dependsOn }) => setupAppleSpeechTranscriptionService(dependsOn),
  })

  const mcpStdioManager = injeca.provide('modules:mcp-stdio-manager', {
    build: async () => setupMcpStdioManager(),
  })

  const widgetsManager = injeca.provide('windows:widgets', {
    dependsOn: { serverChannel, i18n },
    build: ({ dependsOn }) => setupWidgetsWindowManager(dependsOn),
  })

  const pluginHost = injeca.provide('modules:plugin-host', {
    dependsOn: { serverChannel, widgetsManager },
    build: ({ dependsOn }) => setupExtensionHost(dependsOn),
  })

  const globalShortcut = injeca.provide('services:global-shortcut', () => setupGlobalShortcutService())

  // Beat Sync uses a background renderer because Web Audio processing needs a DOM runtime.
  const beatSync = injeca.provide('windows:beat-sync', () => setupBeatSync())

  const devtoolsMarkdownStressWindow = injeca.provide('windows:devtools:markdown-stress', () => setupDevtoolsWindow())

  const onboardingWindowManager = injeca.provide('windows:onboarding', {
    dependsOn: { serverChannel, i18n },
    build: ({ dependsOn }) => setupOnboardingWindowManager(dependsOn),
  })

  const noticeWindow = injeca.provide('windows:notice', {
    dependsOn: { i18n, serverChannel },
    build: ({ dependsOn }) => setupNoticeWindowManager(dependsOn),
  })

  const aboutWindow = injeca.provide('windows:about', {
    dependsOn: { autoUpdater, i18n, serverChannel },
    build: ({ dependsOn }) => setupAboutWindowReusable(dependsOn),
  })

  const chatWindow = injeca.provide('windows:chat', {
    dependsOn: { widgetsManager, serverChannel, mcpStdioManager, i18n },
    build: ({ dependsOn }) => setupChatWindowReusableFunc(dependsOn),
  })

  const spotlightWindow = injeca.provide('windows:spotlight', {
    dependsOn: { serverChannel, i18n, chatWindow, globalShortcut, appConfig },
    build: ({ dependsOn }) => setupSpotlightWindowManager(dependsOn),
  })

  const editorWindow = injeca.provide('windows:editor', {
    dependsOn: { serverChannel, i18n },
    build: ({ dependsOn }) => setupEditorWindowManager(dependsOn),
  })

  const settingsWindow = injeca.provide('windows:settings', {
    dependsOn: { widgetsManager, beatSync, autoUpdater, devtoolsWindow: devtoolsMarkdownStressWindow, serverChannel, godotStageManager, mcpStdioManager, i18n, globalShortcut, spotlightWindow },
    build: async ({ dependsOn }) =>
      setupSettingsWindowReusableFunc({
        ...dependsOn,
        getMainWindow: () => userFacingMainWindow,
        getMainWindowSizeSettings: () => userFacingMainWindowSizeSettings,
      }),
  })

  const mainWindow = injeca.provide('windows:main', {
    dependsOn: { editorWindow, settingsWindow, chatWindow, widgetsManager, noticeWindow, beatSync, autoUpdater, serverChannel, godotStageManager, mcpStdioManager, i18n, onboardingWindowManager, appleSpeechTranscription, liaProductConfig, liaVoiceProfiles },
    build: async ({ dependsOn }) => {
      // Phase 7.9E.4: the voice runtime must register BEFORE the renderer
      // loads. `onWindowCreated` runs right after `new BrowserWindow`, so
      // these handles travel INTO that hook instead of arriving through
      // this provider's own (post-load) resolution.
      const { liaProductConfig: liaProductCfg, liaVoiceProfiles: voiceProfileStore, ...windowDeps } = dependsOn
      return setupMainWindow({
        ...windowDeps,
        onWindowCreated: (window) => {
          userFacingMainWindow = window
          startLiaMainWindowVoiceRuntime({
            liaProductConfig: liaProductCfg,
            liaVoiceProfiles: voiceProfileStore,
            window,
          })
        },
        onSizeSettingsReady: (controller) => {
          userFacingMainWindowSizeSettings = controller
        },
      })
    },
  })

  const captionWindow = injeca.provide('windows:caption', {
    dependsOn: { mainWindow, serverChannel, i18n },
    build: async ({ dependsOn }) => setupCaptionWindowManager(dependsOn),
  })

  const tray = injeca.provide('app:tray', {
    dependsOn: { mainWindow, settingsWindow, captionWindow, widgetsWindow: widgetsManager, serverChannel, beatSyncBgWindow: beatSync, aboutWindow, i18n },
    build: async ({ dependsOn }) => setupTray(dependsOn),
  })

  // Desktop grounding overlay — gated by AIRI_DESKTOP_OVERLAY=1
  if (isDesktopOverlayEnabled()) {
    const desktopOverlay = injeca.provide('windows:desktop-overlay', {
      dependsOn: { mcpStdioManager, serverChannel, i18n },
      build: async ({ dependsOn }) => setupDesktopOverlayWindow(dependsOn),
    })

    // NOTICE: Separate invoke ensures the overlay is eagerly built.
    // Without this, injeca.start() would skip it because no other
    // provider depends on 'windows:desktop-overlay'.
    injeca.invoke({
      dependsOn: { desktopOverlay },
      callback: noop,
    })
  }

  // Register the Lia secure-secret IPC bridge (safeStorage vault) for renderers.
  injeca.invoke({
    dependsOn: { liaSecrets },
    callback: async (deps) => {
      const { context } = createContext(ipcMain)
      registerLiaSecretsBridge({ context, vault: deps.liaSecrets })
    },
  })

  // Register the Lia provider.chat config bridge (references/metadata only).
  injeca.invoke({
    dependsOn: { liaProductConfig },
    callback: async (deps) => {
      const { context } = createContext(ipcMain)
      registerLiaProviderConfigBridge({ context, liaProductConfig: deps.liaProductConfig })
    },
  })

  // Register the Lia voice.tts config bridge (references/metadata only — no
  // secrets; API keys stay in the Phase 4C vault).
  injeca.invoke({
    dependsOn: { liaProductConfig },
    callback: async (deps) => {
      const { context } = createContext(ipcMain)
      registerLiaVoiceConfigBridge({ context, liaProductConfig: deps.liaProductConfig })
    },
  })

  // Phase 8.0D-7: the read-only Brain decision bridge. It reuses the ONE
  // Brain service owned by this lifecycle (see the provider above) and grants
  // no execution authority - it answers a routing question about a described
  // chat turn and returns the canonical decision unchanged. No production
  // chat code calls it yet.
  injeca.invoke({
    dependsOn: { liaBrain },
    callback: async (deps) => {
      const { context } = createContext(ipcMain)
      registerLiaBrainDecisionBridge({ context, brain: deps.liaBrain })
    },
  })

  // Phase 8.0D-10B-4A: the one-way Lia execution observation report. It is
  // diagnostic only and deliberately depends on NOTHING - not on the Brain
  // service, not on product config: the handler sanitizes, requires the
  // logical-send key and discards the report.
  injeca.invoke({
    dependsOn: {},
    callback: async () => {
      const { context } = createContext(ipcMain)
      registerLiaBrainExecutionReportHandler({ context })
    },
  })

  // Private voice library: import/remove imported voices. Kept separate from the
  // bridge above on purpose - selecting a voice still goes through
  // `electronLiaVoiceConfigSet`, so `voice.tts` keeps exactly one writer.
  injeca.invoke({
    dependsOn: { liaProductConfig, liaVoiceProfiles },
    callback: async (deps) => {
      const { context } = createContext(ipcMain)
      // Phase 7.8: there are NO engine-managed voice copies anymore - a
      // modular engine reads the canonical reference from the profile's own
      // directory directly, so removing a profile needs no engine cleanup.
      registerLiaVoiceProfilesBridge({ context, store: deps.liaVoiceProfiles })
    },
  })

  // Lia Voice bridge: the engine-neutral IPC surface over the Lia Voice
  // Phase 7.9E.4: the Lia voice runtime (bridge + capabilities + managed
  // prewarm + greeting latch) no longer lives here as an injeca.invoke on
  // `mainWindow` - that was the renderer<->main race: the provider only
  // resolves after the renderer load begins. It now starts inside the
  // windows:main `onWindowCreated` hook (see main-window-voice-runtime.ts),
  // i.e. strictly BEFORE `load(...)`. One registration per process, as
  // before.

  injeca.invoke({
    dependsOn: { mainWindow, tray, serverChannel, airiHttpServer, godotStageManager, pluginHost, mcpStdioManager, onboardingWindow: onboardingWindowManager, widgetsWindow: widgetsManager, spotlightWindow, artistryConfig },
    callback: async (deps) => {
      const { context } = createContext(ipcMain)
      await setupArtistryBridge({
        widgetsManager: deps.widgetsWindow,
        context,
        artistryConfig: deps.artistryConfig,
      })
    },
  })

  // Eagerly build the Lia product config at boot (no consumer yet in 4A) so its
  // schemaVersion is validated and defaults are initialized for later subphases.
  // NOTE: the resolved instance only exists as `deps.liaProductConfig` inside the
  // callback; the outer `liaProductConfig` handle is only valid for `dependsOn`.
  injeca.invoke({
    dependsOn: { liaProductConfig },
    callback: (deps) => {
      deps.liaProductConfig.get()
    },
  })

  // Phase 8.0D-5: materialize the Lia Brain service at boot (same eager
  // pattern as the product config above) so the production catalog is
  // composed and validated exactly once per process. Touching the handle
  // constructs the service; it calls nothing on it, so no routing decision -
  // and no read of mode, preferences, requirement or policy - happens here.
  injeca.invoke({
    dependsOn: { liaBrain },
    callback: (deps) => {
      void deps.liaBrain
    },
  })

  // Phase 8.0D-10B-4B2: materialize the correlation store at boot (same eager
  // pattern as the Brain service above) so its ONE instance exists from
  // startup with the explicit production bounds. The callback only touches the
  // handle: it records nothing, so the store is born empty and stays empty
  // until a future explicit caller records data.
  injeca.invoke({
    dependsOn: { liaBrainCorrelation },
    callback: (deps) => {
      void deps.liaBrainCorrelation
    },
  })

  injeca.start().catch(err => console.error(err))

  // Lifecycle
  emitAppReady()

  // Extra
  openDebugger()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
}).catch((err) => {
  log.withError(err).error('Error during app initialization')
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  emitAppWindowAllClosed()

  if (platform !== 'darwin') {
    app.quit()
  }
})

let appExiting = false

// Clean up server and intervals when app quits
async function handleAppExit() {
  if (appExiting)
    return

  appExiting = true

  let exitedNormally = true

  /**
   * Safely execute fn and log any errors that occur, marking the exit as abnormal
   * if an error is caught.
   *
   * @param operation - A verb phrase describing the operation.
   * @param fn - Any function to execute. It can be either sync or async.
   * @returns A promise that resolves when the operation is complete.
   */
  async function logIfError(operation: string, fn: () => unknown): Promise<void> {
    try {
      await fn()
    }
    catch (error) {
      exitedNormally = false
      log.withError(error).error(`[app-exit] Failed to ${operation}:`)
    }
  }

  await Promise.all([
    logIfError('execute onAppBeforeQuit hooks', () => emitAppBeforeQuit()),
    logIfError('stop injeca', () => injeca.stop()),
  ])

  // Prevent the global log hook from trying to write to the file after close() is called,
  // which would cause a recursive failure if close() itself throws.
  skipFileLogging = true
  await logIfError('flush file logs', () => fileLogger.close()) // Ensure all logs are flushed

  if (!exitedNormally) {
    app.exit(1)
  }
  else {
    app.quit()
  }
}

process.on('SIGINT', () => handleAppExit())

app.on('before-quit', (event) => {
  if (appExiting)
    return

  event.preventDefault()
  handleAppExit()
})
