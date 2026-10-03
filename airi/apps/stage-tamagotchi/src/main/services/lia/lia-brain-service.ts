import type {
  LiaBrainAutomaticSelectionPolicy,
  LiaBrainCapabilityRequirement,
  LiaBrainCatalog,
  LiaBrainRoutingDecision,
  LiaProductConfigSnapshot,
} from '@lia/core'

import { createProductionBrainCatalog, decideBrainRouteFromProductState } from '@lia/core'

/**
 * Phase 8.0D-4: the Stage-main Brain host service.
 *
 * It is the smallest host-layer surface over the Brain foundation: it owns
 * ONE production Brain catalog (built at construction, static for the
 * process lifetime) and answers routing questions about Lia's REAL product
 * state by reading the canonical product config owner and handing the
 * snapshot to Lia Core's runtime bridge.
 *
 * OBSERVATIONAL BY CONTRACT: nothing consumes `decide(...)` yet. The
 * service does not choose the chat provider or model, does not touch the
 * conversation/voice/persona paths and registers no IPC surface - it only
 * makes the routing decision reachable from the host layer.
 *
 * Everything provider-specific stays in Lia Core: Stage never names an
 * engine or model, never registers engines and never builds a descriptor.
 * Decisions are data, not exceptions: `modeUnspecified`, `disabled`, manual
 * failures, `automaticPolicyMissing`, `noCandidates`, `noPolicyMatch` and
 * `ambiguous` are all returned unchanged. The caller supplies the
 * capability requirement and (when it wants automatic routing) the explicit
 * policy - this service bakes in neither.
 */

/** The one thing this service needs from the host: the current product document. */
export interface LiaBrainServiceDeps {
  /**
   * The canonical Stage-main Lia product config owner (the `configs:lia-product`
   * injeca provider). Read-only here: this service never writes config.
   */
  liaProductConfig: { get: () => LiaProductConfigSnapshot | undefined }
}

/** One routing question. Both fields are caller-owned; neither has a default. */
export interface LiaBrainDecisionRequest {
  /** What the task needs - the chat integration phase defines its own. */
  requirement: LiaBrainCapabilityRequirement
  /** Explicit ordered policy; its absence is a truthful `automaticPolicyMissing`. */
  automaticPolicy?: LiaBrainAutomaticSelectionPolicy
}

export interface LiaBrainService {
  /** The production catalog owned by this instance (constructed once). */
  catalog: LiaBrainCatalog
  /** Evaluates the CURRENT product state; pure read, never throws for normal outcomes. */
  decide: (request: LiaBrainDecisionRequest) => LiaBrainRoutingDecision
}

/**
 * Creates the Brain host service.
 *
 * The production catalog is composed ONCE, here - catalog construction
 * failures are application-owned invariant failures and propagate to the
 * caller (the service is never handed an empty catalog). Every `decide(...)`
 * call re-reads the product config through the canonical owner, so a
 * preference change made after construction is observed by the next call.
 */
export function createLiaBrainService(deps: LiaBrainServiceDeps): LiaBrainService {
  const catalog = createProductionBrainCatalog()

  return {
    catalog,
    decide(request) {
      return decideBrainRouteFromProductState({
        automaticPolicy: request.automaticPolicy,
        engines: catalog.engines,
        models: catalog.models,
        requirement: request.requirement,
        // The snapshot is forwarded verbatim - this service never reads the
        // routing-mode or preferred-id fields itself; the canonical readers
        // inside the bridge own that shape.
        snapshot: deps.liaProductConfig.get() ?? {},
      })
    },
  }
}
