import type { LeadershipMode } from '@proj-airi/stage-ui/libs/pinia'

/** Describes the synchronization and Stage runtime policy for one renderer. */
export interface RendererWindowContext {
  /** Determines whether this renderer can own synchronized actions. */
  leadership: LeadershipMode
  /**
   * Phase 7.3: true when the Lia App spawned this stage. The renderer needs
   * only this boolean (the env itself never crosses the boundary) to run the
   * central managed-route policy - the legacy launcher is not a destination.
   */
  liaManaged: boolean
  /** Determines whether this renderer initializes Stage integrations. */
  stageRuntime: 'full' | 'minimal'
}

function normalizeRoutePath(routePath: string) {
  const [path = ''] = routePath.split(/[?#]/)
  return path || '/'
}

/**
 * Resolves the initial renderer route before Vue Router hydrates the hash.
 *
 * @example
 * resolveInitialRendererRoutePath('/', '#/widgets?source=tray')
 * // => '/widgets'
 */
export function resolveInitialRendererRoutePath(routePath: string, hash = globalThis.location?.hash ?? ''): string {
  const hashPath = hash.startsWith('#') ? hash.slice(1) : ''
  return normalizeRoutePath(hashPath || routePath)
}

/**
 * Resolves renderer ownership from the query that the main process supplies.
 *
 * @example
 * resolveRendererWindowContext('?synced-leader=false&stage-runtime=minimal')
 * // => { leadership: 'follower-only', stageRuntime: 'minimal' }
 */
export function resolveRendererWindowContext(search = globalThis.location?.search ?? ''): RendererWindowContext {
  const query = new URLSearchParams(search)
  const syncedLeader = query.get('synced-leader')
  if (syncedLeader === null)
    throw new TypeError('Missing synced-leader query')
  if (syncedLeader !== 'true' && syncedLeader !== 'false')
    throw new TypeError(`Invalid synced-leader query: ${syncedLeader}`)

  const stageRuntime = query.get('stage-runtime')
  if (stageRuntime !== null && stageRuntime !== 'minimal')
    throw new TypeError(`Invalid stage-runtime query: ${stageRuntime}`)

  const liaManaged = query.get('lia-managed')
  if (liaManaged !== null && liaManaged !== 'true')
    throw new TypeError(`Invalid lia-managed query: ${liaManaged}`)

  return {
    leadership: syncedLeader === 'true' ? 'leader-only' : 'follower-only',
    liaManaged: liaManaged === 'true',
    stageRuntime: stageRuntime === 'minimal' ? 'minimal' : 'full',
  }
}
