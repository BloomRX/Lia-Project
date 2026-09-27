import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LiaBrainSendTerminalReportService } from './brain-send-terminal-report-service'

import { electronLiaBrainSendTerminalObservation } from '../../../shared/eventa'

type MainContext = ReturnType<typeof createContext>['context']

/**
 * Phase 8.0D-10B-4D4C4-B3B2: the main-process Eventa wiring of the FOURTH Brain
 * channel - the one-way logical-send terminal report.
 *
 * It exists as a SEPARATE, minimal module on purpose: the send-terminal ingress
 * service (Phase 8.0D-10B-4D4C4-B3B1) owns validation and the store write and
 * deliberately imports no transport at all, so the transport binding lives
 * here, exactly like `registerLiaBrainExecutionTerminalReportListener` binds the
 * round-terminal channel to its own ingress.
 *
 * It owns exactly ONE thing: the listener registration. The listener does not
 * sanitize, does not inspect and does not interpret - it forwards the raw,
 * still-untrusted payload to `sendTerminalReportService.report(...)` and nothing
 * else. The service owns the key/outcome validation, the store owns what a
 * repeated or conflicting settlement means, and the canonical report shape has a
 * single implementation.
 *
 * The asymmetry with the two triggering paths is deliberate and pinned: this
 * registration receives NO correlation observer and nothing on this path calls
 * one - the diagnostic reader and composition do not expose the send-level fact
 * yet, so triggering now would produce an observation that cannot represent it.
 * The existing triggers remain exactly the decision write, the execution-start
 * write and the round-terminal write.
 *
 * Deliberately absent: no state, no buffering, no queue, no timers, no async
 * layer, no retry, no fallback, no reader/facts, no diagnostic log, no
 * provider/model knowledge and no execution authority of any kind.
 */
export function registerLiaBrainSendTerminalReportListener(params: {
  context: MainContext
  /**
   * The canonical send-terminal ingress instance the composition root created
   * over the lifecycle-owned correlation store - never created or resolved here,
   * and never called with anything but the raw payload.
   */
  sendTerminalReportService: LiaBrainSendTerminalReportService
}): void {
  const { context, sendTerminalReportService } = params

  context.on(electronLiaBrainSendTerminalObservation, (event) => {
    // Raw forwarding: no field is read here, nothing is checked and nothing is
    // rewritten - the payload crosses this layer untouched, and the ingress
    // service decides whether it is a report at all.
    sendTerminalReportService.report((event as { body?: unknown } | undefined)?.body)
  })
}
