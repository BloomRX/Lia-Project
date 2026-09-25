import type { LiaBrainRoutingDecision } from '@lia/core'

/**
 * Phase 8.0D-10B-4C2A: the trusted expected-execution-route mapping.
 *
 * It answers exactly two questions about a CANONICAL Brain routing decision,
 * and nothing else:
 *
 *   1. "Which concrete Brain route did this decision select, if any?"
 *   2. "Which Stage execution provider/model identity does that route mean?"
 *
 * What it is:
 *   pure       a decision and a mapping come in, a factual value goes out;
 *              inputs are read and never mutated
 *   trusted    the expectation comes ONLY from the Brain decision plus this
 *              module's own mapping - never from anything an execution
 *              reported, and never learned at runtime
 *   read-only  no IPC, no logging, no config write, no provider resolution,
 *              no registry access, no Brain call, no correlation state, no
 *              catalog read
 *
 * What it deliberately does NOT know: execution observations. Nothing here
 * imports a report type, reads a correlation entry or asks whether two
 * identities agree - this module only states what a decision MEANS, so a
 * later, separately-owned consumer can place it next to what was observed.
 *
 * Domain boundary (Phase 8.0D-10B-4C1 audit): Brain engine/model ids and
 * Stage execution provider ids are DIFFERENT semantic domains, so
 * `providerId = engineId` is never a rule here - the mapping is an explicit,
 * audited table. The Brain side is owned by Lia Core's provider adapter
 * (`brain/adapters/groq.ts`: `GROQ_BRAIN_ENGINE_ID` / `GROQ_BRAIN_MODEL_ID`)
 * and the Stage side by the chat provider definitions
 * (`defineProvider({ id: 'groq' })` in stage-ui and the renderer's
 * `LIA_CHAT_PROVIDER_OPTIONS`). No shared constant connects the two domains
 * in this build, so the table below states the contract explicitly and the
 * focused tests pin it against the production Brain catalog.
 *
 * Authority boundary: an expectation is DIAGNOSTIC PRODUCT TRUTH. It grants
 * no execution authority whatsoever - it never selects, switches, retries or
 * overrides a provider, never writes a preference, policy or config, and it
 * cannot be influenced by a renderer, an execution claim or a runtime model
 * selection.
 */

/** One concrete selected Brain route: the Brain-domain engine + model ids. */
export interface LiaBrainSelectedRoute {
  engineId: string
  modelId: string
}

/**
 * The trusted Brain-engine -> Stage-provider mapping contract: an engine id
 * in, a provider id (or nothing) out.
 *
 * Deliberately minimal: ids only. No provider object, no provider
 * configuration, no credential, no resolver, no async surface - a lookup
 * table cannot execute anything.
 */
export interface LiaBrainEngineProviderMapping {
  providerIdForEngine: (engineId: string) => string | undefined
}

/**
 * The Stage execution provider id of Lia's current chat brain.
 *
 * Source finding of the Phase 8.0D-10B-4C2A audit: NO importable Stage-side
 * constant for this id exists in the trusted main layer. The id is declared
 * by the RENDERER store (`LIA_CHAT_PROVIDER_OPTIONS` in
 * `renderer/stores/lia/provider.ts`) and by the AIRI provider DEFINITION
 * (`defineProvider({ id: 'groq' })` in
 * `packages/stage-ui/src/libs/providers/providers/groq/index.ts`, which pulls
 * the provider runtime), and `@lia/core` exports the Brain descriptor factory
 * but not this id. Importing either into main would cross the renderer or
 * provider-runtime boundary, so this literal is the explicit Main-owned
 * statement of the current Stage execution-provider contract - never derived
 * at runtime, and pinned by the focused tests.
 */
export const GROQ_STAGE_CHAT_PROVIDER_ID = 'groq'

/**
 * The audited Brain engine -> Stage provider ids of THIS build: exactly the
 * production Brain engines the production catalog registers, and nothing
 * else. One engine today:
 *
 *   Brain engine `groq`  (Lia Core's Groq adapter, `GROQ_BRAIN_ENGINE_ID`)
 *   -> Stage provider `groq` (`defineProvider` / `LIA_CHAT_PROVIDER_OPTIONS`)
 *
 * No speculative entries: a Stage provider ships in this build that has NO
 * production Brain engine (OpenAI, Anthropic, Gemini, Ollama, Qwen and the
 * rest) and must not appear here, and a Brain engine with no mapping is
 * reported as unmapped rather than guessed. Module-private on purpose: the
 * only access path is the frozen mapping object below.
 */
const PRODUCTION_ENGINE_PROVIDER_IDS: ReadonlyMap<string, string> = new Map([
  ['groq', GROQ_STAGE_CHAT_PROVIDER_ID],
])

/**
 * The production mapping: module-owned, frozen, read-only data.
 *
 * There is no mutation API, no registration point and no dynamic learning -
 * an execution report can neither add nor replace an entry, and the same
 * holds for the renderer, a product-config write, an engine's declared
 * availability and any runtime model selection. Unknown ids read as
 * `undefined`, deterministically, and nothing is ever inferred from an id's
 * spelling.
 */
export const LIA_BRAIN_ENGINE_PROVIDER_MAPPING: LiaBrainEngineProviderMapping = Object.freeze({
  providerIdForEngine(engineId: string): string | undefined {
    return PRODUCTION_ENGINE_PROVIDER_IDS.get(engineId)
  },
})

/**
 * Extracts the ONE concrete selected Brain route of a decision, if the
 * decision has one.
 *
 * Exactly two decision shapes identify a selected route:
 *
 * A. automatic + selected - `decision.selection.route` is the engine+model
 *    pair the automatic policy established for the ready candidates;
 * B. manual + resolvedModel - `decision.resolution.engine` and
 *    `decision.resolution.model` are the user's explicit, validated pair.
 *
 * EVERY other shape returns `undefined`, including the shapes that carry
 * engine- or model-like fields without holding a complete selected route:
 * `modeUnspecified`, `disabled`, `automaticPolicyMissing`, the automatic
 * selections `noCandidates` / `noPolicyMatch` / `ambiguous` (the last one
 * names a candidate identity without establishing it as a route), and the
 * manual resolutions `noPreference`, `resolvedEngine` (engine only, no
 * model), `engineNotFound`, `engineIneligible` (may carry an engine, and the
 * model associated with it), `modelNotFound`, `modelIneligible`,
 * `modelEngineNotFound` and `modelEngineMismatch` (may carry an engine+model
 * pair that was refused as a route). Field presence is never a route.
 *
 * Readiness is deliberately NOT consulted: it describes whether an engine can
 * execute now, not whether the explicit route identity exists, so a
 * `resolvedModel` whose readiness is `configurationRequired` or `unavailable`
 * still identifies its route here.
 *
 * Pure: the decision is read, never mutated; no id is normalized, aliased,
 * rewritten or looked up in a catalog, and an unselected decision never
 * throws.
 */
export function selectedLiaBrainRoute(decision: LiaBrainRoutingDecision): LiaBrainSelectedRoute | undefined {
  // A. Automatic: only an ESTABLISHED selection is a route.
  if (decision.status === 'automatic') {
    const selection = decision.selection
    if (selection.status !== 'selected')
      return undefined
    return {
      engineId: selection.route.engine.id,
      modelId: selection.route.model.id,
    }
  }

  // B. Manual: only a fully resolved engine+model pair is a route.
  if (decision.status === 'manual') {
    const resolution = decision.resolution
    if (resolution.status !== 'resolvedModel')
      return undefined
    return {
      engineId: resolution.engine.id,
      modelId: resolution.model.id,
    }
  }

  // modeUnspecified / disabled / automaticPolicyMissing carry no route.
  return undefined
}

/** One expected Stage execution identity: provider plus the Brain route ids it came from. */
export interface LiaBrainExpectedRoute {
  engineId: string
  modelId: string
  providerId: string
}

/**
 * The factual expected-execution-route outcome for one decision.
 *
 * Neutral, non-evaluative naming on purpose: these are diagnosis states, not
 * verdicts. There is no score, no winner, no recommendation, and no state
 * that could switch, retry or override an execution.
 *
 * - `noBrainRouteSelected`  the decision identifies no selected route (every
 *   shape listed on `selectedLiaBrainRoute`), so there is nothing to expect;
 * - `engineMappingMissing`  a route WAS selected, but this build's trusted
 *   mapping has no Stage provider for its engine - reported factually, with
 *   the route's own ids, never repaired;
 * - `expectedRoute`         the selected route plus the Stage provider id the
 *   trusted mapping assigns to its engine.
 */
export type LiaBrainExpectedExecutionRoute
  = | { status: 'noBrainRouteSelected' }
    | { status: 'engineMappingMissing', engineId: string, modelId: string }
    | { status: 'expectedRoute', route: LiaBrainExpectedRoute }

/**
 * Derives the expected Stage execution identity of one Brain decision.
 *
 * Trust source: the decision alone decides WHICH route (via the canonical
 * extraction above) and the supplied mapping alone decides which Stage
 * provider that route's ENGINE means. Both are trusted inputs. Nothing else
 * participates: no execution report, no correlation entry, no provider
 * registry, no catalog, no product config - and the model id is the selected
 * Brain route's own id, preserved verbatim (no normalization, no alias, no
 * rewrite, no catalog lookup).
 *
 * A selected route whose engine is unmapped yields the factual
 * `engineMappingMissing` state; it is never replaced by the engine id, never
 * resolved through a provider registry, never learned from an execution and
 * never an exception. A decision with no selected route yields
 * `noBrainRouteSelected` and never fabricates an expectation.
 *
 * Pure: both inputs are read, never mutated; repeated calls with equal inputs
 * produce equal, freshly built values.
 */
export function expectedExecutionRouteForBrainDecision(
  decision: LiaBrainRoutingDecision,
  mapping: LiaBrainEngineProviderMapping,
): LiaBrainExpectedExecutionRoute {
  const selected = selectedLiaBrainRoute(decision)
  if (selected === undefined)
    return { status: 'noBrainRouteSelected' }

  const providerId = mapping.providerIdForEngine(selected.engineId)
  if (providerId === undefined)
    return { engineId: selected.engineId, modelId: selected.modelId, status: 'engineMappingMissing' }

  return {
    route: {
      engineId: selected.engineId,
      modelId: selected.modelId,
      providerId,
    },
    status: 'expectedRoute',
  }
}
