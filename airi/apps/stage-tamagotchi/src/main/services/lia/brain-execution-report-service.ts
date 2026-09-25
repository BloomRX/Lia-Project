import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LiaBrainExecutionObservationReport } from '../../../shared/eventa'

import { electronLiaBrainExecutionObservation } from '../../../shared/eventa'

type MainContext = ReturnType<typeof createContext>['context']

/**
 * Phase 8.0D-10B-4A: the trusted main-process handler for the Lia execution
 * observation report.
 *
 * It receives the ONE-WAY diagnostic report the renderer that executed a
 * request pushed (five string identities of one attempt) and does exactly
 * three things: sanitize the fields tolerantly, require a non-empty
 * correlationId, and DISCARD the result. After the handler returns, main
 * retains nothing.
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
export function registerLiaBrainExecutionReportHandler(params: { context: MainContext }): void {
  params.context.on(electronLiaBrainExecutionObservation, (event) => {
    // Sanitize, require the key, DROP the sanitized report. The result is
    // voided on purpose - keeping it would be the retention this phase forbids.
    void sanitizeLiaBrainExecutionObservationReport((event as { body?: unknown } | undefined)?.body)
  })
}
