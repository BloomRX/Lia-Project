import type { InferenceServiceProvider, ProviderValidationStatus } from '@proj-airi/stage-ui/libs/providers/types'

import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'

/**
 * The Lia's own boundary for provider *configuration* (B0.7).
 *
 * Why this file exists
 * --------------------
 *
 * Four Lia stores read and write the Stage's provider configuration, and until
 * now each of them imported `@proj-airi/stage-ui/stores/providers/config`
 * directly. That import is the coupling the decoupling plan has to remove: as
 * long as it is spread across the Lia's stores, "which part of the Stage does
 * the Lia actually need?" can only be answered by grepping, and a future
 * replacement has no seam to be dropped into.
 *
 * This module is that seam, and nothing more. It is a **facade**, not a store
 * and not a second source of truth:
 *
 *  - every member delegates to the shared Stage store, which stays
 *    authoritative — same `localStorage` keys, same migration, same
 *    cross-window synchronization (`pinia-plugin-synced`, `state: true`);
 *  - it adds no state, no cache and no lifecycle of its own, so instantiation
 *    order is unchanged: calling `useLiaProviderConfigFacade()` instantiates the
 *    shared store at exactly the moment the direct call used to;
 *  - it exposes only the five operations the Lia's own stores call today. It is
 *    deliberately not a copy of the store's API — `fetchProviders`,
 *    `addProvider`, `removeProvider`, `resetProviders`, `setProviderStatus`,
 *    `markProviderAdded` and the query/mutation handles stay out, because no
 *    Lia code path drives them and exposing them would invent a contract the
 *    Lia does not have.
 *
 * What still has a remote effect
 * ------------------------------
 *
 * `updateConfig` is the **only** member with a remote effect, and it keeps it:
 * the shared store performs the local write *and* replicates the change with a
 * `PATCH` to the AIRI service. B0.7 does not disable that replication, so
 * behaviour on the wire is identical to before this file existed. `ensure` is
 * local-only. `LIA_PROVIDER_CONFIG_REMOTE_EFFECTS` states this as data so a test
 * can pin it and so the next step (making the remote effect optional) has an
 * explicit list to work from instead of a memory.
 *
 * Two deliberate narrowings versus the B0.6 sketch
 * -----------------------------------------------
 *
 * The B0.6 design proposed `LiaProviderConfig = Record<string, string>` and a
 * three-value `LiaProviderStatus` that included `'bypassed'`. Reality is
 * narrower in one dimension and wider in the other, so both were adjusted
 * rather than forced:
 *
 *  - **Payload stays `Record<string, unknown>`.** The shared store's own
 *    signature is `Record<string, unknown>`, and records migrated from the
 *    legacy `settings/credentials/providers` key are copied verbatim, so a
 *    value is not guaranteed to be a string. Narrowing here would need an
 *    unchecked cast at the delegation point — a type that lies in the one place
 *    that is supposed to describe reality.
 *  - **Status is `'unconfigured' | 'configured'`.** Those are the only two
 *    statuses any Lia configuration flow writes; `'bypassed'` is only ever read
 *    (in B0.4's ownership policy), and `'validating'` / `'invalid'` belong to
 *    the Stage's validation lifecycle, which the Lia does not drive.
 *
 * What this file deliberately does NOT do
 * ---------------------------------------
 *
 * It does not enforce "no credential in the config payload" with a type or a
 * runtime guard. A guard was considered and rejected: `ensure` and `updateConfig`
 * receive whatever the shared store already holds, and the legacy migration key
 * is literally `settings/credentials/providers`, so an install that predates the
 * migration can legitimately carry an `apiKey` inside `config`. Throwing on it
 * would turn a supported historical state into a crash. The credential rule
 * stays where it already is and already holds: the Lia never *adds* a key here,
 * and the vault resolver supplies it in memory at provider-build time.
 *
 * Reference: docs/architecture/LIA-PROVIDER-ADAPTER-DESIGN-2026-10-29.md §3.
 */

/**
 * Status a Lia configuration flow may write.
 *
 * A strict subset of the Stage's `ProviderValidationStatus`, so it is assignable
 * to the shared store without a cast.
 */
export type LiaProviderStatus = 'unconfigured' | 'configured'

/**
 * One provider configuration payload.
 *
 * Intentionally not narrowed to `Record<string, string>`: see the module note.
 * This type is the Lia's description of what it *passes through* — it is not a
 * claim that the payload contains no credential, and nothing here adds one.
 */
export type LiaProviderConfig = Record<string, unknown>

/**
 * The slice of the shared provider-config store this facade needs.
 *
 * Declared structurally, not imported as the store's type, for two reasons: the
 * boundary then states in one place exactly which capabilities the Lia depends
 * on, and a test can substitute a plain object to prove the facade adds no
 * behaviour of its own.
 */
export interface LiaProviderConfigSource {
  getProvider: (providerId: string) => InferenceServiceProvider | undefined
  getProviderConfig: (providerId: string) => Record<string, unknown> | undefined
  configuredProviders: Record<string, boolean>
  ensureProvider: (providerId: string, definitionId: string, config?: Record<string, unknown>) => InferenceServiceProvider
  updateProviderConfig: (
    providerId: string,
    config: Record<string, unknown>,
    status: ProviderValidationStatus,
  ) => Promise<InferenceServiceProvider | undefined>
}

/** The five operations the Lia's stores are allowed to use. */
export interface LiaProviderConfigFacade {
  /** The whole provider record, or `undefined`. Local read only. */
  get: (providerId: string) => InferenceServiceProvider | undefined
  /** Only the configuration payload. Local read only. */
  getConfig: (providerId: string) => LiaProviderConfig | undefined
  /** Whether the shared store currently reports the provider as configured. */
  isConfigured: (providerId: string) => boolean
  /**
   * Creates the record when absent and returns the existing one otherwise.
   *
   * Local only: it never reaches the remote service, because the shared store's
   * `ensureProvider` writes just the cross-window snapshot.
   */
  ensure: (providerId: string, definitionId: string, config?: LiaProviderConfig) => InferenceServiceProvider
  /**
   * Replaces the payload and status of an existing record.
   *
   * **Has a remote effect.** The shared store writes locally and then replicates
   * the change with a `PATCH`; that replication is intentionally left switched
   * on in B0.7. An unknown provider id is a no-op that resolves to `undefined`,
   * exactly as the store behaves.
   */
  updateConfig: (
    providerId: string,
    config: LiaProviderConfig,
    status: LiaProviderStatus,
  ) => Promise<InferenceServiceProvider | undefined>
}

/**
 * Which operations still reach the remote AIRI service, per member.
 *
 * Data, not prose: the B0.8 step that makes replication optional is expected to
 * turn `updateConfig` into a local-only write behind an explicit port, and this
 * table is what a test asserts against so that change cannot go silent.
 */
export const LIA_PROVIDER_CONFIG_REMOTE_EFFECTS = {
  get: false,
  getConfig: false,
  isConfigured: false,
  ensure: false,
  updateConfig: true,
} as const

/**
 * Builds the facade over any structurally compatible source.
 *
 * Kept separate from {@link useLiaProviderConfigFacade} so tests can pass a
 * double and observe the delegation itself, with no Pinia, no Vue and no
 * network involved.
 */
export function createLiaProviderConfigFacade(source: LiaProviderConfigSource): LiaProviderConfigFacade {
  return {
    get: providerId => source.getProvider(providerId),
    getConfig: providerId => source.getProviderConfig(providerId),
    // Read at call time, never captured: `configuredProviders` is a derived map
    // on the shared store and must stay reactive for the caller.
    isConfigured: providerId => source.configuredProviders[providerId] === true,
    ensure: (providerId, definitionId, config = {}) =>
      source.ensureProvider(providerId, definitionId, config),
    updateConfig: (providerId, config, status) =>
      source.updateProviderConfig(providerId, config, status),
  }
}

/**
 * The facade bound to the real shared store, which remains the single source of
 * truth for provider configuration.
 *
 * The import of the Stage store lives here and only here inside this folder, so
 * the folder's dependency on the Stage has exactly one address.
 */
export function useLiaProviderConfigFacade(): LiaProviderConfigFacade {
  return createLiaProviderConfigFacade(useProviderConfigStore())
}
