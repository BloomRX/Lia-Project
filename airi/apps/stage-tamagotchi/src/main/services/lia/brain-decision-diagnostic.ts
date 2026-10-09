import type { LiaBrainRoutingDecision } from '@lia/core'

import { useLogg } from '@guiiai/logg'

/**
 * Phase 8.0D-M2: the narrow main-side DIAGNOSTIC ADAPTER for ONE canonical
 * Brain routing decision.
 *
 * It exists for one operational reason. The per-send correlation line
 * (`brain-diagnostic-log.ts`) reports the EXECUTION-identity outcome of a
 * decision, and every decision that carries no route collapses there into the
 * single factual state `noBrainRouteSelected`. That is truthful, but it is not
 * specific: an absent routing mode, an explicit `disabled`, an eligibility
 * outcome and a policy outcome are all distinguishable in the decision itself
 * and indistinguishable in that line. The first real Windows gate of the
 * multimodal route had to be diagnosed from the collapsed state; this adapter
 * makes the decision's own status directly readable instead.
 *
 * One decision in, one deterministic metadata-only line out:
 *
 *   LiaBrainRoutingDecision
 *     -> formatLiaBrainDecisionDiagnostic(decision)  one deterministic line
 *     -> logLiaBrainDecisionDiagnostic(decision)     one informational call
 *     -> @guiiai/logg global hook
 *     -> existing stdout / sanitized main-process log bus / FileLogger
 *
 * Data class: metadata only. The formatter reads the decision's own status
 * discriminators and, when the decision itself names one, the selected or
 * resolved route's engine and model ids. A routing decision carries no prompt,
 * message, attachment, tool argument, tool result, credential, API key,
 * baseURL, provider object, error text or chat payload, so none is reachable
 * from here - and nothing is serialized as a whole: only the allowlisted
 * fields below are ever copied out.
 *
 * Authority: none. A log line cannot select a route, change a mode or a policy,
 * pick a provider or model, trigger a fallback, authorize a tool or start an
 * execution - this module has no dependency through which any of that exists,
 * and it is strictly synchronous. It never writes config, never calls the
 * Brain, never reads the correlation memory and never resolves a mapping.
 *
 * Failure isolation: like its sibling adapter, this module does not wrap the
 * logger call in its own try/catch - the caller that injects it owns the
 * diagnostic isolation boundary, so a throwing logger is contained there and
 * can never reach the decision path.
 */

/** The logger handle, created ONCE for this module - never per decision. */
const log = useLogg('lia:brain-decision').useGlobalConfig()

/** The fixed technical prefix every line carries. */
const PREFIX = '[LIA-BRAIN-DECISION]'

/**
 * One string value as a JSON string literal, so ids stay unambiguous even if a
 * future id contains a space, a delimiter or a quote. Only STRING leaves are
 * quoted this way, and only the allowlisted identity fields ever reach it.
 */
function quoted(value: string): string {
  return JSON.stringify(value)
}

/**
 * The deterministic, metadata-only line for one decision.
 *
 * `status` is always present - it is the fact this adapter exists to expose.
 * Everything after it is emitted only when the decision itself carries it:
 *
 * - `automatic`   the selector's own status, plus the selected route's engine
 *                 and model ids when one was selected;
 * - `manual`      the resolver's own status and the additive readiness status,
 *                 plus the resolved engine and model ids when the resolution
 *                 names them;
 * - every other status carries nothing further, and no placeholder is invented.
 *
 * Field order is fixed and every value is copied verbatim from the decision:
 * the same decision always produces the exact same string (no timestamp, no
 * random id, no environment value, no clock).
 */
export function formatLiaBrainDecisionDiagnostic(decision: LiaBrainRoutingDecision): string {
  const fields = [`status=${quoted(decision.status)}`]

  if (decision.status === 'automatic') {
    fields.push(`selection=${quoted(decision.selection.status)}`)
    if (decision.selection.status === 'selected') {
      fields.push(
        `selectedEngineId=${quoted(decision.selection.route.engine.id)}`,
        `selectedModelId=${quoted(decision.selection.route.model.id)}`,
      )
    }
  }

  if (decision.status === 'manual') {
    fields.push(
      `resolution=${quoted(decision.resolution.status)}`,
      `readiness=${quoted(decision.readiness.status)}`,
    )
    // Only a resolution that actually names an engine reports one; the
    // `noPreference` and not-found states carry no identity to report.
    if ('engine' in decision.resolution)
      fields.push(`resolvedEngineId=${quoted(decision.resolution.engine.id)}`)
    if ('model' in decision.resolution && decision.resolution.model !== undefined)
      fields.push(`resolvedModelId=${quoted(decision.resolution.model.id)}`)
  }

  return [PREFIX, ...fields].join(' ')
}

/**
 * Callback-compatible sink: exactly one call per decision, at an informational
 * level (a routing decision is a fact, never an error), returning nothing.
 */
export function logLiaBrainDecisionDiagnostic(decision: LiaBrainRoutingDecision): void {
  log.log(formatLiaBrainDecisionDiagnostic(decision))
}

/**
 * The pure dev gate, mirroring the sibling correlation adapter: the trusted
 * composition root decides whether diagnostics exist, and this helper only
 * translates that decision into the callback itself (dev) or nothing
 * (production). It holds no state and has no side effect.
 */
export function selectLiaBrainDecisionDiagnosticLog(
  isDev: boolean,
): ((decision: LiaBrainRoutingDecision) => void) | undefined {
  return isDev ? logLiaBrainDecisionDiagnostic : undefined
}
