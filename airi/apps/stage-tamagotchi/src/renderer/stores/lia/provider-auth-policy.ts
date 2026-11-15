import type { InferenceServiceProvider } from '@proj-airi/stage-ui/libs/providers/types'

/**
 * Who owns the lifecycle of a provider configuration.
 *
 * This module exists because the Lia must be able to answer "does this provider
 * need the AIRI account session?" without asking AIRI's auth store, and without
 * duplicating AIRI's rule.
 *
 * The reusable abstraction already exists: `configuredBy` is a **data field**
 * on the provider definition and on every persisted record. AIRI's hub reads it
 * in `isProviderConfiguredForModule` and only then, for the `'authentication'`
 * value, consults `authStore.isAuthenticated`. The decision, therefore, is data
 * — not an auth API. The Lia can make the same decision from the record alone.
 *
 * Why the Lia needs its own predicate at all:
 *
 * The Lia has no AIRI account flow. It never offers a provider whose
 * configuration lifecycle belongs to that session, and it must fail closed
 * rather than silently report "ready to chat" for one that does. Today that is
 * true by construction (`LIA_CHAT_PROVIDER_OPTIONS` are all user-owned), but
 * "true by construction" is not a decision — it is an accident waiting for
 * someone to add an `official-*` entry to the list. This module turns the
 * accident into a stated policy with a test behind it.
 *
 * Evidence that the predicate must stay data-derived rather than hardcoded to
 * `false`: the Lia's voice picker is built from the Stage's available speech
 * providers minus `speech-noop` only, so `official-provider-speech` — which
 * declares `configuredBy: 'authentication'` — is reachable through the Lia UI.
 * A blanket `false` would therefore be a lie. What is genuinely false for the
 * Lia is ownership of the *chat* providers it curates.
 */

/** The subset of a provider record this policy reads. Nothing else is needed. */
export interface ProviderOwnershipRecord {
  configuredBy?: InferenceServiceProvider['configuredBy']
}

/**
 * Whether a provider's configuration lifecycle is owned by the AIRI account
 * session.
 *
 * A missing record is treated as user-owned, which matches AIRI's own fallback
 * (`definition.configuredBy ?? 'user'`) for every provider the Lia curates.
 *
 * Note what this function deliberately does NOT do: it does not import
 * `useAuthStore`, it does not read `isAuthenticated`, and it does not consult
 * the provider definition registry (whose population is an import side effect
 * and would make the answer depend on module load order).
 */
export function isAuthenticationOwnedProvider(
  record: ProviderOwnershipRecord | undefined,
): boolean {
  return record?.configuredBy === 'authentication'
}

/**
 * Whether the Lia may treat a provider as usable without the AIRI account
 * session.
 *
 * Always the complement of {@link isAuthenticationOwnedProvider}, named
 * separately because it is the question the Lia's own readiness check asks.
 */
export function isUsableWithoutAiriSession(
  record: ProviderOwnershipRecord | undefined,
): boolean {
  return !isAuthenticationOwnedProvider(record)
}
