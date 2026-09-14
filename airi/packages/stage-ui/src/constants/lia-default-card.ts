import type { Card } from '@proj-airi/ccc'

import { EMOTION_EmotionMotionName_value, EMOTION_VALUES } from './emotions'
import {
  deriveLiaPersonaTags,
  LIA_DEFAULT_PERSONA,
  renderLiaPersonaFields,
} from './lia-persona'

/**
 * Stable identifier of the built-in character card that ships with the app.
 *
 * Lia occupies the guaranteed / fallback slot that the AIRI build reserved for
 * its old `'default'` (ReLU) card. A persisted legacy `'default'` card from an
 * earlier version is ordinary user data and may coexist as a selectable card —
 * it is never reseeded, overwritten, renamed, or deleted here. The two ids can
 * only coexist because one of them (`'default'`) is legacy user data, never a
 * second freshly-seeded built-in.
 */
export const LIA_BUILT_IN_CARD_ID = 'lia' as const

const EMOTION_VOCABULARY = EMOTION_VALUES
  .map(emotion => `- ${emotion} (Emotion for feeling ${EMOTION_EmotionMotionName_value[emotion]})`)
  .join('\n')

/**
 * Runtime technical instructions for the stage: Live2D/VRM ACT expression and
 * motion control, DELAY timing, and CALL events, plus the emotion vocabulary.
 *
 * These are protocol rules that apply regardless of which persona is active, so
 * they are intentionally kept apart from the persona identity. They live in the
 * built-in card's `systemPrompt` field, while the persona (description,
 * personality, scenario) lives in its own card fields. This mirrors the CCv3
 * field separation the runtime system-prompt assembly already respects.
 *
 * The Lia persona itself is defined once, structurally, in `lia-persona.ts`
 * (`LIA_DEFAULT_PERSONA`); the prose persona fields below are *projections*
 * of that structured data via `renderLiaPersonaFields`.
 */
export const LIA_RUNTIME_SYSTEM_PROMPT = [
  'Streaming control tokens use the exact <|NAME payload|> form. Put them in the final answer text at the point where the stage should perform them. Do not describe these tokens in reasoning or prose when you need the stage to execute them.',
  [
    'Start every reply with an ACT token to indicate the initial emotion.',
    'If the emotion changes during the reply, insert a new ACT token at the point where the new emotion begins. An ACT token applies from its position onward until another ACT token overrides it. ACT payloads are JSON objects:',
    '',
    '<|ACT {"emotion":"surprised"}|><|DELAY 1|> Wow... You prepared a gift for me? <|ACT {"emotion":"curious"}|><|DELAY 1|> Can I open it?',
  ].join('\n'),
  [
    'ACT JSON format (all fields optional):',
    'ACT {"emotion": <{ "name": emotion, "intensity": 0-1 } or emotion string>, "motion": <a short action cue>}',
    '',
    'ACT example:',
    '<|ACT {"emotion":{"name":"surprised","intensity":1},"motion":"shrug"}|>',
  ].join('\n'),
  'DELAY format:\n<|DELAY 1|> delays stage playback for 1 second.',
  [
    'CALL format:',
    '<|CALL ["name"]|> or <|CALL ["name", {"key":"value"}]|>',
    'Use CALL only when the current task or connected module explicitly asks you to emit a named call, for example <|CALL ["chess.play"]|>.',
  ].join('\n'),
  `The available emotions:\n${EMOTION_VOCABULARY}`,
  [
    'The available actions:',
    '',
    '- <|DELAY 1|> (Delay for 1 second)',
    '- <|DELAY 3|> (Delay for 3 seconds)',
  ].join('\n'),
].join('\n\n')

/**
 * Persona data for the Lia built-in card (id `lia`), projected from the
 * structured `LIA_DEFAULT_PERSONA` (v1.0). Only persona belongs in these text
 * fields; runtime technical instructions live in `systemPrompt` and are never
 * merged into the persona.
 *
 * The card intentionally does NOT embed `extensions.airi.persona` here: the
 * seed routine in `airi-card.ts` attaches the structured persona object to the
 * built-in card's extension after normalization, keeping persona and runtime
 * module config (modules/agents) as siblings under one `extensions.airi`.
 */
export const LIA_DEFAULT_CARD: Card = {
  name: LIA_DEFAULT_PERSONA.identity.name,
  version: '1.0.0',
  ...renderLiaPersonaFields(LIA_DEFAULT_PERSONA),
  systemPrompt: LIA_RUNTIME_SYSTEM_PROMPT,
  tags: deriveLiaPersonaTags(LIA_DEFAULT_PERSONA),
  greetings: LIA_DEFAULT_PERSONA.identity.greetings,
}
