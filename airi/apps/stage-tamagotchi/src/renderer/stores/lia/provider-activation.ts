import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'

/**
 * The Lia's own boundary for provider *activation* (B0.8-lite).
 *
 * Why this file exists
 * --------------------
 *
 * Activating a provider is two operations with very different shapes:
 *
 *  - `initializeProvider(id)` — makes sure the record exists with the
 *    definition's defaults and seeds the runtime state. Async, no network;
 *  - `forceProviderConfigured(id)` — seals the record as `'configured'` and
 *    marks the provider as added. Synchronous, no network.
 *
 * Until now `stores/lia/provider.ts` called both directly on the shared
 * `useProviderStore`. That access is correct but unnamed: it is the same pair
 * AIRI's own defaults command uses, and nothing in the Lia marked it as a
 * dependency with a boundary. This module is that boundary, and nothing more.
 *
 * **It still delegates.** The implementation behind both members is the shared
 * Stage store, untouched. This is an extraction of interface, not a Lia runtime:
 * the provider records, the runtime state and the `added` flag all still live in
 * the shared stores, and every reader of them (the Stage's provider settings
 * pages, `configuredProviders`, `listedProviders`, `providerCredentials`) keeps
 * looking at exactly the same state as before. That is deliberate — see
 * "what this unlocks" below for what a real replacement would first have to do.
 *
 * What this unlocks
 * -----------------
 *
 * The dependency that becomes swappable is the **activation pair only**:
 * `@proj-airi/stage-ui/stores/providers/provider` for `initializeProvider` and
 * `forceProviderConfigured`. A future implementation can replace this module's
 * body without touching a single call site in the Lia.
 *
 * What it does NOT unlock, and must not be sold as unlocking: the Lia still
 * reads `configuredProviders` (through the config facade), still calls
 * `validateProviderConfig`, `disposeProviderInstance`, `getProviderInstance`,
 * `supportsModelListing` and `getModelsForProvider`, and still depends on the
 * shared store keeping the records where the Stage expects them. Migrating
 * those reads is a separate, larger step.
 *
 * Why the order is load-bearing
 * -----------------------------
 *
 * `initialize` must happen before `markConfigured`: sealing a provider that has
 * no record would leave the runtime pointing at nothing, and the status would be
 * written onto an entry the runtime state never saw. The two members are
 * therefore exposed separately rather than as one `activateAndConfigure()` — the
 * caller keeps owning the order, exactly as the call sites do today.
 *
 * Reference: docs/architecture/LIA-STAGE-DEPENDENCY-MAP-2026-10-28.md §14 and
 * docs/architecture/LIA-PROVIDER-ADAPTER-DESIGN-2026-10-29.md §3.3.
 */

/**
 * The slice of the shared provider runtime store this port needs.
 *
 * Declared structurally rather than imported as the store's type, so the
 * boundary states in one place exactly which capabilities activation depends
 * on — and so a test can substitute a double to observe the delegation.
 */
export interface LiaProviderActivationSource {
  initializeProvider: (providerId: string) => Promise<void>
  forceProviderConfigured: (providerId: string) => void
}

/** The two operations the Lia's activation path is allowed to use. */
export interface LiaProviderActivation {
  /**
   * Ensures the provider record exists with the definition's defaults and emits
   * the runtime state entry. Local only: no configuration request is made.
   */
  activate: (providerId: string) => Promise<void>
  /**
   * Marks an existing record as configured and the provider as added.
   *
   * Synchronous, matching the delegate: the shared operation reads the current
   * config, caches its hash and writes the two flags without awaiting anything.
   * Call it after {@link LiaProviderActivation.activate}.
   */
  markConfigured: (providerId: string) => void
}

/**
 * Builds the port over any structurally compatible source.
 *
 * Kept separate from {@link useLiaProviderActivation} so tests can pass a
 * double and observe the delegation itself, with no Pinia and no Stage store
 * involved.
 */
export function createLiaProviderActivation(
  source: LiaProviderActivationSource,
): LiaProviderActivation {
  return {
    activate: providerId => source.initializeProvider(providerId),
    markConfigured: providerId => source.forceProviderConfigured(providerId),
  }
}

/**
 * The port bound to the shared Stage provider runtime, which remains the
 * implementation.
 *
 * The import of the shared store lives here and only here for these two
 * operations, so the activation dependency has a single address.
 */
export function useLiaProviderActivation(): LiaProviderActivation {
  return createLiaProviderActivation(useProviderStore())
}
