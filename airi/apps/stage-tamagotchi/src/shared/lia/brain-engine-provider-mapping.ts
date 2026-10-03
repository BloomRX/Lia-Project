/**
 * Phase 8.0D-10B-4D4C4-D2B1-F: process-neutral Lia Brain engine → Stage provider mapping.
 *
 * Pure, shared, no process affinity: used by both main (expected-route derivation) and
 * renderer (route-candidate adapter). Renderer must NOT import from src/main/** and main
 * must not depend on renderer — this module is the single canonical owner.
 *
 * See also `main/services/lia/brain-expected-route.ts` which imports this mapping
 * and derives the expected execution route; no other table or switch exists.
 */

/** The trusted Brain-engine -> Stage-provider mapping contract. */
export interface LiaBrainEngineProviderMapping {
  providerIdForEngine: (engineId: string) => string | undefined
}

/**
 * The Stage execution provider id of Lia's current chat brain.
 * See brain-expected-route.ts for audit provenance.
 */
export const GROQ_STAGE_CHAT_PROVIDER_ID = 'groq'

/**
 * The audited Brain engine -> Stage provider ids of THIS build: exactly the
 * production Brain engines the production catalog registers, and nothing else.
 */
const PRODUCTION_ENGINE_PROVIDER_IDS: ReadonlyMap<string, string> = new Map([
  ['groq', GROQ_STAGE_CHAT_PROVIDER_ID],
])

/**
 * The production mapping: module-owned, frozen, read-only data.
 * Single canonical definition — no duplication.
 */
export const LIA_BRAIN_ENGINE_PROVIDER_MAPPING: LiaBrainEngineProviderMapping = Object.freeze({
  providerIdForEngine(engineId: string): string | undefined {
    return PRODUCTION_ENGINE_PROVIDER_IDS.get(engineId)
  },
})
