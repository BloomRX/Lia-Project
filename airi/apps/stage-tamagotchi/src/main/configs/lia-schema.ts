import type { InferOutput } from 'valibot'

import { array, boolean, literal, number, object, optional, string, union } from 'valibot'

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
 * extending* this schema additively with optional fields — no `schemaVersion`
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

/**
 * Connection settings for a locally running AllTalk server.
 *
 * This is *runtime* configuration - how to reach a piece of software on this
 * machine - and is deliberately kept out of `CustomVoiceProfile`: one AllTalk
 * install serves every imported voice, so switching voices must not require
 * re-entering a server address, and switching machines must not require
 * re-importing voices.
 *
 * Contains no secret (AllTalk on localhost has no credential) and no audio.
 */
const alltalkRuntimeSchema = object({
  /** Base URL of the server, no trailing slash. AllTalk's documented default port is 7851. */
  baseUrl: optional(string()),
  /**
   * AllTalk's own voices folder, as chosen through the OS directory picker.
   * Optional until the user configures it: a profile can exist in the Lia
   * library before AllTalk is set up at all.
   */
  voicesDir: optional(string()),
  /** Per-request timeout in milliseconds. */
  timeoutMs: optional(number()),
  /**
   * Where AllTalk is installed, as chosen through the OS directory picker.
   *
   * The Lia never installs it: AllTalk's own setup script is interactive and
   * needs prerequisites the user must provide (Git, MS C++ Build Tools,
   * espeak-ng), so there is no honest way to automate it. What the Lia *can* do
   * once it knows the folder is detect the install, start it, watch its health
   * and stop it - which is what removes the terminal from the user's day.
   */
  installDir: optional(string()),
})

const sttTargetSchema = object({
  providerId: string(),
  modelId: optional(string()),
})

/**
 * Phase 7.8C: the engine-neutral voice-engine config. `alltalk` below
 * stays in the schema for one reason only - legacy documents must still
 * LOAD - and is deprecated/inert from here on.
 */
const voiceEngineSchema = object({
  /** Selected voice engine id; the config layer itself never names one. */
  preferred: optional(string()),
})

const voiceFallbackSchema = object({
  /** A non-preferred engine MAY answer only when true. */
  enabled: optional(boolean()),
  /** Explicit fallback engine id when the operator pinned one. */
  engineId: optional(string()),
})

const voiceConfigSchema = object({
  /**
   * Phase 7.9H: the product-level voice switch. Absent means enabled (voice
   * is part of Lia's default experience); only an explicit `false` opts the
   * user out of spoken output. The Stage honors it at its ONE central
   * speech-output gate; runtime management keeps running either way.
   * Keeping it in the schema also guarantees the Stage's own config writes
   * round-trip the key instead of silently stripping it from the document.
   */
  enabled: optional(boolean()),
  tts: optional(object({
    /** Preferred primary TTS (voice) target. */
    preferred: optional(ttsTargetSchema),
    /** Ordered TTS fallback list used when the primary voice provider fails. */
    fallback: optional(array(ttsTargetSchema), []),
  })),
  stt: optional(object({
    preferred: optional(sttTargetSchema),
  })),
  /**
   * Where a voice comes from, as opposed to which voice is selected. Lives next
   * to `tts`/`stt` inside the existing `voice` domain rather than in a new
   * config file, so `lia-product.json` stays the single Lia product document.
   */
  engine: optional(voiceEngineSchema),
  fallback: optional(voiceFallbackSchema),
  runtime: optional(object({
    /** DEPRECATED: readable for legacy document compatibility; drives nothing. */
    alltalk: optional(alltalkRuntimeSchema),
    /** Engine-neutral managed-runtime home override. */
    installDir: optional(string()),
  })),
})

const preferencesSchema = object({
  /** Product language preference ('' = inherit AIRI language detection). */
  language: optional(string()),
})

/**
 * Phase 7.9H-B3: the launcher's first-run setup marker. The Stage only
 * needs to round-trip it: valibot drops unknown keys on parse, and any
 * Stage-side config write persists the parsed copy - so a field missing
 * here would silently un-complete the setup on the next Stage save.
 * Additive/optional: existing documents without it stay valid.
 */
const setupSchema = object({
  completed: optional(boolean()),
})

/**
 * Phase 8.0B-2: the persistent Brain selection preference. Same round-trip
 * duty as the setup marker: a field missing here would silently drop the
 * user's Brain choice on the next Stage save. The ids are OPAQUE (Brain
 * Engine Registry / Brain Model ids) - the Stage never resolves them, so
 * no provider/vendor field belongs in this shape. Additive/optional.
 */
const brainSelectionTargetSchema = object({
  preferred: optional(string()),
})

const brainConfigSchema = object({
  engine: optional(brainSelectionTargetSchema),
  model: optional(brainSelectionTargetSchema),
})

export const liaProductConfigSchema = object({
  /** Declares/validates the supported schema version. */
  schemaVersion: literal(LIA_PRODUCT_SCHEMA_VERSION),
  persona: optional(personaConfigSchema, {}),
  provider: optional(providerConfigSchema, {}),
  voice: optional(voiceConfigSchema, {}),
  preferences: optional(preferencesSchema, {}),
  setup: optional(setupSchema),
  brain: optional(brainConfigSchema),
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
