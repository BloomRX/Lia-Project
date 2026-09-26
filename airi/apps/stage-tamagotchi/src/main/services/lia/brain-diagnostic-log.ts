import type { LiaBrainDiagnosticEntry } from './brain-correlation-observer'

import { useLogg } from '@guiiai/logg'

/**
 * Phase 8.0D-10B-4D2B: the narrow main-side diagnostic LOG ADAPTER.
 *
 * It is the ONE place that turns an already-derived structured diagnostic entry
 * into a single metadata-only log line, and hands that line to the repository's
 * existing logger:
 *
 *   LiaBrainDiagnosticEntry
 *     -> formatLiaBrainDiagnosticEntry(entry)   one deterministic line
 *     -> logLiaBrainDiagnostic(entry)           one informational logger call
 *     -> @guiiai/logg global hook
 *     -> existing stdout / sanitized main-process log bus / FileLogger
 *
 * Downstream fan-out is entirely the existing global hook's business: this
 * module writes no file, calls no IPC, touches no window and knows nothing about
 * where log lines are shown. It also never reads the correlation memory, never
 * derives facts, never resolves the trusted mapping and never owns an observer
 * lifecycle - it receives facts that are already final.
 *
 * Data class: metadata only. The formatter's whole input is the structured
 * entry (the opaque correlation key plus the read result), and it copies ONLY
 * the allowlisted identity fields out of it - the opaque key, the factual
 * status discriminator, the expected route ids, and per observed attempt its
 * arrival index plus the ids (and, for the identity-facts state, the two
 * equality booleans). No prompt, message, attachment, tool data, credential,
 * API key, baseURL, provider object or chat payload is reachable from here.
 *
 * Authority: none. A log line cannot select a route, change a policy, pick a
 * provider/model, trigger a fallback, authorize a tool or start an execution -
 * this module has no dependency through which any of that exists, and it is
 * strictly synchronous.
 *
 * Failure isolation: this adapter deliberately does NOT wrap the logger call in
 * its own try/catch - the observer that calls it already owns the mandatory
 * diagnostic isolation boundary (Phase 8.0D-10B-4D2A), so a throwing logger is
 * contained there and can never reach a producer write path.
 */

/**
 * The logger handle, created ONCE for this module - never per observation. The
 * namespace is fixed (`lia:brain`): the global format/level/hook configuration
 * is the application's own, so this module adds no configuration of its own.
 */
const log = useLogg('lia:brain').useGlobalConfig()

/** The fixed technical prefix every line carries. */
const PREFIX = '[LIA-BRAIN-DIAG]'

/**
 * One string value as a JSON string literal, so ids stay unambiguous even if a
 * future id contains a space, a delimiter or a quote.
 *
 * Deliberately narrow: only STRING leaves are quoted this way, and only the
 * allowlisted identity fields ever reach it - the entry is never serialized as
 * a whole.
 */
function quoted(value: string): string {
  return JSON.stringify(value)
}

/**
 * The deterministic, metadata-only line for one entry.
 *
 * Field order is fixed and every value is copied verbatim from the entry: the
 * same entry always produces the exact same string (no timestamp, no random id,
 * no environment value, no clock). Booleans and the arrival index stay raw;
 * string identities are JSON-quoted.
 *
 * Only fields the factual state actually carries are emitted - no placeholder
 * route, no synthesized attempt, no manufactured equality boolean.
 */
export function formatLiaBrainDiagnosticEntry(entry: LiaBrainDiagnosticEntry): string {
  const { correlationId, facts } = entry
  const fields = [`correlationId=${quoted(correlationId)}`, `status=${quoted(facts.status)}`]

  if (facts.status === 'correlationNotObserved')
    return [PREFIX, ...fields].join(' ')

  // The trusted expectation, named as the expectation it is - never as a
  // provider/model that was "observed", "verified" or "authoritative".
  if ('expected' in facts) {
    fields.push(
      `expectedEngineId=${quoted(facts.expected.engineId)}`,
      `expectedProviderId=${quoted(facts.expected.providerId)}`,
      `expectedModelId=${quoted(facts.expected.modelId)}`,
    )
  }

  // A selected route whose engine this build's trusted mapping does not assign
  // a Stage provider: the route's OWN ids are reported as selected, because no
  // expected provider/model exists to report.
  if (facts.status === 'engineMappingMissing') {
    fields.push(
      `selectedEngineId=${quoted(facts.engineId)}`,
      `selectedModelId=${quoted(facts.modelId)}`,
    )
  }

  // Every observed attempt, in the order the array already holds, prefixed by
  // the attempt's OWN arrival index. Equality booleans appear only where the
  // facts layer produced them (the identity-facts state).
  facts.attempts.forEach((attempt) => {
    // The prefix comes from the attempt's OWN arrivalIndex - never from the
    // iteration position, so the emitted name and value always agree.
    const prefix = `attempt${attempt.arrivalIndex}`
    fields.push(
      `${prefix}.arrivalIndex=${attempt.arrivalIndex}`,
      `${prefix}.roundId=${quoted(attempt.roundId)}`,
      `${prefix}.providerId=${quoted(attempt.providerId)}`,
      `${prefix}.modelId=${quoted(attempt.modelId)}`,
    )
    if ('providerIdentityEqual' in attempt) {
      fields.push(
        `${prefix}.providerIdentityEqual=${attempt.providerIdentityEqual}`,
        `${prefix}.modelIdentityEqual=${attempt.modelIdentityEqual}`,
      )
    }
  })

  return [PREFIX, ...fields].join(' ')
}

/**
 * Callback-compatible sink: exactly one call per entry, at an informational
 * level (these are factual snapshot observations, never errors), returning
 * nothing - so it is directly assignable to the observer's optional `log`.
 */
export function logLiaBrainDiagnostic(entry: LiaBrainDiagnosticEntry): void {
  log.info(formatLiaBrainDiagnosticEntry(entry))
}

/**
 * Phase 8.0D-10B-4D2B: the pure dev gate.
 *
 * The trusted composition root decides whether diagnostics exist; this helper
 * only translates that decision into the callback itself (dev) or nothing
 * (production). It holds no state and has no side effect - the very same module
 * function is returned on every dev call.
 */
export function selectLiaBrainDiagnosticLog(
  isDev: boolean,
): ((entry: LiaBrainDiagnosticEntry) => void) | undefined {
  return isDev ? logLiaBrainDiagnostic : undefined
}
