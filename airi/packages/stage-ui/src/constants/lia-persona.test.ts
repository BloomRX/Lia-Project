import { describe, expect, it } from 'vitest'

import {
  LIA_DEFAULT_PERSONA,
  renderLiaPersonaFields,
} from './lia-persona'

describe('Lia persona v1.0 (structured model)', () => {
  it('defines the official default persona shape', () => {
    const p = LIA_DEFAULT_PERSONA

    expect(p.schemaVersion).toBe(1)
    expect(p.identity.name).toBe('Lia')
    expect(p.identity.greetings.length).toBeGreaterThan(0)
    expect(p.preset).toBe('tsundere')
    expect(p.priority.order).toEqual(['utility', 'personality', 'humor'])
    expect(p.language.character).toBe('pt-BR')
    expect(p.memory.policy).toBe('recall-existing-only')

    // Every attribute the preset is required to control (AGENTS §33) is present.
    for (const key of [
      'confidence', 'affection', 'shyness', 'teasing', 'sarcasm',
      'humor', 'curiosity', 'energy', 'kindness', 'proactivity',
    ] as const) {
      expect(typeof p.attributes[key]).toBe('number')
      expect(p.attributes[key]).toBeGreaterThanOrEqual(0)
      expect(p.attributes[key]).toBeLessThanOrEqual(1)
    }
  })

  it('captures the Character Spec identity, relationship and naming', () => {
    const p = LIA_DEFAULT_PERSONA

    // Companion/close virtual friend, warm as trust grows, not cold/subordinate.
    expect(p.relationship.kind).toContain('companheira')
    expect(p.relationship.summary).toContain('não uma subordinada fria')
    expect(p.relationship.trust.toLowerCase()).toContain('confiança')
    // Lia addresses the user by name.
    expect(p.relationship.userName).toBe('Lucas')
    // Not possessive; jealousy only playful.
    expect(p.relationship.jealousy.toLowerCase()).toContain('brincalhão')
    expect(p.relationship.jealousy.toLowerCase()).toContain('nunca possessivo')
  })

  it('encodes the normative emotional-intensity rules per context', () => {
    const ctx = (id: string) => LIA_DEFAULT_PERSONA.intensity.contexts.find(c => c.id === id)!

    expect(ctx('casual').teasingMin).toBe(0.3)
    expect(ctx('casual').teasingMax).toBe(0.4)
    expect(ctx('playful').teasingMin).toBe(0.5)
    expect(ctx('playful').teasingMax).toBe(0.7)
    // "relaxada: mais expressiva"
    expect(ctx('relaxed').teasingMin).toBeDefined()
    expect(ctx('relaxed').guidance).toContain('expressiva')
    // "elogio: pode aumentar"
    expect(ctx('praise').teasingMin).toBeGreaterThanOrEqual(0.5)
    expect(ctx('praise').teasingMax).toBeUndefined()
    // assunto sério / ajuda → ~0 de zoeira
    expect(ctx('serious').teasingMax).toBe(0)
    expect(ctx('helping').teasingMax).toBe(0)
    expect(LIA_DEFAULT_PERSONA.intensity.defaultContextId).toBe('casual')
  })

  it('projects structured data onto separate persona text fields', () => {
    const rendered = renderLiaPersonaFields(LIA_DEFAULT_PERSONA)
    const personaProse = `${rendered.description}\n${rendered.personality}\n${rendered.scenario}`

    // Identity, default language and user naming reach the LLM via prose.
    expect(rendered.description).toContain('Lia')
    expect(personaProse).toContain('tsundere')
    expect(personaProse).toContain('ser útil') // priority
    expect(personaProse).toContain('pt-BR')
    expect(personaProse).toContain('Lucas')
    expect(personaProse).toContain('Nunca inventar memórias') // memory policy prose
    expect(rendered.scenario.length).toBeGreaterThan(0)

    // The old contradiction ("sem emojis") is gone: Spec allows moderate emojis.
    expect(personaProse).toContain('Emojis são permitidos')
    expect(personaProse).not.toContain('Sem emojis')

    // Persona prose never leaks runtime protocol tokens — those stay in
    // `systemPrompt` (technical instructions are not authored "as Lia").
    expect(personaProse).not.toContain('<|ACT')
    expect(personaProse).not.toContain('<|DELAY')
    expect(personaProse).not.toContain('<|CALL')
  })
})
