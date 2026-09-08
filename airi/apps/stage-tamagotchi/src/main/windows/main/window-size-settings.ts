import type { Config } from '../../libs/electron/persistence'

import type {
  LiaWindowSizeRecord,
  MainWindowContext,
  MainWindowContextSizing,
  liaMainWindowStateSchema,
} from './window-sizing'

/**
 * Settings-facing view over the main window's per-mode size. It deliberately
 * exposes NO new persistence: the "configured initial size" IS the existing
 * per-mode override that `resolveContextBounds` already prefers over the preset,
 * and which a user's manual resize also updates (`captureUserBounds`). So
 * Settings and manual resize share one field and the precedence is simply "the
 * most recent explicit action wins" (Model A, approved design).
 */
export interface MainWindowSizeSettingsSnapshot {
  /** Mode the main window is currently sized for (used to apply live only there). */
  activeMode: MainWindowContext
  /** Persisted Home size override, or null when it falls back to the preset. */
  home: LiaWindowSizeRecord | null
  /** Persisted Stage size override, or null when it falls back to the preset. */
  stage: LiaWindowSizeRecord | null
}

export interface MainWindowSizeSettingsController {
  /** Current per-mode overrides + the active main-window mode. */
  getSnapshot(): MainWindowSizeSettingsSnapshot
  /**
   * Writes a mode's initial-size override (or clears it when `size` is null →
   * falls back to the built-in preset). If that mode is the one currently shown,
   * re-applies the new bounds live so the change is immediately visible.
   */
  setInitialSize(mode: MainWindowContext, size: { width: number, height: number } | null): void
}

export function createMainWindowSizeSettingsController(params: {
  sizing: MainWindowContextSizing
  config: Config<typeof liaMainWindowStateSchema>
}): MainWindowSizeSettingsController {
  function getSnapshot(): MainWindowSizeSettingsSnapshot {
    const state = params.config.get() ?? {}
    return {
      activeMode: params.sizing.getContext(),
      home: state.home ?? null,
      stage: state.stage ?? null,
    }
  }

  function setInitialSize(mode: MainWindowContext, size: { width: number, height: number } | null): void {
    const state = params.config.get() ?? {}
    const next = mode === 'home'
      ? { ...state, home: size ?? undefined }
      : { ...state, stage: size ?? undefined }
    params.config.update(next)

    // Only touch the live window when the edited mode is the one being shown;
    // otherwise the new size applies at the next switch/open of that mode.
    if (params.sizing.getContext() === mode) {
      params.sizing.setContext(mode)
    }
  }

  return { getSnapshot, setInitialSize }
}
