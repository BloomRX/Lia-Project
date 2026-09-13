/**
 * Whether the AIRI "Welcome to AIRI" onboarding window may open by itself.
 *
 * AIRI is the upstream runtime; Lia is the product, and Lia does not require an
 * AIRI account. That window is an account prompt, and the only thing that ever
 * opened it automatically was mounting the Stage - so `Home -> CONVERSAR` was
 * interrupted by a login screen for an account the conversation does not need,
 * on a fresh install and again after every one.
 *
 * Nothing is given up by not asking. The chat already runs anonymously:
 * `session-store` treats `userId === 'local'` as a local-only user and never
 * opens the cloud socket, and `use-local-first` always runs its local branch and
 * only adds the remote one when a session exists. Lia's own LLM comes from
 * `liaProviderStore.activateConfiguredProvider()` with a vault-resolved key,
 * which is unrelated to the AIRI session.
 *
 * The features that genuinely need an account - cloud session sync, voice packs,
 * the `official` provider, hologram coupons - stay behind their own explicit
 * sign-in, reachable from the controls island.
 *
 * This gates the AUTOMATIC prompt only. The window, its manager, the onboarding
 * service and the `electronOpenOnboarding` invoke are untouched, so an explicit
 * open still works and the upstream flow is not forked.
 */
export function mayAutoOpenAiriWelcome(): boolean {
  return false
}

/**
 * The decision the Stage actually acts on: the Lia rule and the upstream
 * condition together.
 *
 * Kept as one function so a test can exercise the real expression instead of
 * restating it - `needsOnboarding` is still evaluated upstream, this only
 * decides whether Lia acts on it.
 */
export function shouldAutoOpenAiriWelcome(needsOnboarding: boolean): boolean {
  return mayAutoOpenAiriWelcome() && needsOnboarding
}
