import { describe, expect, it } from 'vitest'

import { sanitizeConfigUpdate } from './config-update-sanitizer'

/**
 * A fronteira renderer -> vault (hardened 12/11/2026). O teste cobre o que
 * pode entrar no cofre por `lia:config:update`: referências nomeadas,
 * quantidade limitada, sem caractere de controle e sem valor gigante.
 */

describe('config update sanitizer', () => {
  it('accepts a named provider credential and passes the update through', () => {
    const result = sanitizeConfigUpdate({
      secrets: [{ key: 'apiKey', scope: 'groq', value: 'value-not-a-real-key' }],
      update: { preferences: { language: 'pt-BR' } },
    })
    expect(result.secrets).toEqual([{ key: 'apiKey', scope: 'groq', value: 'value-not-a-real-key' }])
    expect(result.update).toEqual({ preferences: { language: 'pt-BR' } })
  })

  it('preserves the expected canonical selection for stale-write checks', () => {
    const result = sanitizeConfigUpdate({
      expectedPreferred: { providerId: 'ollama', modelId: 'llama3' },
      update: { provider: { chat: { preferred: { providerId: 'ollama', modelId: 'llama3.1' } } } },
    })
    expect(result.expectedPreferred).toEqual({ providerId: 'ollama', modelId: 'llama3' })
  })

  it('keeps an empty value as an explicit deletion', () => {
    const result = sanitizeConfigUpdate({ secrets: [{ key: 'apiKey', scope: 'groq', value: '' }] })
    expect(result.secrets).toEqual([{ key: 'apiKey', scope: 'groq', value: '' }])
  })

  it('drops the whole batch above eight credentials', () => {
    const secrets = Array.from({ length: 9 }, (_, index) => ({ key: 'apiKey', scope: `provider-${index}`, value: 'x' }))
    expect(sanitizeConfigUpdate({ secrets }).secrets).toEqual([])
    expect(sanitizeConfigUpdate({ secrets: secrets.slice(0, 8) }).secrets).toHaveLength(8)
  })

  it('drops references that are not a provider id', () => {
    const dropped = [
      { key: 'apiKey', scope: '', value: 'x' },
      { key: 'apiKey', scope: '../etc/passwd', value: 'x' },
      { key: 'apiKey', scope: 'scope with space', value: 'x' },
      { key: 'apiKey', scope: 'a'.repeat(65), value: 'x' },
      { key: 'api/Key', scope: 'groq', value: 'x' },
      { key: 'apiKey', scope: 'groq', value: 'line\nbreak' },
      { key: 'apiKey', scope: 'groq', value: 'null\u0000byte' },
      { key: 'apiKey', scope: 'groq', value: 'x'.repeat(4097) },
      { key: 'apiKey', scope: 42, value: 'x' },
      { scope: 'groq', value: 'x' },
      null,
      'groq',
    ]
    expect(sanitizeConfigUpdate({ secrets: dropped }).secrets).toEqual([])
  })

  it('never throws on a hostile payload and never invents fields', () => {
    for (const payload of [undefined, null, 'x', 42, [], { secrets: 'nope' }, { update: 'nope' }, { __proto__: { secrets: [] } }]) {
      const result = sanitizeConfigUpdate(payload)
      expect(Object.keys(result).sort()).toEqual(['secrets', 'update'])
      expect(Array.isArray(result.secrets)).toBe(true)
      expect(typeof result.update).toBe('object')
    }
  })
})
