import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { electronLiaHearingConfigGet } from '../../../shared/eventa'

/**
 * Phase 8.0D-10B-4D4C4-SHELL-B1: the ONE Lia renderer owner of managed Hearing
 * projection.
 *
 * The Lia Launcher is the product authority for speech-to-text. This store reads
 * that decision over a READ-ONLY IPC seam and projects it onto the AIRI runtime
 * stores that the existing hearing pipeline already consumes, so a managed
 * "Completa" session is heard without the user ever opening AIRI Settings.
 *
 * What this store deliberately is NOT:
 * - it does not implement ASR, buffer transcripts, or aggregate fragments;
 * - it does not call the Brain or `chatStore.send` — after transcription the
 *   existing D2B12 voice-send path stays authoritative and untouched;
 * - it does not own, read, or persist API keys (the Lia vault resolver supplies
 *   credentials in memory at provider-build time);
 * - it does not write `lia-product.json` — there is no STT setter to call;
 * - it does not touch the Web Speech implementation.
 */

/**
 * The derived Lia-managed speech-to-text target, as written by the Launcher.
 *
 * `lia-groq-transcription` is a DERIVED provider id, not a new protocol: the
 * definition below is the EXISTING OpenAI-compatible transcription adapter, so
 * no new STT pipeline is introduced. The base URL and model are derived runtime
 * metadata and are never persisted into `lia-product.json`; the credential is
 * never mentioned here at all - the Lia vault resolver supplies it in memory
 * when the instance is built, from the user's existing `groq` secret.
 *
 * This is renderer-side runtime knowledge, so it lives here rather than in the
 * vendor-neutral generic config layer of `@lia/core`.
 */
export const LIA_GROQ_TRANSCRIPTION_PROVIDER_ID = 'lia-groq-transcription'

/** The provider definition the derived Groq target is projected onto. */
export const LIA_GROQ_TRANSCRIPTION_DEFINITION_ID = 'openai-compatible-audio-transcription'

/** Trailing slash required by the adapter's own base URL validator. */
export const LIA_GROQ_TRANSCRIPTION_BASE_URL = 'https://api.groq.com/openai/v1/'

/**
 * This definition's `listModels` returns an empty list, so the model can never
 * be discovered at runtime and must be supplied explicitly.
 */
export const LIA_GROQ_TRANSCRIPTION_MODEL_ID = 'whisper-large-v3-turbo'

/** The canonical STT selection as exposed by the read-only Hearing IPC. */
export interface LiaHearingSttSelection {
  providerId: string
  modelId?: string
}

/**
 * The DERIVED runtime projection of one canonical STT selection.
 *
 * `config` is non-secret by construction: it carries only a base URL and a model
 * id. It must never contain an apiKey, token, or secret — the credential is
 * resolved from the Lia vault when the instance is built.
 */
export interface LiaHearingRuntimeTarget {
  providerId: string
  definitionId: string
  config: Record<string, string>
}

/**
 * Projects a canonical STT selection onto its runtime provider target.
 *
 * Pure and total, so the mapping is directly testable without a renderer:
 * - the derived Lia Groq target expands to the OpenAI-compatible definition with
 *   its derived base URL and model;
 * - ANY other target is applied as its own provider/model, with no Groq-specific
 *   projection, because the canonical document is the authority.
 */
export function projectSttTarget(preferred: LiaHearingSttSelection): LiaHearingRuntimeTarget {
  if (preferred.providerId === LIA_GROQ_TRANSCRIPTION_PROVIDER_ID) {
    return {
      config: {
        baseUrl: LIA_GROQ_TRANSCRIPTION_BASE_URL,
        model: preferred.modelId?.trim() || LIA_GROQ_TRANSCRIPTION_MODEL_ID,
      },
      definitionId: LIA_GROQ_TRANSCRIPTION_DEFINITION_ID,
      providerId: LIA_GROQ_TRANSCRIPTION_PROVIDER_ID,
    }
  }

  const config: Record<string, string> = {}
  if (preferred.modelId?.trim())
    config.model = preferred.modelId.trim()

  return {
    config,
    definitionId: preferred.providerId,
    providerId: preferred.providerId,
  }
}

export const useLiaHearingStore = defineStore('lia-hearing', () => {
  const getHearingConfig = useElectronEventaInvoke(electronLiaHearingConfigGet)
  const hearingStore = useHearingStore()
  const providerConfigStore = useProviderConfigStore()
  const providerStore = useProviderStore()
  const audioDeviceStore = useSettingsAudioDevice()

  /** Set once the canonical selection has been applied to the runtime stores. */
  const projected = ref(false)
  /** Why no projection happened, for diagnostics. Never a secret. */
  const degradedReason = ref<string | undefined>(undefined)
  /** Guards against concurrent initialization from more than one caller. */
  let initializing: Promise<void> | undefined
  /** Identity of the applied projection, so stale instances are rebuilt. */
  let appliedSignature: string | undefined
  /**
   * The microphone bootstrap runs at most once per session. It is a flag, never
   * a watcher: re-asserting the microphone after the user turns it off would
   * fight an intentional runtime choice.
   */
  let microphoneBootstrapped = false

  /**
   * Writes the derived provider record, disposing a cached instance first when
   * the projection actually changes.
   *
   * Instances are cached per provider id, so without disposal a changed base URL
   * or model would silently keep the previously built provider alive.
   */
  async function applyProviderProjection(target: LiaHearingRuntimeTarget): Promise<void> {
    const signature = `${target.providerId}\u0000${target.definitionId}\u0000${JSON.stringify(target.config)}`
    if (providerConfigStore.providers[target.providerId]) {
      if (appliedSignature === signature)
        return

      await providerStore.disposeProviderInstance(target.providerId)
      await providerConfigStore.updateProviderConfig(target.providerId, { ...target.config }, 'unconfigured')
    }
    else {
      providerConfigStore.ensureProvider(target.providerId, target.definitionId, { ...target.config })
    }

    appliedSignature = signature
  }

  /**
   * Reads the canonical Hearing facts and projects them. Safe to call more than
   * once: the projection is idempotent and the microphone is enabled at most once.
   *
   * Never throws — a missing target, an unknown provider definition, or an IPC
   * failure all degrade to a recorded reason while text conversation continues.
   */
  async function initialize(): Promise<void> {
    if (initializing)
      return initializing

    const run = (async () => {
      try {
        const config = await getHearingConfig()
        const preferred = config?.preferred

        // No canonical selection means "not configured". This never invents a
        // provider, and specifically never falls back to Web Speech.
        if (!preferred?.providerId) {
          degradedReason.value = 'stt-not-configured'
          return
        }

        const target = projectSttTarget(preferred)
        await applyProviderProjection(target)

        hearingStore.activeTranscriptionProvider = target.providerId
        hearingStore.activeTranscriptionModel = target.config.model ?? ''
        projected.value = true
        degradedReason.value = undefined

        // Text-only mode never auto-enables the microphone.
        if (config?.enabled === false) {
          degradedReason.value = 'voice-disabled'
          return
        }

        if (!microphoneBootstrapped) {
          audioDeviceStore.enabled = true
          microphoneBootstrapped = true
        }
      }
      catch (error) {
        // Degraded, not fatal: record a non-secret reason and leave the text
        // path untouched.
        degradedReason.value = error instanceof Error ? error.name : 'projection-failed'
        projected.value = false
      }
      finally {
        initializing = undefined
      }
    })()

    initializing = run
    return run
  }

  return {
    degradedReason,
    initialize,
    projected,
  }
})
