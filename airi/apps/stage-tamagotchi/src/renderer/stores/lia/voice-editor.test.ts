import type { LiaVoiceConfig } from '../../../shared/eventa'
import type { VoicePreviewDriver } from './voice-preview'

import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 4E-2 commit 2: the Voz tab's editing logic.
 *
 * The editor is a plain composable rather than logic buried in the SFC so the
 * catalogue flow, the selection rules and the write path can be asserted here in
 * the `node` project. `VoiceSection.vue` is a thin binding over it; its own
 * rendering is covered by `VoiceSection.test.ts` (SSR) and
 * `VoiceSection.browser.test.ts` (mount).
 *
 * The provider catalogue is the REAL one: `availableSpeechProvidersMetadata`
 * comes from stage-ui's own registry and is only awaited, never stubbed. Voices
 * arrive through a spy on `listProviderVoices`, the single seam the runtime
 * itself uses to fill `availableVoices`, so what the editor sees is exactly what
 * the speech store would cache. Models are seeded into `providerRuntimeState`,
 * the same slot `getModelsForProvider` reads at runtime.
 */

const ipc = vi.hoisted(() => ({
  getVoiceConfig: vi.fn(async (): Promise<unknown> => ({ tts: {} })),
  saveVoiceConfig: vi.fn(async (_config: unknown) => {
    structuredClone(_config)
  }),
}))

/** The slice of the AIRI card the voice store projects onto. */
type CardSpeech = { provider?: string, model?: string, voice_id?: string } | undefined

const card = vi.hoisted(() => ({
  speech: undefined as CardSpeech,
  persona: { language: { character: 'pt-BR' } },
  updateActiveCardSpeech: vi.fn(async (_speech: CardSpeech) => true),
  persistActiveCardModuleSelections: vi.fn(async () => {}),
  get activeCard() {
    return {
      id: 'lia',
      extensions: { airi: { modules: { speech: card.speech }, persona: card.persona } },
    }
  },
}))

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
    if (invoke?.receiveEvent?.id === 'eventa:invoke:lia:voice:config:get-receive')
      return ipc.getVoiceConfig
    if (invoke?.receiveEvent?.id === 'eventa:invoke:lia:voice:config:set-receive')
      return ipc.saveVoiceConfig

    throw new Error(`Unexpected eventa invoke: ${JSON.stringify(invoke)}`)
  },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'pt-BR' },
    // Marked so a label can never be mistaken for a raw id.
    t: (key: string, fallback?: string) => fallback ?? `T(${key})`,
  }),
}))

vi.mock('@proj-airi/stage-ui/stores/modules/airi-card', () => ({
  useAiriCardStore: () => card,
}))

/**
 * Shaped like what `kokoro-local`'s real `listVoices` returns: `VoiceInfo`
 * entries whose `name` is the friendly label and whose `id` is technical.
 * Injected through the runtime's own loader, never read by the editor directly.
 */
const KOKORO_VOICES = [
  { id: 'af_heart', name: 'Heart (English, female)', provider: 'kokoro-local' },
  { id: 'bf_emma', name: 'Emma (English, female)', provider: 'kokoro-local' },
]

const KOKORO_MODELS = [
  { id: 'onnx-community/Kokoro-82M-v1.0-ONNX', name: 'Kokoro 82M', provider: 'kokoro-local' },
]

const KOKORO = 'kokoro-local'
const OPENAI_COMPATIBLE = 'openai-compatible-audio-speech'

/** What the store last sent over the Set channel. */
function lastSent(): LiaVoiceConfig {
  const call = ipc.saveVoiceConfig.mock.calls.at(-1)
  if (!call)
    throw new Error('saveVoiceConfig was never called')
  return call[0] as LiaVoiceConfig
}

describe('lia voice editor (4E-2 commit 2)', async () => {
  const { useLiaVoiceStore: useLiaVoiceStoreForSpy } = await import('./voice')
  const { useVoiceEditor } = await import('./voice-editor')

  /** Puts `models` where `getModelsForProvider` reads them. */
  function seedModels(providerId: string, models: unknown[]): void {
    const providers = useProviderStore()
    const current = providers.providerRuntimeState as Record<string, unknown>
    providers.providerRuntimeState = {
      ...current,
      [providerId]: { ...(current[providerId] as object ?? {}), models },
    } as typeof providers.providerRuntimeState
  }

  /**
   * The one seam the runtime uses to fill its voice cache. Providers without a
   * catalogue return `[]` here exactly as their real definitions do - notably
   * `openai-compatible-audio-speech`, whose `listVoices` is `async () => []`.
   */
  function installCatalogueSpy(): void {
    vi.spyOn(useProviderStore(), 'listProviderVoices').mockImplementation(async (providerId: string) =>
      providerId === KOKORO ? KOKORO_VOICES as never : [] as never)
  }

  /** An editor over a loaded store whose catalogues are ready. */
  async function setup(
    persisted: unknown = { tts: {} },
    preview?: VoicePreviewDriver,
  ): Promise<ReturnType<typeof useVoiceEditor>> {
    ipc.getVoiceConfig.mockResolvedValue(persisted)
    const editor = useVoiceEditor(preview ? { preview } : {})
    await editor.hydrate()
    return editor
  }

  /** A restart: a fresh pinia reading back exactly what the bridge stored. */
  async function restart(persisted: LiaVoiceConfig): Promise<ReturnType<typeof useVoiceEditor>> {
    setActivePinia(createPinia())
    installCatalogueSpy()
    return await setup(structuredClone(persisted))
  }

  /**
   * `providerMetadata` is built asynchronously from the static definitions, so
   * the catalogue is briefly empty on a fresh pinia. Awaited, never stubbed.
   */
  async function waitForProviderCatalogue(): Promise<void> {
    const speech = useSpeechStore()
    for (let attempt = 0; attempt < 200 && speech.availableSpeechProvidersMetadata.length === 0; attempt++)
      await new Promise(resolve => setTimeout(resolve, 10))
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    await waitForProviderCatalogue()

    ipc.getVoiceConfig.mockReset()
    ipc.getVoiceConfig.mockResolvedValue({ tts: {} })
    ipc.saveVoiceConfig.mockReset()
    ipc.saveVoiceConfig.mockImplementation(async (config: unknown) => {
      structuredClone(config)
    })

    card.speech = undefined
    card.persona = { language: { character: 'pt-BR' } }
    card.updateActiveCardSpeech.mockReset()
    card.updateActiveCardSpeech.mockImplementation(async (speech: CardSpeech) => {
      card.speech = speech
      return true
    })
    card.persistActiveCardModuleSelections.mockReset()
    card.persistActiveCardModuleSelections.mockResolvedValue(undefined)

    // Referenced so the real speech store is instantiated like the app does.
    expect(useSpeechStore().availableVoices).toBeDefined()
    installCatalogueSpy()
  })

  // -------------------------------------------------------------------------
  // Catalogues
  // -------------------------------------------------------------------------

  it('lists the real speech provider catalogue, labelled by metadata', async () => {
    const speech = useSpeechStore()
    const editor = await setup()

    const real = speech.availableSpeechProvidersMetadata
    expect(real.length, 'the real registry must be populated, not stubbed').toBeGreaterThan(5)

    // Every registry entry except the one the Lia picker deliberately hides.
    const shown = real.filter(meta => meta.id !== 'speech-noop')

    expect(editor.providerOptions.value).toHaveLength(shown.length)
    expect(editor.providerOptions.value.map(option => option.id))
      .toEqual(shown.map(meta => meta.id))
    // The friendly name is the label; the id is carried but never shown.
    for (const [index, meta] of shown.entries())
      expect(editor.providerOptions.value[index].label, meta.id).toBe(meta.localizedName)
  })

  it('lists voices from the runtime catalogue, labelled by name', async () => {
    const editor = await setup()
    await editor.selectProvider(KOKORO)

    expect(editor.voiceOptions.value.map(voice => voice.id)).toEqual(['af_heart', 'bf_emma'])
    expect(editor.voiceOptions.value.map(voice => voice.label))
      .toEqual(['Heart (English, female)', 'Emma (English, female)'])
  })

  it('hides the model selector when the provider exposes no usable catalogue', async () => {
    const editor = await setup()
    await editor.selectProvider(KOKORO)

    // The real runtime says this provider can list models, but nothing is loaded
    // for it, so there is nothing to offer.
    expect(useProviderStore().supportsModelListing(KOKORO)).toBe(true)
    expect(editor.modelOptions.value).toEqual([])
    expect(editor.showModelSelector.value).toBe(false)
  })

  it('shows the model selector once a catalogue is usable', async () => {
    seedModels(KOKORO, KOKORO_MODELS)
    const editor = await setup()
    await editor.selectProvider(KOKORO)

    expect(editor.showModelSelector.value).toBe(true)
    expect(editor.modelOptions.value).toEqual([
      { id: 'onnx-community/Kokoro-82M-v1.0-ONNX', label: 'Kokoro 82M' },
    ])
  })

  it('reports an explanatory state for a provider with no voice catalogue', async () => {
    // Kokoro needs no credential, so with its catalogue answering `[]` this is a
    // real empty list rather than a missing credential.
    vi.spyOn(useProviderStore(), 'listProviderVoices').mockResolvedValue([] as never)
    const editor = await setup()
    await editor.selectProvider(KOKORO)

    expect(editor.requiresConfiguration(KOKORO)).toBe(false)
    expect(editor.voiceOptions.value).toEqual([])
    expect(editor.voiceCatalogState.value).toBe('empty')
    expect(editor.hasNoVoiceCatalog.value).toBe(true)
  })

  it('says "configure this provider" instead of showing an empty catalogue', async () => {
    const editor = await setup()
    await editor.selectProvider(OPENAI_COMPATIBLE)

    // This used to read as "this provider has no voices", which is how a missing
    // credential came to look like a provider defect.
    expect(editor.voiceOptions.value).toEqual([])
    expect(editor.voiceCatalogState.value).toBe('needsConfiguration')
    expect(editor.hasNoVoiceCatalog.value).toBe(false)
  })

  it('does not invent voices for OpenAI-compatible', async () => {
    const editor = await setup()
    await editor.selectProvider(OPENAI_COMPATIBLE)

    // The provider genuinely ships no catalogue, so the editor must offer none
    // rather than fall back to a built-in list.
    expect(editor.voiceOptions.value).toHaveLength(0)
    expect(editor.selectedVoiceId.value).toBe('')
    expect(useSpeechStore().getVoicesForProvider(OPENAI_COMPATIBLE)).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Selection and writes
  // -------------------------------------------------------------------------

  it('invalidates a voice and model that belonged to the previous provider', async () => {
    const editor = await setup({
      tts: { preferred: { providerId: KOKORO, modelId: 'kokoro-82m', voiceId: 'af_heart' }, fallback: [] },
    })
    expect(editor.selectedVoiceId.value).toBe('af_heart')

    await editor.selectProvider(OPENAI_COMPATIBLE)

    // Carrying `af_heart` over would show a selection the new catalogue cannot
    // back and persist a target the runtime cannot resolve.
    expect(lastSent().tts?.preferred).toEqual({ providerId: OPENAI_COMPATIBLE })
    expect(editor.selectedVoiceId.value).toBe('')
    expect(editor.selectedModelId.value).toBe('')
  })

  it('saves the whole target when a voice is chosen', async () => {
    const editor = await setup()
    await editor.selectProvider(KOKORO)
    await editor.selectVoice('bf_emma')

    expect(lastSent().tts?.preferred).toEqual({ providerId: KOKORO, voiceId: 'bf_emma' })
    expect(editor.selectedVoiceId.value).toBe('bf_emma')
  })

  it('saves the whole target when a model is chosen', async () => {
    seedModels(KOKORO, KOKORO_MODELS)
    const editor = await setup()
    await editor.selectProvider(KOKORO)
    await editor.selectModel('onnx-community/Kokoro-82M-v1.0-ONNX')

    expect(lastSent().tts?.preferred).toEqual({
      providerId: KOKORO,
      modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    })
  })

  it('turns "Nenhuma" into an empty fallback array, never an absent field', async () => {
    const editor = await setup({
      tts: {
        preferred: { providerId: KOKORO, voiceId: 'af_heart' },
        fallback: [{ providerId: KOKORO, voiceId: 'bf_emma' }],
      },
    })

    await editor.selectFallbackProvider('')

    const sent = lastSent().tts
    expect(sent?.fallback).toEqual([])
    expect(Object.hasOwn(sent ?? {}, 'fallback')).toBe(true)
    expect(editor.selectedFallbackProviderId.value).toBe('')
  })

  it('always hands an array fallback to the central writer', async () => {
    const voiceStore = useLiaVoiceStoreForSpy()
    const save = vi.spyOn(voiceStore, 'saveTtsConfiguration')
    const editor = await setup({ tts: { preferred: { providerId: KOKORO, voiceId: 'af_heart' } } })

    await editor.selectFallbackProvider(KOKORO)
    await editor.selectFallbackProvider('')

    // Asserted on the argument rather than on the serialized payload: the writer
    // itself normalizes a missing `fallback` to `[]`, so checking only the wire
    // format would let an editor that omits the field pass unnoticed.
    expect(save.mock.calls.length).toBeGreaterThan(0)
    for (const [argument] of save.mock.calls)
      expect(Array.isArray(argument.fallback), JSON.stringify(argument)).toBe(true)
  })

  it('saves a complete reserve target', async () => {
    seedModels(KOKORO, KOKORO_MODELS)
    const editor = await setup({ tts: { preferred: { providerId: KOKORO, voiceId: 'af_heart' } } })

    await editor.selectFallbackProvider(KOKORO)
    await editor.selectFallbackVoice('bf_emma')
    await editor.selectFallbackModel('onnx-community/Kokoro-82M-v1.0-ONNX')

    expect(lastSent().tts?.fallback).toEqual([{
      providerId: KOKORO,
      modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
      voiceId: 'bf_emma',
    }])
  })

  it('refuses a reserve identical to the preferred voice', async () => {
    const editor = await setup({ tts: { preferred: { providerId: KOKORO, voiceId: 'af_heart' } } })

    await editor.selectFallbackProvider(KOKORO)
    const saved = await editor.selectFallbackVoice('af_heart')

    // Same provider, model and voice would fail exactly like the preferred one.
    expect(saved).toBe(false)
    expect(editor.saveError.value).toBe('fallbackIdentical')
    // The rejected target was never written: the reserve is still the provider
    // chosen by the previous, accepted step.
    expect(lastSent().tts?.fallback).toEqual([{ providerId: KOKORO }])
    expect(editor.selectedFallbackVoiceId.value).toBe('')
  })

  it('flags a reserve that is already identical in the persisted config', async () => {
    const target = { providerId: KOKORO, voiceId: 'af_heart' }
    const editor = await setup({ tts: { preferred: target, fallback: [target] } })

    // Nothing the editor wrote, but the UI has to be able to warn about it.
    expect(editor.fallbackDuplicatesPreferred.value).toBe(true)
  })

  it('allows the same provider as a reserve when the voice differs', async () => {
    const editor = await setup({ tts: { preferred: { providerId: KOKORO, voiceId: 'af_heart' } } })

    await editor.selectFallbackProvider(KOKORO)
    const saved = await editor.selectFallbackVoice('bf_emma')

    expect(saved).toBe(true)
    expect(editor.saveError.value).toBeNull()
    expect(lastSent().tts?.fallback).toEqual([{ providerId: KOKORO, voiceId: 'bf_emma' }])
  })

  // -------------------------------------------------------------------------
  // Failure handling and durability
  // -------------------------------------------------------------------------

  it('does not look saved when persisting failed', async () => {
    const editor = await setup()
    ipc.saveVoiceConfig.mockRejectedValueOnce(new Error('disk full'))

    const saved = await editor.selectProvider(KOKORO)

    expect(saved).toBe(false)
    expect(editor.saveError.value).toBe('persist')
    // The selection is derived from voice.tts, so a failed write leaves the UI
    // showing the previous truth instead of a lie.
    expect(editor.selectedProviderId.value).toBe('')
  })

  it('keeps the source and says so when only the projection failed', async () => {
    const editor = await setup()
    card.updateActiveCardSpeech.mockRejectedValueOnce(new Error('card write failed'))

    const saved = await editor.selectProvider(KOKORO)

    expect(saved).toBe(false)
    expect(editor.saveError.value).toBe('projection')
    // voice.tts survived, so the UI keeps showing the new provider.
    expect(editor.selectedProviderId.value).toBe(KOKORO)
    expect(lastSent().tts?.preferred).toEqual({ providerId: KOKORO })
  })

  it('preserves the configuration across a restart', async () => {
    const first = await setup({
      tts: { preferred: { providerId: KOKORO, voiceId: 'af_heart' }, fallback: [] },
    })
    await first.selectVoice('bf_emma')
    await first.selectFallbackProvider(KOKORO)
    await first.selectFallbackVoice('af_heart')

    const second = await restart(lastSent())

    expect(second.selectedProviderId.value).toBe(KOKORO)
    expect(second.selectedVoiceId.value).toBe('bf_emma')
    expect(second.selectedFallbackProviderId.value).toBe(KOKORO)
    expect(second.selectedFallbackVoiceId.value).toBe('af_heart')
    expect(second.voiceOptions.value.map(voice => voice.id)).toEqual(['af_heart', 'bf_emma'])
  })

  it('repairs a stale card projection when the tab is opened again', async () => {
    // Simulates the aftermath of a failed projection: the source is right and
    // the card still holds something else.
    card.speech = { provider: 'speech-noop' }
    card.updateActiveCardSpeech.mockClear()

    await setup({
      tts: { preferred: { providerId: KOKORO, voiceId: 'af_heart' }, fallback: [] },
    })

    expect(card.updateActiveCardSpeech).toHaveBeenCalled()
    expect(card.speech).toMatchObject({ provider: KOKORO, voice_id: 'af_heart' })
  })

  // -------------------------------------------------------------------------
  // Load discipline: no duplicate work, no recursion
  // -------------------------------------------------------------------------

  it('collapses concurrent voice loads for the same target', async () => {
    const editor = await setup()
    const load = vi.spyOn(useSpeechStore(), 'loadVoicesForProvider')
    load.mockClear()

    await Promise.all([
      editor.refreshVoices(KOKORO),
      editor.refreshVoices(KOKORO),
      editor.refreshVoices(KOKORO),
    ])

    // One catalogue, one load. Without the in-flight guard each caller would
    // start its own provider instantiation - for Kokoro, its own model load.
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('switches provider repeatedly without looping and recovers the catalogue', async () => {
    const editor = await setup()
    const speech = useSpeechStore()
    const load = vi.spyOn(speech, 'loadVoicesForProvider')
    load.mockClear()

    // The other end is marked ready so every switch is one the editor is
    // actually allowed to perform a lookup for.
    const other = anUnconfiguredProvider()
    markConfigured(other)
    const sequence = [KOKORO, other, KOKORO, other, KOKORO]
    for (const providerId of sequence)
      await editor.selectProvider(providerId)

    // Exactly one load per change: a provider change must not trigger another
    // provider change, and `applyVoiceTarget` must not cascade into a reload.
    expect(load.mock.calls).toHaveLength(sequence.length)
    expect(speech.activeSpeechProvider).toBe(KOKORO)
    expect(editor.selectedProviderId.value).toBe(KOKORO)

    // Returning to a previous provider brings its catalogue back.
    expect(editor.voiceOptions.value.map(voice => voice.id)).toEqual(['af_heart', 'bf_emma'])
    expect(editor.hasNoVoiceCatalog.value).toBe(false)
  })

  it('keeps "no speech output" out of the picker while leaving it registered', async () => {
    const editor = await setup()

    // `speech-noop` is a registered speech provider meaning "no speech output"
    // and its English name is literally "None". The Lia tab already opens with
    // "Nenhuma voz configurada", so a second way of saying "no voice" mid-list
    // only confused things. It stays in the registry - AIRI uses it and the
    // speech store defaults to it - and it is dropped from this picker only.
    expect(useSpeechStore().availableSpeechProvidersMetadata.some(meta => meta.id === 'speech-noop')).toBe(true)
    expect(editor.providerOptions.value.some(option => option.id === 'speech-noop')).toBe(false)

    // The sentinel is still separate: it is the empty value, never a provider id.
    expect(editor.providerOptions.value.some(option => option.id === '')).toBe(false)
    expect(editor.selectedProviderId.value).toBe('')
  })

  // -------------------------------------------------------------------------
  // Preview
  // -------------------------------------------------------------------------

  /** A driver that records what it was asked to speak and waits to be released. */
  function fakePreview() {
    const calls: { providerId: string, voiceId?: string, text: string }[] = []
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const driver = vi.fn(async (
      target: { providerId: string, voiceId?: string },
      text: string,
      signal: AbortSignal,
      onPlaybackStart: () => void,
    ) => {
      calls.push({ providerId: target.providerId, voiceId: target.voiceId, text })
      onPlaybackStart()
      await gate
      if (signal.aborted)
        throw new Error('aborted')
    })

    return { driver, calls, release: () => release?.() }
  }

  it('previews the selected target with the fixed sample text', async () => {
    const preview = fakePreview()
    const editor = await setup(
      { tts: { preferred: { providerId: KOKORO, voiceId: 'bf_emma' }, fallback: [] } },
      preview.driver,
    )

    const playing = editor.playPreview()
    await vi.waitFor(() => expect(preview.calls).toHaveLength(1))

    expect(preview.calls[0]).toEqual({
      providerId: KOKORO,
      voiceId: 'bf_emma',
      text: 'Olá! Eu sou a Lia.',
    })
    expect(editor.previewState.value).toBe('playing')

    preview.release()
    await playing
    expect(editor.previewState.value).toBe('idle')
  })

  it('never persists anything while previewing', async () => {
    const preview = fakePreview()
    const editor = useVoiceEditor({ preview: preview.driver })
    await editor.hydrate()
    await editor.selectProvider(KOKORO)

    const writesBefore = ipc.saveVoiceConfig.mock.calls.length
    const cardWritesBefore = card.persistActiveCardModuleSelections.mock.calls.length

    const playing = editor.playPreview()
    await vi.waitFor(() => expect(preview.calls).toHaveLength(1))
    preview.release()
    await playing

    // Hearing a voice must not configure it.
    expect(ipc.saveVoiceConfig.mock.calls).toHaveLength(writesBefore)
    expect(card.persistActiveCardModuleSelections.mock.calls).toHaveLength(cardWritesBefore)
    expect(lastSent().tts?.preferred).toEqual({ providerId: KOKORO })
  })

  it('cancels a preview in flight', async () => {
    const preview = fakePreview()
    const editor = useVoiceEditor({ preview: preview.driver })
    await editor.hydrate()
    await editor.selectProvider(KOKORO)

    const playing = editor.playPreview()
    await vi.waitFor(() => expect(editor.previewState.value).toBe('playing'))

    editor.cancelPreview()
    expect(editor.previewState.value).toBe('cancelled')

    preview.release()
    await playing
    // The cancelled attempt must not overwrite the state on its way out.
    expect(editor.previewState.value).toBe('cancelled')
  })

  it('reports a preview failure instead of swallowing it', async () => {
    const driver = vi.fn(async () => {
      throw new Error('provider rejected the sample')
    })
    const editor = useVoiceEditor({ preview: driver })
    await editor.hydrate()
    await editor.selectProvider(KOKORO)

    await editor.playPreview()

    expect(editor.previewState.value).toBe('error')
    expect(editor.previewError.value).toContain('provider rejected the sample')
  })

  it('refuses to preview while no voice is configured', async () => {
    const preview = fakePreview()
    const editor = useVoiceEditor({ preview: preview.driver })
    await editor.hydrate()

    await editor.playPreview()

    expect(preview.calls).toHaveLength(0)
    expect(editor.previewState.value).toBe('error')
    expect(editor.previewError.value).toBe('noVoice')
  })
  // -------------------------------------------------------------------------
  // 4E-2 round 2
  // -------------------------------------------------------------------------

  /**
   * Tells the config store a provider is ready, so a test can exercise a second
   * provider the editor is allowed to query. Kokoro is the only speech provider
   * that needs nothing supplied at all.
   */
  function markConfigured(providerId: string): void {
    const configStore = useProviderConfigStore()
    configStore.providers = {
      ...(configStore.providers as object),
      [providerId]: { status: 'configured' },
    } as typeof configStore.providers
  }

  /**
   * A provider the registry already reports as unusable until the user does
   * something - a credential, or a session for the `configuredBy:
   * 'authentication'` ones. Taken from live metadata so no provider is listed
   * by hand.
   */
  function anUnconfiguredProvider(): string {
    const candidate = useSpeechStore().availableSpeechProvidersMetadata.find(meta =>
      !meta.configured && (meta.requiresCredentials !== false || meta.configuredBy === 'authentication'))
    if (!candidate)
      throw new Error('the live registry exposes no provider needing configuration')
    return candidate.id
  }

  it('keeps speech-noop registered but out of the Lia picker', async () => {
    const editor = await setup()
    const speech = useSpeechStore()

    const registered = speech.availableSpeechProvidersMetadata.map(meta => meta.id)
    const offered = editor.providerOptions.value.map(option => option.id)

    // Still a real provider in the global registry, so AIRI keeps working and the
    // speech store keeps defaulting to it.
    expect(registered).toContain('speech-noop')
    // ...and gone from the Lia tab, where "Nenhuma voz configurada" already says it.
    expect(offered).not.toContain('speech-noop')
    // Nothing else was filtered out as a side effect.
    expect(offered).toEqual(registered.filter(id => id !== 'speech-noop'))
    expect(offered.length).toBe(registered.length - 1)
  })

  it('applies the persisted voice to this window\'s speech runtime on hydration', async () => {
    ipc.getVoiceConfig.mockResolvedValue({
      tts: {
        preferred: { providerId: KOKORO, voiceId: 'af_heart', modelId: '' },
        fallback: [],
      },
    })
    const speech = useSpeechStore()
    const voiceStore = useLiaVoiceStoreForSpy()

    // The whole reported bug: the config is on disk, the runtime is not.
    expect(speech.activeSpeechProvider).toBe('speech-noop')

    await voiceStore.hydrateRuntime()

    expect(speech.activeSpeechProvider).toBe(KOKORO)
    expect(speech.activeSpeechVoice?.id).toBe('af_heart')
  })

  it('hydrating without a configured voice leaves the runtime alone', async () => {
    ipc.getVoiceConfig.mockResolvedValue({ tts: {} })
    const speech = useSpeechStore()

    await useLiaVoiceStoreForSpy().hydrateRuntime()

    expect(speech.activeSpeechProvider).toBe('speech-noop')
  })

  it('does not ask an unconfigured provider for its catalogue', async () => {
    const unconfigured = anUnconfiguredProvider()
    const editor = await setup({
      tts: { preferred: { providerId: unconfigured, voiceId: '', modelId: '' }, fallback: [] },
    })

    const spy = vi.spyOn(useProviderStore(), 'listProviderVoices').mockResolvedValue([] as never)

    expect(editor.requiresConfiguration(unconfigured)).toBe(true)
    await editor.refreshVoices(unconfigured)

    expect(spy).not.toHaveBeenCalled()
    expect(editor.voiceCatalogState.value).toBe('needsConfiguration')
  })

  it('does not let a late answer from the previous provider clear the current one\'s loading state', async () => {
    const editor = await setup({
      tts: { preferred: { providerId: KOKORO, voiceId: '', modelId: '' }, fallback: [] },
    })

    // The old provider only needs to be *allowed* to load, so mark it ready in
    // the config store rather than inventing a second credential-free provider.
    const unconfigured = anUnconfiguredProvider()
    markConfigured(unconfigured)
    expect(editor.requiresConfiguration(unconfigured)).toBe(false)

    const release: Record<string, () => void> = {}
    vi.spyOn(useProviderStore(), 'listProviderVoices').mockImplementation(
      (providerId: string) => new Promise((resolve) => {
        release[providerId] = () => resolve([] as never)
      }),
    )

    const slow = editor.refreshVoices(unconfigured)
    const current = editor.refreshVoices(KOKORO)

    expect(editor.isLoadingVoices.value).toBe(true)

    // The stale one lands while Kokoro is still in flight.
    release[unconfigured]()
    await slow

    expect(editor.isLoadingVoices.value).toBe(true)

    release[KOKORO]()
    await current

    expect(editor.isLoadingVoices.value).toBe(false)
  })
})
