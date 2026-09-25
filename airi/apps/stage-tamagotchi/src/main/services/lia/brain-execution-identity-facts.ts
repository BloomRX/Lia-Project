import type { LiaBrainRoutingDecision } from '@lia/core'

import type { LiaBrainEngineProviderMapping, LiaBrainExpectedRoute } from './brain-expected-route'

import { expectedExecutionRouteForBrainDecision } from './brain-expected-route'

/**
 * Phase 8.0D-10B-4C2B: the pure per-attempt execution identity facts.
 *
 * It answers exactly one question, per observed attempt:
 *
 *   "Does this observed execution identity equal the identity the TRUSTED
 *    Brain decision expects?"
 *
 * ...and nothing further. The expectation comes from the canonical
 * expected-route foundation (Phase 8.0D-10B-4C2A, `brain-expected-route.ts`)
 * and is derived from the trusted decision plus the trusted engine -> provider
 * mapping only. The observed attempt contributes ONLY what was observed
 * (`roundId`, `providerId`, `modelId`) - an observed identity never defines,
 * repairs or influences the expectation.
 *
 * What it is:
 *   pure        a snapshot and a mapping come in, a factual value goes out;
 *               inputs are read and never mutated, and every returned object
 *               is fresh
 *   per-attempt each attempt keeps its own place in the observed order
 *               (`arrivalIndex`) and its own two equality facts, which stay
 *               INDEPENDENT - a provider may be equal while the model is not,
 *               and vice versa
 *   read-only   no correlation-store access, no IPC, no logging, no config,
 *               no provider resolution, no Brain call, no timers, no I/O
 *
 * What it deliberately does NOT do: it never reduces several attempts to one
 * verdict. There is no route-level equality, no aggregate "any/first/last"
 * fact, no fallback interpretation, no count classification, no preferred or
 * chosen attempt, no score and no recommendation. The attempt array itself is
 * the factual evidence; aggregation is explicitly deferred to a later phase.
 */

/**
 * The minimum an observed execution attempt must carry for these facts.
 *
 * Deliberately NOT the transport contract: a real
 * `LiaBrainExecutionObservationReport` (or the correlation store's own copy of
 * it) is structurally compatible because it carries at least these three
 * fields, and nothing here needs the opaque correlation key, the conversation
 * id or any store timestamp.
 */
export interface LiaObservedExecutionIdentity {
  modelId: string
  providerId: string
  roundId: string
}

/**
 * The minimum snapshot these facts need: the canonical decision of one logical
 * send (when one was recorded) plus the attempts observed for it, in the order
 * they were reported.
 *
 * Deliberately structural: no correlation-store import, no transport contract,
 * no store type. A real correlation-store entry satisfies this shape as-is -
 * its `executions` carry the three identity fields above - and its
 * `correlationId`/`createdAt` metadata plays no part here, so this
 * transformation is order-free and metadata-free by construction.
 */
export interface LiaBrainExecutionIdentitySnapshot {
  decision?: LiaBrainRoutingDecision
  executions: readonly LiaObservedExecutionIdentity[]
}

/**
 * One observed attempt, preserved verbatim and placed in the observed order.
 *
 * `arrivalIndex` is the attempt's own position in the input array (0, 1, 2...):
 * nothing is sorted, deduplicated or renumbered.
 */
export interface LiaBrainObservedAttempt {
  arrivalIndex: number
  modelId: string
  providerId: string
  roundId: string
}

/**
 * One observed attempt enriched with the TWO independent identity facts.
 *
 * Exact equality, field by field: `providerIdentityEqual` is
 * `observed.providerId === expected.providerId` and `modelIdentityEqual` is
 * `observed.modelId === expected.modelId`. No normalization, no case folding,
 * no alias, no substring matching, no catalog lookup. The two facts are never
 * combined into a single verdict.
 */
export interface LiaBrainAttemptIdentityFact extends LiaBrainObservedAttempt {
  modelIdentityEqual: boolean
  providerIdentityEqual: boolean
}

/**
 * The factual outcome of one derivation. Every state is a diagnosis state, not
 * a verdict - none of them says that an execution was correct, wrong, expected
 * or unexpected:
 *
 * - `decisionNotObserved`  the snapshot carries no Brain decision at all, so
 *   there is nothing to expect; the raw observed attempts are preserved as
 *   factual metadata and no expectation is fabricated;
 * - `noBrainRouteSelected` the decision exists but identifies no selected
 *   route; observed executions stay preserved - an execution having happened
 *   does NOT turn this into an error;
 * - `engineMappingMissing` a route was selected but this build's trusted
 *   mapping assigns it no Stage provider; the route's own ids and the observed
 *   attempts are preserved, never repaired;
 * - `noExecutionObserved`  a trusted expected route exists and NO attempt was
 *   observed in this snapshot; this says nothing about timeouts or failures,
 *   only that no execution observation is present;
 * - `attemptIdentityFacts` a trusted expected route exists and one or more
 *   attempts were observed - every attempt carries its own two equality facts.
 */
export type LiaBrainExecutionIdentityFacts
  = | { attempts: LiaBrainObservedAttempt[], status: 'decisionNotObserved' }
    | { attempts: LiaBrainObservedAttempt[], status: 'noBrainRouteSelected' }
    | { attempts: LiaBrainObservedAttempt[], engineId: string, modelId: string, status: 'engineMappingMissing' }
    | { attempts: [], expected: LiaBrainExpectedRoute, status: 'noExecutionObserved' }
    | { attempts: LiaBrainAttemptIdentityFact[], expected: LiaBrainExpectedRoute, status: 'attemptIdentityFacts' }

/** Copies one observed attempt into a fresh plain object, in the observed order. */
function observedAttempt(execution: LiaObservedExecutionIdentity, arrivalIndex: number): LiaBrainObservedAttempt {
  return {
    arrivalIndex,
    modelId: execution.modelId,
    providerId: execution.providerId,
    roundId: execution.roundId,
  }
}

/**
 * Derives the per-attempt execution identity facts of one snapshot.
 *
 * Steps, in order:
 * 1. no decision -> `decisionNotObserved` (observed attempts preserved);
 * 2. the canonical expected-route foundation decides WHICH identity is
 *    expected (trusted decision + trusted mapping only):
 *    - no selected route -> `noBrainRouteSelected` (attempts preserved);
 *    - selected route without a mapping -> `engineMappingMissing` (the route's
 *      ids plus the observed attempts preserved);
 * 3. an expected route with no observed attempt -> `noExecutionObserved`;
 * 4. an expected route with attempts -> `attemptIdentityFacts`, one entry per
 *    observed attempt, in the observed order.
 *
 * The mapping is consulted ONLY through that foundation, and only ever with the
 * trusted selected engine id: observed provider/model strings are compared
 * against the expectation, never used to build it.
 *
 * Pure: the snapshot, its attempts and the mapping are read, never mutated; a
 * returned value shares no object with the input, and a later call with the
 * same inputs is unaffected by any mutation of an earlier result.
 */
export function deriveLiaBrainExecutionIdentityFacts(
  snapshot: LiaBrainExecutionIdentitySnapshot,
  mapping: LiaBrainEngineProviderMapping,
): LiaBrainExecutionIdentityFacts {
  const [decision, executions] = [snapshot.decision, snapshot.executions]
  const observed = executions.map(observedAttempt)

  // 1. Nothing was decided for this logical send: no expectation can exist.
  if (decision === undefined)
    return { attempts: observed, status: 'decisionNotObserved' }

  const expected = expectedExecutionRouteForBrainDecision(decision, mapping)

  // 2. The decision identifies no selected route (or its engine is unmapped).
  if (expected.status === 'noBrainRouteSelected')
    return { attempts: observed, status: 'noBrainRouteSelected' }
  if (expected.status === 'engineMappingMissing')
    return { attempts: observed, engineId: expected.engineId, modelId: expected.modelId, status: 'engineMappingMissing' }

  // 3. A trusted expectation exists, and no attempt was observed for it.
  if (observed.length === 0)
    return { attempts: [], expected: expected.route, status: 'noExecutionObserved' }

  // 4. Every observed attempt keeps its own place and its own two facts.
  return {
    attempts: observed.map(attempt => ({
      ...attempt,
      modelIdentityEqual: attempt.modelId === expected.route.modelId,
      providerIdentityEqual: attempt.providerId === expected.route.providerId,
    })),
    expected: expected.route,
    status: 'attemptIdentityFacts',
  }
}
