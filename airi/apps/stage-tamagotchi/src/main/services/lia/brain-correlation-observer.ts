import type { LiaBrainCorrelationReadFacts, LiaBrainCorrelationSnapshotReader } from './brain-correlation-reader'

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
 *     -> optionally forwarded to an injected log callback
 *     -> otherwise DISCARDED
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
 * provider, not an IPC service, not a logger, not a comparator and not an
 * execution controller. It holds no state at all - no Map, no Set, no array
 * history, no last result, no pending set, no TTL or debounce bookkeeping - and
 * it interprets nothing: the factual outcome (its status, its attempts, its
 * equality facts, its expected route) is never read, branched on or edited;
 * it is only computed and handed off. Where the facts go is decided entirely by
 * whoever supplies the optional callback - this module never chooses a
 * destination, never formats a line and never knows a logger exists.
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
 * Phase 8.0D-10B-4D2A: the structured diagnostic entry - the WHOLE payload the
 * optional callback receives, and nothing more.
 *
 * `facts` is the EXISTING read result, forwarded by reference: its union, its
 * states, its `expected` route, its attempts and its two equality booleans are
 * never re-declared, re-typed, cloned or normalized here - this type adds only
 * the opaque key the read result itself does not carry.
 *
 * Deliberately absent, and guarded by tests: no timestamp (the destination owns
 * time), no sequence number, no environment or window identity, no duplicated
 * provider/model/status fields and no derived verdict - no aggregate, no match,
 * no score, no recommendation.
 *
 * Data class: metadata only. The entry carries the opaque correlation key plus
 * the facts, which are themselves derived from the canonical decision and the
 * already-sanitized five-field execution reports - so no prompt, message,
 * attachment, tool argument, credential, API key, baseURL, provider config or
 * chat payload has a path into it.
 */
export interface LiaBrainDiagnosticEntry {
  correlationId: string
  facts: LiaBrainCorrelationReadFacts
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
 *
 * Phase 8.0D-10B-4D2A: `log` is an OPTIONAL callback of the entry above. It is
 * the plain `(entry) => void` seam the Lia runtime already uses for structured
 * metadata (the same callback convention the voice/runtime hosts consume), so
 * this module needs no logger import, no console, no transport and no
 * environment knowledge: the caller decides whether anything happens at all.
 * Production supplies nothing, so the read still runs and its result is simply
 * dropped - the historical behavior, unchanged.
 */
export function createLiaBrainCorrelationObserver(params: {
  correlationReader: LiaBrainCorrelationSnapshotReader
  log?: (entry: LiaBrainDiagnosticEntry) => void
}): LiaBrainCorrelationObserver {
  const { correlationReader, log } = params

  return {
    observe(correlationId: string): void {
      try {
        // Exactly ONE delegation, unconditionally: the read adapter performs
        // the single snapshot read and the pure facts layer derives the factual
        // result. The read is NEVER skipped - with or without a callback - so
        // the observation itself does not depend on whether output is
        // configured.
        const facts = readLiaBrainExecutionIdentityFacts(correlationReader, correlationId, LIA_BRAIN_ENGINE_PROVIDER_MAPPING)

        // Read BEFORE forward: the value handed off is the exact object the
        // read produced - not a clone, not a re-derivation, not an edited copy.
        // Every factual state travels, unfiltered and unabridged; with no
        // callback this call is a no-op and the result is discarded.
        log?.({ correlationId, facts })
      }
      catch {
        // Diagnostic isolation: a reader/mapping/derivation failure - and, with
        // the same boundary, a hostile callback - is contained here. Nothing is
        // retried, no fallback runs, no second read happens, no second callback
        // runs, no product state changes, and the caller's write path (and
        // therefore chat execution) is unaffected.
      }
    },
  }
}
