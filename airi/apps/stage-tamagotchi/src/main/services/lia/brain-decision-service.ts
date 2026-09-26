import type {
  LiaChatTurnBrainFacts,
} from '@lia/core'
import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type {
  LiaBrainChatDecision,
  LiaBrainChatDecisionRequest,
} from '../../../shared/eventa'
import type { LiaBrainCorrelationObserver } from './brain-correlation-observer'
import type { LiaBrainCorrelationService } from './brain-correlation-service'
import type { LiaBrainService } from './lia-brain-service'

import { brainRequirementForChatTurn, createProductionBrainAutomaticPolicy } from '@lia/core'
import { defineInvokeHandler } from '@moeru/eventa'

import { electronLiaBrainChatDecision } from '../../../shared/eventa'

type MainContext = ReturnType<typeof createContext>['context']

/**
 * Phases 8.0D-7/8.0D-7A, extended by 8.0D-8: the read-only renderer -> main
 * Brain decision bridge.
 *
 * One typed invoke: the renderer describes WHAT one chat turn needs (facts);
 * main maps those facts through the canonical `brainRequirementForChatTurn(...)`
 * and asks the Stage-owned Brain service for a routing decision, which is
 * returned unchanged.
 *
 * Authority boundary: renderer-controlled data may influence capability
 * REQUIREMENTS only (textInput/textOutput plus imageInput, reasoning,
 * toolCalling). It may NOT influence route identity or route precedence. The
 * automatic policy is TRUSTED PRODUCT STATE: it is created here, once, from
 * Lia Core's product policy (`createProductionBrainAutomaticPolicy()`) - never
 * from request data - and reused for every request.
 *
 * Mode semantics stay canonical: this bridge never inspects `brain.mode`.
 * Supplying the trusted policy unconditionally is safe because the unified
 * router is the authority - an absent mode yields `modeUnspecified`, a
 * disabled mode `disabled`, a manual mode ignores the automatic policy
 * entirely, and only an automatic mode consults it (capability eligibility
 * still decides which routes are candidates, and the policy never overrides
 * it).
 *
 * Read-only by construction - it computes a DECISION and grants no execution
 * authority: no config write, no provider/model selection, no registry
 * mutation, no SDK, no network, no inference, no chat state. The service is
 * the ONE owned by the Stage lifecycle (passed in through injeca); this
 * module never constructs a service or a catalog.
 *
 * Renderer data is untrusted: only the contract's own shape is read, field by
 * field, into fresh plain objects. Unknown keys (a policy blob, a providerId,
 * descriptors, callbacks, paths) are simply never looked at, so they cannot
 * reach the routing stack.
 *
 * Phase 8.0D-10B-4B3: the injected correlation store receives the canonical
 * decision as a DIAGNOSTIC fact, keyed by the request's opaque logical-send
 * key. This bridge only WRITES (`recordDecision`); it never reads, inspects or
 * interprets the retained state, and the store can influence nothing about the
 * decision - it is written strictly AFTER the decision already exists.
 *
 * Phase 8.0D-10B-4C4C: the injected diagnostic observer is triggered from the
 * SAME isolated block, strictly AFTER the successful write, so the dual-trigger
 * semantics proven by the 4C3B audit hold here: one completed factual mutation
 * produces exactly one observation of THAT key. The observer dependency is the
 * canonical lifecycle instance and its contract is one method - `observe(...)`
 * returning nothing - so this bridge cannot inspect a result, cannot learn about
 * facts, engines, providers or expectations, and cannot branch on diagnostics.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Phase 8.0D-10B-3B2: reads the request's opaque logical-send key.
 *
 * Transport metadata only. The value is opaque by contract: it is not parsed,
 * not validated against a format, not compared, not stored, and it never
 * reaches the requirement builder, the policy or `decide(...)`. A non-string
 * (or absent) value simply reads as "no key", following the same tolerant
 * field-by-field convention as `readFacts`.
 */
function readCorrelationId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Reads the three turn facts from the request. Only an explicit `true` turns
 * a flag on; anything else (absent, false, a string, a function) reads as
 * "this turn does not need it" - never as a hidden default.
 */
function readFacts(value: unknown): LiaChatTurnBrainFacts {
  if (!isRecord(value))
    return {}
  const facts: LiaChatTurnBrainFacts = {}
  if (value.hasImageInput === true)
    facts.hasImageInput = true
  if (value.reasoningRequested === true)
    facts.reasoningRequested = true
  if (value.usesTools === true)
    facts.usesTools = true
  return facts
}

/**
 * Registers the bridge on the given main-process context, using the Brain
 * service the lifecycle already owns.
 *
 * The trusted production automatic policy is created ONCE here, at
 * registration - the same lifecycle as the bridge itself - and reused by
 * every request. It is product state, so it is never rebuilt per renderer
 * call and never derived from request data.
 */
export function registerLiaBrainDecisionBridge(params: {
  context: MainContext
  brain: Pick<LiaBrainService, 'decide'>
  /**
   * Phase 8.0D-10B-4B3: the canonical correlation store, injected by the
   * lifecycle - the bridge never resolves or creates one itself. It is used for
   * exactly ONE diagnostic write (`recordDecision`) and is never read here.
   */
  correlationStore: LiaBrainCorrelationService
  /**
   * Phase 8.0D-10B-4C4C: the canonical diagnostic observer owned by the
   * lifecycle (the 4C4B provider) - never resolved or created here. It is
   * triggered once per successful decision write, receives the same opaque key,
   * and returns nothing: the bridge never reads, stores or branches on it.
   */
  correlationObserver: LiaBrainCorrelationObserver
}): void {
  const { context, brain, correlationStore, correlationObserver } = params
  const trustedAutomaticPolicy = createProductionBrainAutomaticPolicy()

  defineInvokeHandler(context, electronLiaBrainChatDecision, (request: LiaBrainChatDecisionRequest): LiaBrainChatDecision => {
    // Phase 8.0D-10B-3B2: the request may carry an opaque logical-send key. It
    // stays transport metadata: it is validated tolerantly (any non-string or
    // empty shape reads as "no key"), never parsed, and it never reaches the
    // requirement builder, the trusted policy or `decide(...)`.
    const correlationId = readCorrelationId(request?.correlationId)

    const decision = brain.decide({
      automaticPolicy: trustedAutomaticPolicy,
      requirement: brainRequirementForChatTurn(readFacts(request?.facts)),
    })

    // Phase 8.0D-10B-4B3: after a canonical decision exists, the diagnostic
    // record is filled with THAT decision - the very object the Brain service
    // returned, never reconstructed, normalized or compared. The write is
    // fire-and-forget and isolated: a correlation store that throws cannot
    // change the decision the renderer receives, cannot cause a second
    // `decide(...)`, and cannot surface an error to the caller.
    // Phase 8.0D-10B-4C4C: the observation follows the WRITE, in the same
    // isolated block - a record that throws is never observed, and a hostile
    // observer cannot escape either. Nothing about the returned decision
    // depends on this diagnostic path.
    if (correlationId !== undefined) {
      try {
        correlationStore.recordDecision(correlationId, decision)
        // Ordering is the contract: the factual mutation completes first, and
        // only then is THAT key observed. The returned value is discarded (it
        // is `void`), so no diagnostic result is inspected or acted upon.
        correlationObserver.observe(correlationId)
      }
      catch {
        // Diagnostic memory only: the decision below is unaffected.
      }
    }

    return decision
  })
}
