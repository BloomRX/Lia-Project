import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LiaBrainExecutionObservationReport } from '../../../shared/eventa'
import type { LiaBrainCorrelationObserver } from './brain-correlation-observer'
import type { LiaBrainCorrelationService } from './brain-correlation-service'

import { electronLiaBrainExecutionObservation } from '../../../shared/eventa'

type MainContext = ReturnType<typeof createContext>['context']

/**
 * Phase 8.0D-10B-4A: the trusted main-process handler for the Lia execution
 * observation report.
 *
 * It receives the ONE-WAY diagnostic report the renderer that executed a
 * request pushed (five string identities of one attempt) and does exactly
 * three things: sanitize the fields tolerantly, require a non-empty
 * correlationId, and hand the sanitized five-field object to the injected
 * correlation store as a diagnostic fact (Phase 8.0D-10B-4B3). Nothing else is
 * retained here: this module keeps no state, and it only WRITES
 * (`recordExecution`) - it never reads, inspects or interprets the store.
 *
 * Phase 8.0D-10B-4C4C: the injected diagnostic observer is triggered from the
 * same isolated block, strictly AFTER the successful write, with the sanitized
 * report's own key - so one accepted attempt produces exactly one observation
 * of ITS logical send. The dependency is the canonical lifecycle instance and
 * its contract is one method, `observe(...)`, returning nothing: this handler
 * cannot inspect a result, cannot learn about facts, engines, providers or
 * expectations, and cannot branch on diagnostics.
 *
 * Trust boundary: execution identity is UNTRUSTED DATA, even though it
 * originates from the leader's real execution seam. `providerId`/`modelId` are
 * diagnostic CLAIMS - they are read as strings, never validated against a
 * catalog, never compared to a decision, and they grant no authority of any
 * kind: no route selection, no policy change, no preferred engine/model, no
 * fallback, no provider execution, no tool authorization, no permission.
 *
 * Deliberately absent: no host Brain service, no routing-decision call, no
 * Brain catalog, no product config, no preference write, no storage, no
 * comparison - this module owns no dependency other than the IPC context it
 * registers on.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Tolerant string read: any non-string shape reads as "no value", never as a default. */
function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Sanitizes one report, or reads it as "not a report" when the required
 * logical-send key is missing. Fields are copied into a fresh plain object,
 * so unknown keys (a policy blob, a prompt, a credential, callbacks) are
 * simply never looked at.
 *
 * PURE and unexported-by-accident: it is exported so the tolerant conventions
 * this phase promises can be tested directly. It holds no state, touches no
 * channel and returns a fresh value - the caller decides what to do with it,
 * and the only caller DISCARDS it.
 */
export function sanitizeLiaBrainExecutionObservationReport(value: unknown): LiaBrainExecutionObservationReport | undefined {
  if (!isRecord(value))
    return undefined
  const correlationId = readString(value.correlationId)
  if (correlationId.length === 0)
    return undefined
  return {
    correlationId,
    conversationId: readString(value.conversationId),
    roundId: readString(value.roundId),
    providerId: readString(value.providerId),
    modelId: readString(value.modelId),
  }
}

/**
 * Registers the diagnostic report handler. The sanitized report is discarded
 * inside the handler: no return value, no state, no side effect - the handler
 * cannot produce an execution command even by accident.
 */
export function registerLiaBrainExecutionReportHandler(params: {
  context: MainContext
  /**
   * Phase 8.0D-10B-4B3: the canonical correlation store, injected by the
   * lifecycle - never created or resolved here. It is used for exactly ONE
   * diagnostic write (`recordExecution`) and is never read.
   */
  correlationStore: LiaBrainCorrelationService
  /**
   * Phase 8.0D-10B-4C4C: the canonical diagnostic observer owned by the
   * lifecycle (the 4C4B provider) - never resolved or created here. It is
   * triggered once per successful report write with that report's own sanitized
   * key, and returns nothing: the handler never reads, stores or branches on it.
   */
  correlationObserver: LiaBrainCorrelationObserver
}): void {
  const { context, correlationStore, correlationObserver } = params

  context.on(electronLiaBrainExecutionObservation, (event) => {
    // Sanitize first: only a report with a usable key survives, and only the
    // five contract fields are read into a fresh object.
    const report = sanitizeLiaBrainExecutionObservationReport((event as { body?: unknown } | undefined)?.body)
    if (report === undefined)
      return

    // Diagnostic write, isolated: a correlation store that throws cannot make
    // an exception escape into chat execution, cannot trigger a retry or a
    // fallback, and cannot produce a user-facing error.
    // Phase 8.0D-10B-4C4C: the observation follows the WRITE, in the same
    // isolated block - a record that throws is never observed, and a hostile
    // observer cannot escape into the one-way handler either.
    try {
      correlationStore.recordExecution(report)
      // Ordering is the contract: the factual mutation completes first, and
      // only then is the sanitized report's own key observed. The returned
      // value is discarded (it is `void`) - no diagnostic result is inspected.
      correlationObserver.observe(report.correlationId)
    }
    catch {
      // Diagnostic memory only: the request this report describes is unaffected.
    }
  })
}
