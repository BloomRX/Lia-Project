import { describe, expect, it } from 'vitest'

import { providerAnthropic } from '.'

/**
 * Rodada 21 — contrato de provider.
 *
 * A Lia não tem adaptador nativo da Anthropic. O que este teste protege é a
 * DECLARAÇÃO: a entrada não pode voltar a se apresentar como suporte direto a
 * `api.anthropic.com`, porque o transporte é OpenAI `/chat/completions` e a API
 * nativa só responde em `/v1/messages`.
 */
describe('provider anthropic — declaração honesta', () => {
  it('declara que precisa de gateway compatível com OpenAI', () => {
    expect(providerAnthropic.description).toContain('gateway')
    expect(providerAnthropic.description).toContain('/v1/messages')
  })

  it('não promete endpoint nativo da Anthropic', () => {
    const description = providerAnthropic.description.toLowerCase()
    expect(description).not.toMatch(/suporte nativo|nativo da anthropic|api nativa direta/)
  })

  it('oferece apenas tarefa de chat — sem embeddings, TTS ou STT implícitos', () => {
    expect(providerAnthropic.tasks).toEqual(['chat'])
  })
})
