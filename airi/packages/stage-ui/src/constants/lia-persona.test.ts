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

  it('encodes the normative emotional-intensity rules per context', () => {
    const ctx = (id: string) => LIA_DEFAULT_PERSONA.intensity.contexts.find(c => c.id === id)!

    expect(ctx('casual').teasingMin).toBe(0.3)
    expect(ctx('casual').teasingMax).toBe(0.4)
    expect(ctx('playful').teasingMin).toBe(0.5)
    expect(ctx('playful').teasingMax).toBe(0.7)
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

    expect(rendered.description).toContain('Lia')
    expect(rendered.personality).toContain('tsundere')
    expect(rendered.personality).toContain('ser útil')
    expect(rendered.personality).toContain('pt-BR')
    expect(rendered.personality).toContain('Nunca inventar memórias') // memory policy prose
    expect(rendered.scenario.length).toBeGreaterThan(0)

    // Persona prose never leaks runtime protocol tokens — those stay in
    // `systemPrompt` (technical instructions are not authored "as Lia").
    const personaProse = `${rendered.description}\n${rendered.personality}\n${rendered.scenario}`
    expect(personaProse).not.toContain('<|ACT')
    expect(personaProse).not.toContain('<|DELAY')
    expect(personaProse).not.toContain('<|CALL')
  })
})
