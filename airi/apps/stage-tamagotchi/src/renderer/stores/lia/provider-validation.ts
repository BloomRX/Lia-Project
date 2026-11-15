import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'

/**
 * E3 historical validator boundary retained unchanged for conformance.
 * The model editor now uses the explicit draft probe in provider-runtime.ts;
 * these validators may list models or ping another model and cannot approve
 * the user's selected ID. The description below records the E3 extraction.
 *
 * The Lia's own boundary for provider *validation* (E3).
 *
 * Why this file exists
 * --------------------
 *
 * "Test connection" is the one Lia flow that runs the provider's own validators
 * against a draft configuration. It reaches `validateProviderConfig` on the
 * shared Stage store, which builds a validation plan from the provider
 * definition, runs the schema checks first, and only then — if the schema passed
 * — instantiates the provider and runs the connectivity checks. The result is a
 * classification (`valid`), a list of `Error`s and a human-readable `reason`
 * that the Lia shows verbatim.
 *
 * That operation had exactly one call site in the Lia, named directly on the
 * shared store. This module is that dependency's single address.
 *
 * **It still delegates.** This is an extraction of interface, not a Lia
 * validator: every invocation calls the shared store, which remains the only
 * implementation. No validator, no reason string and no classification rule is
 * duplicated here. E1 and E2 took the same approach for the instance lifecycle.
 *
 * What this unlocks
 * -----------------
 *
 * The dependency that becomes swappable is validation and nothing else. A future
 * implementation can replace this module's body without touching `provider.ts`.
 *
 * What it does NOT unlock, and must not be sold as unlocking: the Lia still
 * reads and writes provider configuration through `provider-config-facade.ts`,
 * still activates through `provider-activation.ts`, and still reaches provider
 * instances through `provider-runtime.ts`. Those are three separate boundaries
 * on purpose.
 *
 * Why `validate` and not `validateProviderConfig`
 * -----------------------------------------------
 *
 * The static frontier in `provider-config-facade.test.ts` looks for the shared
 * store's member names outside the module allowed to use them. A port member
 * spelled exactly like the delegate would make a port call and a direct store
 * call indistinguishable to that check. Same reasoning as `canListModels` in
 * `provider-runtime.ts`.
 *
 * What this port deliberately does NOT do
 * ---------------------------------------
 *
 * It does not resolve credentials. The shared implementation builds its
 * validation instance straight from the config it is given — it never calls the
 * credential resolver that `getProviderInstance` uses. The Lia's call site
 * resolves the vault key itself and puts it in the draft config before asking
 * for validation, and that stays true: adding a resolver hop here would change
 * which key the validators test, silently. `provider-validation.test.ts` pins
 * it so a later "improvement" is caught.
 *
 * Reference: docs/architecture/LIA-STAGE-DEPENDENCY-MAP-2026-10-28.md and the
 * B0.9 dependency map, section 6, candidate P2.
 */

/**
 * The store instance type is derived from the real definition rather than
 * re-declared, so the signature — including the result shape, which the shared
 * store does not export as a named type — cannot drift from what it delegates
 * to. Nothing here invents a return type.
 */
type SharedProviderValidationStore = ReturnType<typeof useProviderStore>

/**
 * The slice of the shared provider store this port needs.
 *
 * Declared structurally, like the other two Lia ports, so a test can substitute
 * a double and observe the delegation with no Pinia and no Stage store.
 */
export interface LiaProviderValidationSource {
  validateProviderConfig: SharedProviderValidationStore['validateProviderConfig']
}

/** The single operation the Lia's validation path is allowed to use. */
export interface LiaProviderValidation {
  /**
   * Validates a draft configuration against the provider's own definition.
   *
   * Same arguments, same classification, same reason text and same thrown
   * errors as the shared operation: `providerId`, the draft config, and the
   * optional chat-ping switches. Network effects are the shared operation's
   * own — the Lia adds none.
   */
  validate: SharedProviderValidationStore['validateProviderConfig']
}

/**
 * Builds the port over any structurally compatible source.
 *
 * Kept separate from {@link useLiaProviderValidation} so tests can pass a double
 * and observe the delegation itself.
 */
export function createLiaProviderValidation(
  source: LiaProviderValidationSource,
): LiaProviderValidation {
  return {
    validate: (providerId, config, options) => source.validateProviderConfig(providerId, config, options),
  }
}

/**
 * The port bound to the shared Stage provider store, which remains the
 * implementation.
 *
 * The import of the shared store lives here and only here for validation.
 */
export function useLiaProviderValidation(): LiaProviderValidation {
  return createLiaProviderValidation(useProviderStore())
}
