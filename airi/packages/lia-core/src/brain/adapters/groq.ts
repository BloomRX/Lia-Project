import type { LiaBrainCapabilities, LiaBrainEngineDescriptor, LiaBrainModelDescriptor } from '../types'

/**
 * Phase 8.0D-2: Lia's first PRODUCTION Brain descriptor adapter - the
 * current chat brain described in the (otherwise provider-neutral) Brain
 * domain. Provider-specific by design: it lives here, outside the generic
 * domain files, so `types.ts` / `engine-registry.ts` / `capabilities.ts` /
 * `resolver.ts` / `routes.ts` / `selection.ts` / `decision.ts` / `runtime.ts`
 * never carry vendor or model identities.
 *
 * Repository evidence for the identities (no ids from memory):
 * - the engine id is the canonical chat provider id Lia's onboarding
 *   persists (`LIA_CHAT_PROVIDER_OPTIONS` in the Stage renderer store), and
 *   is also the AIRI provider definition id ('groq');
 * - the model id and its user-facing label are the exact entries of the
 *   curated Lia chat catalog (`LIA_MODEL_CATALOG`), the ids persisted into
 *   `provider.chat.preferred` and sent to the API verbatim.
 *
 * Capability grading (repository behavior is the authority - never vendor
 * documentation):
 * - text in/out: the engine's declared task is 'chat';
 * - reasoning: the engine declares reasoning modes, and the adapter's own
 *   effort mapping is written against this model family;
 * - tool calling: the current chat execution path composes built-in and
 *   custom tools into the request and handles tool results, with the
 *   per-model compatibility probe only ever disabling it after a failure;
 * - image/audio/video input: no repository evidence for this engine/model
 *   (image understanding is a SEPARATE AIRI module, and the engine declares
 *   the 'chat' task only) - reported false rather than assumed;
 * - audio output: a distinct capability from Lia's audio-synthesis pipeline
 *   (owned by its own engine contract) - reported false, never inferred
 *   from synthesis support elsewhere;
 * - realtime: the current path does not expose interactive sessions.
 *
 * Availability describes PRODUCT support (the engine is a shipped,
 * selectable chat provider in this build), not live authentication health.
 * This adapter is pure description: it initializes no SDK, performs no
 * request, holds no keys, reads no environment, touches neither product
 * config nor the Brain registry (population is a separate concern).
 */

/** Stable engine id: the canonical provider id Lia persists for this chat brain. */
export const GROQ_BRAIN_ENGINE_ID = 'groq'

/** Stable model id: persisted and sent to the API verbatim (Lia's own catalog). */
export const GROQ_BRAIN_MODEL_ID = 'openai/gpt-oss-120b'

/**
 * The audited capability truth for Lia's current chat brain, shared by the
 * engine layer and this model because the repository wires them through the
 * SAME chat execution path. Every flag is explicit; none is inferred.
 */
const CURRENT_CHAT_BRAIN_CAPABILITIES: LiaBrainCapabilities = {
  audioInput: false,
  audioOutput: false,
  imageInput: false,
  realtime: false,
  reasoning: true,
  textInput: true,
  textOutput: true,
  toolCalling: true,
  videoInput: false,
}

/** One engine plus the models served by it, as the registry will consume them. */
export interface LiaBrainDescriptorSet {
  engines: readonly LiaBrainEngineDescriptor[]
  models: readonly LiaBrainModelDescriptor[]
}

/**
 * Describes the current brain: one engine and the one model Lia actually
 * chat with today. Fresh objects on every call (no shared mutable state),
 * both sides consistent (`model.engineId` equals the engine id and the
 * engine declares exactly that model). No hypothetical or future models.
 */
export function groqBrainDescriptors(): LiaBrainDescriptorSet {
  return {
    engines: [
      {
        availability: 'available',
        capabilities: { ...CURRENT_CHAT_BRAIN_CAPABILITIES },
        id: GROQ_BRAIN_ENGINE_ID,
        modelIds: [GROQ_BRAIN_MODEL_ID],
        name: 'Groq',
      },
    ],
    models: [
      {
        capabilities: { ...CURRENT_CHAT_BRAIN_CAPABILITIES },
        engineId: GROQ_BRAIN_ENGINE_ID,
        id: GROQ_BRAIN_MODEL_ID,
        name: 'GPT-OSS 120B',
      },
    ],
  }
}
