import type { Rectangle } from 'electron'

import { describe, expect, it, vi } from 'vitest'

import {
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
