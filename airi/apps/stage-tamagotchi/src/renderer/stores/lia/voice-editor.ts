import type { LiaVoiceTtsConfig, LiaVoiceTtsTarget } from '../../../shared/eventa'
import type { VoicePreviewDriver } from './voice-preview'

import { errorMessageFrom } from '@moeru/std'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { computed, ref } from 'vue'

import { useLiaVoiceStore } from './voice'

/**
 * Editing state for the "Configurar Lia" → Voz tab (M1 Phase 4E-2, commit 2).
 *
 * Three rules shape this file:
 *
 *  1. **No second source of truth.** Every selection is *derived* from
 *     `voice.tts` through `useLiaVoiceStore`. There is no parallel copy of the
 *     selection here, so the dropdowns cannot drift away from what is persisted
 *     — if a write fails, the UI keeps showing the previous truth.
 *
 *  2. **One write path.** All changes go through `saveTtsConfiguration()`, the
 *     writer from commit 1, which owns the `voice.tts` → card projection →
 *     runtime order. Nothing here calls `updateTtsConfig`, projects the card or
 *     applies the target directly.
 *
 *  3. **Real catalogs only.** Providers, voices and models are read from the
 *     existing speech/provider stores. When a provider has no voice catalog
 *     (`openai-compatible-audio-speech` really returns `[]`) this says so
 *     instead of inventing entries, and when a provider exposes no usable model
 *     catalog the model selector stays hidden rather than becoming a free-text
 *     field.
 */

/** One selectable entry in any of the three voice catalogs. */
export interface VoiceEditorOption {
  /** The technical id. Sent to the store; never rendered as a label. */
  id: string
  /** What the dropdown shows: the catalog's friendly name. */
  label: string
}

export type VoicePreviewState = 'cancelled' | 'error' | 'idle' | 'loading' | 'playing'

/**
 * What the voice catalogue for the selected provider currently is.
 *
 * Kept apart on purpose: `empty` means the provider really ships no list,
 * `needsConfiguration` means the user has to supply a credential first, and
 * `error` means the lookup failed and may work on a retry.
 */
export type VoiceCatalogState
  = | 'empty'
    | 'error'
    | 'loading'
    | 'needsConfiguration'
    | 'ready'
    | 'unselected'

/**
 * Providers that carry no voice catalog of their own.
 *
 * This is not a hardcoded *catalog* — no voice or model is listed here. It only
 * records, for the explanatory message, that the voice of these providers is
 * chosen in the provider's own settings, which is how the speech runtime reads
 * it (`Stage.vue` takes `providerConfig.voice` for OpenAI-compatible). The list
 * is still cross-checked against the live catalog at runtime: a provider only
 * gets the "no catalog" state when `getVoicesForProvider` really came back
 * empty.
 */
const PROVIDERS_WITHOUT_VOICE_CATALOG: readonly string[] = [
  'openai-compatible-audio-speech',
]

/**
 * The sample text spoken by "Ouvir exemplo".
 *
 * Fixed, short, neutral and pt-BR by design: the preview exists to hear a
 * timbre, not to compose text. It is a module constant and is never written to
 * `voice.tts`, the card or any persisted state.
 */
export const LIA_VOICE_PREVIEW_TEXT = 'Olá! Eu sou a Lia.'

/**
 * Speech providers hidden from the Lia picker.
 *
 * `speech-noop` is a real registered provider meaning "no speech output", and
 * its English name is literally "None". It stays in the global registry and AIRI
 * keeps using it - the speech store even defaults to it - but the Lia tab
 * already has a "Nenhuma voz configurada" option at the top, so a second way to
 * say "no voice" in the middle of the list only confuses. Filtered here, at the
 * Lia layer, and nowhere else.
 */
const HIDDEN_FROM_LIA_PICKER: readonly string[] = ['speech-noop']

/** `''` in a dropdown means "Nenhuma", i.e. the field is cleared. */
const NONE = ''

function toOption(entry: { id: string, name?: string }): VoiceEditorOption {
  return { id: entry.id, label: entry.name || entry.id }
}

function isSameTarget(a: LiaVoiceTtsTarget | undefined, b: LiaVoiceTtsTarget | undefined): boolean {
  if (!a || !b)
    return false

  return a.providerId === b.providerId
    && (a.modelId ?? '') === (b.modelId ?? '')
    && (a.voiceId ?? '') === (b.voiceId ?? '')
}

export function useVoiceEditor(options: { preview?: VoicePreviewDriver } = {}) {
  const voiceStore = useLiaVoiceStore()
  const speechStore = useSpeechStore()
  const providersStore = useProviderStore()
  const providerConfigStore = useProviderConfigStore()

  const previewDriver = options.preview

  // ---------------------------------------------------------------------------
  // Catalogs — every one of them read from the existing runtime stores.
  // ---------------------------------------------------------------------------

  /** Real speech provider catalog (`availableSpeechProvidersMetadata`). */
  const providerOptions = computed<VoiceEditorOption[]>(() =>
    speechStore.availableSpeechProvidersMetadata
      .filter(meta => !HIDDEN_FROM_LIA_PICKER.includes(meta.id))
      .map(meta => ({
        id: meta.id,
        label: meta.localizedName || meta.id,
      })))

  /**
   * Whether a provider cannot list its voices until the user supplies a
   * credential in the provider settings.
   *
   * Derived from metadata the registry already publishes - `requiresCredentials`
   * on the definition and `configuredProviders` from the config store - so there
   * is no parallel Lia-side list of providers. Knowing this up front is what
   * keeps browsing the dropdown from firing requests that can only fail: a 401
   * from the official provider, a `.trim()` on an undefined config, a refused
   * connection to a local engine.
   */
  function requiresConfiguration(providerId: string): boolean {
    if (!providerId)
      return false

    const meta = speechStore.availableSpeechProvidersMetadata.find(item => item.id === providerId)
    if (!meta)
      return false

    // The registry already tracks readiness; nothing here re-derives it.
    if (meta.configured || providerConfigStore.configuredProviders[providerId])
      return false

    // A `configuredBy: 'authentication'` provider holds no user-supplied key, so
    // `requiresCredentials` is false for it - yet it is exactly as unusable with
    // no session, and asking it for a catalogue is what produced a 401 on every
    // dropdown open.
    if (meta.configuredBy === 'authentication')
      return true

    return meta.requiresCredentials !== false
  }

  function voicesFor(providerId: string): VoiceEditorOption[] {
    if (!providerId)
      return []

    return speechStore.getVoicesForProvider(providerId).map(toOption)
  }

  /**
   * Models for an explicitly selected provider.
   *
   * The speech store exposes `supportsModelListing` and `providerModels` as
   * computeds bound to the *active* provider, which is the wrong axis for an
   * editor describing whichever provider the user picked. Both are thin
   * delegations to `useProviderStore()`, so calling them with an explicit id
   * reuses that exact contract instead of duplicating the logic here.
   */
  function modelsFor(providerId: string): VoiceEditorOption[] {
    if (!providerId || !providersStore.supportsModelListing(providerId))
      return []

    return providersStore.getModelsForProvider(providerId).map(toOption)
  }

  // ---------------------------------------------------------------------------
  // Selection — derived from `voice.tts`, never a parallel copy.
  // ---------------------------------------------------------------------------

  const selectedProviderId = computed(() => voiceStore.preferred?.providerId ?? NONE)
  const selectedVoiceId = computed(() => voiceStore.preferred?.voiceId ?? NONE)
  const selectedModelId = computed(() => voiceStore.preferred?.modelId ?? NONE)

  const voiceOptions = computed(() => voicesFor(selectedProviderId.value))
  const modelOptions = computed(() => modelsFor(selectedProviderId.value))

  /**
   * The model selector only appears when the provider supports listing models
   * and a usable catalog came back. Otherwise the runtime has nothing to offer
   * and a free-text field would only invite an invalid id.
   */
  const showModelSelector = computed(() => modelOptions.value.length > 0)

  /**
   * Providers whose catalogue is in flight.
   *
   * Per provider rather than one shared flag: browsing A -> B -> C must not let
   * A's late answer clear B's loading state, and the catalogue for the provider
   * now on screen has to reflect only its own request.
   */
  const voiceLoadsPending = ref(new Set<string>())

  const isLoadingVoices = computed(() => voiceLoadsPending.value.has(selectedProviderId.value))

  /**
   * One state instead of three booleans that could disagree.
   *
   * "The catalogue is empty" and "this provider needs configuring first" and
   * "the request failed" used to collapse into the same message, which is how a
   * missing credential came to read as a provider with no voices.
   */
  function catalogStateFor(providerId: string, options: VoiceEditorOption[]): VoiceCatalogState {
    if (!providerId)
      return 'unselected'
    if (voiceLoadsPending.value.has(providerId))
      return 'loading'
    if (requiresConfiguration(providerId))
      return 'needsConfiguration'
    if (options.length > 0)
      return 'ready'
    if (speechStore.speechProviderError)
      return 'error'

    return 'empty'
  }

  const voiceCatalogState = computed<VoiceCatalogState>(() =>
    catalogStateFor(selectedProviderId.value, voiceOptions.value))

  /**
   * A provider is selected but its voice catalog is genuinely empty. Distinct
   * from "still loading", so the message never flashes while voices arrive.
   */
  const hasNoVoiceCatalog = computed(() => voiceCatalogState.value === 'empty')

  /** Whether the empty catalog is expected rather than a failure. */
  const voiceCatalogComesFromProviderSettings = computed(() =>
    PROVIDERS_WITHOUT_VOICE_CATALOG.includes(selectedProviderId.value))

  // Reserve voice. `voice.tts.fallback` is `[]` for "Nenhuma" — never absent —
  // and this tab edits a single reserve, so index 0 is the whole story.
  const fallbackTarget = computed(() => voiceStore.fallback[0] ?? null)
  const selectedFallbackProviderId = computed(() => fallbackTarget.value?.providerId ?? NONE)
  const selectedFallbackVoiceId = computed(() => fallbackTarget.value?.voiceId ?? NONE)
  const selectedFallbackModelId = computed(() => fallbackTarget.value?.modelId ?? NONE)

  const fallbackVoiceOptions = computed(() => voicesFor(selectedFallbackProviderId.value))
  const fallbackModelOptions = computed(() => modelsFor(selectedFallbackProviderId.value))
  const showFallbackModelSelector = computed(() => fallbackModelOptions.value.length > 0)

  const fallbackVoiceCatalogState = computed<VoiceCatalogState>(() =>
    catalogStateFor(selectedFallbackProviderId.value, fallbackVoiceOptions.value))

  const fallbackHasNoVoiceCatalog = computed(() => fallbackVoiceCatalogState.value === 'empty')

  /**
   * A reserve identical in all three fields to the preferred voice would fail
   * exactly like the preferred one, so it is not a reserve. The same provider
   * with a different model or voice *is* meaningful and stays allowed.
   */
  const fallbackDuplicatesPreferred = computed(() =>
    isSameTarget(fallbackTarget.value ?? undefined, voiceStore.preferred))

  // ---------------------------------------------------------------------------
  // Writes — one path, through the commit-1 writer.
  // ---------------------------------------------------------------------------

  const isSaving = ref(false)
  /** A stable message key the template translates; `null` when the last write succeeded. */
  const saveError = ref<'fallbackIdentical' | 'persist' | 'projection' | null>(null)

  /**
   * Voice loads in flight, keyed by provider + model.
   *
   * A provider change reaches the catalogue from two directions: this editor
   * asks for it, and `applyVoiceTarget` moves `activeSpeechProvider`, whose own
   * watcher in the speech store asks too. `listProviderVoices` dedupes
   * concurrent requests that share a key, but the two callers do not always
   * agree on the model - and two different keys mean two real provider
   * instantiations, which for Kokoro means loading the local model twice. This
   * keeps the editor to a single load per target, however often it is asked.
   */
  const voiceLoadsInFlight = new Map<string, Promise<void>>()

  async function refreshVoices(providerId: string, modelId?: string): Promise<void> {
    if (!providerId)
      return

    // Browsing the dropdown must not fire a request that can only fail. The
    // provider says so in its own metadata, so ask nothing at all and let the UI
    // show "configure this provider first" instead of an empty catalogue.
    if (requiresConfiguration(providerId))
      return

    const key = `${providerId}\u0000${modelId ?? ''}`
    const inFlight = voiceLoadsInFlight.get(key)
    if (inFlight)
      return await inFlight

    const task = (async () => {
      voiceLoadsPending.value = new Set(voiceLoadsPending.value).add(providerId)
      try {
        // `loadVoicesForProvider` populates the store cache and never throws; it
        // reports failures through `speechProviderError`.
        await speechStore.loadVoicesForProvider(providerId, modelId)
      }
      finally {
        const pending = new Set(voiceLoadsPending.value)
        pending.delete(providerId)
        voiceLoadsPending.value = pending
      }
    })()

    voiceLoadsInFlight.set(key, task)
    try {
      await task
    }
    finally {
      voiceLoadsInFlight.delete(key)
    }
  }

  async function commit(patch: Partial<LiaVoiceTtsConfig>): Promise<boolean> {
    const next: LiaVoiceTtsConfig = {
      preferred: 'preferred' in patch ? patch.preferred : voiceStore.preferred,
      // `[]` rather than "absent": the two shapes must not drift apart.
      fallback: 'fallback' in patch ? (patch.fallback ?? []) : voiceStore.fallback,
    }

    const reserve = next.fallback?.[0]
    if (reserve && isSameTarget(reserve, next.preferred)) {
      saveError.value = 'fallbackIdentical'
      return false
    }

    isSaving.value = true
    saveError.value = null
    try {
      const result = await voiceStore.saveTtsConfiguration({
        preferred: next.preferred,
        fallback: next.fallback ?? [],
      })

      if (!result.persisted) {
        // `updateTtsConfig` applies to the in-memory target before the IPC
        // write, so a failure leaves the store ahead of the disk. The persisted
        // file is the only source of truth, so read it back: the UI then shows
        // what is really configured instead of a write that never landed.
        try {
          await voiceStore.refreshConfig()
        }
        catch (error) {
          console.warn('[Lia Voice] could not re-read the configuration after a failed write', error)
        }
        saveError.value = 'persist'
        return false
      }

      if (!result.projected) {
        // `voice.tts` is saved and the card is behind. Say so instead of
        // pretending it is all done; `hydrate()` resyncs on the next open.
        saveError.value = 'projection'
        return false
      }

      return true
    }
    finally {
      isSaving.value = false
    }
  }

  /** Merges a patch into the currently persisted preferred target. */
  function preferredWith(patch: Partial<LiaVoiceTtsTarget>): LiaVoiceTtsTarget {
    return {
      providerId: selectedProviderId.value,
      modelId: patch.modelId ?? voiceStore.preferred?.modelId,
      voiceId: patch.voiceId ?? voiceStore.preferred?.voiceId,
    }
  }

  function fallbackWith(patch: Partial<LiaVoiceTtsTarget>): LiaVoiceTtsTarget {
    return {
      providerId: selectedFallbackProviderId.value,
      modelId: patch.modelId ?? fallbackTarget.value?.modelId,
      voiceId: patch.voiceId ?? fallbackTarget.value?.voiceId,
    }
  }

  /**
   * Changing the provider invalidates the voice and model that belonged to the
   * previous one: keeping them would show a selection the new catalog cannot
   * back, and would persist a target the runtime cannot resolve.
   */
  async function selectProvider(providerId: string): Promise<boolean> {
    if (providerId === selectedProviderId.value)
      return true

    if (!providerId)
      return await commit({ preferred: undefined })

    const saved = await commit({ preferred: { providerId } })
    await refreshVoices(providerId)
    return saved
  }

  async function selectVoice(voiceId: string): Promise<boolean> {
    if (!selectedProviderId.value || voiceId === selectedVoiceId.value)
      return true

    return await commit({ preferred: preferredWith({ voiceId: voiceId || undefined }) })
  }

  async function selectModel(modelId: string): Promise<boolean> {
    if (!selectedProviderId.value || modelId === selectedModelId.value)
      return true

    return await commit({ preferred: preferredWith({ modelId: modelId || undefined }) })
  }

  async function selectFallbackProvider(providerId: string): Promise<boolean> {
    if (providerId === selectedFallbackProviderId.value)
      return true

    if (!providerId)
      return await commit({ fallback: [] })

    const saved = await commit({ fallback: [{ providerId }] })
    await refreshVoices(providerId)
    return saved
  }

  async function selectFallbackVoice(voiceId: string): Promise<boolean> {
    if (!selectedFallbackProviderId.value || voiceId === selectedFallbackVoiceId.value)
      return true

    return await commit({ fallback: [fallbackWith({ voiceId: voiceId || undefined })] })
  }

  async function selectFallbackModel(modelId: string): Promise<boolean> {
    if (!selectedFallbackProviderId.value || modelId === selectedFallbackModelId.value)
      return true

    return await commit({ fallback: [fallbackWith({ modelId: modelId || undefined })] })
  }

  // ---------------------------------------------------------------------------
  // Preview — hears the current selection without becoming a source of truth.
  // ---------------------------------------------------------------------------

  const previewState = ref<VoicePreviewState>('idle')
  const previewError = ref<string | null>(null)
  let previewController: AbortController | null = null

  function cancelPreview(): void {
    if (!previewController)
      return

    previewController.abort()
    previewController = null
    previewState.value = 'cancelled'
    previewError.value = null
  }

  /**
   * Speaks the fixed sample with the *current* selection.
   *
   * It reads `voice.tts` and writes nothing: no `saveTtsConfiguration`, no
   * `updateTtsConfig`, no card projection. Previewing a voice cannot change
   * which voice is configured.
   */
  async function playPreview(): Promise<void> {
    const target = voiceStore.preferred
    if (!target?.providerId) {
      previewState.value = 'error'
      previewError.value = 'noVoice'
      return
    }

    if (!previewDriver) {
      previewState.value = 'error'
      previewError.value = 'noPreviewDriver'
      return
    }

    // A second click replaces the attempt in flight instead of overlapping it.
    previewController?.abort()
    const controller = new AbortController()
    previewController = controller

    previewState.value = 'loading'
    previewError.value = null

    const onPlaybackStart = (): void => {
      if (!controller.signal.aborted)
        previewState.value = 'playing'
    }

    try {
      await previewDriver(target, LIA_VOICE_PREVIEW_TEXT, controller.signal, onPlaybackStart)
      if (!controller.signal.aborted)
        previewState.value = 'idle'
    }
    catch (error) {
      if (controller.signal.aborted)
        return

      previewState.value = 'error'
      previewError.value = errorMessageFrom(error) ?? 'unknown'
    }
    finally {
      if (previewController === controller)
        previewController = null
    }
  }

  // ---------------------------------------------------------------------------
  // Opening the tab.
  // ---------------------------------------------------------------------------

  /**
   * Loads the persisted configuration, resyncs a card projection left behind by
   * a failed write, and warms the catalog of whatever is selected.
   *
   * Called on mount. A failed read is surfaced through `voiceStore.loadError`
   * (the template renders it) rather than swallowed, and the catalogs still
   * load so the tab is not left blank.
   */
  async function hydrate(): Promise<void> {
    try {
      await voiceStore.refreshConfig()
    }
    catch (error) {
      console.warn('[Lia Voice] could not load the persisted voice configuration', error)
    }

    // Commit 1 keeps `voice.tts` when a card projection fails; this is where the
    // divergence is detected and repaired on the next open.
    await voiceStore.resyncProjectionFromSource()

    const providerId = selectedProviderId.value
    if (providerId)
      await refreshVoices(providerId, voiceStore.preferred?.modelId)

    const reserveProviderId = selectedFallbackProviderId.value
    if (reserveProviderId && reserveProviderId !== providerId)
      await refreshVoices(reserveProviderId, fallbackTarget.value?.modelId)
  }

  return {
    // Catalogs
    providerOptions,
    voiceOptions,
    modelOptions,
    fallbackVoiceOptions,
    fallbackModelOptions,
    isLoadingVoices,
    voiceCatalogState,
    fallbackVoiceCatalogState,
    requiresConfiguration,
    hasNoVoiceCatalog,
    voiceCatalogComesFromProviderSettings,
    fallbackHasNoVoiceCatalog,
    showModelSelector,
    showFallbackModelSelector,

    // Selection (derived from voice.tts)
    selectedProviderId,
    selectedVoiceId,
    selectedModelId,
    fallbackTarget,
    selectedFallbackProviderId,
    selectedFallbackVoiceId,
    selectedFallbackModelId,
    fallbackDuplicatesPreferred,

    // Writes
    isSaving,
    saveError,
    selectProvider,
    selectVoice,
    selectModel,
    selectFallbackProvider,
    selectFallbackVoice,
    selectFallbackModel,

    // Preview
    previewState,
    previewError,
    playPreview,
    cancelPreview,

    // Lifecycle
    hydrate,
    refreshVoices,
  }
}
