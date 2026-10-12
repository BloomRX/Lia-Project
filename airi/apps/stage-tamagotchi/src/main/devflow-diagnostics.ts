/**
 * DEVFLOW-ONLY runtime evidence for the Lia development autopilot.
 *
 * The M3.0b round exists because the Stage once showed a taskbar icon with NO
 * visible Lia surface: a stale `core-agent/dist` made the renderer fail to
 * instantiate its modules. A dev-server "ready in ..." line proves none of
 * that, and neither does a taskbar icon. So the automatic gate needs proof of
 * three distinct facts, each from the place that actually knows it:
 *
 *   renderer=ready       the renderer document finished loading
 *   window=visible       the BrowserWindow is verified visible (isVisible())
 *   renderer-app=mounted the ROOT Vue app mounted
 *   avatar-scene=mounted the Stage scene component mounted its renderer
 *
 * The last two are deliberately separate facts. `createApp(App).mount('#app')`
 * proves the root app mounted; it does NOT prove an avatar was loaded or drawn.
 * Only the Stage scene component knows that, so the avatar claim comes from
 * there and the root-mount claim is named for what it actually is.
 *
 * Everything here is inert unless the launcher was started with
 * `LIA_DEVFLOW_DIAGNOSTICS=1`, which only the DevFlow autopilot sets. Outside
 * that flag no listener is registered, nothing is logged, and product behaviour
 * is byte-for-byte what it was.
 *
 * Metadata only, by contract: these lines carry a state name and nothing else.
 * No prompts, no images, no user messages, no keys, no vault data.
 */
import process from 'node:process'

import { ipcMain } from 'electron'

export const LIA_DEVFLOW_DIAGNOSTICS_ENV = 'LIA_DEVFLOW_DIAGNOSTICS'

/** Channel the renderer uses to report that the ROOT Vue app mounted. */
export const LIA_DEVFLOW_APP_MOUNTED_CHANNEL = 'lia-devflow:app-mounted'

/**
 * Channel the STAGE SCENE component uses to report that it mounted. This is the
 * only source allowed to back the avatar-scene claim.
 */
export const LIA_DEVFLOW_SCENE_MOUNTED_CHANNEL = 'lia-devflow:scene-mounted'

const emitted = new Set<string>()

export function liaDevflowDiagnosticsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[LIA_DEVFLOW_DIAGNOSTICS_ENV] === '1'
}

/**
 * Emits one marker, at most once per name. Idempotent, because a window can
 * re-show and a renderer can reload without that being new evidence.
 */
export function liaDevflowMark(marker: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!liaDevflowDiagnosticsEnabled(env))
    return false
  if (emitted.has(marker))
    return false
  emitted.add(marker)
  console.info(`lia-stage ${marker}`)
  return true
}

/** Test seam: forget which markers were already emitted. */
export function __resetLiaDevflowMarksForTest(): void {
  emitted.clear()
}

/**
 * Registers the renderer -> main bridge. Only ever called in DevFlow mode, so
 * a normal launch has no listener at all.
 */
export function registerLiaDevflowSceneBridge(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!liaDevflowDiagnosticsEnabled(env))
    return false
  // Two distinct claims, from two distinct senders. A root mount can never
  // satisfy the avatar-scene marker, and the scene component is not consulted
  // about the root.
  ipcMain.on(LIA_DEVFLOW_APP_MOUNTED_CHANNEL, () => {
    liaDevflowMark('renderer-app=mounted', env)
  })
  ipcMain.on(LIA_DEVFLOW_SCENE_MOUNTED_CHANNEL, () => {
    liaDevflowMark('avatar-scene=mounted', env)
  })
  return true
}
