import type { LiaBrainCapabilities, LiaBrainEngineDescriptor, LiaBrainModelDescriptor } from '../types'

/**
 * Phase 8.0D-2: Lia's first PRODUCTION Brain descriptor adapter - the
 * current chat brain described in the (otherwise provider-neutral) Brain
 * domain. Provider-specific by design: it lives here, outside the generic
 * domain files, so `types.ts` / `engine-registry.ts` / `capabilities.ts` /
 * `resolver.ts` / `routes.ts` / `selection.ts` / `decision.ts` / `runtime.ts`
 * never carry vendor or model identities.
 *
 * Phase 8.0D-M1 adds a SECOND model on the same engine: the engine's vision
 * route. It is an additional route, not a replacement - the text chat brain
 * stays the first declared route and remains the default for text-only turns.
 *
 * Repository evidence for the identities (no ids from memory):
 * - the engine id is the canonical chat provider id Lia's onboarding
 *   persists (`LIA_CHAT_PROVIDER_OPTIONS` in the Stage renderer store), and
 *   is also the AIRI provider definition id ('groq');
 * - the model ids and their user-facing labels are the ids persisted into
 *   `provider.chat.preferred` and sent to the API verbatim.
 *
 * Capability grading (repository behavior is the authority for what the
 * PRODUCT does; the provider's own published contract is the authority for
 * what a MODEL accepts):
 * - text in/out: the engine's declared task is 'chat';
 * - reasoning: the engine declares reasoning modes, and the adapter's own
 *   effort mapping is written against this model family;
 * - tool calling: the current chat execution path composes built-in and
 *   custom tools into the request and handles tool results, and it gates them
 *   per model+provider through `streamOptionsToolsCompatibilityOk`
 *   (`core-agent/src/runtime/llm-service.ts`), which only ever DISABLES tools
 *   for a model key after a failure has been observed for it. `toolCalling`
 *   stays graded true on that transport plus each model's published contract,
 *   but it remains PARTIAL as a validated 8.0D criterion until a directed
 *   round-trip test proves a tool call returns into the model loop;
 * - image input: FALSE for the text chat brain and TRUE for the vision route,
 *   each on its own published contract. Two repository facts bound the TRUE:
 *   the send path builds `image_url` content parts
 *   (`core-agent/src/runtime/chat-orchestrator-runtime.ts`) and
 *   `sanitizeMessages` keeps non-text parts while
 *   `streamOptionsContentArrayCompatibilityOk` is true - which is the default
 *   per model key, degrading only after `isContentArrayRelatedError` fired for
 *   that key. A model whose contract rejects content arrays would therefore
 *   silently lose the image, so this flag must not be widened on assumption.
 *   Image understanding in the AIRI `vision` module is separate and unrelated;
 * - audio input/output: neither model accepts audio or produces it from the
 *   brain. Lia's audio pipeline (transcription upstream of the brain,
 *   synthesis downstream of it) is a distinct concern and is never inferred
 *   into these flags;
 * - video input, realtime: no evidence for either model.
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
 * Stable model id of the engine's vision route, sent to the API verbatim.
 * Text + image in, text out, with reasoning and tool use.
 */
export const GROQ_BRAIN_VISION_MODEL_ID = 'qwen/qwen3.8-27b'

/**
 * The audited capability truth for Lia's text chat brain. Every flag is
 * explicit; none is inferred.
 */
const TEXT_CHAT_BRAIN_CAPABILITIES: LiaBrainCapabilities = {
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

/**
 * The audited capability truth for the engine's vision route: the text chat
 * brain's capabilities plus image input. Nothing else widens - audio, video
 * and realtime stay false because this model does not do them.
 */
const VISION_BRAIN_CAPABILITIES: LiaBrainCapabilities = {
  audioInput: false,
  audioOutput: false,
  imageInput: true,
  realtime: false,
  reasoning: true,
  textInput: true,
  textOutput: true,
  toolCalling: true,
  videoInput: false,
}

/**
 * The ENGINE declares the SUPERSET of its models' capabilities, and that is
 * the contract's intent rather than a workaround: `routes.ts` and
 * `resolver.ts` judge the engine AND the model by their OWN descriptors, so a
 * requirement the engine cannot serve is rejected once for all its models,
 * while a requirement only some models serve is settled per model. An engine
 * declaring the intersection instead would make its most capable model
 * unreachable.
 *
 * Consequence, and the point of the split: an `imageInput` requirement passes
 * the engine, is rejected by the text chat brain's own descriptor, and is
 * accepted by the vision route's - which is what makes the routing
 * capability-driven instead of heuristic.
 */
const GROQ_ENGINE_CAPABILITIES: LiaBrainCapabilities = {
  audioInput: false,
  audioOutput: false,
  imageInput: true,
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
 * Describes this engine and the models Lia actually chats with today. Fresh
 * objects on every call (no shared mutable state), both sides consistent
 * (`model.engineId` equals the engine id and the engine declares exactly
 * those models). No hypothetical or future models.
 *
 * Model order is the text chat brain first, then the vision route. This order
 * is NOT the routing precedence - the product policy declares that
 * explicitly - but `catalog.ts` preserves it as the enumeration order.
 */
export function groqBrainDescriptors(): LiaBrainDescriptorSet {
  return {
    engines: [
      {
        availability: 'available',
        capabilities: { ...GROQ_ENGINE_CAPABILITIES },
        id: GROQ_BRAIN_ENGINE_ID,
        modelIds: [GROQ_BRAIN_MODEL_ID, GROQ_BRAIN_VISION_MODEL_ID],
        name: 'Groq',
      },
    ],
    models: [
      {
        capabilities: { ...TEXT_CHAT_BRAIN_CAPABILITIES },
        engineId: GROQ_BRAIN_ENGINE_ID,
        id: GROQ_BRAIN_MODEL_ID,
        name: 'GPT-OSS 120B',
      },
      {
        capabilities: { ...VISION_BRAIN_CAPABILITIES },
        engineId: GROQ_BRAIN_ENGINE_ID,
        id: GROQ_BRAIN_VISION_MODEL_ID,
        name: 'Qwen3.8 27B',
      },
    ],
  }
}
