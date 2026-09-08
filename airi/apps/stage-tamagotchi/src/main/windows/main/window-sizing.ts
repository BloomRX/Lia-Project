import type { BrowserWindow, Rectangle } from 'electron'

import type { Config } from '../../libs/electron/persistence'

import { screen } from 'electron'
import { number, object, optional } from 'valibot'

/**
 * Window "modes" of the Lia main window. Both the launcher Home (`/home`) and
 * the character Stage (`/`) live in the same Electron BrowserWindow; each mode
 * has its own preferred size so one mode never leaks its bounds into the other.
 */
export type MainWindowContext = 'home' | 'stage'

export interface WindowSizePreset {
  width: number
  height: number
}

/**
 * Conservative Lia presets in logical CSS pixels (Electron DIP). They are only
 * the *requested* size — the active display work area is always consulted and
 * the window is clamped/centered at apply time, so no single preset is assumed
 * to fit every monitor/DPI.
 *
 * - Home is a compact launcher: a little larger than the historical 450×600 so
 *   the TitleBar + launcher stack has comfortable breathing room (still small).
 * - Stage is an immersive character scene and benefits from a larger portrait
 *   canvas, but stays well under a full-screen overlay.
 */
export const HOME_WINDOW_PRESET: WindowSizePreset = { width: 460, height: 640 }
export const STAGE_WINDOW_PRESET: WindowSizePreset = { width: 800, height: 1000 }

/**
 * Hard floor (native min too) so manual/frameless resizing never shrinks the
 * window into something unusable, on either mode.
 */
export const MAIN_WINDOW_MIN_SIZE: WindowSizePreset = { width: 360, height: 480 }

const sizeRecord = object({
  width: optional(number()),
  height: optional(number()),
})

export interface LiaWindowSizeRecord {
  width?: number
  height?: number
}

/** Persists only the user's *size* per mode (never the other mode's). */
export const liaMainWindowStateSchema = object({
  home: optional(sizeRecord),
  stage: optional(sizeRecord),
})

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Computes the concrete bounds for a window mode, purely (no Electron runtime),
 * so it is unit-testable.
 *
 * Rules:
 * - preferred size = the persisted per-mode user size when present, else the mode preset;
 * - size is clamped to [MIN, work area] so the window never exceeds the screen
 *   or becomes unusably small;
 * - `recenter` centers within the work area; otherwise the current top-left is
 *   kept and only nudged/clamped so the whole window stays on the active display.
 */
export function resolveContextBounds(params: {
  context: MainWindowContext
  currentBounds: Rectangle
  workArea: Rectangle
  overrideSize?: LiaWindowSizeRecord | null
  recenter: boolean
}): Rectangle {
  const preset = params.context === 'home' ? HOME_WINDOW_PRESET : STAGE_WINDOW_PRESET
  const override = params.overrideSize

  const preferredWidth = typeof override?.width === 'number' ? override.width : preset.width
  const preferredHeight = typeof override?.height === 'number' ? override.height : preset.height

  const width = Math.round(clamp(preferredWidth, MAIN_WINDOW_MIN_SIZE.width, params.workArea.width))
  const height = Math.round(clamp(preferredHeight, MAIN_WINDOW_MIN_SIZE.height, params.workArea.height))

  let x: number
  let y: number

  if (params.recenter) {
    x = params.workArea.x + Math.round((params.workArea.width - width) / 2)
    y = params.workArea.y + Math.round((params.workArea.height - height) / 2)
  }
  else {
    const maxX = params.workArea.x + params.workArea.width - width
    const maxY = params.workArea.y + params.workArea.height - height
    x = Math.round(clamp(params.currentBounds.x, params.workArea.x, Math.max(params.workArea.x, maxX)))
    y = Math.round(clamp(params.currentBounds.y, params.workArea.y, Math.max(params.workArea.y, maxY)))
  }

  return { x, y, width, height }
}

export interface MainWindowContextSizing {
  /** Applies the requested mode's bounds to the live window (recenters on demand). */
  setContext(context: MainWindowContext, options?: { recenter?: boolean }): void
  /** Records the current window size against the active mode (user resize). */
  captureUserBounds(): void
  /** Enables persistence of user resizes (called once the window is shown/settled). */
  armUserResizeCapture(): void
  /** Read-only: the mode the main window is currently sized for. */
  getContext(): MainWindowContext
}

/**
 * Owns per-mode sizing for the single main window.
 *
 * - `setContext` switches the window to the mode's size (per-mode override or
 *   preset), staying on the active display.
 * - `captureUserBounds` stores the current size on the *active* mode only, so
 *   resizing in Home never contaminates the Stage size and vice-versa.
 *
 * Only *user* resizes are persisted. Programmatic resizes are never written:
 * - At startup the window is created at the Home preset and `setContext` applies
 *   the persisted override; a `resize` event can still fire while the window
 *   momentarily reflects the construction preset. If we captured unconditionally
 *   with mode = `home`, that transient would overwrite the saved Home override
 *   with the preset (Stage never suffers this because it is only resized when the
 *   user navigates, explaining the original Home-vs-Stage asymmetry). Capture is
 *   therefore only armed after the window is shown (`armUserResizeCapture`), and
 *   the resize tails produced by our own `setContext` are suppressed.
 */
export function createMainWindowContextSizing(params: {
  window: BrowserWindow
  config: Config<typeof liaMainWindowStateSchema>
}): MainWindowContextSizing {
  let currentContext: MainWindowContext = 'home'
  /** Bounds our own `setContext` most recently asked for (to ignore its resize tail). */
  let programmaticTarget: Rectangle | null = null
  let userResizeCaptureArmed = false

  function persistedSize(context: MainWindowContext): LiaWindowSizeRecord | null | undefined {
    const state = params.config.get() ?? {}
    return context === 'home' ? state.home : state.stage
  }

  function setContext(context: MainWindowContext, options: { recenter?: boolean } = {}): void {
    const recenter = options.recenter ?? false
    currentContext = context
    const currentBounds = params.window.getBounds()
    const bounds = resolveContextBounds({
      context,
      currentBounds,
      workArea: screen.getDisplayMatching(currentBounds).workArea,
      overrideSize: persistedSize(context),
      recenter,
    })
    programmaticTarget = bounds
    params.window.setBounds(bounds)
  }

  function captureUserBounds(): void {
    const bounds = params.window.getBounds()
    // Ignore the async resize tail of our own `setContext` so a programmatic
    // mode switch never writes (or clobbers) an override.
    if (
      programmaticTarget
      && Math.round(bounds.width) === Math.round(programmaticTarget.width)
      && Math.round(bounds.height) === Math.round(programmaticTarget.height)
    ) {
      programmaticTarget = null
      return
    }
    programmaticTarget = null

    // Before the window is shown/settled, resize events may still reflect the
    // construction preset; never let those persist an override.
    if (!userResizeCaptureArmed) {
      return
    }

    const state = params.config.get() ?? {}
    const entry: LiaWindowSizeRecord = {
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    }
    params.config.update(currentContext === 'home' ? { ...state, home: entry } : { ...state, stage: entry })
  }

  function armUserResizeCapture(): void {
    userResizeCaptureArmed = true
  }

  function getContext(): MainWindowContext {
    return currentContext
  }

  return { setContext, captureUserBounds, armUserResizeCapture, getContext }
}
