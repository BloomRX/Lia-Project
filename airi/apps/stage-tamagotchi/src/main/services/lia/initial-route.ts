import process from 'node:process'

import { isLauncherManaged } from './lia-managed'

/**
 * Phase 7.2, managed AIRI stage handoff (QA items 1-4).
 *
 * The standalone stage opens on the legacy Lia Home (`/home`) - the
 * launcher shell with its own avatar, "Conversar", config panels. When the
 * Lia App spawns the stage (LIA_MANAGED=1) that shell is the WRONG product:
 * the Lia Launcher already IS the launcher, and the stage's job is to be
 * the companion - directly, with no second "Conversar" button and no
 * duplicate setup UI.
 *
 * Managed therefore starts at the companion route ('/', the desktop stage
 * in pages/index.vue). Standalone keeps '/home' exactly as today. This is
 * the ONLY place the initial route is decided, pure and electron-free so
 * the contract stays unit-testable.
 */
export const MANAGED_MAIN_WINDOW_ROUTE = '/'
export const STANDALONE_MAIN_WINDOW_ROUTE = '/home'

export function initialMainWindowRoute(env: NodeJS.ProcessEnv = process.env): string {
  return isLauncherManaged(env)
    ? MANAGED_MAIN_WINDOW_ROUTE
    : STANDALONE_MAIN_WINDOW_ROUTE
}

/**
 * The matching initial window-sizing context ('home' | 'stage'): the
 * companion must never open at the small launcher preset (460x640).
 */
export function initialMainWindowContext(env: NodeJS.ProcessEnv = process.env): 'home' | 'stage' {
  return isLauncherManaged(env) ? 'stage' : 'home'
}
