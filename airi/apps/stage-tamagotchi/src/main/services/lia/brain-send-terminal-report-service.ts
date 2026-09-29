import type { LiaBrainSendTerminalReport } from '../../../shared/eventa'
import type { LiaBrainCorrelationObserver } from './brain-correlation-observer'

/**
 * Phase 8.0D-10B-4D4C4-B3B1: the trusted main-process ingress for the Lia
 * logical-send terminal report.
 *
 * It receives ONE unknown payload - the Eventa boundary is untrusted, so the
 * type it is handed is `unknown`, never the contract type - and does exactly
 * three things: sanitize the two contract fields tolerantly, require a usable
 * logical-send key and a closed-vocabulary outcome, and hand the sanitized
 * two-field report to the injected correlation store as a diagnostic fact
 * (Phase 8.0D-10B-4D4C4-B3A). It owns no other behavior and no state at all.
 *
 * Phase 8.0D-10B-4D4C4-B4B5: the injected diagnostic observer is
 * triggered from the same isolated block, strictly AFTER the successful write,
 * with the sanitized report's own key - exactly like the sibling terminal
 * ingress. One accepted send-terminal report therefore produces exactly one
 * observation of ITS logical send, and the observation follows the write, so
 * the send fact is already available in the canonical store when the read
 * happens. The dependency is the canonical lifecycle instance and its contract
 * is one method, `observe(...)`, returning nothing.
 *
 * The transport binding lives in its own module
 * (`brain-send-terminal-report-listener.ts`), which forwards raw payloads here
 * and knows nothing about validation or the store.
 *
 * Trust boundary: the settlement of a logical send is UNTRUSTED METADATA, even
 * though it originates from the renderer that really ran the send. The outcome
 * is read as one of two exact strings and copied verbatim - it is never
 * normalized, never mapped to a boolean, never used to derive a verdict, and it
 * grants no authority of any kind: no route selection, no policy change, no
 * preferred engine/model, no fallback, no retry, no tool authorization, no
 * permission, no execution switching. Round identity, provider/model identity,
 * attempt counts, error text, stack, failure stage, prompt, message, usage and
 * credentials are NOT part of this contract and are never looked at, even when
 * a hostile payload carries them.
 *
 * Deliberately absent: no Eventa/Electron, no handler registration, no
 * correlation reader or facts, no diagnostic logger, no Brain service, no
 * product config, no comparison, no aggregates and no send-level verdict.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Tolerant string read: any non-string shape reads as "no value", never as a default. */
function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * The closed send-terminal vocabulary, read exactly: the two settlements a
 * logical send can reach. Anything else - a synonym, a round-only treatment
 * like `abandoned`, a translated label, an upper-cased variant, a padded
 * string, a non-string - reads as "not an outcome", never as a coerced default.
 */
function readOutcome(value: unknown): LiaBrainSendTerminalReport['outcome'] | undefined {
  return value === 'succeeded' || value === 'failed' ? value : undefined
}

/**
 * Sanitizes one payload, or reads it as "not a send-terminal report" when
 * either required fact is missing or unusable. Fields are copied into a fresh
 * plain object, so unknown keys (a round, an attempt count, an error object, a
 * nested provider blob, a prompt, a credential, callbacks) are simply never
 * looked at - nothing is spread, assigned or round-tripped.
 *
 * The key convention is the SAME one both sibling ingresses use: a key must be
 * a non-empty string, and a whitespace-only string is still a usable key (there
 * is no trimming anywhere on this boundary). The key belongs to the entry that
 * owns it: this module never synthesizes, derives or falls back to a generated
 * one.
 *
 * PURE: no state, no channel, no store - the caller decides what to do with the
 * result, exactly like the sibling sanitizers.
 */
export function sanitizeLiaBrainSendTerminalReport(value: unknown): LiaBrainSendTerminalReport | undefined {
  if (!isRecord(value))
    return undefined
  const correlationId = readString(value.correlationId)
  if (correlationId.length === 0)
    return undefined
  const outcome = readOutcome(value.outcome)
  if (outcome === undefined)
    return undefined
  const report: LiaBrainSendTerminalReport = {
    correlationId,
    outcome,
  }
  // Phase 8.0D-10B-4D4C4-D2B7: optional tri-state initialRouteOverride
  // absent/undefined → omit (not observed), exactly null → null (observed absent),
  // object with two strings → fresh two-field copy, malformed → omit but keep send terminal
  const rawRoute = (value as Record<string, unknown>).initialRouteOverride
  if (rawRoute === null) {
    report.initialRouteOverride = null
  }
  else if (isRecord(rawRoute)) {
    const providerId = rawRoute.providerId
    const modelId = rawRoute.modelId
    if (typeof providerId === 'string' && typeof modelId === 'string') {
      report.initialRouteOverride = {
        providerId: providerId as string,
        modelId: modelId as string,
      }
    }
  }
  return report
}

/**
 * The narrow dependency this ingress needs from the canonical correlation
 * store: the ability to record ONE sanitized send terminal, and nothing else.
 *
 * It is declared STRUCTURALLY, exactly like the reader surface the diagnostic
 * observer consumes (`LiaBrainCorrelationSnapshotReader`), so the canonical
 * service satisfies it as-is while this module stays unable to read an entry,
 * inspect the size, or write any other fact family. The store owns what a
 * repeated or conflicting report means (first send terminal wins); this layer
 * forwards every valid payload and resolves nothing.
 */
export interface LiaBrainSendTerminalRecorder {
  recordSendTerminal: (report: LiaBrainSendTerminalReport) => void
}

/**
 * The ingress surface: ONE operation, and nothing else.
 *
 * `report` is `void` by contract - there is no status, no count, no error object
 * and no retry result to branch on, so no caller can build an execution decision
 * out of an ingress outcome.
 */
export interface LiaBrainSendTerminalReportService {
  report: (payload: unknown) => void
}

/**
 * Creates the send-terminal ingress service over the injected canonical
 * correlation store and the injected canonical diagnostic observer.
 *
 * Both dependencies arrive exactly like the sibling terminal ingress receives
 * them - never created, resolved or reached for here. The only store member
 * this service touches is `recordSendTerminal`: it never writes a decision,
 * never appends an execution start, never reads an entry and never inspects
 * the size. The observer is triggered once per accepted report with that
 * report's own sanitized key; the canonical store remains the authority on
 * repeated or conflicting outcomes, and this layer resolves nothing.
 */
export function createLiaBrainSendTerminalReportService(params: {
  correlationStore: LiaBrainSendTerminalRecorder
  /**
   * Phase 8.0D-10B-4D4C4-B4B5: the canonical diagnostic observer owned by the
   * lifecycle - never resolved or created here. It is triggered once per
   * successful send-terminal write with that report's own sanitized key, and
   * returns nothing.
   */
  correlationObserver: LiaBrainCorrelationObserver
}): LiaBrainSendTerminalReportService {
  const { correlationStore, correlationObserver } = params

  return {
    report(payload: unknown): void {
      // Sanitize first: only a payload with a usable key and one exact outcome
      // survives, and only the two contract fields are read into a fresh object.
      const report = sanitizeLiaBrainSendTerminalReport(payload)
      if (report === undefined)
        return

      // Diagnostic write, isolated with the SAME containment policy as the
      // sibling terminal ingress: a correlation store that throws cannot make an
      // exception escape into the caller, cannot trigger a retry or a fallback,
      // and cannot produce a user-facing error.
      // Phase 8.0D-10B-4D4C4-B4B5: the observation follows the WRITE, in the
      // same isolated block - a record that throws is never observed, and a
      // hostile observer cannot escape into the caller either.
      try {
        correlationStore.recordSendTerminal(report)
        // Ordering is the contract: the factual mutation completes first, and
        // only then is the sanitized report's own key observed.
        correlationObserver.observe(report.correlationId)
      }
      catch {
        // Diagnostic memory only: the logical send this report describes is
        // unaffected.
      }
    },
  }
}
