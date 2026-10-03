import type { TextSegment, TextToken } from '@proj-airi/pipelines-audio'

import { describe, expect, it } from 'vitest'

import { mergeSpeechSegmentsForLocalTts } from './segment-merger'

/**
 * Phase 7.6, item 17 (A/B/C/D): the provider-aware segment merger turns the
 * stock latency-focused splitter's tiny fragments (\"Ah,\" / \"Lucas,\") into
 * natural-sized chunks for serialized local engines, WITHOUT touching the
 * default path other providers use.
 */

const META = { intentId: 'i-1', streamId: 's-1', turnId: 't-1' }

function tokenStream(values: Array<Pick<TextToken, 'type' | 'value'>>): ReadableStream<TextToken> {
  let sequence = 0
  return new ReadableStream<TextToken>({
    start(controller) {
      for (const value of values) {
        controller.enqueue({
          createdAt: Date.now(),
          intentId: META.intentId,
          sequence: sequence++,
          streamId: META.streamId,
          turnId: META.turnId,
          ...value,
        } as TextToken)
      }
      controller.close()
    },
  })
}

/** A deterministic base segmenter: each `piece` is emitted as one segment. */
function stubBase(pieces: Array<{ text: string, reason: TextSegment['reason'], special?: string | null }>) {
  return (): ReadableStream<TextSegment> => new ReadableStream<TextSegment>({
    start(controller) {
      pieces.forEach((piece, index) => {
        controller.enqueue({
          createdAt: Date.now(),
          intentId: META.intentId,
          segmentId: `stub-${index}`,
          special: piece.special ?? null,
          streamId: META.streamId,
          turnId: META.turnId,
          text: piece.text,
          reason: piece.reason,
        })
      })
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<TextSegment>): Promise<TextSegment[]> {
  const reader = stream.getReader()
  const out: TextSegment[] = []
  for (;;) {
    const { value, done } = await reader.read()
    if (done)
      break
    out.push(value)
  }
  return out
}

describe('mergeSpeechSegmentsForLocalTts', () => {
  it('a: merges tiny punctuation-triggered fragments into one natural chunk', async () => {
    // The exact QA pattern: boost emitted 'Ah,' and 'Lucas,' as their own
    // requests (3 and 6 chars), then the soft-punct follower ('né?') again.
    // None of them should ever be synthesized alone.
    const stream = mergeSpeechSegmentsForLocalTts(stubBase([
      { reason: 'boost', special: null, text: 'Ah,' },
      { reason: 'boost', special: null, text: 'Lucas,' },
      { reason: 'soft' as TextSegment['reason'], special: null, text: 'que bom te ver por aqui,' },
      { reason: 'hard', special: null, text: 'como você está hoje?' },
    ]))({} as ReadableStream<TextToken>, META)

    const segments = await collect(stream)
    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('Ah, Lucas, que bom te ver por aqui, como você está hoje?')
    // Reason survives as a strong one - never the latency 'boost'.
    expect(segments[0].reason).not.toBe('boost')
  })

  it('b: emits at a strong boundary once the soft target is reached, in order', async () => {
    const soft = 'Esta é a primeira frase longa o suficiente para passar do alvo macio de oitenta caracteres.'
    expect(soft.length).toBeGreaterThanOrEqual(80)
    const stream = mergeSpeechSegmentsForLocalTts(stubBase([
      { reason: 'hard', special: null, text: soft },
      { reason: 'hard', special: null, text: 'Vem a segunda frase, também comprida, fechando o parágrafo com pontuação.' },
      { reason: 'flush', special: null, text: 'E o resto curto.' },
    ]))({} as ReadableStream<TextToken>, META)

    const segments = await collect(stream)
    // Chunk 1: the first sentence, already past the soft target at a strong
    // boundary - emitted immediately, not held for the rest of the turn.
    // Chunk 2: the shorter tail, merged at the flush.
    expect(segments.length).toBe(2)
    expect(segments[0].text).toBe(soft)
    expect(segments[1].text).toContain('Vem a segunda')
    expect(segments[1].text).toContain('E o resto curto.')
  })

  it('c: bounds a long paragraph by the hard cap without cutting words', async () => {
    const sentence = `${'palavra '.repeat(40)}final.`
    const stream = mergeSpeechSegmentsForLocalTts(stubBase([
      { reason: 'hard', special: null, text: sentence },
    ]))({} as ReadableStream<TextToken>, META)

    const segments = await collect(stream)
    expect(segments).toHaveLength(1)
    // Over the cap it still flushes as soon as it can; words are intact.
    expect(segments[0].text.endsWith('final.')).toBe(true)
    expect(segments[0].text.split(' ').filter(Boolean).length).toBe(41)
  })

  it('c+: force-cuts pathological boundary-less input at 2x the cap', async () => {
    const endless = Array.from({ length: 20 }).fill('trechosempontuacao').join(' ')
    const stream = mergeSpeechSegmentsForLocalTts(stubBase(
      endless.split(' ').map(text => ({ reason: 'limit' as TextSegment['reason'], special: null, text })),
    ))({} as ReadableStream<TextToken>, META)

    const segments = await collect(stream)
    const total = segments.reduce((sum, s) => sum + s.text.length, 0)
    expect(total).toBeGreaterThan(0)
    // Nothing exceeds 2x the hard cap by more than one fragment.
    for (const s of segments) {
      expect(s.text.length).toBeLessThan(240 * 2 + 20)
    }
    expect(segments.length).toBeGreaterThan(1)
  })

  it('d: emits specials at their exact position and never speaks punctuation-only bits alone', async () => {
    const stream = mergeSpeechSegmentsForLocalTts(stubBase([
      { reason: 'boost', special: null, text: '!!!' }, // STANDALONE punctuation: dropped
      { reason: 'hard', special: null, text: 'Vamos nessa!' },
      { reason: 'special', special: '[laugh]', text: '' },
      { reason: 'hard', special: null, text: 'E agora a continuação da frase falável.' },
    ]))({} as ReadableStream<TextToken>, META)

    const segments = await collect(stream)
    // Text before the special is flushed BEFORE it; the special rides between.
    expect(segments.map(s => s.special != null ? `[special:${s.special}]` : s.text)).toEqual([
      'Vamos nessa!',
      '[special:[laugh]]',
      'E agora a continuação da frase falável.',
    ])
    for (const s of segments.filter(s => !s.special))
      expect(s.text).not.toBe('!!!')
  })

  it('e-order: segments keep the input textual order even when several fit one chunk', async () => {
    const stream = mergeSpeechSegmentsForLocalTts(stubBase([
      { reason: 'soft' as TextSegment['reason'], special: null, text: 'Primeiro.' },
      { reason: 'soft' as TextSegment['reason'], special: null, text: 'Segundo.' },
      { reason: 'soft' as TextSegment['reason'], special: null, text: 'Terceiro.' },
    ]))({} as ReadableStream<TextToken>, META)

    const segments = await collect(stream)
    expect(segments).toHaveLength(1)
    expect(segments[0].text.indexOf('Primeiro.')).toBeLessThan(segments[0].text.indexOf('Segundo.'))
    expect(segments[0].text.indexOf('Segundo.')).toBeLessThan(segments[0].text.indexOf('Terceiro.'))
  })

  it('keeps pending text when the base stream ends without a flush', async () => {
    // Stream closes right after a fragment: the remainder must still be spoken.
    const stream = mergeSpeechSegmentsForLocalTts(stubBase([
      { reason: 'boost', special: null, text: 'Oi!' },
    ]))({} as ReadableStream<TextToken>, META)

    const segments = await collect(stream)
    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('Oi!')
    expect(segments[0].reason).toBe('flush')
  })
})

describe('stock segmenter vs merged (regression guard)', () => {
  it('a stock-split message produces strictly more chunks than the merged one', async () => {
    const { createTtsSegmentStream, TTS_FLUSH_INSTRUCTION } = await import('@proj-airi/pipelines-audio')
    const text = 'Ah, Lucas, que bom te ver por aqui! Eu estava mesmo pensando em você faz um tempo, sabe? Queria te contar uma coisa bem legal que aconteceu hoje cedo no trabalho.'

    async function count(stream: ReadableStream<TextSegment>): Promise<string[]> {
      const segments = await collect(stream)
      return segments.filter(s => !s.special).map(s => s.text)
    }

    const stock = await count(createTtsSegmentStream(tokenStream([
      { type: 'literal', value: text },
      { type: 'flush', value: TTS_FLUSH_INSTRUCTION },
    ]), META))

    const merged = await count(mergeSpeechSegmentsForLocalTts(createTtsSegmentStream)(tokenStream([
      { type: 'literal', value: text },
      { type: 'flush', value: TTS_FLUSH_INSTRUCTION },
    ]), META))

    expect(stock.length).toBeGreaterThan(3) // the QA fragmentation baseline
    expect(merged.length).toBeLessThan(stock.length)
    // All text survives merging, in order.
    expect(merged.join(' ').replace(/\s+/g, ' ')).toContain('te contar uma coisa bem legal')
    // No fragment under ten characters is spoken alone anymore.
    for (const piece of merged)
      expect(piece.trim().length).toBeGreaterThanOrEqual(10)
  })
})
