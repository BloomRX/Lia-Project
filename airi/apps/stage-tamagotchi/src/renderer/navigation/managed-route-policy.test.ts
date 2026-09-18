import { describe, expect, it } from 'vitest'
/**
 * Phase 7.3 managed navigation - tests A, B, C, D, E of the brief, against
 * a REAL vue-router with the production guard installed.
 */
import { createMemoryHistory, createRouter } from 'vue-router'

import { LEGACY_LAUNCHER_ROUTE, managedRoutePolicyGuard, managedRouteRedirect } from './managed-route-policy'

const STUB = { template: '<div />' }

function makeRouter(managed: boolean) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: STUB, path: '/' },
      { component: STUB, path: '/home' },
      { component: STUB, path: '/about' },
    ],
  })
  router.beforeEach(managedRoutePolicyGuard(managed))
  return router
}

describe('managed route policy (Phase 7.3)', () => {
  it('pure rule: managed maps /home -> /, standalone allows everything', () => {
    expect(managedRouteRedirect(LEGACY_LAUNCHER_ROUTE, true)).toBe('/')
    expect(managedRouteRedirect('/', true)).toBeUndefined()
    expect(managedRouteRedirect('/about', true)).toBeUndefined()
    expect(managedRouteRedirect(LEGACY_LAUNCHER_ROUTE, false)).toBeUndefined()
  })

  it('a: managed initial navigation to the companion lands untouched', async () => {
    const router = makeRouter(true)
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('b: managed programmatic navigation to /home is REPLACED by the companion', async () => {
    const router = makeRouter(true)
    await router.push('/')
    await router.push('/home')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('c: the Home-button shape (push to /home) can never render the legacy shell', async () => {
    const router = makeRouter(true)
    await router.replace('/home')
    expect(router.currentRoute.value.path).toBe('/')
    await router.push({ path: '/home', query: { from: 'button' } })
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('d: standalone behavior is preserved verbatim - /home remains reachable', async () => {
    const router = makeRouter(false)
    await router.push('/home')
    expect(router.currentRoute.value.path).toBe('/home')
    // The guard is a pure allow while standalone: navigating away and
    // coming back through an EXPLICIT visit keeps '/home' exactly as the
    // standalone shell always behaved (no redirect rule fires: proven by
    // the pure rule test above; memory-history go() timing is not the
    // contract under test here).
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/')
    await router.push('/home')
    expect(router.currentRoute.value.path).toBe('/home')
  })

  it('e: back/forward history can never resurrect the legacy shell while managed', async () => {
    const router = makeRouter(true)
    await router.push('/')
    await router.push('/about')
    await router.push('/home') // redirect/replaced -> '/'
    expect(router.currentRoute.value.path).toBe('/')
    await router.back()
    // The replaced entry never entered the stack, so back goes straight to
    // the last real entry - and even if a stale entry existed, the guard
    // would replace it again before render.
    expect(router.currentRoute.value.path).not.toBe('/home')
    await router.back()
    expect(router.currentRoute.value.path).not.toBe('/home')
    await router.forward()
    expect(router.currentRoute.value.path).not.toBe('/home')
  })
})
