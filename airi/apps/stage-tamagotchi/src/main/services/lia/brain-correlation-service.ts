import type { LiaBrainCorrelationStore } from './brain-correlation-store'

import { createLiaBrainCorrelationStore } from './brain-correlation-store'

/**
 * Phase 8.0D-10B-4B2: the canonical production owner of the ephemeral Brain
 * correlation store.
 *
 * The pure store requires explicit bounds and owns no lifecycle; this module is
 * the ONE production factory that supplies them, so the Stage main lifecycle
 * can own exactly one instance per process through the same Injeca pattern it
 * already uses for the Brain service. No second DI mechanism, no module global,
 * no Vue/Pinia state, no service-locator getter, no singleton accessor - the
 * instance exists because the container built it, and nowhere else.
 *
 * This phase owns MEMORY LIFECYCLE ONLY. The returned surface is exactly the
 * store's own API (record a decision, record an execution report, read one
 * entry, inspect the size) - no interpretation of the facts, no comparison, no
 * recommendation, and no execution authority of any kind. Nothing records into
 * it yet: the Brain decision bridge and the execution-report handler remain
 * unaware of it.
 */

/**
 * Hard bound on live correlation entries in production.
 *
 * Diagnostic metadata only, so memory stays hard-bounded while still absorbing
 * bursty interaction: hundreds of in-flight logical sends, each with its
 * fallback attempts, fit comfortably.
 */
export const LIA_BRAIN_CORRELATION_MAX_ENTRIES = 256

/**
 * Production lifetime of one correlation entry, in milliseconds (15 minutes).
 *
 * Comfortably spans a queued send and its fallback attempts, and is short
 * enough that the store can never drift into durable conversation history.
 */
export const LIA_BRAIN_CORRELATION_TTL_MS = 15 * 60 * 1000

/**
 * The production surface: the store API, and nothing else.
 *
 * `compare(...)`, `match(...)`, `mismatch(...)`, `expectedProvider`,
 * `expectedModel` and any recommendation API do not exist here - this service
 * owns memory lifecycle, not meaning.
 */
export type LiaBrainCorrelationService = LiaBrainCorrelationStore

/**
 * Builds one bounded, ephemeral correlation store with the production bounds.
 *
 * `now` exists purely as a narrow test seam so expiry can be proven
 * deterministically without sleeping; production passes nothing and therefore
 * uses the store's normal/default clock. No other knob is exposed, and the
 * production bounds are never configurable from the outside.
 */
export function createLiaBrainCorrelationService(options: { now?: () => number } = {}): LiaBrainCorrelationService {
  return createLiaBrainCorrelationStore({
    maxEntries: LIA_BRAIN_CORRELATION_MAX_ENTRIES,
    ttlMs: LIA_BRAIN_CORRELATION_TTL_MS,
    // The default clock is the production clock: only a test seam overrides it.
    ...(options.now === undefined ? {} : { now: options.now }),
  })
}
