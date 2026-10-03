import type { NavigationGuard } from 'vue-router'

/**
 * Phase 7.3, managed routing contract (QA items 2-4).
 *
 * The legacy Lia Home (`/home`) is the STANDALONE launcher shell. Under
 * LIA_MANAGED it is not a valid user destination at all - the Lia App IS
 * the launcher - so "Home" inside the companion must mean the companion's
 * Stage view ('/'), never the shell it bypassed at boot.
 *
 * ONE central policy, enforced as a single router guard: every navigation
 * shape collapses through it - buttons, tray links, programmatic push,
 * direct hash URLs, and browser-style back/forward (history entries are
 * intercepted before the guard ever lets them render).
 */
export const LEGACY_LAUNCHER_ROUTE = '/home'
export const MANAGED_COMPANION_ROUTE = '/'

/** The one managed-route rule, pure and testable. */
export function managedRouteRedirect(path: string, managed: boolean): string | undefined {
  if (!managed)
    return undefined
  return path === LEGACY_LAUNCHER_ROUTE ? MANAGED_COMPANION_ROUTE : undefined
}

/** vue-router `beforeEach` form of {@link managedRouteRedirect}. */
export function managedRoutePolicyGuard(managed: boolean): NavigationGuard {
  return (to) => {
    const redirect = managedRouteRedirect(to.path, managed)
    // `replace` keeps the legacy shell OUT of the history stack: back/forward
    // can never resurrect it (brief item E).
    return redirect ? { path: redirect, replace: true } : true
  }
}
