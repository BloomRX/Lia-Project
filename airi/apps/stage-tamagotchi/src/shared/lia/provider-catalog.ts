/**
 * The chat providers the Lia offers, as one list that both halves of the
 * process boundary can agree on.
 *
 * Why this file exists
 * --------------------
 *
 * Before this module, "is this provider migrated to the main-process transport?"
 * was answered by `isNativeTransportDefinition()` in the renderer, by a second
 * literal `Set` in the main-process execution service, and by the curated list
 * the onboarding UI renders. Three lists, two of them literal, and no rule that
 * kept them equal. Migrating a provider meant editing both, and forgetting one
 * left that provider silently on the legacy path — the failure this module
 * makes impossible to express.
 *
 * It is deliberately data only: ids and predicates, no endpoints, no models, no
 * vendor behaviour. Endpoints stay in the provider schemas that already declare
 * them (`@proj-airi/stage-ui/libs/providers/providers/<id>/index.ts`), so there
 * is still exactly one place a default URL is written. A second copy of
 * `https://api.openai.com/v1` here would be a future drift, not a convenience.
 *
 * Why the ids are literal
 * -----------------------
 *
 * `LIA_CHAT_PROVIDER_OPTIONS` in `renderer/stores/lia/provider.ts` carries UI
 * chrome (labels, key-management URLs) and cannot be imported by the main
 * process. These ids are the stable contract between the two; the UI list
 * references them and a test pins that the two sets are equal, so neither can
 * grow without the other.
 *
 * Every id here must satisfy two properties, checked by tests rather than
 * assumed:
 *
 *  1. its AIRI definition speaks `chat/completions` with `Authorization: Bearer`
 *     — which is what `lia/core`'s `ProviderRuntime` implements;
 *  2. its AIRI definition declares `tasks: ['chat']`, so denying the renderer
 *     read access to its credential scope cannot break speech or transcription.
 *
 * Reference: docs/architecture/LIA-NEXT-DECOUPLING-PLAN.md §6 (Corte B).
 */

/** The chat providers the Lia curates. Every one executes in the main process. */
export const CURATED_CHAT_PROVIDER_IDS = [
  'openai',
  'groq',
  'cerebras-ai',
  'anthropic',
  'xai',
  'mistral-ai',
  'openrouter-ai',
  'openai-compatible',
  'lm-studio',
  'ollama',
] as const

export type CuratedChatProviderId = typeof CURATED_CHAT_PROVIDER_IDS[number]

const curated = new Set<string>(CURATED_CHAT_PROVIDER_IDS)

/**
 * Whether this provider id executes through the main-process transport.
 *
 * The single rule the renderer and the main process both consult. An unknown id
 * — including a user's custom transport, which is keyed by its own id — is not
 * curated; those are owned by the presence of a transport record instead.
 */
export function isCuratedChatProvider(id: string): boolean {
  return curated.has(id)
}
