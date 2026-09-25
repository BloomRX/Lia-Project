import type { LiaBrainCorrelationSnapshotReader } from './brain-correlation-reader'

import { readLiaBrainExecutionIdentityFacts } from './brain-correlation-reader'
import { LIA_BRAIN_ENGINE_PROVIDER_MAPPING } from './brain-expected-route'

/**
 * Phase 8.0D-10B-4C4A: the tiny main-side DIAGNOSTIC OBSERVER.
 *
 * It is the single place that turns a completed producer write into one
 * factual observation:
 *
 *   observe(correlationId)
 *     -> the proven read adapter (one snapshot read)
 *     -> the proven pure per-attempt identity facts
 *     -> the result is DISCARDED
 *
 * It owns exactly three things the 4C3B audit assigned to it:
 *
 *   invocation   it delegates to `readLiaBrainExecutionIdentityFacts(...)` and
 *                never talks to the correlation memory itself - `get(...)`
 *                stays owned by the read adapter, so production keeps exactly
 *                ONE read implementation
 *   mapping      it is the ONE new production consumer of the immutable trusted
 *                engine -> provider mapping - producers never see it, and the
 *                observer only forwards it to the read adapter (it never calls
 *                the expected-route foundation's functions itself)
 *   isolation    it owns the diagnostic read/derive failure boundary: a reader,
 *                mapping or derivation failure is contained here - never
 *                escaping into the write paths that call it
 *
 * What it deliberately is NOT: not a store, not a cache, not a lifecycle
 * provider, not an IPC service, not a comparator and not an execution
 * controller. It holds no state at all - no Map, no Set, no array history, no
 * last result, no pending set, no TTL or debounce bookkeeping - and it inspects
 * nothing: the factual outcome (its status, its attempts, its equality facts,
 * its expected route) is never read, branched on or interpreted, only computed
 * and dropped. Output/emission is a later, explicitly-owned phase.
 *
 * Authority: none. The observer cannot reach the Brain service, a routing
 * decision, a provider/model, product config, fallback, tools or permissions,
 * and it is strictly synchronous - so it can never influence runtime behavior.
 */

/**
 * The complete public contract: one fire-and-forget observation.
 *
 * `observe(...)` returns nothing (not even a promise), exposes no getter and
 * offers no way to inspect or retain what it computed. The correlationId is
 * forwarded verbatim as an opaque key the CALLER already validated - transport
 * key validation stays owned by the two producer write points.
 */
export interface LiaBrainCorrelationObserver {
  observe: (correlationId: string) => void
}

/**
 * Builds one observer over a structural snapshot reader.
 *
 * The dependency is the approved structural contract
 * (`LiaBrainCorrelationSnapshotReader` - `get(correlationId)` only), so the
 * production correlation memory object satisfies it as-is without this module
 * naming, importing or depending on the concrete store or its service/write
 * API. The observer never resolves a reader, never creates one and never
 * reaches for a global.
 */
export function createLiaBrainCorrelationObserver(params: {
  correlationReader: LiaBrainCorrelationSnapshotReader
}): LiaBrainCorrelationObserver {
  const { correlationReader } = params

  return {
    observe(correlationId: string): void {
      try {
        // Exactly ONE delegation: the read adapter performs the single snapshot
        // read and the pure facts layer derives the factual result. The result
        // is intentionally DISCARDED - not assigned, not inspected, not
        // retained - because emission belongs to a later phase.
        void readLiaBrainExecutionIdentityFacts(correlationReader, correlationId, LIA_BRAIN_ENGINE_PROVIDER_MAPPING)
      }
      catch {
        // Diagnostic isolation: a reader/mapping/derivation failure is
        // contained here. Nothing is retried, no fallback runs, no second read
        // happens, nothing is logged or emitted, and no product state changes -
        // the caller's write path (and therefore chat execution) is unaffected.
      }
    },
  }
}
