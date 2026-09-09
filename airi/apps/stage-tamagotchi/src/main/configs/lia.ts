import type { InferOutput } from 'valibot'

import { array, boolean, literal, object, optional, string, union } from 'valibot'

import { createConfig } from '../libs/electron/persistence'

/**
 * Lia product configuration.
 *
 * Owns the *product* preferences of the Lia layer (what the user chose and the
 * policies the Lia orchestrates) as distinct from the generic AIRI technical
 * state, which keeps living in its own stores / `createConfig` files.
 *
 * Persistence reuses the existing `createConfig` (`userData/lia-product.json`),
 * coexisting with the already-present `userData/lia-main-window.json` (window
 * sizing). No new storage, no second framework, no migration of existing data.
 *
 * Domain split follows the approved architecture:
 *   persona → voice → provider → preferences
 *
 * NOTE (Phase 4A): the fields are intentionally minimal/forward-shaped. Persona,
 * provider and voice get their detailed shapes in later subphases (4B/4C/4D) by
 * *extending* this schema additively with optional fields — no `schemaVersion`
 * bump for purely additive/optional evolution.
 */

/** Only schema version supported today. No generic migration engine yet. */
export const LIA_PRODUCT_SCHEMA_VERSION = 1

const personaConfigSchema = object({
  /** Pointer to the active persona card (v1: the single "Lia" card). */
  activeCardId: optional(string()),
})

const providerTargetSchema = object({
  providerId: string(),
  modelId: optional(string()),
})

const chatProviderConfigSchema = object({
  /** How provider/model is decided: 'auto' recommends; 'manual' pins the user's choice. */
  strategy: optional(union([literal('auto'), literal('manual')])),
  /** User's preferred primary chat provider/model. */
  preferred: optional(providerTargetSchema),
  /** Ordered fallback list applied when the primary provider fails. */
  fallback: optional(array(providerTargetSchema), []),
  /** Master switch for provider failover. Defaults to enabled when set. */
  fallbackEnabled: optional(boolean()),
  /**
   * Explicit marker that the user completed the first-run provider setup for a
   * VALID configuration (has preferred provider+model and a stored key). It is
   * only a hint for the launcher UX — readiness always also checks that the
   * preferred target + key are actually present, so this flag alone never marks
   * the system as ready.
   */
  onboarded: optional(boolean()),
})

const providerConfigSchema = object({
  chat: optional(chatProviderConfigSchema),
})

const ttsTargetSchema = object({
  providerId: string(),
  modelId: optional(string()),
  voiceId: optional(string()),
})

const sttTargetSchema = object({
  providerId: string(),
  modelId: optional(string()),
})

const voiceConfigSchema = object({
  tts: optional(object({
    /** Preferred primary TTS (voice) target. */
    preferred: optional(ttsTargetSchema),
    /** Ordered TTS fallback list used when the primary voice provider fails. */
    fallback: optional(array(ttsTargetSchema), []),
  })),
  stt: optional(object({
    preferred: optional(sttTargetSchema),
  })),
})

const preferencesSchema = object({
  /** Product language preference ('' = inherit AIRI language detection). */
  language: optional(string()),
})

export const liaProductConfigSchema = object({
  /** Declares/validates the supported schema version. */
  schemaVersion: literal(LIA_PRODUCT_SCHEMA_VERSION),
  persona: optional(personaConfigSchema, {}),
  provider: optional(providerConfigSchema, {}),
  voice: optional(voiceConfigSchema, {}),
  preferences: optional(preferencesSchema, {}),
})

export type LiaProductConfig = InferOutput<typeof liaProductConfigSchema>

/**
 * The product persona defaults to the Lia built-in character card. `'lia'`
 * mirrors the renderer's built-in card id (airi-card store) and is kept in sync
 * by hand — per the approved 4B model the main process does not push this to the
 * renderer; the renderer's own fresh-install state already resolves to `lia`.
 * A full main → renderer persona bridge is a later phase (4E).
 */
const LIA_PRODUCT_PERSONA_DEFAULT_ACTIVE_CARD_ID = 'lia'

export const defaultLiaProductConfig: LiaProductConfig = {
  schemaVersion: LIA_PRODUCT_SCHEMA_VERSION,
  persona: { activeCardId: LIA_PRODUCT_PERSONA_DEFAULT_ACTIVE_CARD_ID },
  provider: {},
  voice: {},
  preferences: {},
}

/**
 * Creates the Lia product config at `userData/lia-product.json`.
 *
 * Because the schema fixes `schemaVersion` to the supported literal, a file from
 * a newer/unknown schema fails validation and `createConfig` auto-heals it back
 * to the default (keeping a `.bak`). This satisfies "validate the version now"
 * without a migration engine; a migration framework only becomes necessary once
 * a second real schema version exists.
 */
export function createLiaProductConfig() {
  const config = createConfig('lia', 'product.json', liaProductConfigSchema, {
    default: defaultLiaProductConfig,
    autoHeal: true,
  })
  config.setup()

  return config
}
