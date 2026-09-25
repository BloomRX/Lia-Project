import type { LiaBrainModelRoute } from './routes'
import type { LiaBrainEngineDescriptor } from './types'

/**
 * Phase 8.0C-4: the pure engine-readiness layer.
 *
 * It answers exactly one question, separate from every other layer:
 *
 *   "Can this engine execute NOW?"
 *
 * Capability eligibility answers a different question ("can this engine
 * support the required capabilities at all?"), and the two are deliberately
 * never merged: an engine can be perfectly capable and still not executable
 * here yet (needs configuration) or not usable in this build at all.
 *
 * This module INTERPRETS the descriptor state the product layer already
 * declares - it never probes. No config read, no credential read, no
 * network/auth check, no provider-specific remediation, no registry
 * ownership or mutation, no filesystem/IPC/logging. Descriptors in,
 * readiness out.
 */

/**
 * The canonical readiness of one engine in THIS build. The three states are
 * mutually exclusive and total: every availability state maps onto exactly
 * one of them.
 */
export type LiaBrainEngineReadiness
  = | { status: 'ready' }
    | { status: 'configurationRequired' }
    | { status: 'unavailable' }

/**
 * Maps one engine descriptor's declared availability onto readiness. The
 * mapping is explicit and exhaustive - a new availability state cannot pass
 * silently; the compiler reports the missing branch instead.
 *
 * `engine.availability` is the ONLY input: nothing is inferred from ids,
 * capability breadth, model counts or display text.
 */
export function brainEngineReadiness(engine: LiaBrainEngineDescriptor): LiaBrainEngineReadiness {
  switch (engine.availability) {
    case 'available':
      return { status: 'ready' }
    case 'configurationRequired':
      return { status: 'configurationRequired' }
    case 'unavailable':
      return { status: 'unavailable' }
  }
}

/**
 * Keeps only the routes whose engine is ready to execute now.
 *
 * Only `engine.availability === 'available'` qualifies - `configurationRequired`
 * and `unavailable` engines are dropped, never downgraded, never repaired and
 * never replaced by a fallback route.
 *
 * It is a pure filter and nothing else: input order is preserved verbatim,
 * duplicate routes stay duplicated, and no sorting, ranking, capability
 * check, policy interpretation or mutation happens here. Capability
 * filtering stays owned by `eligibleBrainModelRoutes(...)`; which candidate
 * to actually use stays owned by the policy selector.
 */
export function readyBrainModelRoutes(routes: readonly LiaBrainModelRoute[]): readonly LiaBrainModelRoute[] {
  return routes.filter(route => route.engine.availability === 'available')
}
