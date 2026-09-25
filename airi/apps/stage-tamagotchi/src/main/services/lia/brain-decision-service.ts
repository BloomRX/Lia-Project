import type {
  LiaBrainAutomaticSelectionPolicy,
  LiaBrainRouteRef,
  LiaChatTurnBrainFacts,
} from '@lia/core'
import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type {
  LiaBrainChatDecision,
  LiaBrainChatDecisionRequest,
} from '../../../shared/eventa'
import type { LiaBrainService } from './lia-brain-service'

import { brainRequirementForChatTurn } from '@lia/core'
import { defineInvokeHandler } from '@moeru/eventa'

import { electronLiaBrainChatDecision } from '../../../shared/eventa'

type MainContext = ReturnType<typeof createContext>['context']

/**
 * Phase 8.0D-7: the read-only renderer -> main Brain decision bridge.
 *
 * One typed invoke: the renderer describes WHAT one chat turn needs (facts)
 * and optionally hands over an explicit automatic selection policy; main maps
 * those facts through the canonical `brainRequirementForChatTurn(...)` and
 * asks the Stage-owned Brain service for a routing decision, which is
 * returned unchanged.
 *
 * Read-only by construction - it computes a DECISION and grants no execution
 * authority: no config write, no provider/model selection, no registry
 * mutation, no SDK, no network, no inference, no chat state. The service is
 * the ONE owned by the Stage lifecycle (passed in through injeca); this
 * module never constructs a service or a catalog.
 *
 * Renderer data is untrusted: only the contract's own shape is read, field by
 * field, into fresh plain objects. Unknown keys (a providerId, descriptor
 * blobs, callbacks, paths) are simply never looked at, so they cannot reach
 * the routing stack. No production chat code calls this yet.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
 * Reads the explicit policy, keeping only well-formed route references.
 * Anything else - a missing list, a malformed entry, a foreign object - is
 * dropped rather than trusted; an empty result stays `undefined`, so a
 * missing policy keeps its honest `automaticPolicyMissing` outcome instead of
 * becoming an invented default.
 */
function readPolicy(value: unknown): LiaBrainAutomaticSelectionPolicy | undefined {
  if (!isRecord(value) || !Array.isArray(value.routes))
    return undefined
  const routes: LiaBrainRouteRef[] = []
  for (const entry of value.routes) {
    if (!isRecord(entry) || typeof entry.engineId !== 'string' || typeof entry.modelId !== 'string')
      continue
    routes.push({ engineId: entry.engineId, modelId: entry.modelId })
  }
  return routes.length > 0 ? { routes } : undefined
}

/**
 * Registers the bridge on the given main-process context, using the Brain
 * service the lifecycle already owns.
 */
export function registerLiaBrainDecisionBridge(params: {
  context: MainContext
  brain: Pick<LiaBrainService, 'decide'>
}): void {
  const { context, brain } = params

  defineInvokeHandler(context, electronLiaBrainChatDecision, (request: LiaBrainChatDecisionRequest): LiaBrainChatDecision => {
    return brain.decide({
      automaticPolicy: readPolicy(request?.automaticPolicy),
      requirement: brainRequirementForChatTurn(readFacts(request?.facts)),
    })
  })
}
