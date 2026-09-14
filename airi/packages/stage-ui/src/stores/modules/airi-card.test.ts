import type { AiriCard } from './airi-card'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CURRENT_LIA_PERSONA_PROJECTION_VERSION, LIA_DEFAULT_PERSONA, renderLiaPersonaFields } from '../../constants/lia-persona'
import { useSettingsStageModel } from '../settings/stage-model'
import { useAiriCardStore } from './airi-card'
import { useConsciousnessStore } from './consciousness'
import { useSpeechStore } from './speech'
import { useVisionStore } from './vision'

const { resetArtistryToGlobal } = vi.hoisted(() => ({
  resetArtistryToGlobal: vi.fn(),
}))

// NOTICE:
// Vitest runs these store tests in Node, where localforage cannot select a
// browser storage driver. The stage-model watcher legitimately asks the
// display-model store to resolve IDs, so provide the storage boundary with a
// deterministic no-op instead of allowing rejected driver initialization to
// escape as an unrelated test error.
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
        globalPromptPrefix: 'mock-artistry-prefix',
        globalProviderOptions: {},
        activeProvider: 'mock-artistry-provider',
        activeModel: 'mock-artistry-model',
        defaultPromptPrefix: 'mock-artistry-prefix',
        providerOptions: {},
      }),
      actions: {
        resetToGlobal: resetArtistryToGlobal,
      },
    }),
  }
})

vi.mock('./consciousness', async () => {
  const { defineStore } = await import('pinia')

  return {
    useConsciousnessStore: defineStore('consciousness', {
      state: () => ({
        activeProvider: 'mock-consciousness-provider',
        activeModel: 'mock-consciousness-model',
      }),
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
      state: () => ({
        activeProvider: 'mock-vision-provider',
        activeModel: 'mock-vision-model',
      }),
    }),
  }
})

// Real modules loaded by these tests (e.g. the settings stage-model store) may
// still touch vue-i18n; keep a deterministic i18n boundary so store tests do not
// need a live i18n plugin instance.
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

/**
 * @example
 * describe('airi-card store', () => {})
 */
describe('airi-card store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetArtistryToGlobal.mockClear()
  })

  // This test runs first so the store's localStorage backing is empty, which
  // reproduces a true fresh install: no persisted cards and no persisted
  // active id. Initialization must seed Lia as the single built-in card and
  // resolve the default selection to it.
  it('seeds Lia as the default built-in card on a fresh install', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    expect(cardStore.cards.has('lia')).toBe(true)
    expect(cardStore.activeCardId).toBe('lia')
    expect(cardStore.activeCard?.name).toBe('Lia')

    // The Lia persona is authored as structured card data, not pulled from i18n.
    expect(cardStore.activeCard?.personality).toContain('tsundere')
    expect(cardStore.activeCard?.description).toBeTruthy()

    // Persona and runtime instructions stay in separate card fields: the
    // `systemPrompt` carries the runtime ACT/DELAY tokens, and the persona
    // identity is not smeared across that runtime text.
    expect(cardStore.activeCard?.systemPrompt).toContain('<|ACT')
    expect(cardStore.activeCard?.systemPrompt).toContain('<|DELAY')
    expect(cardStore.activeCard?.systemPrompt).not.toContain('Lia is a')
  })

  it('stores Lia persona v1.0 as structured data on the built-in card', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    const persona = cardStore.activeCard?.extensions?.airi?.persona
    expect(persona).toBeDefined()
    if (!persona)
      return

    // Single editable source, projected onto the runtime text fields.
    expect(persona.identity.name).toBe('Lia')
    expect(persona.schemaVersion).toBe(1)
    expect(persona.preset).toBe('tsundere')

    // Normative Lia rules live in the data model.
    expect(persona.priority.order).toEqual(['utility', 'personality', 'humor'])
    expect(persona.language.character).toBe('pt-BR')
    expect(persona.memory.policy).toBe('recall-existing-only')

    // Intensity contexts reflect the official rules.
    const casual = persona.intensity.contexts.find(ctx => ctx.id === 'casual')
    expect(casual?.teasingMin).toBe(0.3)
    expect(casual?.teasingMax).toBe(0.4)
    const serious = persona.intensity.contexts.find(ctx => ctx.id === 'serious')
    expect(serious?.teasingMax).toBe(0)

    // The persona text fields the runtime reads are projections of this data.
    expect(cardStore.activeCard?.personality).toContain(persona.preset)
    expect(cardStore.activeCard?.personality).toContain('ser útil')
  })

  it('keeps a legacy card untouched when it carries no structured persona', async () => {
    const cardStore = useAiriCardStore()
    const cardId = await cardStore.addCard({
      name: 'Sem persona estruturada',
      version: '1.0.0',
      description: 'Card antigo/importado sem persona em extensions.',
      personality: 'Curioso e preciso.',
    }, 'scratch')
    await cardStore.activateCard(cardId)

    // Imported/legacy cards keep working via their text fields alone.
    expect(cardStore.activeCard?.extensions?.airi?.persona).toBeUndefined()
    expect(cardStore.activeCard?.personality).toBe('Curioso e preciso.')
    expect(cardStore.activeCard?.systemPrompt).toBeUndefined()
  })

  // ROOT CAUSE:
  //
  // Authentication installed the official module defaults before card startup
  // completed. Initializing the default card then assigned its missing module
  // fields as empty values and erased those defaults.
  //
  // We fixed this by applying only module fields that a card actually owns.
  it('keeps runtime module selections when the active card omits them', async () => {
    const consciousnessStore = useConsciousnessStore()
    const speechStore = useSpeechStore()
    const visionStore = useVisionStore()
    const cardStore = useAiriCardStore()

    await cardStore.initialize()

    expect(consciousnessStore.activeProvider).toBe('mock-consciousness-provider')
    expect(consciousnessStore.activeModel).toBe('mock-consciousness-model')
    expect(speechStore.activeSpeechProvider).toBe('mock-speech-provider')
    expect(speechStore.activeSpeechModel).toBe('mock-speech-model')
    expect(speechStore.activeSpeechVoiceId).toBe('mock-speech-voice')
    expect(visionStore.activeProvider).toBe('mock-vision-provider')
    expect(visionStore.activeModel).toBe('mock-vision-model')
  })

  // ROOT CAUSE:
  //
  // Each Electron window called the synchronized initialize action. The leader
  // applied the active card again for every new window. An older card selection
  // then replaced module defaults that the authentication hook had configured.
  //
  // We fixed this by making card initialization idempotent in the leader.
  it('does not reapply active card settings for a second window', async () => {
    const consciousnessStore = useConsciousnessStore()
    const speechStore = useSpeechStore()
    const visionStore = useVisionStore()
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    consciousnessStore.activeProvider = 'official-provider'
    consciousnessStore.activeModel = 'auto'
    speechStore.activeSpeechProvider = 'official-provider-speech'
    speechStore.activeSpeechModel = 'auto'
    visionStore.activeProvider = 'vision-official-provider'
    visionStore.activeModel = 'auto'

    await cardStore.initialize()

    expect(consciousnessStore.activeProvider).toBe('official-provider')
    expect(consciousnessStore.activeModel).toBe('auto')
    expect(speechStore.activeSpeechProvider).toBe('official-provider-speech')
    expect(speechStore.activeSpeechModel).toBe('auto')
    expect(visionStore.activeProvider).toBe('vision-official-provider')
    expect(visionStore.activeModel).toBe('auto')
  })

  // ROOT CAUSE:
  //
  // The authentication hook updated the runtime module stores, but the active
  // card kept its older empty selections. A later card activation restored
  // speech-noop and erased the authenticated defaults.
  //
  // We fixed this by persisting the resolved runtime selections in one card
  // command without applying the card back to the runtime.
  it('persists runtime module selections without reapplying the active card', async () => {
    const consciousnessStore = useConsciousnessStore()
    const speechStore = useSpeechStore()
    const visionStore = useVisionStore()
    const cardStore = useAiriCardStore()
    await cardStore.initialize()
    resetArtistryToGlobal.mockClear()

    consciousnessStore.activeProvider = 'official-provider'
    consciousnessStore.activeModel = 'auto'
    speechStore.activeSpeechProvider = 'official-provider-speech'
    speechStore.activeSpeechModel = 'auto'
    speechStore.activeSpeechVoiceId = ''
    visionStore.activeProvider = 'vision-official-provider'
    visionStore.activeModel = 'auto'

    await expect(cardStore.persistActiveCardModuleSelections()).resolves.toBe(true)

    expect(cardStore.activeCard?.extensions.airi.modules.consciousness).toEqual({
      provider: 'official-provider',
      model: 'auto',
    })
    expect(cardStore.activeCard?.extensions.airi.modules.speech).toMatchObject({
      provider: 'official-provider-speech',
      model: 'auto',
      voice_id: '',
    })
    expect(cardStore.activeCard?.extensions.airi.modules.vision).toEqual({
      provider: 'vision-official-provider',
      model: 'auto',
    })
    expect(resetArtistryToGlobal).not.toHaveBeenCalled()

    await expect(cardStore.persistActiveCardModuleSelections()).resolves.toBe(false)
  })

  // ROOT CAUSE:
  //
  // A synchronized state snapshot replaced `activeCardId`. The old watcher
  // interpreted that replicated state as a user command and applied module
  // settings, which produced another synchronized snapshot.
  //
  // We fixed this by applying settings only from the synchronized activation
  // action. State replication remains free of runtime side effects.
  it('applies card settings only through the activation command', async () => {
    const stageModelStore = useSettingsStageModel()
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    const vrmCardId = await cardStore.addCard({
      name: 'VRM card',
      version: '1.0.0',
      description: 'Card for the promoted leader.',
      extensions: {
        airi: {
          modules: {
            consciousness: { provider: 'mock-consciousness-provider', model: 'mock-consciousness-model' },
            vision: { provider: 'mock-vision-provider', model: 'mock-vision-model' },
            speech: { provider: 'mock-speech-provider', model: 'mock-speech-model', voice_id: 'mock-speech-voice' },
            displayModelId: 'preset-vrm-1',
          },
          agents: {},
        },
      },
    }, 'scratch')
    const live2dCardId = await cardStore.addCard({
      name: 'Live2D card',
      version: '1.0.0',
      description: 'Card for the active leader.',
      extensions: {
        airi: {
          modules: {
            consciousness: { provider: 'mock-consciousness-provider', model: 'mock-consciousness-model' },
            vision: { provider: 'mock-vision-provider', model: 'mock-vision-model' },
            speech: { provider: 'mock-speech-provider', model: 'mock-speech-model', voice_id: 'mock-speech-voice' },
            displayModelId: 'preset-live2d-1',
          },
          agents: {},
        },
      },
    }, 'scratch')

    stageModelStore.stageModelSelected = 'preset-live2d-1'
    await cardStore.activateCard(vrmCardId)
    expect(stageModelStore.stageModelSelected).toBe('preset-vrm-1')

    cardStore.$patch({ activeCardId: live2dCardId })
    expect(stageModelStore.stageModelSelected).toBe('preset-vrm-1')

    await cardStore.activateCard(live2dCardId)
    expect(stageModelStore.stageModelSelected).toBe('preset-live2d-1')
  })

  it('does not create runtime module stores for metadata-only consumers', () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    // ROOT CAUSE:
    //
    // The chat session store only reads the active card ID and system prompt,
    // but creating the card store also created every runtime module store.
    // The speech store then loaded provider voices in each auxiliary window.
    useAiriCardStore(pinia)

    expect(pinia.state.value.speech).toBeUndefined()
    expect(pinia.state.value.consciousness).toBeUndefined()
    expect(pinia.state.value.vision).toBeUndefined()
  })

  /**
   * @example
   * it('persists selected module config on active card', () => {})
   */
  it('persists selected module config on active card', async () => {
    const stageModelStore = useSettingsStageModel()
    stageModelStore.stageModelSelected = 'preset-live2d-1'

    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    expect(await cardStore.updateActiveCardDisplayModel('display-model-iru-v2')).toBe(true)
    expect(await cardStore.updateActiveCardConsciousness({ provider: 'openrouter-ai', model: 'anthropic/claude-sonnet' })).toBe(true)
    expect(await cardStore.updateActiveCardVision({ provider: 'ollama', model: 'llava' })).toBe(true)
    expect(await cardStore.updateActiveCardSpeech({ provider: 'elevenlabs', model: 'eleven_multilingual_v2', voice_id: 'aria' })).toBe(true)
    expect(cardStore.activeCard?.extensions.airi.modules).toMatchObject({
      displayModelId: 'display-model-iru-v2',
      consciousness: { provider: 'openrouter-ai', model: 'anthropic/claude-sonnet' },
      vision: { provider: 'ollama', model: 'llava' },
      speech: { provider: 'elevenlabs', model: 'eleven_multilingual_v2', voice_id: 'aria' },
    })
    expect(stageModelStore.stageModelSelected).toBe('display-model-iru-v2')
  })

  // ROOT CAUSE:
  //
  // Card activation changes `activeCardId`, but the previous implementation
  // only observed the debounced `activeCard` object. Some card switchers keep
  // the same object reference while changing the selected ID, so the runtime
  // stage model stayed on the previous card's model.
  //
  // We fixed this by applying card settings from the stable activation key.
  // https://github.com/moeru-ai/airi/issues/2089
  it('issue #2089: applies the activated card display model to the stage runtime', async () => {
    const stageModelStore = useSettingsStageModel()
    stageModelStore.stageModelSelected = 'preset-live2d-1'

    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    const card: AiriCard = {
      name: 'VRM card',
      version: '1.0.0',
      description: 'Card with a VRM display model',
      extensions: {
        airi: {
          modules: {
            consciousness: { provider: 'mock-consciousness-provider', model: 'mock-consciousness-model' },
            vision: { provider: 'mock-vision-provider', model: 'mock-vision-model' },
            speech: { provider: 'mock-speech-provider', model: 'mock-speech-model', voice_id: 'mock-speech-voice' },
            displayModelId: 'preset-vrm-1',
          },
          agents: {},
        },
      },
    }
    const cardId = await cardStore.addCard(card, 'scratch')

    await cardStore.activateCard(cardId)

    expect(stageModelStore.stageModelSelected).toBe('preset-vrm-1')
  })

  it('applies edits to the currently active card display model', async () => {
    const stageModelStore = useSettingsStageModel()
    stageModelStore.stageModelSelected = 'preset-live2d-1'

    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    const cardId = await cardStore.addCard({
      name: 'Editable card',
      version: '1.0.0',
      description: 'Card whose model can be edited',
      extensions: {
        airi: {
          modules: {
            consciousness: { provider: 'mock-consciousness-provider', model: 'mock-consciousness-model' },
            vision: { provider: 'mock-vision-provider', model: 'mock-vision-model' },
            speech: { provider: 'mock-speech-provider', model: 'mock-speech-model', voice_id: 'mock-speech-voice' },
            displayModelId: 'preset-live2d-1',
          },
          agents: {},
        },
      },
    }, 'scratch')
    await cardStore.activateCard(cardId)

    const card = cardStore.getCard(cardId)
    expect(card).toBeDefined()
    await cardStore.updateCard(cardId, {
      ...card!,
      extensions: {
        ...card!.extensions,
        airi: {
          ...card!.extensions.airi,
          modules: {
            ...card!.extensions.airi.modules,
            displayModelId: 'preset-vrm-1',
          },
        },
      },
    })

    expect(stageModelStore.stageModelSelected).toBe('preset-vrm-1')
  })

  // ROOT CAUSE:
  //
  // pinia-plugin-synced applies a structured clone of every synchronized
  // store. The clone replaced the active card object, so the runtime watcher
  // treated unchanged card settings as an edit. Applying those settings
  // mutated other synchronized stores and committed another full snapshot.
  //
  // We prevent the feedback loop by applying runtime settings only through an
  // explicit card command, never in response to a state snapshot.
  it('does not reapply runtime settings for an unchanged synchronized card snapshot', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    const cardId = await cardStore.addCard({
      name: 'Artistry card',
      version: '1.0.0',
      description: 'A card with object-valued runtime settings.',
      extensions: {
        airi: {
          modules: {
            artistry: {
              options: { steps: 20 },
            },
          },
          agents: {},
        },
      },
    }, 'scratch')
    await cardStore.activateCard(cardId)

    const applicationsBeforeSnapshot = resetArtistryToGlobal.mock.calls.length
    const synchronizedCards = new Map<string, AiriCard>(JSON.parse(JSON.stringify([...cardStore.cards])))

    cardStore.$patch({ cards: synchronizedCards })

    expect(resetArtistryToGlobal).toHaveBeenCalledTimes(applicationsBeforeSnapshot)
  })

  // ROOT CAUSE:
  //
  // The settings reset clears the runtime model before resetting card state.
  // Resetting `activeCardId` first briefly selected the still-persisted default
  // card, allowing its display model to overwrite the reset runtime value.
  //
  // https://github.com/moeru-ai/airi/pull/2090#discussion_r3610810272
  it('does not restore a stale card model during card state reset', async () => {
    const stageModelStore = useSettingsStageModel()
    stageModelStore.stageModelSelected = 'preset-live2d-1'

    const cardStore = useAiriCardStore()
    await cardStore.initialize()
    await cardStore.updateActiveCardDisplayModel('preset-vrm-1')
    stageModelStore.stageModelSelected = 'preset-live2d-1'

    cardStore.resetState()

    expect(stageModelStore.stageModelSelected).toBe('preset-live2d-1')
  })

  /**
   * @example
   * it('updates speech config on the active card', () => {})
   */
  it('updates speech config on the active card', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    expect(await cardStore.updateActiveCardSpeech({ provider: 'elevenlabs', model: 'eleven_multilingual_v2', voice_id: 'aria' })).toBe(true)
    expect(cardStore.activeCard?.extensions.airi.modules.speech).toMatchObject({
      provider: 'elevenlabs',
      model: 'eleven_multilingual_v2',
      voice_id: 'aria',
    })
  })

  it('keeps position-sensitive CCv3 fields separate from the stable system prompt', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    const cardId = await cardStore.addCard({
      name: 'Runtime context card',
      version: '1.0.0',
      systemPrompt: 'Follow the character rules.',
      description: 'A patient field researcher.',
      personality: 'Curious and precise.',
      scenario: 'The conversation takes place in an observatory.',
      postHistoryInstructions: 'Answer the latest observation in one paragraph.',
      greetings: ['Welcome to the observatory.'],
      messageExample: [
        ['{{user}}: What did you find?', '{{char}}: A new comet.'],
      ],
      extensions: {
        airi: {
          modules: {
            consciousness: { provider: 'mock-consciousness-provider', model: 'mock-consciousness-model' },
            vision: { provider: 'mock-vision-provider', model: 'mock-vision-model' },
            speech: { provider: 'mock-speech-provider', model: 'mock-speech-model', voice_id: 'mock-speech-voice' },
            artistry: { widgetInstruction: 'Use the image widget for star charts.' },
          },
          agents: {},
        },
      },
    }, 'scratch')

    await cardStore.activateCard(cardId)

    expect(cardStore.systemPrompt).toBe([
      'Follow the character rules.',
      'A patient field researcher.',
      'Curious and precise.',
      'The conversation takes place in an observatory.',
      'Use the image widget for star charts.',
    ].join('\n\n'))
    expect(cardStore.systemPrompt).not.toContain('Answer the latest observation')
    expect(cardStore.systemPrompt).not.toContain('Welcome to the observatory')
    expect(cardStore.systemPrompt).not.toContain('What did you find?')
  })

  it('falls back to the Lia built-in card when the active custom card is deleted', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    const cardId = await cardStore.addCard({
      name: 'Custom card',
      version: '1.0.0',
      description: 'A removable card.',
    }, 'scratch')
    await cardStore.activateCard(cardId)

    await cardStore.removeCard(cardId)

    expect(cardStore.cards.has(cardId)).toBe(false)
    expect(cardStore.activeCardId).toBe('lia')
    expect(cardStore.activeCard?.name).toBe('Lia')
  })

  it('keeps the Lia built-in fallback card when deletion is requested directly', async () => {
    const cardStore = useAiriCardStore()
    // Force a fresh resolve to the built-in regardless of prior storage state.
    cardStore.activeCardId = '__missing__'
    await cardStore.initialize()

    expect(await cardStore.removeCard('lia')).toBe(false)
    expect(cardStore.cards.has('lia')).toBe(true)
    expect(cardStore.activeCardId).toBe('lia')
    expect(cardStore.activeCard?.name).toBe('Lia')
  })

  it('does not overwrite a persisted legacy default (ReLU) card, which stays selectable', async () => {
    const cardStore = useAiriCardStore()

    // Simulate state persisted by an AIRI version whose built-in card id was
    // 'default': that card and the active id are still present on disk. It is
    // a fully-shaped AiriCard (the legacy built-in carried an airi extension).
    const legacyDefaultCard: AiriCard = {
      name: 'ReLU',
      version: '1.0.0',
      description: 'Legacy built-in persona from AIRI.',
      extensions: {
        airi: {
          modules: {
            consciousness: { provider: 'mock-consciousness-provider', model: 'mock-consciousness-model' },
            vision: { provider: 'mock-vision-provider', model: 'mock-vision-model' },
            speech: { provider: 'mock-speech-provider', model: 'mock-speech-model', voice_id: 'mock-speech-voice' },
          },
          agents: {},
        },
      },
    }
    cardStore.cards.set('default', legacyDefaultCard)
    cardStore.activeCardId = 'default'

    await cardStore.initialize()

    // The legacy card is preserved untouched and remains the active selection.
    expect(cardStore.cards.has('default')).toBe(true)
    expect(cardStore.cards.get('default')?.name).toBe('ReLU')
    expect(cardStore.activeCardId).toBe('default')
    expect(cardStore.activeCard?.name).toBe('ReLU')

    // The Lia built-in is still available alongside it as the fallback.
    expect(cardStore.cards.has('lia')).toBe(true)
    expect(cardStore.cards.get('lia')?.name).toBe('Lia')
  })

  it('preserves a valid persisted active card during initialization', async () => {
    const cardStore = useAiriCardStore()
    const cardId = await cardStore.addCard({
      name: 'Persisted active card',
      version: '1.0.0',
      description: 'Keep this selection.',
    }, 'scratch')
    cardStore.activeCardId = cardId

    await cardStore.initialize()

    expect(cardStore.activeCardId).toBe(cardId)
    expect(cardStore.activeCard?.name).toBe('Persisted active card')
  })

  it('repairs a dangling persisted active card to the Lia built-in during initialization', async () => {
    const cardStore = useAiriCardStore()
    cardStore.activeCardId = 'missing-card'

    await cardStore.initialize()

    expect(cardStore.activeCardId).toBe('lia')
    expect(cardStore.activeCard?.name).toBe('Lia')
  })
})

/**
 * A Lia card as persisted by a build that shipped projection v1: the language
 * directive trailing the personality block, and no projection version stamped.
 */
function legacyLiaCard(): AiriCard {
  return {
    name: 'Lia',
    version: '1.0.0',
    description: 'Lia e uma companhia proxima.',
    personality: 'Preset: tsundere (nao agressiva).\n\nEstilo de fala: informal.\n\nIdioma: responda em pt-BR por padrao.',
    scenario: 'O palco e a casa de Lia.',
    systemPrompt: 'Streaming control tokens use the exact <|NAME payload|> form.',
    extensions: {
      airi: {
        modules: {
          consciousness: { provider: 'mock-consciousness-provider', model: 'mock-consciousness-model' },
          vision: { provider: 'mock-vision-provider', model: 'mock-vision-model' },
          speech: { provider: 'mock-speech-provider', model: 'mock-speech-model', voice_id: 'mock-speech-voice' },
        },
        agents: {},
        persona: LIA_DEFAULT_PERSONA,
      },
    },
  }
}

describe('airi-card store persisted Lia projection migration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetArtistryToGlobal.mockClear()
  })

  it('migrates a persisted Lia card without any manual localStorage reset', async () => {
    const cardStore = useAiriCardStore()
    cardStore.cards.set('lia', legacyLiaCard())
    cardStore.activeCardId = 'lia'

    await cardStore.initialize()

    const migrated = cardStore.cards.get('lia')!
    // The bug this fixes: the stale v1 prose survived boot and the pt-BR rule
    // stayed buried, so the model answered in English.
    expect(migrated.personality).not.toContain('Idioma: responda em pt-BR por padrao.')
    expect(migrated.personality?.startsWith('Idioma:')).toBe(true)
    expect(migrated.personality).toBe(renderLiaPersonaFields(LIA_DEFAULT_PERSONA).personality)
    expect(cardStore.systemPrompt).toContain('pt-BR')
  })

  it('stamps the projection version and keeps the persona as the source of truth', async () => {
    const cardStore = useAiriCardStore()
    cardStore.cards.set('lia', legacyLiaCard())

    await cardStore.initialize()

    const migrated = cardStore.cards.get('lia')!
    expect(migrated.extensions.airi.personaProjectionVersion).toBe(CURRENT_LIA_PERSONA_PROJECTION_VERSION)
    // Migration must not mutate or replace the structured persona.
    expect(migrated.extensions.airi.persona).toEqual(LIA_DEFAULT_PERSONA)
    expect(migrated.extensions.airi.persona?.language.character).toBe('pt-BR')
  })

  it('does not rewrite a card that is already on the current projection', async () => {
    const cardStore = useAiriCardStore()
    await cardStore.initialize()

    const current = cardStore.cards.get('lia')!
    expect(current.extensions.airi.personaProjectionVersion).toBe(CURRENT_LIA_PERSONA_PROJECTION_VERSION)

    const before = cardStore.cards.get('lia')
    await cardStore.initialize()

    // Same object reference: nothing was rebuilt on the second boot.
    expect(cardStore.cards.get('lia')).toBe(before)
  })

  it('leaves a non-Lia card completely untouched', async () => {
    const cardStore = useAiriCardStore()
    const custom: AiriCard = {
      name: 'Custom',
      version: '1.0.0',
      description: 'Hand written description.',
      personality: 'Hand written personality, deliberately not a projection.',
      scenario: 'Hand written scenario.',
      extensions: {
        airi: {
          modules: {
            consciousness: { provider: 'mock-consciousness-provider', model: 'mock-consciousness-model' },
            vision: { provider: 'mock-vision-provider', model: 'mock-vision-model' },
            speech: { provider: 'mock-speech-provider', model: 'mock-speech-model', voice_id: 'mock-speech-voice' },
          },
          agents: {},
        },
      },
    }
    cardStore.cards.set('custom-card', custom)

    await cardStore.initialize()

    const after = cardStore.cards.get('custom-card')!
    expect(after.description).toBe('Hand written description.')
    expect(after.personality).toBe('Hand written personality, deliberately not a projection.')
    expect(after.scenario).toBe('Hand written scenario.')
    expect(after.extensions.airi.personaProjectionVersion).toBeUndefined()
    // And no card was deleted.
    expect(cardStore.cards.has('lia')).toBe(true)
    expect(cardStore.cards.has('custom-card')).toBe(true)
  })

  it('projects from the stored persona rather than the built-in default', async () => {
    const cardStore = useAiriCardStore()
    const legacy = legacyLiaCard()
    const editedPersona = {
      ...LIA_DEFAULT_PERSONA,
      language: { ...LIA_DEFAULT_PERSONA.language, character: 'es-ES' as const },
    }
    legacy.extensions.airi.persona = editedPersona
    cardStore.cards.set('lia', legacy)

    await cardStore.initialize()

    // The persisted persona wins: it stays the source of truth even when it
    // differs from the shipped default.
    expect(cardStore.cards.get('lia')!.personality).toContain('es-ES')
    expect(cardStore.cards.get('lia')!.extensions.airi.persona?.language.character).toBe('es-ES')
  })

  it('attaches the persona and projects when a legacy card has none', async () => {
    const cardStore = useAiriCardStore()
    const legacy = legacyLiaCard()
    delete legacy.extensions.airi.persona
    cardStore.cards.set('lia', legacy)

    await cardStore.initialize()

    const migrated = cardStore.cards.get('lia')!
    expect(migrated.extensions.airi.persona).toEqual(LIA_DEFAULT_PERSONA)
    expect(migrated.extensions.airi.personaProjectionVersion).toBe(CURRENT_LIA_PERSONA_PROJECTION_VERSION)
    expect(migrated.personality).toBe(renderLiaPersonaFields(LIA_DEFAULT_PERSONA).personality)
  })

  it('keeps the character language independent of the UI locale after migrating', async () => {
    const cardStore = useAiriCardStore()
    cardStore.cards.set('lia', legacyLiaCard())

    await cardStore.initialize()

    // The projection is derived from the persona object, never from i18n, so
    // the interface language cannot move the character's language.
    expect(cardStore.cards.get('lia')!.extensions.airi.persona?.language.character).toBe('pt-BR')
    expect(cardStore.cards.get('lia')!.personality).toBe(renderLiaPersonaFields(LIA_DEFAULT_PERSONA).personality)
  })
})
