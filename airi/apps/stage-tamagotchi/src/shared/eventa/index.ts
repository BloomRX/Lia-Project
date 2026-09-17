import type { Locale } from '@intlify/core'
import type {
  LiaCustomVoiceFile as LiaCoreCustomVoiceFile,
  LiaCustomVoiceProfile as LiaCoreCustomVoiceProfile,
  LiaVoiceProfileErrorCode as LiaCoreVoiceProfileErrorCode,
  LiaVoiceProfileImportRequest as LiaCoreVoiceProfileImportRequest,
  LiaVoiceProfileResult as LiaCoreVoiceProfileResult,
  LiaVoiceProfileSource as LiaCoreVoiceProfileSource,
} from '@lia/core/voices/types'
import type {
  GameletIframeRequestPayload as GameletIframeInvokePayload,
  GameletIframeResponsePayload,
} from '@proj-airi/plugin-sdk-tamagotchi/gamelet'
import type { ServerOptions } from '@proj-airi/server-runtime/server'
import type {
  ShortcutAccelerator,
  ShortcutBinding,
  ShortcutRegistrationResult,
} from '@proj-airi/stage-shared/global-shortcut'
import type {
  StageViewErrorPayload,
  StageViewPatch,
  StageViewRequestAckPayload,
  StageViewSnapshotPayload,
} from '@proj-airi/stage-shared/godot-stage'
import type { ServerChannelQrPayload } from '@proj-airi/stage-shared/server-channel-qr'
import type {
  ThreeHitTestReadTracePayload,
  ThreeSceneRenderInfoTracePayload,
  VrmDisposeEndTracePayload,
  VrmDisposeStartTracePayload,
  VrmLoadEndTracePayload,
  VrmLoadErrorTracePayload,
  VrmLoadStartTracePayload,
  VrmUpdateFrameTracePayload,
} from '@proj-airi/stage-ui-three/trace'
import type { Rectangle } from 'electron'

import type { LiaBootstrapState, LiaRuntimeInstallState } from '../lia-voice'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

/** A single sanitized main-process log line streamed to the Lia Home viewer. */
export interface MainProcessLogLine {
  id: number
  timestamp: number
  text: string
}

export const electronStartTrackMousePosition = defineInvokeEventa('eventa:invoke:electron:start-tracking-mouse-position')
export const electronStartDraggingWindow = defineInvokeEventa('eventa:invoke:electron:start-dragging-window')

export const electronOpenMainDevtools = defineInvokeEventa('eventa:invoke:electron:windows:main:devtools:open')
export const electronCenterMainWindow = defineInvokeEventa<Rectangle>('eventa:invoke:electron:windows:main:center')
export const electronSetMainWindowContext = defineInvokeEventa<void, { mode: 'home' | 'stage' }>('eventa:invoke:electron:windows:main:set-context')

/**
 * Per-mode initial window-size configuration (read/written by the Settings
 * window). Mirrors the main-window's persisted per-mode size override — no new
 * persistence; `null` means "fall back to the built-in preset".
 */
export interface MainWindowSizeRecord {
  width?: number
  height?: number
}

export interface MainWindowSizeSnapshot {
  activeMode: 'home' | 'stage'
  home: MainWindowSizeRecord | null
  stage: MainWindowSizeRecord | null
}

export type MainWindowSizeInput = { width: number, height: number } | null

export const electronMainWindowSizeGet = defineInvokeEventa<MainWindowSizeSnapshot>('eventa:invoke:electron:windows:main:size:get')
export const electronMainWindowSizeSet = defineInvokeEventa<void, { mode: 'home' | 'stage', size: MainWindowSizeInput }>('eventa:invoke:electron:windows:main:size:set')
export const electronGetMainWindowLogs = defineInvokeEventa<MainProcessLogLine[]>('eventa:invoke:electron:main-window:get-logs')
export const electronMainWindowLogEntry = defineEventa<MainProcessLogLine>('eventa:event:electron:main-window:log')
export const electronOpenEditor = defineInvokeEventa<void>('eventa:invoke:electron:windows:editor:open')
export const electronOpenSettings = defineInvokeEventa<void, { route?: string }>('eventa:invoke:electron:windows:settings:open')
export const electronSettingsNavigate = defineEventa<{ route: string }>('eventa:event:electron:windows:settings:navigate')
export const electronOpenChat = defineInvokeEventa('eventa:invoke:electron:windows:chat:open')
export const electronSpotlightHide = defineInvokeEventa<void>('eventa:invoke:electron:windows:spotlight:hide')
export const electronSpotlightShowResultNotification = defineInvokeEventa<void, { body: string }>('eventa:invoke:electron:windows:spotlight:show-result-notification')
export const electronSpotlightShortcutGet = defineInvokeEventa<ShortcutAccelerator>('eventa:invoke:electron:windows:spotlight:shortcut:get')
export const electronSpotlightShortcutSet = defineInvokeEventa<ShortcutRegistrationResult, { accelerator: ShortcutAccelerator | null }>('eventa:invoke:electron:windows:spotlight:shortcut:set')
export const electronOpenSettingsDevtools = defineInvokeEventa('eventa:invoke:electron:windows:settings:devtools:open')
export const electronOpenDevtoolsWindow = defineInvokeEventa<void, { key: string, route?: string, width?: number, height?: number, x?: number, y?: number }>('eventa:invoke:electron:windows:devtools:open')

export interface ElectronServerChannelConfig {
  tlsConfig?: ServerOptions['tlsConfig'] | null
  authToken: string
  hostname: string
}
export const electronGetServerChannelConfig = defineInvokeEventa<ElectronServerChannelConfig>('eventa:invoke:electron:server-channel:get-config')
export const electronApplyServerChannelConfig = defineInvokeEventa<ElectronServerChannelConfig, Partial<ElectronServerChannelConfig>>('eventa:invoke:electron:server-channel:apply-config')
export const electronGetServerChannelQrPayload = defineInvokeEventa<ServerChannelQrPayload>('eventa:invoke:electron:server-channel:get-qr-payload')

export type ElectronUpdaterChannel = 'latest' | 'stable' | 'alpha' | 'beta' | 'nightly' | 'canary'

export interface ElectronUpdaterPreferences {
  channel?: ElectronUpdaterChannel
}

export const electronGetUpdaterPreferences = defineInvokeEventa<ElectronUpdaterPreferences>('eventa:invoke:electron:auto-updater:get-preferences')
export const electronSetUpdaterPreferences = defineInvokeEventa<ElectronUpdaterPreferences, ElectronUpdaterPreferences>('eventa:invoke:electron:auto-updater:set-preferences')

export * from './plugin/assets'
export * from './plugin/capabilities'
export * from './plugin/host'
export * from './plugin/tools'

export interface DesktopOverlayReadiness {
  state: 'booting' | 'ready' | 'degraded'
  error?: string
}

export const getDesktopOverlayReadinessContract = defineInvokeEventa<DesktopOverlayReadiness>('eventa:invoke:electron:windows:desktop-overlay:get-readiness')

export const captionIsFollowingWindowChanged = defineEventa<boolean>('eventa:event:electron:windows:caption-overlay:is-following-window-changed')
export const captionGetIsFollowingWindow = defineInvokeEventa<boolean>('eventa:invoke:electron:windows:caption-overlay:get-is-following-window')

export type RequestWindowActionDefault = 'confirm' | 'cancel' | 'close'
export interface RequestWindowPayload {
  id?: string
  route: string
  type?: string
  payload?: Record<string, any>
}
export interface RequestWindowPending {
  id: string
  type?: string
  payload?: Record<string, any>
}

// Reference window helpers are generic; callers can alias for clarity
export type NoticeAction = 'confirm' | 'cancel' | 'close'

export function createRequestWindowEventa(namespace: string) {
  const prefix = (name: string) => `eventa:${name}:electron:windows:${namespace}`
  return {
    openWindow: defineInvokeEventa<boolean, RequestWindowPayload>(prefix('invoke:open')),
    windowAction: defineInvokeEventa<void, { id: string, action: RequestWindowActionDefault }>(prefix('invoke:action')),
    pageMounted: defineInvokeEventa<RequestWindowPending | undefined, { id?: string }>(prefix('invoke:page-mounted')),
    pageUnmounted: defineInvokeEventa<void, { id?: string }>(prefix('invoke:page-unmounted')),
  }
}

// Notice window events built from generic factory
export const noticeWindowEventa = createRequestWindowEventa('notice')

// Widgets / Adhoc window events
export interface WidgetWindowSize {
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
}

export type WidgetGridSize = 's' | 'm' | 'l' | { cols?: number, rows?: number }

export interface WidgetsAddPayload {
  id?: string
  componentName: string
  componentProps?: Record<string, any>
  alwaysOnTop?: boolean
  // size presets or explicit spans; renderer decides mapping
  size?: WidgetGridSize
  windowSize?: WidgetWindowSize | Record<string, unknown>
  // auto-dismiss in ms; if omitted, persistent until closed by user
  ttlMs?: number
}

export interface WidgetsUpdatePayload {
  id: string
  componentProps?: Record<string, any>
  alwaysOnTop?: boolean
  size?: WidgetGridSize
  windowSize?: WidgetWindowSize | Record<string, unknown>
  ttlMs?: number
}

export interface WidgetSnapshot {
  id: string
  componentName: string
  componentProps: Record<string, any>
  alwaysOnTop: boolean
  size: WidgetGridSize
  windowSize?: WidgetWindowSize
  ttlMs: number
}

/**
 * Request relayed from Electron main to one mounted widget iframe through the widgets renderer.
 */
export interface WidgetsIframeRequestPayload {
  /** Widget id that identifies the mounted iframe target. */
  id: string
  /** Relay correlation id echoed by the renderer-to-main result event. */
  requestId: string
  /** Structured-clone-safe request record forwarded into the iframe Eventa runtime. */
  payload: GameletIframeInvokePayload['payload']
  /** Request timeout budget in milliseconds. */
  timeoutMs: number
}

/**
 * Shared fields for a renderer-to-main iframe request result.
 */
export interface WidgetsIframeRequestResultBasePayload {
  /** Widget id that produced the result. */
  id: string
  /** Relay correlation id matching the original main-to-renderer request. */
  requestId: string
}

/**
 * Successful renderer-to-main iframe request result.
 */
export interface WidgetsIframeRequestSuccessPayload extends WidgetsIframeRequestResultBasePayload {
  /** Marks this result as a successful iframe response. */
  ok: true
  /** Structured-clone-safe response record returned by the iframe Eventa runtime. */
  result: GameletIframeResponsePayload
}

/**
 * Failed renderer-to-main iframe request result.
 */
export interface WidgetsIframeRequestFailurePayload extends WidgetsIframeRequestResultBasePayload {
  /** Marks this result as a failed iframe response. */
  ok: false
  /** Error message returned when the iframe request fails. */
  error: string
}

/**
 * Result relayed from the widgets renderer back to Electron main for one iframe request.
 */
export type WidgetsIframeRequestResultPayload
  = | WidgetsIframeRequestSuccessPayload
    | WidgetsIframeRequestFailurePayload

export interface PluginManifestSummary {
  extensionId: string
  entrypoints: Record<string, string | undefined>
  path: string
  enabled: boolean
  loaded: boolean
  isNew: boolean
}

export interface PluginRegistrySnapshot {
  root: string
  plugins: PluginManifestSummary[]
}

// TODO: Replace these manually duplicated IPC types with re-exports from
// @proj-airi/plugin-sdk (CapabilityDescriptor) once stage-ui and the shared
// eventa layer can depend on the SDK without introducing unwanted coupling.
export interface PluginCapabilityPayload {
  key: string
  state: 'announced' | 'ready' | 'degraded' | 'withdrawn'
  metadata?: Record<string, unknown>
}

export interface PluginCapabilityState {
  key: string
  state: 'announced' | 'ready' | 'degraded' | 'withdrawn'
  metadata?: Record<string, unknown>
  updatedAt: number
}

export interface PluginHostSessionSummary {
  id: string
  extensionId: string
  phase: string
  runtime: 'electron' | 'node' | 'web'
  moduleId: string
}

export interface PluginHostDebugSnapshot {
  registry: PluginRegistrySnapshot
  sessions: PluginHostSessionSummary[]
  capabilities: PluginCapabilityState[]
  refreshedAt: number
}

export interface ElectronMcpStdioServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  enabled?: boolean
}

export interface ElectronMcpStdioConfigFile {
  mcpServers: Record<string, ElectronMcpStdioServerConfig>
}

export interface ElectronMcpStdioApplyResult {
  path: string
  started: Array<{ name: string }>
  failed: Array<{ name: string, error: string }>
  skipped: Array<{ name: string, reason: string }>
}

export interface ElectronMcpStdioServerRuntimeStatus {
  name: string
  state: 'running' | 'stopped' | 'error'
  command: string
  args: string[]
  pid: number | null
  lastError?: string
}

export interface ElectronMcpStdioRuntimeStatus {
  path: string
  servers: ElectronMcpStdioServerRuntimeStatus[]
  updatedAt: number
}

export interface ElectronMcpToolDescriptor {
  serverName: string
  name: string
  toolName: string
  description?: string
  inputSchema: Record<string, unknown>
}

export interface ElectronMcpCallToolPayload {
  name: string
  arguments?: Record<string, unknown>
}

export interface ElectronMcpCallToolResult {
  content?: Array<Record<string, unknown>>
  structuredContent?: Record<string, unknown>
  toolResult?: unknown
  isError?: boolean
}

export interface ElectronMcpStdioConfigText {
  path: string
  text: string
}

export interface ElectronMcpStdioTestResult {
  ok: boolean
  error?: string
  tools?: string[]
  durationMs: number
}

export interface ElectronMcpStdioTestPayload {
  name: string
  config: ElectronMcpStdioServerConfig
}

export const electronMcpOpenConfigFile = defineInvokeEventa<{ path: string }>('eventa:invoke:electron:mcp:open-config-file')
export const electronMcpApplyAndRestart = defineInvokeEventa<ElectronMcpStdioApplyResult>('eventa:invoke:electron:mcp:apply-and-restart')
export const electronMcpGetRuntimeStatus = defineInvokeEventa<ElectronMcpStdioRuntimeStatus>('eventa:invoke:electron:mcp:get-runtime-status')
export const electronMcpListTools = defineInvokeEventa<ElectronMcpToolDescriptor[]>('eventa:invoke:electron:mcp:list-tools')
export const electronMcpCallTool = defineInvokeEventa<ElectronMcpCallToolResult, ElectronMcpCallToolPayload>('eventa:invoke:electron:mcp:call-tool')
export const electronMcpReadConfigText = defineInvokeEventa<ElectronMcpStdioConfigText>('eventa:invoke:electron:mcp:read-config-text')
export const electronMcpWriteConfigText = defineInvokeEventa<ElectronMcpStdioConfigText, { text: string }>('eventa:invoke:electron:mcp:write-config-text')
export const electronMcpTestServer = defineInvokeEventa<ElectronMcpStdioTestResult, ElectronMcpStdioTestPayload>('eventa:invoke:electron:mcp:test-server')

export const widgetsOpenWindow = defineInvokeEventa<void, { id?: string }>('eventa:invoke:electron:windows:widgets:open')
export const widgetsHideWindow = defineInvokeEventa<void, { id?: string }>('eventa:invoke:electron:windows:widgets:hide')
export const widgetsAdd = defineInvokeEventa<string | undefined, WidgetsAddPayload>('eventa:invoke:electron:windows:widgets:add')
export const widgetsRemove = defineInvokeEventa<void, { id: string }>('eventa:invoke:electron:windows:widgets:remove')
export const widgetsClear = defineInvokeEventa('eventa:invoke:electron:windows:widgets:clear')
export const widgetsUpdate = defineInvokeEventa<void, WidgetsUpdatePayload>('eventa:invoke:electron:windows:widgets:update')
export const widgetsFetch = defineInvokeEventa<WidgetSnapshot | void, { id: string }>('eventa:invoke:electron:windows:widgets:fetch')
export const widgetsPrepareWindow = defineInvokeEventa<string | undefined, { id?: string }>('eventa:invoke:electron:windows:widgets:prepare')
export const widgetsIframePublish = defineInvokeEventa<void, { id: string, event: Record<string, unknown> }>('eventa:invoke:electron:windows:widgets:iframe-publish')

export const electronWindowClose = defineInvokeEventa<void>('eventa:invoke:electron:window:close')
export type ElectronWindowLifecycleReason
  = | 'initial'
    | 'snapshot'
    | 'show'
    | 'hide'
    | 'minimize'
    | 'restore'
    | 'focus'
    | 'blur'

export interface ElectronWindowLifecycleState {
  focused: boolean
  minimized: boolean
  reason: ElectronWindowLifecycleReason
  updatedAt: number
  visible: boolean
}

export const electronWindowLifecycleChanged = defineEventa<ElectronWindowLifecycleState>('eventa:event:electron:window:lifecycle-changed')
export const electronGetWindowLifecycleState = defineInvokeEventa<ElectronWindowLifecycleState>('eventa:invoke:electron:window:get-lifecycle-state')
export const electronWindowSetAlwaysOnTop = defineInvokeEventa<void, boolean>('eventa:invoke:electron:window:set-always-on-top')
export const electronAppOpenUserDataFolder = defineInvokeEventa<{ path: string }>('eventa:invoke:electron:app:open-user-data-folder')
export const electronAppQuit = defineInvokeEventa<void>('eventa:invoke:electron:app:quit')

export type ElectronGodotStageState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

/**
 * Snapshot of the Godot sidecar lifecycle owned by Electron main.
 *
 * Use when:
 * - Renderer windows need to reflect whether the external Godot window is available
 * - Settings or stage pages need lifecycle feedback after start/stop actions
 *
 * Expects:
 * - `pid` is only set while the Godot child process exists
 * - `lastError` is present for the most recent lifecycle or scene-apply failure
 *
 * Returns:
 * - N/A
 */
export interface ElectronGodotStageStatus {
  state: ElectronGodotStageState
  pid: number | null
  lastError?: string
  updatedAt: number
}

/**
 * Serialized scene input payload forwarded from renderer to Electron main.
 *
 * Use when:
 * - The selected model should be materialized to disk and applied to the Godot scene
 *
 * Expects:
 * - `data` contains the full model file bytes
 * - `fileName` matches the original model asset name when available
 *
 * Returns:
 * - N/A
 */
export interface ElectronGodotStageSceneInputPayload {
  modelId: string
  format: 'vrm'
  name: string
  fileName: string
  data: Uint8Array
}

export const electronGodotStageStart = defineInvokeEventa<ElectronGodotStageStatus>('eventa:invoke:electron:godot-stage:start')
export const electronGodotStageStop = defineInvokeEventa<ElectronGodotStageStatus>('eventa:invoke:electron:godot-stage:stop')
export const electronGodotStageGetStatus = defineInvokeEventa<ElectronGodotStageStatus>('eventa:invoke:electron:godot-stage:get-status')
export const electronGodotStageApplySceneInput = defineInvokeEventa<void, ElectronGodotStageSceneInputPayload>('eventa:invoke:electron:godot-stage:apply-scene-input')
export const electronGodotStageGetViewSnapshot = defineInvokeEventa<StageViewSnapshotPayload | null>('eventa:invoke:electron:godot-stage:view-snapshot:get')
export const electronGodotStageApplyViewPatch = defineInvokeEventa<StageViewRequestAckPayload, StageViewPatch>('eventa:invoke:electron:godot-stage:view-state:apply-patch')
export const electronGodotStageRequestViewSnapshot = defineInvokeEventa<StageViewRequestAckPayload>('eventa:invoke:electron:godot-stage:view-state:request-snapshot')
export const electronGodotStageStatusChanged = defineEventa<ElectronGodotStageStatus>('eventa:event:electron:godot-stage:status-changed')
export const electronGodotStageViewSnapshotChanged = defineEventa<StageViewSnapshotPayload>('eventa:event:electron:godot-stage:view-snapshot-changed')
export const electronGodotStageViewStateError = defineEventa<StageViewErrorPayload>('eventa:event:electron:godot-stage:view-state-error')

// Global shortcut ->

/**
 * Phase of a shortcut trigger event.
 *
 * - `down` — key combination pressed
 * - `up`   — key combination released; only emitted by drivers that
 *            accepted a binding with `receiveKeyUps: true`
 */
export type ElectronShortcutTriggerPhase = 'down' | 'up'

/**
 * Payload broadcast to all subscribed windows when a registered shortcut
 * fires. Renderer composables filter by `id` to dispatch local handlers.
 */
export interface ElectronShortcutTriggerPayload {
  id: string
  phase: ElectronShortcutTriggerPhase
}

export const electronShortcutRegister = defineInvokeEventa<ShortcutRegistrationResult, ShortcutBinding>('eventa:invoke:electron:shortcut:register')
export const electronShortcutUnregister = defineInvokeEventa<void, { id: string }>('eventa:invoke:electron:shortcut:unregister')
export const electronShortcutUnregisterAll = defineInvokeEventa<void>('eventa:invoke:electron:shortcut:unregister-all')
export const electronShortcutList = defineInvokeEventa<ShortcutBinding[]>('eventa:invoke:electron:shortcut:list')
export const electronShortcutTriggered = defineEventa<ElectronShortcutTriggerPayload>('eventa:event:electron:shortcut:triggered')

// <- Global shortcut

export type StageThreeRuntimeTraceEnvelope
  = | { type: 'three-render-info', payload: ThreeSceneRenderInfoTracePayload }
    | { type: 'three-hit-test-read', payload: ThreeHitTestReadTracePayload }
    | { type: 'vrm-update-frame', payload: VrmUpdateFrameTracePayload }
    | { type: 'vrm-load-start', payload: VrmLoadStartTracePayload }
    | { type: 'vrm-load-end', payload: VrmLoadEndTracePayload }
    | { type: 'vrm-load-error', payload: VrmLoadErrorTracePayload }
    | { type: 'vrm-dispose-start', payload: VrmDisposeStartTracePayload }
    | { type: 'vrm-dispose-end', payload: VrmDisposeEndTracePayload }

export interface StageThreeRuntimeTraceForwardedPayload {
  envelope: StageThreeRuntimeTraceEnvelope
  origin: string
}

export interface StageThreeRuntimeTraceRemoteControlPayload {
  origin: string
}

export const stageThreeRuntimeTraceForwardedEvent = defineEventa<StageThreeRuntimeTraceForwardedPayload>('eventa:event:stage-three-runtime-trace:forwarded')
export const stageThreeRuntimeTraceRemoteEnableEvent = defineEventa<StageThreeRuntimeTraceRemoteControlPayload>('eventa:event:stage-three-runtime-trace:remote-enable')
export const stageThreeRuntimeTraceRemoteDisableEvent = defineEventa<StageThreeRuntimeTraceRemoteControlPayload>('eventa:event:stage-three-runtime-trace:remote-disable')

// Internal event from main -> widgets renderer when a widget should render
export const widgetsRenderEvent = defineEventa<WidgetSnapshot>('eventa:event:electron:windows:widgets:render')
export const widgetsRemoveEvent = defineEventa<{ id: string }>('eventa:event:electron:windows:widgets:remove')
export const widgetsClearEvent = defineEventa('eventa:event:electron:windows:widgets:clear')
export const widgetsUpdateEvent = defineEventa<WidgetsUpdatePayload>('eventa:event:electron:windows:widgets:update')
/** Main-to-renderer event requesting work from a mounted widget iframe. */
export const widgetsIframeRequestEvent = defineEventa<WidgetsIframeRequestPayload>('eventa:event:electron:windows:widgets:iframe-request')
/** Renderer-to-main event carrying the correlated result for a widget iframe request. */
export const widgetsIframeRequestResultEvent = defineEventa<WidgetsIframeRequestResultPayload>('eventa:event:electron:windows:widgets:iframe-request-result')

// Onboarding window events
export const electronOnboardingClose = defineInvokeEventa('eventa:invoke:electron:windows:onboarding:close')
export const electronOpenOnboarding = defineInvokeEventa('eventa:invoke:electron:windows:onboarding:open')

// Auth — OIDC Authorization Code + PKCE flow via system browser
export interface ElectronAuthTokens {
  accessToken: string
  refreshToken?: string
  idToken?: string
  expiresIn: number
}
export const electronAuthStartLogin = defineInvokeEventa<void>('eventa:invoke:electron:auth:start-login')
export const electronAuthCallback = defineEventa<ElectronAuthTokens>('eventa:event:electron:auth:callback')
export const electronAuthCallbackError = defineEventa<{ error: string }>('eventa:event:electron:auth:callback-error')
export const electronAuthLogout = defineInvokeEventa<void>('eventa:invoke:electron:auth:logout')

export const i18nSetLocale = defineInvokeEventa<void, Locale>('eventa:invoke:electron:i18n:set-locale')
export const i18nGetLocale = defineInvokeEventa<string | undefined>('eventa:invoke:electron:i18n:get-locale')

// Lia secrets (M1 Phase 4C).
//
// Provider API keys / tokens are owned by the Electron main process via a
// safeStorage vault — NEVER by renderer localStorage or `lia-product.json`.
// The renderer only ever asks main to store/has/read/delete one secret on
// demand (read → transient in-memory use), never to persist it itself.
export interface LiaSecretPayload {
  /** e.g. a chat provider id. */
  scope: string
  /** e.g. `apiKey`. */
  key: string
}

export const electronLiaSecretEncryptionAvailable = defineInvokeEventa<boolean>('eventa:invoke:lia:secret:encryption-available')
export const electronLiaSecretHas = defineInvokeEventa<boolean, LiaSecretPayload>('eventa:invoke:lia:secret:has')
export const electronLiaSecretSet = defineInvokeEventa<boolean, LiaSecretPayload & { value: string }>('eventa:invoke:lia:secret:set')
export const electronLiaSecretGet = defineInvokeEventa<string | undefined, LiaSecretPayload>('eventa:invoke:lia:secret:get')
export const electronLiaSecretDelete = defineInvokeEventa<boolean, LiaSecretPayload>('eventa:invoke:lia:secret:delete')

// Lia chat provider configuration (M1 Phase 4C).
//
// Lives in the Lia product config (`userData/lia-product.json`, namespace `lia`)
// under `provider.chat` and only carries references/metadata: strategy, the
// user's preferred provider/model, and the ordered fallback list. No secret is
// ever stored here — API keys live in the main-process secret vault and are
// merged in per-use at provider-instance build time.
export interface LiaProviderChatTarget {
  providerId: string
  modelId?: string
}

export interface LiaProviderChatConfig {
  strategy?: 'auto' | 'manual'
  preferred?: LiaProviderChatTarget
  fallback?: LiaProviderChatTarget[]
  /** Master switch for provider failover (defaults to enabled when configured). */
  fallbackEnabled?: boolean
  /** First-run setup completed for a valid config (see readiness rules). */
  onboarded?: boolean
}

export const electronLiaProviderChatConfigGet = defineInvokeEventa<LiaProviderChatConfig>('eventa:invoke:lia:provider:chat:config:get')
export const electronLiaProviderChatConfigSet = defineInvokeEventa<void, LiaProviderChatConfig>('eventa:invoke:lia:provider:chat:config:set')

// Lia voice configuration (M1 Phase 4D).
//
// Lives in the Lia product config (`userData/lia-product.json`, namespace `lia`)
// under `voice` and only carries references/metadata: the user's preferred TTS
// target and the ordered TTS fallback list. No secret is ever stored here —
// voice provider API keys live in the main-process secret vault (Phase 4C) and
// are merged in per-use at provider-instance build time.
//
// 4D-1 scope: the bridge only reads/writes the `tts` slice. `voice.stt` is
// forward-shaped in the product schema but has no IPC surface yet, and is never
// clobbered by a TTS write.
export interface LiaVoiceTtsTarget {
  providerId: string
  modelId?: string
  voiceId?: string
}

export interface LiaVoiceTtsConfig {
  /** Preferred primary TTS (voice) target. */
  preferred?: LiaVoiceTtsTarget
  /** Ordered TTS fallback list used when the primary voice provider fails. */
  fallback?: LiaVoiceTtsTarget[]
}

export interface LiaVoiceConfig {
  tts?: LiaVoiceTtsConfig
}

/**
 * The canonical definitions of these voice-profile shapes moved to Lia Core
 * (`@lia/core/voices/types`) when the Lia product became independent of its
 * stage host. They are re-exported here so the AIRI-side IPC contract keeps
 * compiling against exactly one source of truth.
 */

export type LiaCustomVoiceFile = LiaCoreCustomVoiceFile
export type LiaCustomVoiceProfile = LiaCoreCustomVoiceProfile
export type LiaVoiceProfileErrorCode = LiaCoreVoiceProfileErrorCode
export type LiaVoiceProfileImportRequest = LiaCoreVoiceProfileImportRequest
export type LiaVoiceProfileResult<T> = LiaCoreVoiceProfileResult<T>
export type LiaVoiceProfileSource = LiaCoreVoiceProfileSource

/**
 * How to reach the local AllTalk server. Runtime configuration only - it lives
 * in `voice.runtime.alltalk` inside `lia-product.json`, never inside a voice
 * profile, because one server serves every imported voice.
 *
 * No secret and no audio: AllTalk on localhost takes no credential, and the
 * reference WAV stays on disk under `userData/lia-voices/<id>/`.
 */
export interface LiaAllTalkRuntimeConfig {
  /** Base URL without a trailing slash, e.g. `http://127.0.0.1:7851`. */
  baseUrl: string
  /** AllTalk's own voices folder, chosen through the OS directory picker. */
  voicesDir?: string
  /** Where AllTalk is installed, chosen through the OS directory picker. */
  installDir?: string
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number
}

/**
 * What the Lia knows about the speech runtime it manages.
 *
 * Deliberately free of technical vocabulary: the UI turns `notInstalled` into
 * "we need to install the voice system", never "AllTalk is missing from
 * installDir".
 */
export type LiaRuntimeState
  = | { state: 'checking' }
    | { state: 'error', message: string }
    | { state: 'notInstalled' }
    | { state: 'ready' }
    | { state: 'starting' }
    | { state: 'stopped' }

/** Install steps the guided wizard walks the user through. */
export interface LiaRuntimeInstallStep {
  /** Stable id, so the UI can mark progress without parsing labels. */
  id: string
  title: string
  detail: string
  /** External documentation, opened only on an explicit user click. */
  link?: string
  done: boolean
}

/**
 * What the UI shows about AllTalk. `notConfigured` is distinct from `offline`:
 * one says "point me at your server", the other says "the server is not
 * running". Conflating them sends the user to the wrong fix.
 */
export type LiaAllTalkStatus
  = | { state: 'checking' }
    | { state: 'connected', voices: string[] }
    | { state: 'error', error: string }
    | { state: 'notConfigured' }
    | { state: 'offline' }

/** A synthesis request from the renderer, resolved to a profile in the main process. */
export interface LiaAllTalkSynthesisRequest {
  /** The custom voice profile id - never a path, never a filename. */
  profileId: string
  text: string
  /** BCP-47 tag, e.g. `pt-BR`. Normalized to AllTalk's `pt` in the main process. */
  language?: string
}

/** Outcome of publishing a profile's reference audio into AllTalk's voices folder. */
export type LiaAllTalkSyncResult
  = | { copied: boolean, filename: string, ok: true }
    | { error: LiaVoiceProfileErrorCode | 'notConfigured', message: string, ok: false }

export const electronLiaVoiceConfigGet = defineInvokeEventa<LiaVoiceConfig>('eventa:invoke:lia:voice:config:get')
export const electronLiaVoiceConfigSet = defineInvokeEventa<void, LiaVoiceConfig>('eventa:invoke:lia:voice:config:set')

/**
 * Custom voice library. These manage the profiles themselves; selecting one for
 * playback still goes through `electronLiaVoiceConfigSet`, which stays the only
 * writer of `voice.tts`.
 */
export const electronLiaVoiceProfilesList = defineInvokeEventa<LiaCustomVoiceProfile[]>('eventa:invoke:lia:voice:profiles:list')

/** Opens the OS file picker in the main process. Resolves `null` when cancelled. */
export const electronLiaVoiceProfilesPick = defineInvokeEventa<string[] | null, { extensions: string[], multiple?: boolean, title?: string }>('eventa:invoke:lia:voice:profiles:pick')

export const electronLiaVoiceProfilesImport = defineInvokeEventa<LiaVoiceProfileResult<LiaCustomVoiceProfile>, LiaVoiceProfileImportRequest>('eventa:invoke:lia:voice:profiles:import')

export const electronLiaVoiceProfilesRemove = defineInvokeEventa<LiaVoiceProfileResult<{ id: string }>, { id: string }>('eventa:invoke:lia:voice:profiles:remove')

/**
 * AllTalk runtime.
 *
 * The voices directory is only ever produced by the main process's own
 * `showOpenDialog`: there is no channel through which the renderer can set a
 * path, so a compromised renderer cannot point the sync at an arbitrary folder.
 */
export const electronLiaAllTalkConfigGet = defineInvokeEventa<LiaAllTalkRuntimeConfig>('eventa:invoke:lia:alltalk:config:get')

/** Writes only `baseUrl`/`timeoutMs`. `voicesDir` is ignored here on purpose. */
export const electronLiaAllTalkConfigSet = defineInvokeEventa<LiaAllTalkRuntimeConfig, Partial<LiaAllTalkRuntimeConfig>>('eventa:invoke:lia:alltalk:config:set')

/** Opens the OS directory picker and persists the choice. Resolves `null` on cancel. */
export const electronLiaAllTalkVoicesDirPick = defineInvokeEventa<string | null, { clear?: boolean }>('eventa:invoke:lia:alltalk:voices-dir:pick')

export const electronLiaAllTalkStatus = defineInvokeEventa<LiaAllTalkStatus>('eventa:invoke:lia:alltalk:status')

/** Publishes a profile's reference audio into AllTalk's voices folder. */
export const electronLiaAllTalkSync = defineInvokeEventa<LiaAllTalkSyncResult, { profileId: string }>('eventa:invoke:lia:alltalk:sync')

/** Resolves the profile, publishes it if needed, and returns the generated WAV. */
export const electronLiaAllTalkSynthesize = defineInvokeEventa<ArrayBuffer, LiaAllTalkSynthesisRequest>('eventa:invoke:lia:alltalk:synthesize')

/* --------------------------------------------------------------------------
 * Managed speech runtime
 *
 * The Lia starts and stops the local voice server itself. The renderer only
 * ever asks about state or requests a transition; it never runs a process.
 * -------------------------------------------------------------------------- */

/** Current lifecycle state of the managed voice runtime. */
export const electronLiaRuntimeState = defineInvokeEventa<LiaRuntimeState>('eventa:invoke:lia:runtime:state')

/** Detects the install and, when present, starts it and waits for health. */
export const electronLiaRuntimeStart = defineInvokeEventa<LiaRuntimeState>('eventa:invoke:lia:runtime:start')

/** Stops the managed process. Used by advanced settings and app shutdown. */
export const electronLiaRuntimeStop = defineInvokeEventa<LiaRuntimeState>('eventa:invoke:lia:runtime:stop')

/**
 * OS directory picker for the install location.
 *
 * Like `voicesDir`, the path can only enter the config from here - there is no
 * channel that accepts an install directory from the renderer.
 */
export const electronLiaRuntimeInstallDirPick = defineInvokeEventa<string | null, { clear?: boolean }>('eventa:invoke:lia:runtime:install-dir:pick')

/** The guided install wizard's steps, with completion flags. */
export const electronLiaRuntimeInstallSteps = defineInvokeEventa<LiaRuntimeInstallStep[]>('eventa:invoke:lia:runtime:install-steps')

/**
 * What exists on disk - the install fact, separate from the run fact (Phase 6
 * QA hotfix, item E). The main process answers from the install markers and
 * the persisted install record; the renderer never infers it from server
 * health errors.
 */
export const electronLiaRuntimeInstallState = defineInvokeEventa<{ state: LiaRuntimeInstallState }>('eventa:invoke:lia:runtime:install-state')

/**
 * Emitted by main on every runtime state transition (Phase 6 hotfix: the
 * health-ready that never reached the card).
 *
 * The runtime's own control channels above are pull-only: the renderer asks,
 * and gets one answer. That is enough for a click, and not enough for a
 * server that takes ~75 s to become healthy after an unattended autostart -
 * the store would keep the 'starting' snapshot it read at mount forever.
 * This is the push half of the pair: the state machine emits an event on
 * every transition (it already did, for the log), main republishes the new
 * snapshot here, and the store holds whatever arrives verbatim.
 */
export const electronLiaRuntimeChanged = defineEventa<LiaRuntimeState>('eventa:lia:runtime:changed')

/* --------------------------------------------------------------------------
 * Managed voice runtime: install, repair, remove
 *
 * An install is long-running, so its state is a snapshot the renderer pulls plus
 * an event pushed on every change - the same shape the runtime control above
 * already uses.
 * -------------------------------------------------------------------------- */

/** Current bootstrap state, so a reopened UI resumes instead of guessing. */
export const electronLiaBootstrapState = defineInvokeEventa<LiaBootstrapState>('eventa:invoke:lia:bootstrap:state')

/** Starts install, or repair when the runtime is already present. */
export const electronLiaBootstrapRun = defineInvokeEventa<LiaBootstrapState, boolean>('eventa:invoke:lia:bootstrap:run')

/** Asks a running install to stop at the next step boundary. */
export const electronLiaBootstrapCancel = defineInvokeEventa<void>('eventa:invoke:lia:bootstrap:cancel')

/** Removes only what the Lia installed. */
export const electronLiaBootstrapRemove = defineInvokeEventa<void>('eventa:invoke:lia:bootstrap:remove')

/** Emitted on every bootstrap state change. */
export const electronLiaBootstrapChanged = defineEventa<LiaBootstrapState>('eventa:lia:bootstrap:changed')

/** Engines the current build knows how to drive, with what each expects. */
export const electronLiaVoiceEnginesList = defineInvokeEventa<Array<{ extensions: string[], id: string, label: string, roles: string[] }>>('eventa:invoke:lia:voice:engines:list')

/* --------------------------------------------------------------------------
 * Custom voice engine preparation (Phase 6)
 *
 * Deliberately separate from the bootstrap: installing the voice system is the
 * Lia's responsibility, but downloading the multi-gigabyte, separately-licensed
 * voice-cloning model happens only at an explicit user request. State is pulled,
 * progress is pushed - the same shape as the bootstrap above.
 * -------------------------------------------------------------------------- */

/** How the managed runtime's voice engine is configured, per its own config files. */
export interface LiaCustomVoiceEngineState {
  /** The engine the server will load (e.g. 'xtts', 'piper'); undefined when unknown. */
  engine?: string
  /** `true` only when engine, model files and first-run flag all agree. */
  ready: boolean
  /** The upstream interactive first-run prompt is still armed: a start would time out. */
  firstRunPending: boolean
  /** Every file of the pin's xtts model set is on disk. */
  modelComplete: boolean
  /** How many model files are missing, for diagnostics that want more than a flag. */
  missingModelFiles: number
  /** A config file could not be parsed; carries its display name. */
  parseError?: string
}

/** Prepare phases. `error` carries `detail`; a cancelled run says so too. */
export type LiaCustomVoicePreparePhase
  = | 'checking'
    | 'enabling-first-run'
    | 'downloading'
    | 'verifying'
    | 'ready'
    | 'error'
    | 'cancelled'

export interface LiaCustomVoicePrepareState {
  phase: LiaCustomVoicePreparePhase
  /** A human sentence, safe to show. Never a path, never a URL, never a stack. */
  detail?: string
}

/** Reads the engine configuration of the managed runtime. */
export const electronLiaCustomVoiceEngineState = defineInvokeEventa<LiaCustomVoiceEngineState>('eventa:invoke:lia:custom-voice:engine-state')

/** Runs the documented upstream download for the voice-cloning model. */
export const electronLiaCustomVoicePrepare = defineInvokeEventa<LiaCustomVoicePrepareState>('eventa:invoke:lia:custom-voice:prepare')

/** Asks a running prepare to stop - the download child is actually killed. */
export const electronLiaCustomVoiceCancel = defineInvokeEventa<void>('eventa:invoke:lia:custom-voice:cancel')

/** Emitted on every prepare state change. */
export const electronLiaCustomVoiceChanged = defineEventa<LiaCustomVoicePrepareState>('eventa:lia:custom-voice:changed')

export { electron } from '@proj-airi/electron-eventa'
export * from '@proj-airi/electron-eventa/electron-updater'
