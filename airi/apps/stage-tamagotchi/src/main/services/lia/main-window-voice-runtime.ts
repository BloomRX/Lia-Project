/**
 * Phase 7.9E.4: the Lia voice runtime now starts at the WINDOW-CREATION
 * seam, killing the renderer<->main registration race.
 *
 * THE OLD RACE (real-Window QA, 7.9E.3 diag): the Lia voice bridge was an
 * `injeca.invoke` depending on the `windows:main` provider - which only
 * resolves after setupMainWindow() returns, i.e. AFTER the renderer load
 * begins. The managed renderer's startup greeting could therefore invoke
 * `electronLiaVoiceStatus` BEFORE any main-process handler existed; the
 * invoke stayed pending forever (voice-status-invoke-start with no invoke
 * -end) and the greeting never reached speech-host / claim / TTS.
 *
 * THE NEW ORDER (structurally guaranteed): setupMainWindow() calls its
 * `onWindowCreated` hook immediately after `new BrowserWindow(...)` and
 * BEFORE `load(...)`; this function runs inside that hook, so by the time
 * any renderer code can execute, these invoke handlers already exist:
 *
 *   BrowserWindow created
 *     -> Lia voice bridge (status / synthesize / config surface)
 *     -> capabilities bridge
 *     -> managed voice prewarm (fire-and-forget)
 *     -> startup-greeting claim latch
 *     -> renderer load begins
 *
 * Exactly ONE voice service / engine set / greeting latch exists per Stage
 * main-process lifetime (one main window, one hook call). The window-bound
 * Eventa context is intentionally unchanged in shape: `createContext(ipcMain,
 * window)` is what lets outbound pushes (capability invalidation on
 * `webContents.send`) work - the window object is fully available right
 * after construction, only the PROVIDER resolution used to be late. No
 * context split was needed.
 *
 * Prewarm stays managed-only, async, engine-owned, failure-nonfatal.
 */

import type { BrowserWindow } from 'electron'

import { resolveVoiceRuntimeHome } from '@lia/core/bootstrap/runtime-root'
import { readVoiceRuntimeSelection } from '@lia/core/voice/config'
import { createKokoroVoiceEngine } from '@lia/core/voice/engines/kokoro'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { app, ipcMain } from 'electron'

import { registerLiaCapabilitiesBridge } from './lia-capabilities'
import { isLauncherManaged } from './lia-managed'
import { registerLiaVoiceBridge } from './lia-voice-service'
import { registerLiaStartupGreetingBridge } from './startup-greeting'
import { prewarmManagedVoice } from './voice-prewarm'

export interface LiaMainWindowVoiceRuntimeParams {
  /** The JUST-CONSTRUCTED main window (load has not started yet). */
  window: BrowserWindow
  /** Same handles the old injeca block received - one per process. */
  liaProductConfig: Parameters<typeof registerLiaVoiceBridge>[0]['liaProductConfig']
  liaVoiceProfiles: Parameters<typeof registerLiaVoiceBridge>[0]['store']
  log?: (line: string) => void
}

export function startLiaMainWindowVoiceRuntime(params: LiaMainWindowVoiceRuntimeParams): void {
  const log = params.log ?? (line => console.info(line))

  // The window is NOT optional here. The electron main adapter forwards
  // outbound events through `window.webContents.send`; without a window it
  // can only *reply* to an incoming invoke, so a spontaneous push - a
  // bootstrap's live install progress, from its `onStateChange` - is
  // silently dropped and the panel never changes until the run returns.
  const { context } = createContext(ipcMain, params.window)

  // Phase 7.9C: the engines this build ships, constructed at the HOST
  // seam. The bridge/renderer/service never name an engine; the engine
  // owns its runtime tree under the engine-neutral home (with the
  // optional product-config override) and starts lazily on first use.
  const userDataDir = app.getPath('userData')
  const engines = [
    createKokoroVoiceEngine({
      installDirOverride: () => readVoiceRuntimeSelection(params.liaProductConfig.get()?.voice).installDir,
      runtimeHome: () => resolveVoiceRuntimeHome({ userDataDir }),
    }),
  ]

  // Capability invalidation is circular-by-nature: the voice bridge
  // fires the change, the capability probe recomputes. A late-bound ref
  // keeps the registration order honest.
  let invalidateCapabilities: (() => void) | undefined
  const voiceBridge = registerLiaVoiceBridge({
    context,
    engines,
    liaProductConfig: params.liaProductConfig,
    onVoiceAvailabilityChanged: () => invalidateCapabilities?.(),
    store: params.liaVoiceProfiles,
  })

  const capabilities = registerLiaCapabilitiesBridge({
    context,
    liaProductConfig: { get: () => params.liaProductConfig.get() },
    store: params.liaVoiceProfiles,
    voiceAvailable: voiceBridge.voiceAvailable,
  })
  invalidateCapabilities = capabilities.invalidate

  // Phase 7.9E, item 1: a real MANAGED launch hides the engine cold
  // start behind the Stage boot. Fire-and-forget by construction - this
  // hook (and the whole boot) is not delayed one millisecond by warming.
  // Failure degrades to voice-unavailable + diagnostics; a settle
  // refreshes the capability truth so the warmed engine becomes visible
  // without any user action. Standalone launches keep the lazy start
  // untouched.
  const prewarm = prewarmManagedVoice({
    engines,
    log: record => log(Object.entries(record).map(([key, value]) => `${key}=${String(value)}`).join(' ')),
    managedLaunch: isLauncherManaged(),
    onSettled: () => voiceBridge.voiceChanged(),
  })
  void prewarm.settled

  // Phase 7.9E, item 3: the exactly-once startup-greeting latch lives in
  // this process - it IS the launch. Registered once, engine-blind.
  registerLiaStartupGreetingBridge({ context, managedLaunch: isLauncherManaged() })
}
