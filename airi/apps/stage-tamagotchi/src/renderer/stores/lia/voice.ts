import type { LiaVoiceConfig, LiaVoiceTtsConfig, LiaVoiceTtsTarget } from '../../../shared/eventa'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { registerSpeechTtsFallbackPolicy } from '@proj-airi/stage-ui/libs/speech/tts-fallback'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  electronLiaVoiceConfigGet,
  electronLiaVoiceConfigSet,
} from '../../../shared/eventa'
import { logVoiceConfigDiag } from '../../diagnostics/voice-config'

/**
 * Lia voice (TTS) configuration on the renderer side (M1 Phase 4D-2).
 *
 * This store is the renderer half of the `voice.tts` IPC bridge added in 4D-1.
 * It owns exactly two jobs:
 *
 *  1. load the Lia-persisted TTS configuration and normalize it, and
 *  2. apply a resolved target onto the EXISTING AIRI speech runtime by writing
 *     the three refs it already reads (`activeSpeechProvider`,
 *     `activeSpeechModel`, `activeSpeechVoiceId`).
 *
 * It deliberately changes nothing else:
 *  - no new provider, no new TTS path, no change to `pipelines-audio`;
 *  - no UI, and no startup wiring — nothing imports this store unless a caller
 *    opts in, so AIRI behaves exactly as before when it is never initialized;
 *  - `lia-product.json` (domain `voice`) stays the only persistent source. The
 *    renderer never reads/writes the file, never uses localStorage as a source
 *    of truth, and never receives a credential (keys stay in the 4C vault).
 *
 * Fallback ordering is *prepared* here (`voiceTargetChain` +
 * `nextVoiceTargetOnFailure`) but NOT activated: nothing in the TTS pipeline
 * calls it, and `nextVoiceTargetOnFailure` never applies anything by itself.
 * Phase 4D-3 is the intended consumer.
 */

/** Normalized renderer shape: `fallback` is always materialized as an array. */
export interface LiaVoiceTtsState {
  preferred?: LiaVoiceTtsTarget
  fallback: LiaVoiceTtsTarget[]
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Keeps exactly the reference fields a TTS target is made of (`providerId` plus
 * the optional `modelId`/`voiceId`).
 *
 * This mirrors the main-process sanitizer in
 * `main/services/lia/voice-config-service.ts`: anything else — an `apiKey`, a
 * `baseUrl`, an arbitrary blob — is dropped here too, so a credential cannot be
 * round-tripped through the renderer back into `lia-product.json` even if some
 * future caller hands this store a polluted object. Returns `undefined` for
 * anything without a usable `providerId`.
 */
export function normalizeLiaVoiceTarget(value: unknown): LiaVoiceTtsTarget | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined

  const { providerId, modelId, voiceId } = value as Record<string, unknown>
  if (!isNonEmptyString(providerId))
    return undefined

  const target: LiaVoiceTtsTarget = { providerId }
  if (isNonEmptyString(modelId))
    target.modelId = modelId
  if (isNonEmptyString(voiceId))
    target.voiceId = voiceId
  return target
}

/**
 * Normalizes a `tts` payload into the renderer state. `preferred` is optional
 * and `fallback` is always an array (empty when absent/invalid), matching the
 * document shape the main process persists.
 */
export function normalizeLiaVoiceTts(value: LiaVoiceTtsConfig | undefined): LiaVoiceTtsState {
  const source = (value && typeof value === 'object' && !Array.isArray(value))
    ? value as Record<string, unknown>
    : {}

  const fallback = Array.isArray(source.fallback)
    ? source.fallback
        .map(normalizeLiaVoiceTarget)
        .filter((target): target is LiaVoiceTtsTarget => target !== undefined)
    : []

  const preferred = normalizeLiaVoiceTarget(source.preferred)
  return preferred ? { preferred, fallback } : { fallback }
}

export const useLiaVoiceStore = defineStore('lia-voice', () => {
  const speechStore = useSpeechStore()

  const getVoiceConfig = useElectronEventaInvoke(electronLiaVoiceConfigGet)
  const saveVoiceConfig = useElectronEventaInvoke(electronLiaVoiceConfigSet)

  /** Raw config as returned by the main process (diagnostics/debugging only). */
  const loadedConfig = ref<LiaVoiceConfig | undefined>(undefined)
  const preferred = ref<LiaVoiceTtsTarget | undefined>(undefined)
  const fallback = ref<LiaVoiceTtsTarget[]>([])

  const isLoaded = ref(false)
  const isLoading = ref(false)
  const loadError = ref<string | null>(null)

  /**
   * Position in `voiceTargetChain`. `0` is the preferred target; advancing walks
   * the fallback list. Only `nextVoiceTargetOnFailure` moves it and only
   * `resetVoiceTarget`/a reload moves it back — nothing applies it implicitly.
   */
  const activeTargetIndex = ref(0)

  /**
   * The ordered resolution chain: `preferred`, then `fallback[0..n]`.
   *
   * When there is no `preferred`, the chain simply starts at `fallback[0]` —
   * a configured fallback is still a usable voice, and inventing a separate
   * "primary required" rule would only add a state the UI has to explain. An
   * unconfigured store yields an empty chain, and every consumer below treats
   * that as "do nothing".
   */
  const voiceTargetChain = computed<LiaVoiceTtsTarget[]>(() => {
    const chain: LiaVoiceTtsTarget[] = []
    if (preferred.value)
      chain.push(preferred.value)
    chain.push(...fallback.value)
    return chain
  })

  const hasConfiguration = computed(() => voiceTargetChain.value.length > 0)

  /** The target the store currently points at (`undefined` when unconfigured). */
  function resolveCurrentVoiceTarget(): LiaVoiceTtsTarget | undefined {
    return voiceTargetChain.value[activeTargetIndex.value]
  }

  /**
   * Moves to the next target in the chain and returns it, or `undefined` once
   * the chain is exhausted.
   *
   * PREPARED, NOT ACTIVATED: this only advances the store's cursor. It never
   * writes to the speech runtime, so no TTS path fails over today. A 4D-3
   * consumer is expected to call it and then `applyVoiceTarget(next)`.
   */
  function nextVoiceTargetOnFailure(): LiaVoiceTtsTarget | undefined {
    const chain = voiceTargetChain.value
    const nextIndex = activeTargetIndex.value + 1
    if (nextIndex >= chain.length)
      return undefined

    activeTargetIndex.value = nextIndex
    return chain[nextIndex]
  }

  /** Points the cursor back at the preferred target. Does not apply anything. */
  function resetVoiceTarget(): void {
    activeTargetIndex.value = 0
  }

  function applyTtsState(state: LiaVoiceTtsState) {
    preferred.value = state.preferred
    fallback.value = state.fallback
    // A new configuration invalidates any cursor left over from the old one.
    activeTargetIndex.value = 0
  }

  /**
   * Reads `voice.tts` from `lia-product.json` through the 4D-1 bridge and
   * normalizes it. Safe when nothing is configured: the state ends up empty and
   * the speech runtime is left exactly as AIRI had it.
   */
  async function refreshConfig(): Promise<LiaVoiceTtsState> {
    isLoading.value = true
    loadError.value = null
    try {
      const config = await getVoiceConfig()
      loadedConfig.value = config ?? {}
      const state = normalizeLiaVoiceTts(config?.tts)
      applyTtsState(state)

      // TEMPORARY 4E-1 investigation: measures each stage of the hydration chain
      // on a real machine. DEV-only, references only, no secrets. Remove with the
      // investigation.
      logVoiceConfigDiag(import.meta.env.DEV, {
        stage: 'store',
        ipcGetReturned: config !== undefined && config !== null,
        ipcTtsExists: !!config && typeof config === 'object' && 'tts' in config,
        persistedVoiceTts: !!config?.tts && typeof config.tts === 'object' && Object.keys(config.tts).length > 0,
        preferredExists: !!state.preferred,
        fallbackCount: state.fallback.length,
        storePreferredExists: !!preferred.value,
        storeFallbackCount: fallback.value.length,
        hasConfiguration: hasConfiguration.value,
        providerId: state.preferred?.providerId ?? null,
        modelId: state.preferred?.modelId ?? null,
        voiceId: state.preferred?.voiceId ?? null,
      })

      isLoaded.value = true
      return state
    }
    catch (error) {
      loadError.value = errorMessageFrom(error) ?? 'Unknown error'
      throw error
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * Persists the CURRENT state, always as the full `tts` slice.
   *
   * The bridge uses replace semantics for `tts`, so sending only `preferred`
   * would silently delete a stored `fallback`. `fallback` is always sent as an
   * array (empty when there is none) for the same reason.
   *
   * Each target is rebuilt through `normalizeLiaVoiceTarget` rather than
   * spread: `preferred` / `fallback` are `ref`s, so their contents (and every
   * element of the array) are Vue reactive Proxies, and a spread keeps those
   * proxies. Electron IPC serializes with the structured clone algorithm, which
   * cannot clone a Proxy and throws "An object could not be cloned." — the same
   * failure the chat onboarding gate had.
   */
  async function persistTtsConfig(): Promise<void> {
    const tts: LiaVoiceTtsConfig = {
      fallback: fallback.value
        .map(target => normalizeLiaVoiceTarget(target))
        .filter((target): target is LiaVoiceTtsTarget => target !== undefined),
    }
    const preferredTarget = normalizeLiaVoiceTarget(preferred.value)
    if (preferredTarget)
      tts.preferred = preferredTarget

    await saveVoiceConfig({ tts })
    loadedConfig.value = { tts }
  }

  /** Normalizes, stores and persists a new `tts` configuration in one step. */
  async function updateTtsConfig(next: LiaVoiceTtsConfig): Promise<LiaVoiceTtsState> {
    applyTtsState(normalizeLiaVoiceTts(next))
    await persistTtsConfig()
    return { preferred: preferred.value, fallback: [...fallback.value] }
  }

  /**
   * Applies one target to the EXISTING AIRI speech runtime using exactly the
   * fields it already reads. No provider internals are touched.
   *
   * Order matters: provider first, then model, then voice. The speech store
   * watches `activeSpeechProvider` (pre-flush) and runs `ensureActiveSpeechModel`
   * + `loadVoicesForProvider` from that watcher, so all three writes are visible
   * by the time it runs. Returns `false` (and touches nothing) without a target.
   */
  async function applyVoiceTarget(target: LiaVoiceTtsTarget | undefined): Promise<boolean> {
    if (!target?.providerId)
      return false

    const providerChanged = speechStore.activeSpeechProvider !== target.providerId

    speechStore.activeSpeechProvider = target.providerId
    // An absent `modelId` clears the model instead of leaking the previous
    // provider's model id into the new one.
    speechStore.activeSpeechModel = target.modelId ?? ''
    speechStore.activeSpeechVoiceId = target.voiceId ?? ''

    // A provider change already triggers the store's own voice-catalog load via
    // its watcher; only the same-provider case (e.g. a new model/voice) needs an
    // explicit refresh so the voice id can be resolved against a real catalog.
    if (!providerChanged)
      await speechStore.loadVoicesForProvider(target.providerId, target.modelId || undefined)

    return true
  }

  /** Resolves the current target and applies it. `false` when unconfigured. */
  async function applyResolvedTarget(): Promise<boolean> {
    return applyVoiceTarget(resolveCurrentVoiceTarget())
  }

  /**
   * Installs the inert-by-default TTS fallback policy for this renderer
   * session, mirroring `useLiaProviderStore.registerRuntimeExtensions()`.
   * Called once by the Lia Home. Idempotent.
   *
   * The speech runtime stays in charge of *when* to retry (one segment at a
   * time, never on abort, never on a non-recoverable error, bounded by its own
   * attempt ceiling); this policy only answers "is there another target?" and
   * applies it.
   */
  function registerRuntimeExtensions(): void {
    registerSpeechTtsFallbackPolicy({
      onAttemptFailed: async (ctx) => {
        // Read BEFORE the switch: this is the provider that just failed.
        const failedProviderId = speechStore.activeSpeechProvider

        // The cursor is the single source of truth for the chain — preferred,
        // then each fallback exactly once, then exhausted. It cannot loop, and
        // it never revisits an earlier target within the same turn.
        const next = nextVoiceTargetOnFailure()
        if (!next)
          return false

        await applyVoiceTarget(next)

        // Technical diagnostic only: which provider gave up and which took over.
        // No toast, no UI, no secret material.
        console.warn('[Lia Voice] TTS provider failed, falling back', {
          failedProviderId,
          attempt: ctx.attempt,
          nextProviderId: next.providerId,
          nextModelId: next.modelId,
          nextVoiceId: next.voiceId,
        })
        return true
      },

      onTurnEnded: async () => {
        // Nothing to restore unless a fallback actually took over this turn.
        if (activeTargetIndex.value === 0)
          return

        // A fallback is temporary recovery, never a new preference: the cursor
        // goes back to the preferred target and the runtime follows. Nothing is
        // persisted, so `lia-product.json` still names the original preferred.
        resetVoiceTarget()
        await applyVoiceTarget(resolveCurrentVoiceTarget())
      },
    })
  }

  return {
    // State
    loadedConfig,
    preferred,
    fallback,
    isLoaded,
    isLoading,
    loadError,
    activeTargetIndex,

    // Computed
    voiceTargetChain,
    hasConfiguration,

    // Target resolution (fallback prepared, not activated)
    resolveCurrentVoiceTarget,
    nextVoiceTargetOnFailure,
    resetVoiceTarget,

    // Load / save
    refreshConfig,
    persistTtsConfig,
    updateTtsConfig,

    // Apply
    applyVoiceTarget,
    applyResolvedTarget,

    // Runtime wiring (4D-3)
    registerRuntimeExtensions,
  }
})
