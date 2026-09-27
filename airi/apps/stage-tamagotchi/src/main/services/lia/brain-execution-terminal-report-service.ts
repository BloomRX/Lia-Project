import type { LiaBrainExecutionTerminalReport } from '../../../shared/eventa'
import type { LiaBrainCorrelationObserver } from './brain-correlation-observer'
import type { LiaBrainCorrelationService } from './brain-correlation-service'

/**
 * Phase 8.0D-10B-4D4C2B1: the trusted main-process ingress for the Lia terminal
 * execution report.
 *
 * It receives ONE unknown payload - the future Eventa boundary is untrusted, so
 * the type it is handed is `unknown`, never the contract type - and does exactly
 * three things: sanitize the three contract fields tolerantly, require usable
 * keys and a closed-vocabulary outcome, and hand the sanitized three-field
 * report to the injected correlation store as a diagnostic fact (Phase
 * 8.0D-10B-4D4C2A). It owns no other behavior and no state at all.
 *
 * Phase 8.0D-10B-4D4C3B2-B3: the injected diagnostic observer is triggered from
 * the same isolated block, strictly AFTER the successful write, with the
 * sanitized report's own key - exactly like the sibling execution ingress. One
 * accepted terminal report therefore produces exactly one observation of ITS
 * logical send, and the observation follows the write, so the terminal fact is
 * already available in the canonical store when the read happens. The
 * dependency is the canonical lifecycle instance and its contract is one
 * method, `observe(...)`, returning nothing: this ingress cannot inspect a
 * result, cannot learn about facts, engines, providers or expectations, and
 * cannot branch on diagnostics.
 *
 * The transport binding lives in its own module (`brain-execution-terminal-
 * report-listener.ts`), which forwards raw payloads here and knows nothing about
 * validation or the store.
 *
 * Trust boundary: a terminal outcome is UNTRUSTED METADATA, even though it
 * originates from the leader's real execution seam. The outcome is read as one
 * of three exact strings and copied verbatim - it is never normalized, never
 * mapped to a boolean, and it grants no authority of any kind: no route
 * selection, no policy change, no preferred engine/model, no fallback, no retry,
 * no tool authorization, no permission. Provider/model identity, conversation,
 * turn, error text, stack, failure stage and usage are NOT part of this contract
 * and are never looked at, even when a hostile payload carries them.
 *
 * Deliberately absent: no Eventa/Electron, no handler registration, no
 * correlation reader or facts, no diagnostic logger, no Brain service, no
 * product config, no comparison and no aggregates.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Tolerant string read: any non-string shape reads as "no value", never as a default. */
function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * The closed terminal vocabulary, read exactly: the three outcomes the Core
 * Agent runtime can classify. Anything else - a synonym, a translated label, an
 * upper-cased variant, a non-string - reads as "not an outcome", never as a
 * coerced default.
 */
function readOutcome(value: unknown): LiaBrainExecutionTerminalReport['outcome'] | undefined {
  return value === 'succeeded' || value === 'failed' || value === 'abandoned' ? value : undefined
}

/**
 * Sanitizes one payload, or reads it as "not a terminal report" when any of the
 * three required facts is missing or unusable. Fields are copied into a fresh
 * plain object, so unknown keys (a prompt, a credential, an error object, a
 * nested provider blob, callbacks) are simply never looked at - nothing is
 * spread, assigned or round-tripped.
 *
 * The key convention is the SAME one the execution ingress uses: a key must be
 * a non-empty string, and a whitespace-only string is still a usable key (there
 * is no trimming anywhere on this boundary). The round key follows that exact
 * policy. Both belong to the entry that owns them: this module never
 * synthesizes, derives or falls back to a generated key.
 *
 * PURE: no state, no channel, no store - the caller decides what to do with the
 * result, exactly like the sibling sanitizer of the execution report.
 */
export function sanitizeLiaBrainExecutionTerminalReport(value: unknown): LiaBrainExecutionTerminalReport | undefined {
  if (!isRecord(value))
    return undefined
  const correlationId = readString(value.correlationId)
  if (correlationId.length === 0)
    return undefined
  const roundId = readString(value.roundId)
  if (roundId.length === 0)
    return undefined
  const outcome = readOutcome(value.outcome)
  if (outcome === undefined)
    return undefined
  return {
    correlationId,
    outcome,
    roundId,
  }
}

/**
 * The ingress surface: ONE operation, and nothing else.
 *
 * `report` is `void` by contract - there is no status, no count, no error object
 * and no retry result to branch on, so no caller can build an execution decision
 * out of an ingress outcome. The store owns what a repeated or conflicting
 * report means (first terminal outcome per round wins); this layer forwards
 * every valid payload and resolves nothing.
 */
export interface LiaBrainExecutionTerminalReportService {
  report: (payload: unknown) => void
}

/**
 * Creates the terminal ingress service over the injected canonical correlation
 * store and the injected canonical diagnostic observer.
 *
 * Both dependencies arrive exactly like the sibling execution ingress receives
 * them - never created, resolved or reached for here. The only store member this
 * service touches is `recordExecutionTerminal`: it never writes a decision,
 * never appends an execution start, never reads an entry and never inspects the
 * size, so it cannot validate a round against a matching start or a decision.
 * The observer is triggered once per accepted report with that report's own
 * sanitized key; the canonical store remains the authority on repeated or
 * conflicting outcomes, and this layer resolves nothing.
 */
export function createLiaBrainExecutionTerminalReportService(params: {
  correlationStore: LiaBrainCorrelationService
  /**
   * Phase 8.0D-10B-4D4C3B2-B3: the canonical diagnostic observer owned by the
   * lifecycle (the 4C4B provider) - never resolved or created here. It is
   * triggered once per successful terminal write with that report's own
   * sanitized key, and returns nothing: the ingress never reads, stores or
   * branches on it.
   */
  correlationObserver: LiaBrainCorrelationObserver
}): LiaBrainExecutionTerminalReportService {
  const { correlationStore, correlationObserver } = params

  return {
    report(payload: unknown): void {
      // Sanitize first: only a payload with two usable keys and one exact
      // outcome survives, and only the three contract fields are read into a
      // fresh object.
      const report = sanitizeLiaBrainExecutionTerminalReport(payload)
      if (report === undefined)
        return

      // Diagnostic write, isolated with the SAME containment policy as the
      // execution ingress: a correlation store that throws cannot make an
      // exception escape into the caller, cannot trigger a retry or a fallback,
      // and cannot produce a user-facing error.
      // Phase 8.0D-10B-4D4C3B2-B3: the observation follows the WRITE, in the
      // same isolated block - a record that throws is never observed, and a
      // hostile observer cannot escape into the caller either.
      try {
        correlationStore.recordExecutionTerminal(report)
        // Ordering is the contract: the factual mutation completes first, and
        // only then is the sanitized report's own key observed. The returned
        // value is discarded (it is `void`) - no diagnostic result is inspected,
        // and the outcome itself never selects a different path.
        correlationObserver.observe(report.correlationId)
      }
      catch {
        // Diagnostic memory only: the round this report describes is unaffected.
      }
    },
  }
}
