import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LIA_RUNTIME_SYSTEM_PROMPT } from '../../constants/lia-default-card'
import { useAiriCardStore } from './airi-card'

const { uiLocale, resetArtistryToGlobal } = vi.hoisted(() => ({
  uiLocale: { value: 'en-US' },
  resetArtistryToGlobal: vi.fn(),
}))

vi.mock('localforage', () => ({
  default: {
    getItem: vi.fn(async () => undefined),
    iterate: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
    setItem: vi.fn(async <T>(_: string, value: T) => value),
  },
}))

vi.mock('./artistry', async () => {
  const { defineStore } = await import('pinia')
  return {
    useArtistryStore: defineStore('artistry', {
      state: () => ({
        globalProvider: 'mock-artistry-provider',
        globalModel: 'mock-artistry-model',
        globalPromptPrefix: '',
        globalProviderOptions: {},
        activeProvider: 'mock-artistry-provider',
        activeModel: 'mock-artistry-model',
        defaultPromptPrefix: '',
        providerOptions: {},
      }),
      actions: { resetToGlobal: resetArtistryToGlobal },
    }),
  }
})

vi.mock('./consciousness', async () => {
  const { defineStore } = await import('pinia')
  return {
    useConsciousnessStore: defineStore('consciousness', {
      state: () => ({ activeProvider: 'mock-consciousness-provider', activeModel: 'mock-consciousness-model' }),
    }),
  }
})

vi.mock('./speech', async () => {
  const { defineStore } = await import('pinia')
  return {
    useSpeechStore: defineStore('speech', {
      state: () => ({
        activeSpeechProvider: 'mock-speech-provider',
        activeSpeechModel: 'mock-speech-model',
        activeSpeechVoiceId: 'mock-speech-voice',
      }),
    }),
  }
})

vi.mock('./vision', async () => {
  const { defineStore } = await import('pinia')
  return {
    useVisionStore: defineStore('vision', {
      state: () => ({ activeProvider: 'mock-vision-provider', activeModel: 'mock-vision-model' }),
    }),
  }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: uiLocale }),
}))

/**
 * The system prompt that actually reaches the provider.
 *
 * Regression for "Lia answers in English". The audit proved nothing was missing
 * or overwritten: card `lia` was active, `extensions.airi.persona` was present,
 * `description`/`personality`/`scenario` arrived, the technical runtime prompt
 * arrived, and no legacy AIRI default prompt was injected. The defect was
 * salience: the only language directive sat at 77% of the prompt, behind a
 * 1628-character runtime block written entirely in English, so the model
 * anchored on the English framing and answered "oi" in English.
 *
 * These assertions pin the composed prompt: identity, persona, priority, the
 * technical runtime tokens, and a language directive positioned early enough
 * to compete with them.
 */
describe('lia system prompt sent to the provider', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetArtistryToGlobal.mockClear()
  })

  async function composed() {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()
    return { cardStore, prompt: cardStore.systemPrompt }
  }

  it('resolves lia as the active card and carries the structured persona', async () => {
    const { cardStore } = await composed()

    expect(cardStore.activeCardId).toBe('lia')
    expect(cardStore.activeCard?.name).toBe('Lia')
    expect(cardStore.activeCard?.extensions?.airi?.persona).toBeTruthy()
    expect(cardStore.activeCard?.extensions?.airi?.persona?.language?.character).toBe('pt-BR')
  })

  it('sends the pt-BR directive, the Lia identity and the persona rules', async () => {
    const { prompt } = await composed()

    expect(prompt).toContain('pt-BR')
    expect(prompt).toContain('Lia')
    // Persona priorities from the v1.0 spec: utilidade > personalidade > humor.
    expect(prompt).toContain('ser útil e resolver a tarefa')
    expect(prompt).toContain('tsundere')
  })

  it('sends the technical runtime tokens alongside the persona, not instead of it', async () => {
    const { prompt } = await composed()

    expect(prompt).toContain('<|ACT')
    expect(prompt).toContain('<|DELAY')
    // Both halves must be present: the protocol block must not displace the
    // persona, and the persona must not displace the protocol.
    expect(prompt).toContain(LIA_RUNTIME_SYSTEM_PROMPT)
    expect(prompt).toContain('Idioma:')
  })

  it('places the character language early enough to hold against the English runtime block', async () => {
    const { prompt, cardStore } = await composed()

    // The runtime block is English-only, so a directive buried behind it loses.
    const portugueseDiacritics = ['à', 'á', 'â', 'ã', 'ç', 'é', 'ê', 'í', 'ó', 'ô', 'õ', 'ú']
    expect(portugueseDiacritics.some(mark => LIA_RUNTIME_SYSTEM_PROMPT.includes(mark))).toBe(false)

    const personality = cardStore.activeCard?.personality ?? ''
    // The directive leads the persona block rather than trailing it.
    expect(personality.startsWith('Idioma:')).toBe(true)
    expect(personality.indexOf('pt-BR')).toBeLessThan(personality.indexOf('Limites:'))

    // And it lands in the first half of the whole composed prompt.
    const index = prompt.indexOf('pt-BR')
    expect(index).toBeGreaterThan(-1)
    expect(index, `pt-BR at ${index} of ${prompt.length}`).toBeLessThan(prompt.length / 2)
  })

  it('does not let a legacy AIRI default prompt replace the persona', async () => {
    const { prompt } = await composed()

    // The unused AIRI v2 prompt is English-only assistant boilerplate; if it
    // ever reached this path it would compete with the persona for language.
    expect(prompt).not.toContain('You are a helpful assistant')
    // The persona prose must survive composition rather than being overwritten.
    expect(prompt).toContain('Prioridade:')
    expect(prompt).toContain('Relação:')
  })

  it('keeps characterLanguage independent of the UI locale', async () => {
    // The character's language is her own dimension, not the interface's.
    uiLocale.value = 'ja-JP'
    const japanese = await composed()
    expect(japanese.cardStore.activeCard?.extensions?.airi?.persona?.language?.character).toBe('pt-BR')
    expect(japanese.prompt).toContain('pt-BR')

    uiLocale.value = 'en-US'
    const english = await composed()
    expect(english.cardStore.activeCard?.extensions?.airi?.persona?.language?.character).toBe('pt-BR')
    expect(english.prompt).toContain('pt-BR')
  })
})
