/**
 * Phase 7.2 managed stage handoff - tests A and B of the hotfix brief.
 *
 * A: with LIA_MANAGED=1 the legacy launcher shell (/home) is bypassed and
 *    the main window lands directly on the companion route ('/').
 * B: without LIA_MANAGED the standalone developer behavior is preserved -
 *    the window still lands on the Lia Home exactly as before.
 */
import { describe, expect, it } from 'vitest'

import { initialMainWindowContext, initialMainWindowRoute, MANAGED_MAIN_WINDOW_ROUTE, STANDALONE_MAIN_WINDOW_ROUTE } from './initial-route'

describe('initialMainWindowRoute - Phase 7.2 managed handoff', () => {
  it('test A: LIA_MANAGED=1 selects the companion route, bypassing the legacy launcher', () => {
    expect(initialMainWindowRoute({ LIA_MANAGED: '1' })).toBe(MANAGED_MAIN_WINDOW_ROUTE)
    expect(MANAGED_MAIN_WINDOW_ROUTE).toBe('/')
    expect(MANAGED_MAIN_WINDOW_ROUTE).not.toBe('/home')
  })

  it('test B: without LIA_MANAGED the standalone launcher shell is preserved', () => {
    expect(initialMainWindowRoute({})).toBe(STANDALONE_MAIN_WINDOW_ROUTE)
    expect(STANDALONE_MAIN_WINDOW_ROUTE).toBe('/home')
    // Anything but the exact marker is NOT managed: '0', 'true', blanks.
    for (const value of ['0', 'true', '', ' 1', '1 ']) {
      expect(initialMainWindowRoute({ LIA_MANAGED: value })).toBe(STANDALONE_MAIN_WINDOW_ROUTE)
    }
  })

  it('the window-sizing context follows the same switch: companion never opens at launcher size', () => {
    expect(initialMainWindowContext({ LIA_MANAGED: '1' })).toBe('stage')
    expect(initialMainWindowContext({})).toBe('home')
  })
})
