import type { LiaWindowSizeRecord, MainWindowContext, MainWindowContextSizing, liaMainWindowStateSchema } from './window-sizing'
import type { Config } from '../../libs/electron/persistence'

import { describe, expect, it, vi } from 'vitest'

import { createMainWindowSizeSettingsController } from './window-size-settings'

interface SizeState {
  home?: LiaWindowSizeRecord
  stage?: LiaWindowSizeRecord
}

function setup(seed: SizeState = {}, activeMode: MainWindowContext = 'stage') {
  let state: SizeState = { ...seed }
  let setContextCalls = 0

  const config = {
    get: () => state,
    update: (next: SizeState) => {
      state = next
    },
  } as unknown as Config<typeof liaMainWindowStateSchema>

  const sizing: MainWindowContextSizing = {
    setContext: vi.fn(() => {
      setContextCalls += 1
    }),
    captureUserBounds: vi.fn(),
    armUserResizeCapture: vi.fn(),
    getContext: () => activeMode,
  }

  const controller = createMainWindowSizeSettingsController({ sizing, config })
  return { controller, config: { read: () => state }, setContextCalls: () => setContextCalls }
}

describe('createMainWindowSizeSettingsController', () => {
  it('reports null overrides (fall back to preset) and the active mode', () => {
    const { controller } = setup({}, 'home')
    expect(controller.getSnapshot()).toEqual({ activeMode: 'home', home: null, stage: null })
  })

  it('surfaces existing persisted overrides in the snapshot', () => {
    const { controller } = setup({ home: { width: 400, height: 560 }, stage: { width: 800, height: 1000 } }, 'stage')
    expect(controller.getSnapshot()).toEqual({
      activeMode: 'stage',
      home: { width: 400, height: 560 },
      stage: { width: 800, height: 1000 },
    })
  })

  it('writes an override for a non-active mode without resizing the live window', () => {
    const { controller, config, setContextCalls } = setup({}, 'stage')
    controller.setInitialSize('home', { width: 400, height: 560 })
    expect(config.read()).toEqual({ home: { width: 400, height: 560 } })
    expect(config.read().stage).toBeUndefined()
    expect(setContextCalls()).toBe(0)
  })

  it('re-applies the live window when the edited mode is the one currently shown', () => {
    const { controller, config, setContextCalls } = setup({}, 'stage')
    controller.setInitialSize('stage', { width: 800, height: 1000 })
    expect(config.read().stage).toEqual({ width: 800, height: 1000 })
    expect(setContextCalls()).toBe(1)
  })

  it('clears the override (restore default) and never touches the other mode', () => {
    const { controller, config } = setup({ home: { width: 400, height: 560 }, stage: { width: 800, height: 1000 } }, 'stage')
    controller.setInitialSize('home', null)
    expect(config.read()).toEqual({ stage: { width: 800, height: 1000 } })
    expect(config.read().home).toBeUndefined()
  })
})
