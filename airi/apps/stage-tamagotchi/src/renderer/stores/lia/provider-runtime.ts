import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'

/**
 * The Lia's own boundary for provider *runtime* access (E2).
 *
 * Why this file exists
 * --------------------
 *
 * Building a provider instance is not a read. `getProviderInstance` looks the
 * credential up, may create the provider record as a side effect when the
 * definition needs none, resolves the per-build secret, applies the schema
 * defaults and caches the instance. Four Lia modules reached that operation and
 * its three siblings by importing the shared Stage store directly, which made
 * one dependency appear in four places with four different names for it
 * (`providersStore`, `providerStore`).
 *
 * This module is the single address for those four operations. Nothing else.
 *
 * **It still delegates.** Every member below calls the shared Stage store,
 * untouched, on every invocation. There is no cache here, no second copy of the
 * credential logic, no fallback and no reimplementation: this is an extraction
 * of interface, not a Lia runtime. The provider records, the instance cache and
 * the runtime state all still live in the shared stores, and every Stage
 * consumer of them keeps looking at exactly the same objects.
 *
 * The semantics this port must not disturb are pinned in
 * `provider-runtime-semantics.test.ts` (E1) against the shared store directly,
 * and re-asserted through the port in `provider-runtime.test.ts`.
 *
 * What this unlocks
 * -----------------
 *
 * The dependency that becomes swappable is the **instance lifecycle**: building,
 * discarding, and the two model-listing reads bound to an explicitly chosen
 * provider. A future implementation can replace this module's body without
 * touching a call site.
 *
 * What it does NOT unlock, and must not be sold as unlocking: validation goes
 * through `provider-validation.ts`, activation through
 * `provider-activation.ts`, and the Lia still reads the provider
 * configuration through `provider-config-facade.ts`. Those are three separate
 * boundaries on purpose.
 *
 * Why `canListModels` and not `supportsModelListing`
 * --------------------------------------------------
 *
 * The static frontier in `provider-config-facade.test.ts` works by looking for
 * the shared store's member names outside the module that is allowed to use
 * them. A port member spelled exactly like the delegate would make a port call
 * and a direct store call indistinguishable to that check, so the predicate is
 * named for what the caller gets, not for what the store calls it. `listModels`
 * and `getInstance` differ for the same reason; `dispose` was already distinct.
 *
 * Reference: docs/architecture/LIA-STAGE-DEPENDENCY-MAP-2026-10-28.md and the
 * B0.9 dependency map, section 6, candidate P1.
 */

/**
 * The store instance type is derived from the real definition rather than
 * re-declared, so these signatures cannot drift from the runtime they delegate
 * to. Nothing here invents a return type.
 */
type SharedProviderRuntimeStore = ReturnType<typeof useProviderStore>

/**
 * The slice of the shared provider runtime store this port needs.
 *
 * Declared structurally, the same way the activation port declares its source,
 * so a test can substitute a double and observe the delegation with no Pinia
 * and no Stage store involved.
 */
export interface LiaProviderRuntimeSource {
  getProviderInstance: SharedProviderRuntimeStore['getProviderInstance']
  disposeProviderInstance: SharedProviderRuntimeStore['disposeProviderInstance']
  supportsModelListing: SharedProviderRuntimeStore['supportsModelListing']
  getModelsForProvider: SharedProviderRuntimeStore['getModelsForProvider']
}

/** The four operations the Lia's runtime access is allowed to use. */
export interface LiaProviderRuntime {
  /**
   * The cached instance for a provider, built on first use.
   *
   * Everything the shared implementation does on that path is preserved:
   * credential lookup, the record it may create for a credential-free
   * definition, the resolved secret, the schema defaults applied afterwards,
   * the cache, and the error when a required credential is missing.
   */
  getInstance: SharedProviderRuntimeStore['getProviderInstance']
  /** Releases the cached instance so the next build re-resolves the credential. */
  dispose: SharedProviderRuntimeStore['disposeProviderInstance']
  /** Whether the provider has a definition that can list models at all. */
  canListModels: SharedProviderRuntimeStore['supportsModelListing']
  /** The model catalog already loaded for a provider, empty until it is. */
  listModels: SharedProviderRuntimeStore['getModelsForProvider']
}

/**
 * Builds the port over any structurally compatible source.
 *
 * Kept separate from {@link useLiaProviderRuntime} so tests can pass a double
 * and observe the delegation itself.
 */
export function createLiaProviderRuntime(
  source: LiaProviderRuntimeSource,
): LiaProviderRuntime {
  return {
    canListModels: providerId => source.supportsModelListing(providerId),
    dispose: providerId => source.disposeProviderInstance(providerId),
    getInstance: providerId => source.getProviderInstance(providerId),
    listModels: providerId => source.getModelsForProvider(providerId),
  }
}

/**
 * The port bound to the shared Stage provider runtime, which remains the
 * implementation.
 *
 * The import of the shared store lives here and only here for these four
 * operations.
 */
export function useLiaProviderRuntime(): LiaProviderRuntime {
  return createLiaProviderRuntime(useProviderStore())
}
