import type { BrowserWindow, Rectangle } from 'electron'

import { screen } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import {
  createMainWindowContextSizing,
  HOME_WINDOW_PRESET,
  MAIN_WINDOW_MIN_SIZE,
  resolveContextBounds,
  STAGE_WINDOW_PRESET,
} from './window-sizing'

// NOTICE:
// The module imports `screen` from 'electron' at top level (only used by the
// live-window controller), so we stub it here so unit tests can run headless.
// See apps/stage-tamagotchi/src/main/windows/shared/display.test.ts
vi.mock('electron', () => ({
  screen: {
    getDisplayMatching: vi.fn(),
  },
}))

const workArea: Rectangle = { x: 0, y: 0, width: 1280, height: 720 }

function recenter(context: 'home' | 'stage', overrideSize?: { width?: number, height?: number } | null) {
  return resolveContextBounds({
    context,
    currentBounds: { x: 0, y: 0, width: 400, height: 600 },
    workArea,
    overrideSize,
    recenter: true,
  })
}

describe('resolveContextBounds', () => {
  it('applies the Home preset when there is no persisted override', () => {
    const bounds = recenter('home', null)
    expect(bounds.width).toBe(HOME_WINDOW_PRESET.width)
    expect(bounds.height).toBe(HOME_WINDOW_PRESET.height)
    expect(bounds.x).toBe(Math.round((workArea.width - HOME_WINDOW_PRESET.width) / 2))
    expect(bounds.y).toBe(Math.round((workArea.height - HOME_WINDOW_PRESET.height) / 2))
  })

  it('applies the Stage preset and keeps it fully centered inside the work area', () => {
    const tallWorkArea: Rectangle = { x: 0, y: 0, width: 1600, height: 1200 }
    const bounds = resolveContextBounds({
      context: 'stage',
      currentBounds: { x: 0, y: 0, width: 800, height: 1000 },
      workArea: tallWorkArea,
      overrideSize: null,
      recenter: true,
    })
    expect(bounds.width).toBe(STAGE_WINDOW_PRESET.width)
    expect(bounds.height).toBe(STAGE_WINDOW_PRESET.height)
    expect(bounds.x).toBe(Math.round((tallWorkArea.width - STAGE_WINDOW_PRESET.width) / 2))
    expect(bounds.y).toBe(Math.round((tallWorkArea.height - STAGE_WINDOW_PRESET.height) / 2))
  })

  it('never exceeds the work area (clamps oversized presets/overrides)', () => {
    const smallWorkArea: Rectangle = { x: 0, y: 0, width: 600, height: 520 }
    const bounds = resolveContextBounds({
      context: 'stage',
      currentBounds: { x: 0, y: 0, width: 800, height: 1000 },
      workArea: smallWorkArea,
      overrideSize: null,
      recenter: true,
    })
    expect(bounds.width).toBeLessThanOrEqual(smallWorkArea.width)
    expect(bounds.height).toBeLessThanOrEqual(smallWorkArea.height)
  })

  it('prefers a persisted per-mode override over the preset', () => {
    const bounds = recenter('home', { width: 520, height: 700 })
    expect(bounds.width).toBe(520)
    expect(bounds.height).toBe(700)
  })

  it('enforces the minimum size floor', () => {
    const bounds = recenter('stage', { width: 100, height: 100 })
    expect(bounds.width).toBe(MAIN_WINDOW_MIN_SIZE.width)
    expect(bounds.height).toBe(MAIN_WINDOW_MIN_SIZE.height)
  })

  it('keeps the top-left and only nudges it when the mode does not fit when not recentering', () => {
    // Window sits near the top-right; enlarging to Stage would overflow the
    // right edge, so x is pulled left to keep it fully on-screen.
    const bounds = resolveContextBounds({
      context: 'stage',
      currentBounds: { x: 1000, y: 0, width: 280, height: 600 },
      workArea,
      overrideSize: null,
      recenter: false,
    })
    expect(bounds.width).toBe(STAGE_WINDOW_PRESET.width)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(workArea.x + workArea.width)
    expect(bounds.y).toBeGreaterThanOrEqual(workArea.y)
  })
})

/** Big work area so the Stage preset (800×1000) is never clamped in these tests. */
const bigWorkArea: Rectangle = { x: 0, y: 0, width: 1920, height: 1200 }

function makeWindowController(initialSize: { width: number, height: number }) {
  let bounds: Rectangle = { x: 100, y: 100, width: initialSize.width, height: initialSize.height }
  const win = {
    getBounds: (): Rectangle => ({ ...bounds }),
    setBounds: (next: Rectangle): void => {
      bounds = { ...next }
    },
    // Simulates a user/OS resize producing a window 'resize' event.
    _forceSize: (width: number, height: number): void => {
      bounds = { ...bounds, width, height }
    },
  }
  return win
}

describe('createMainWindowContextSizing persistence', () => {
  function setup(seed?: { home?: { width?: number, height?: number }, stage?: { width?: number, height?: number } }) {
    let state = seed ?? {}
    const config = {
      get: () => state,
      update: (next: unknown) => {
        state = next as typeof state
      },
    }
    // Mock: any display reports the big work area.
    vi.mocked(screen.getDisplayMatching).mockImplementation((() => ({ workArea: { ...bigWorkArea } })) as never)

    const win = makeWindowController({ width: HOME_WINDOW_PRESET.width, height: HOME_WINDOW_PRESET.height })
    const sizing = createMainWindowContextSizing({
      window: win as unknown as BrowserWindow,
      config: config as never,
    })
    return { sizing, config, win }
  }

  it('never persists a resize before user-resize capture is armed (startup transient)', () => {
    const { sizing, config, win } = setup({ home: { width: 520, height: 700 } })
    // Startup: apply persisted Home override, but do NOT arm yet.
    sizing.setContext('home', { recenter: true })
    expect(config.get()).toEqual({ home: { width: 520, height: 700 } })

    // A transient startup resize to the preset must NOT clobber the Home override.
    win._forceSize(HOME_WINDOW_PRESET.width, HOME_WINDOW_PRESET.height)
    sizing.captureUserBounds()
    expect(config.get()).toEqual({ home: { width: 520, height: 700 } })
  })

  it('persists a Home user resize only once armed', () => {
    const { sizing, config, win } = setup({ home: { width: 520, height: 700 } })
    // not armed yet -> no writes
    win._forceSize(900, 900)
    sizing.captureUserBounds()
    expect(config.get()).toEqual({ home: { width: 520, height: 700 } })

    sizing.armUserResizeCapture()
    win._forceSize(560, 760)
    sizing.captureUserBounds()
    expect(config.get().home).toEqual({ width: 560, height: 760 })
  })

  it('splits per-mode and never lets Stage overwrite Home or vice-versa', () => {
    const { sizing, config, win } = setup()
    sizing.armUserResizeCapture()

    // Home: user resizes to 560×760.
    win._forceSize(560, 760)
    sizing.captureUserBounds()
    expect(config.get().home).toEqual({ width: 560, height: 760 })

    // Navigate to Stage: programmatic resize tail is suppressed (no stage override yet).
    sizing.setContext('stage')
    sizing.captureUserBounds()
    expect(config.get().stage).toBeUndefined()
    expect(config.get().home).toEqual({ width: 560, height: 760 })

    // Stage: user resizes to 900×1100 -> only stage override written.
    win._forceSize(900, 1100)
    sizing.captureUserBounds()
    expect(config.get().stage).toEqual({ width: 900, height: 1100 })
    expect(config.get().home).toEqual({ width: 560, height: 760 })
  })

  it('restores the persisted override on setContext', () => {
    const { sizing, win } = setup({ home: { width: 520, height: 700 } })
    win._forceSize(HOME_WINDOW_PRESET.width, HOME_WINDOW_PRESET.height)
    sizing.setContext('home', { recenter: true })
    expect(win.getBounds().width).toBe(520)
    expect(win.getBounds().height).toBe(700)
  })
})
