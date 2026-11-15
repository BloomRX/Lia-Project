import type { LiaPersona, LiaPersonalityAttributes } from '@proj-airi/stage-ui/constants/lia-persona'
import type { AiriCard } from '@proj-airi/stage-ui/stores/modules/airi-card'

import { CURRENT_LIA_PERSONA_PROJECTION_VERSION, LIA_DEFAULT_PERSONA, renderLiaPersonaFields } from '@proj-airi/stage-ui/constants/lia-persona'

export const PERSONALITY_TRAITS = Object.keys(LIA_DEFAULT_PERSONA.attributes) as (keyof LiaPersonalityAttributes)[]

export interface PersonalityDraft {
  attributes: LiaPersonalityAttributes
  contextId: LiaPersona['intensity']['defaultContextId']
}

export function createPersonalityDraft(persona: LiaPersona): PersonalityDraft {
  return { attributes: { ...persona.attributes }, contextId: persona.intensity.defaultContextId }
}

/** Only editor-owned fields change; identity, rules and runtime instructions survive. */
export function preparePersonalityCard(card: AiriCard, draft: PersonalityDraft): AiriCard {
  const current = card.extensions.airi.persona
  if (!current || !current.intensity.contexts.some(context => context.id === draft.contextId))
    throw new Error('invalid-context')
  if (PERSONALITY_TRAITS.some(key => !Number.isFinite(draft.attributes[key]) || draft.attributes[key] < 0 || draft.attributes[key] > 1))
    throw new Error('invalid-trait')

  const attributes = { ...current.attributes }
  for (const key of PERSONALITY_TRAITS)
    attributes[key] = draft.attributes[key]
  const persona: LiaPersona = {
    ...current,
    attributes,
    intensity: { ...current.intensity, defaultContextId: draft.contextId },
  }
  return {
    ...card,
    ...renderLiaPersonaFields(persona),
    extensions: {
      ...card.extensions,
      airi: { ...card.extensions.airi, persona, personaProjectionVersion: CURRENT_LIA_PERSONA_PROJECTION_VERSION },
    },
  }
}
