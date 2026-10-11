/**
 * DEVFLOW-ONLY runtime evidence for the Lia development autopilot.
 *
 * The M3.0b round exists because the Stage once showed a taskbar icon with NO
 * visible Lia surface: a stale `core-agent/dist` made the renderer fail to
 * instantiate its modules. A dev-server "ready in ..." line proves none of
 * that, and neither does a taskbar icon. So the automatic gate needs proof of
 * three distinct facts, each from the place that actually knows it:
 *
 *   renderer=ready      the renderer document finished loading
 *   window=visible      the BrowserWindow really reached the shown state
 *   avatar-scene=mounted the Vue app mounted, i.e. modules really instantiated
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

/** Channel the renderer uses to report that its scene graph mounted. */
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
  ipcMain.on(LIA_DEVFLOW_SCENE_MOUNTED_CHANNEL, () => {
    liaDevflowMark('avatar-scene=mounted', env)
  })
  return true
}
