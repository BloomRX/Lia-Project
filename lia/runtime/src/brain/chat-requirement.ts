import type { LiaBrainCapability, LiaBrainCapabilityRequirement } from './capabilities'

/**
 * Phase 8.0D-6: the canonical Brain capability requirement for ONE Lia chat
 * turn.
 *
 * It answers exactly one question - "what capabilities does THIS turn
 * require?" - and nothing else: it selects no engine or model, reads no
 * product state and never asks for a routing decision. The facts come from
 * signals the existing chat execution path already carries for the turn:
 *
 * - text: every conversation turn sends user text and expects text back, so
 *   that pair is the permanent baseline;
 * - image: the attachments actually sent with the turn (the same objects the
 *   runtime turns into image content parts) - an attachment UI existing
 *   somewhere proves nothing by itself;
 * - tools: the tool references supplied with the turn ("request-specific
 *   tools selected by their model-facing names") - future tool plans do not
 *   count;
 * - reasoning: the existing session-level reasoning request the chat
 *   preparation reads before inference (each provider maps it to its own
 *   request fields). The current path exposes no per-turn reasoning switch,
 *   so the existing signal is used as-is - no new state is invented.
 *
 * Nothing else is part of the current chat request contract, so audio
 * input/output, video input and realtime are deliberately never required
 * here. Pure by construction: plain facts in, a requirement out - no
 * product config, no Brain catalog or service, no registry, no provider SDK,
 * no network/filesystem/IPC. Callers own when to build it and what to do
 * with it.
 */

/**
 * Turn facts. Every field is optional and means exactly what it says: absent
 * (or explicitly false) is "this turn does not need it", never a hidden
 * default. Only true facts become requirements.
 */
export interface LiaChatTurnBrainFacts {
  /** The turn actually carries image input (attachments that reach the brain). */
  hasImageInput?: boolean
  /** The turn supplies tools/tool references to the brain path. */
  usesTools?: boolean
  /** Reasoning is explicitly requested for this turn/provider request. */
  reasoningRequested?: boolean
}

/**
 * Builds the turn's Brain capability requirement.
 *
 * `textInput` and `textOutput` are always required; `imageInput`,
 * `reasoning` and `toolCalling` join them only when their fact holds. The
 * returned list follows ONE canonical order - the order of the capability
 * domain itself (text in, image, audio, video, text out, audio out,
 * reasoning, tools, realtime), with only the required entries present - so
 * comparisons between requirements never depend on how the caller spelled
 * its facts. Each capability appears at most once by construction. The
 * order carries no precedence: the eligibility layer treats it as a set.
 * The facts object is read, never mutated.
 */
export function brainRequirementForChatTurn(facts: LiaChatTurnBrainFacts): LiaBrainCapabilityRequirement {
  const required: LiaBrainCapability[] = ['textInput']
  if (facts.hasImageInput === true)
    required.push('imageInput')
  required.push('textOutput')
  if (facts.reasoningRequested === true)
    required.push('reasoning')
  if (facts.usesTools === true)
    required.push('toolCalling')
  return { required }
}
