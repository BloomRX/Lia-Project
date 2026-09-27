import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LiaBrainExecutionTerminalReportService } from './brain-execution-terminal-report-service'

import { electronLiaBrainExecutionTerminalObservation } from '../../../shared/eventa'

type MainContext = ReturnType<typeof createContext>['context']

/**
 * Phase 8.0D-10B-4D4C2B2: the main-process Eventa wiring of the THIRD Brain
 * channel - the one-way terminal execution report.
 *
 * It exists as a SEPARATE, minimal module on purpose: the terminal ingress
 * service (Phase 8.0D-10B-4D4C2B1) owns validation and the store write and
 * deliberately imports no transport at all, so the transport binding lives
 * here, exactly like `registerLiaBrainExecutionReportHandler` binds the
 * execution-observation channel to its own ingress.
 *
 * It owns exactly ONE thing: the listener registration. The listener does not
 * sanitize, does not inspect and does not interpret - it forwards the raw,
 * still-untrusted payload to `terminalReportService.report(...)` and nothing
 * else. The service owns the key/outcome validation, the store owns what a
 * repeated or conflicting outcome means, and the canonical report shape has a
 * single implementation.
 *
 * The asymmetry with the execution path is deliberate and pinned: this
 * registration receives NO correlation observer, so a terminal write can never
 * trigger a diagnostic observation. The existing triggers remain exactly the
 * decision write and the execution-start write.
 *
 * Deliberately absent: no state, no buffering, no queue, no timers, no async
 * layer, no retry, no fallback, no reader/facts, no diagnostic log, no
 * provider/model knowledge and no execution authority of any kind.
 */
export function registerLiaBrainExecutionTerminalReportListener(params: {
  context: MainContext
  /**
   * The canonical terminal ingress instance the composition root created over
   * the lifecycle-owned correlation store - never created or resolved here, and
   * never called with anything but the raw payload.
   */
  terminalReportService: LiaBrainExecutionTerminalReportService
}): void {
  const { context, terminalReportService } = params

  context.on(electronLiaBrainExecutionTerminalObservation, (event) => {
    // Raw forwarding: no field is read here, nothing is checked and nothing is
    // rewritten - the payload crosses this layer untouched, and the ingress
    // service decides whether it is a report at all.
    terminalReportService.report((event as { body?: unknown } | undefined)?.body)
  })
}
