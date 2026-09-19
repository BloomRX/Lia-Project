import { describe, expect, it } from 'vitest'

import { isSpeechChunkSpeakable, normalizeTextForSpeech } from './text-for-speech'

/**
 * Phase 7.7.2, items 12-14: the speech-normalization layer. The visible
 * message is never the input of these rules; only what reaches the TTS is.
 */

describe('normalizeTextForSpeech', () => {
  it('i: the known QA sentence keeps its natural Portuguese - including the terminal period as prosody', () => {
    const { text } = normalizeTextForSpeech('Diga apenas: Oi Lucas, agora minha voz está funcionando.')
    expect(text).toBe('Diga apenas: Oi Lucas, agora minha voz está funcionando.')
    expect(isSpeechChunkSpeakable(text)).toBe(true)
  })

  it('detached punctuation reattaches to its word so "." never tokenizes alone', () => {
    const { text } = normalizeTextForSpeech('minha voz está funcionando .')
    expect(text).toBe('minha voz está funcionando.')
  })

  it('h: a punctuation-only chunk is never speakable, never TTS-worthy', () => {
    for (const chunk of ['.', '!', '?', '...', '?!', ',', ' * ', ' - ']) {
      const { text } = normalizeTextForSpeech(chunk)
      expect(isSpeechChunkSpeakable(text)).toBe(false)
      expect(isSpeechChunkSpeakable(chunk)).toBe(false)
    }
  })

  it('j: question and exclamation survive - they are prosody, not literals', () => {
    const { text } = normalizeTextForSpeech('Sério?! Ela falou! De verdade?')
    expect(text).toBe('Sério?! Ela falou! De verdade?')
  })

  it('k: markdown syntax is removed, its natural text kept', () => {
    const { text } = normalizeTextForSpeech('**Olá** Lucas, veja _isto_:\n\n- item um\n- item dois')
    expect(text).toBe('Olá Lucas, veja isto: item um item dois')

    const heading = normalizeTextForSpeech('## Título\n\nTexto **com negrito**.')
    expect(heading.text).toBe('Título Texto com negrito.')

    const quote = normalizeTextForSpeech('> citação qualquer\n\nresposta direta')
    expect(quote.text).toBe('citação qualquer resposta direta')
  })

  it('links keep the label voice, URLs and images are not spelled out', () => {
    const { text } = normalizeTextForSpeech('leia [a documentação](https://exemplo.com/guia?x=1) e www.exemplo.com')
    expect(text).toBe('leia a documentação e')
    expect(normalizeTextForSpeech('acesse https://exemplo.com/abc').text).toBe('acesse')
    expect(normalizeTextForSpeech('![foto](img.png) Olá').text).toBe('Olá')
  })

  it('code fences and inline code are removed, never read', () => {
    const { text } = normalizeTextForSpeech('rode `npm run dev` e pronto')
    expect(text).toBe('rode e pronto')
    const fenced = normalizeTextForSpeech('antes\n```ts\nconst x = 1\n```\ndepois')
    expect(fenced.text).toBe('antes depois')
    expect(fenced.diagnostics.removedCodeChars).toBeGreaterThan(0)
  })

  it('emoji follow the product policy - removed, never transliterated', () => {
    const { text, diagnostics } = normalizeTextForSpeech('Oi Lucas! 😊🎉 tudo bem?')
    expect(text).toBe('Oi Lucas! tudo bem?')
    expect(diagnostics.emojiRemovedCount).toBeGreaterThanOrEqual(2)
  })

  it('whitespace collapses deterministically', () => {
    expect(normalizeTextForSpeech('  muitos\n\nespaços   aqui\t ').text).toBe('muitos espaços aqui')
  })

  it('l: normalization never EXPANDS or rewrites natural text', () => {
    const source = 'Oi! Como você está? Estou bem, obrigada. E você, Lucas?'
    expect(normalizeTextForSpeech(source).text).toBe(source)
  })

  it('accents survive wholesale - portuguese is not mangled', () => {
    const source = 'Agora minha voz está funcionando, não é? Coração, ação, avó, você.'
    expect(normalizeTextForSpeech(source).text).toBe(source)
  })
})
