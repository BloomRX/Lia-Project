import { LIA_DEFAULT_CARD } from '@proj-airi/stage-ui/constants/lia-default-card'
import { LIA_DEFAULT_PERSONA } from '@proj-airi/stage-ui/constants/lia-persona'
import { describe, expect, it } from 'vitest'

import { createPersonalityDraft, preparePersonalityCard } from './personality-editor'

function fixture() {
  const card = JSON.parse(JSON.stringify(LIA_DEFAULT_CARD))
  card.extensions = { airi: { modules: {}, agents: {}, persona: JSON.parse(JSON.stringify(LIA_DEFAULT_PERSONA)) } }
  return card
}

describe('personality validation', () => {
  it.each([Number.NaN, Infinity, -0.01, 1.01])('rejects invalid levels: %s', (value) => {
    const card = fixture()
    const draft = createPersonalityDraft(card.extensions.airi.persona)
    draft.attributes.energy = value
    expect(() => preparePersonalityCard(card, draft)).toThrow('invalid-trait')
    expect(card.extensions.airi.persona.attributes.energy).toBe(0.7)
  })
  it('rejects an unavailable context instead of creating new rules', () => {
    const card = fixture()
    const draft = createPersonalityDraft(card.extensions.airi.persona)
    draft.contextId = 'custom'
    expect(() => preparePersonalityCard(card, draft)).toThrow('invalid-context')
  })
  it('keeps canonical identity, limits and unrelated extension data', () => {
    const card = fixture()
    const draft = createPersonalityDraft(card.extensions.airi.persona)
    draft.attributes.energy = 0
    const result = preparePersonalityCard(card, draft)
    expect(result.extensions.airi.persona!.identity).toEqual(LIA_DEFAULT_PERSONA.identity)
    expect(result.extensions.airi.persona!.limits).toEqual(LIA_DEFAULT_PERSONA.limits)
    expect(result.extensions.airi.persona!.preset).toBe('tsundere')
    expect(result.systemPrompt).toBe(card.systemPrompt)
    expect(result.extensions.airi.modules).toEqual(card.extensions.airi.modules)
    expect(result.personality).toContain('energia 0')
    expect(card.extensions.airi.persona.attributes.energy).toBe(0.7)
  })
})
