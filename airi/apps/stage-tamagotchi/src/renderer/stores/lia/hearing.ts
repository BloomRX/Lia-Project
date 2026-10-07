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

/**
 * Reduces arbitrary text to a bounded, low-cardinality, non-secret form.
 *
 * Diagnostics must be safe to read from a support log, so anything that could
 * be a URL, a credential, or a device identifier is replaced by a placeholder
 * before it is printed. Only the shape of the failure survives.
 */
function sanitizeDiagnosticText(raw: string): string {
  return raw
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
    .replace(/\b[\w-]{16,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

/** The browser failure names this bootstrap can actually produce. */
const KNOWN_AUDIO_FAILURE_NAMES = new Set([
  'AbortError',
  'NotAllowedError',
  'NotFoundError',
  'NotReadableError',
  'OverconstrainedError',
  'PermissionDeniedError',
  'SecurityError',
  'TypeError',
])

/**
 * Reduces an unknown failure to `name` plus a sanitized message.
 *
 * Anything outside the known DOMException set collapses to `UnknownError`, so a
 * novel error message can never be echoed verbatim into a log.
 */
function describeFailure(error: unknown): { message: string, name: string } {
  if (!(error instanceof Error))
    return { message: 'non-error', name: 'UnknownError' }

  const name = KNOWN_AUDIO_FAILURE_NAMES.has(error.name) ? error.name : 'UnknownError'
  return { message: sanitizeDiagnosticText(error.message), name }
}

/**
 * Emits one metadata-only diagnostics line for the next real Windows E2E.
 *
 * Values are constructed here from booleans, counts, fixed enums, provider ids
 * and already-sanitized failure names. Never a credential, never a device id or
 * label, never captured audio, never recognized text.
 */
function reportDiagnostic(event: string, detail?: Record<string, boolean | number | string>): void {
  const pairs = Object.entries(detail ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')
  console.info(`[LIA-HEARING] ${event}${pairs ? ` ${pairs}` : ''}`)
}

export const useLiaHearingStore = defineStore('lia-hearing', () => {
  const getHearingConfig = useElectronEventaInvoke(electronLiaHearingConfigGet)
  const hearingStore = useHearingStore()
  const providerConfigStore = useProviderConfigStore()
  const providerStore = useProviderStore()
  const audioDeviceStore = useSettingsAudioDevice()

  /** Set once the canonical selection has been applied to the runtime stores. */
  const projected = ref(false)
  /** Set only when a microphone is genuinely usable - never on a failed attempt. */
  const microphoneReady = ref(false)
  /** Why no projection happened, for diagnostics. Never a secret. */
  const degradedReason = ref<string | undefined>(undefined)
  /** Guards against concurrent initialization from more than one caller. */
  let initializing: Promise<void> | undefined
  /** Identity of the applied projection, so stale instances are rebuilt. */
  let appliedSignature: string | undefined
  /**
   * The microphone bootstrap is consumed by SUCCESS, not by an attempt.
   *
   * It is a flag, never a watcher: re-asserting the microphone after the user
   * turns it off would fight an intentional runtime choice. A failed attempt
   * therefore leaves it clear, so a transient boot-time failure (devices still
   * enumerating, a dismissed prompt) can be retried by a later `initialize()`
   * instead of costing the session its microphone.
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
   * Brings the microphone up through the same functional preconditions the
   * proven manual path enforces, adapted for programmatic bootstrap: permission
   * handshake first, a real input device resolved, then a confirmed stream.
   *
   * Assigning `enabled = true` on its own cannot do this. It fires the store's
   * watcher while permission is still unrequested and the device list is still
   * anonymous and empty, so `getUserMedia` is attempted with neither, fails, and
   * the store reverts `enabled` to false. The handshake is what resolves a
   * device: `askPermission()` awaits the post-permission device enumeration and
   * selects the preferred input before returning. It is idempotent when
   * permission is already granted, so one unconditional call is both the smaller
   * design and the correct one.
   *
   * Returns once the outcome is known, and latches only on a usable microphone.
   */
  async function bootstrapMicrophone(): Promise<void> {
    reportDiagnostic('microphone-preconditions', {
      audioInputCount: audioDeviceStore.audioInputs.length,
      hasSelectedInput: Boolean(audioDeviceStore.selectedAudioInput),
      permissionGranted: audioDeviceStore.permissionGranted,
    })

    reportDiagnostic('microphone-handshake-attempted', {
      permissionGranted: audioDeviceStore.permissionGranted,
    })
    try {
      await audioDeviceStore.askPermission()
    }
    catch (error) {
      reportDiagnostic('microphone-handshake-failed', describeFailure(error))
      degradedReason.value = 'microphone-permission-denied'
      return
    }

    if (!audioDeviceStore.permissionGranted) {
      reportDiagnostic('microphone-permission-unavailable')
      degradedReason.value = 'microphone-permission-denied'
      return
    }

    if (!audioDeviceStore.selectedAudioInput) {
      reportDiagnostic('microphone-input-unavailable', {
        audioInputCount: audioDeviceStore.audioInputs.length,
      })
      degradedReason.value = 'microphone-no-input'
      return
    }

    reportDiagnostic('microphone-enable-attempted', {
      audioInputCount: audioDeviceStore.audioInputs.length,
      hasSelectedInput: true,
      permissionGranted: audioDeviceStore.permissionGranted,
    })
    audioDeviceStore.enabled = true

    try {
      // Awaits the same in-flight request the store's own watcher allocated, so
      // no second stream is created and the outcome is observed, not raced.
      await audioDeviceStore.startStream()
    }
    catch (error) {
      audioDeviceStore.enabled = false
      reportDiagnostic('microphone-stream-failed', describeFailure(error))
      degradedReason.value = 'microphone-stream-failed'
      return
    }

    if (!audioDeviceStore.enabled) {
      // The store reverted it underneath us: permission revoked mid-start, or
      // its own start failed for a reason it does not surface as a throw.
      reportDiagnostic('microphone-reverted-after-start')
      degradedReason.value = 'microphone-stream-failed'
      return
    }

    microphoneReady.value = true
    microphoneBootstrapped = true
    reportDiagnostic('microphone-ready', { enabled: true })
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
      reportDiagnostic('initialize-started')
      try {
        const config = await getHearingConfig()
        const preferred = config?.preferred

        // No canonical selection means "not configured". This never invents a
        // provider, and specifically never falls back to Web Speech.
        if (!preferred?.providerId) {
          degradedReason.value = 'stt-not-configured'
          return
        }

        reportDiagnostic('canonical-target-received', { providerId: preferred.providerId })

        const target = projectSttTarget(preferred)
        await applyProviderProjection(target)

        hearingStore.activeTranscriptionProvider = target.providerId
        hearingStore.activeTranscriptionModel = target.config.model ?? ''
        projected.value = true
        degradedReason.value = undefined
        reportDiagnostic('projection-completed', { providerId: target.providerId })

        // Text-only mode never auto-enables the microphone.
        if (config?.enabled === false) {
          degradedReason.value = 'voice-disabled'
          return
        }

        // A usable microphone was already brought up, so this run never touches
        // it again: a later deliberate mic-off stays off.
        if (microphoneBootstrapped) {
          reportDiagnostic('microphone-bootstrap-skipped', { reason: 'already-bootstrapped' })
          return
        }

        await bootstrapMicrophone()
      }
      catch (error) {
        // Degraded, not fatal: record a non-secret reason and leave the text
        // path untouched.
        const failure = describeFailure(error)
        reportDiagnostic('projection-failed', failure)
        degradedReason.value = failure.name === 'UnknownError' ? 'projection-failed' : failure.name
        projected.value = false
      }
      finally {
        initializing = undefined
        reportDiagnostic('initialize-complete', {
          degradedReason: degradedReason.value ?? 'none',
          enabled: audioDeviceStore.enabled,
          microphoneReady: microphoneReady.value,
          projected: projected.value,
        })
      }
    })()

    initializing = run
    return run
  }

  return {
    degradedReason,
    initialize,
    microphoneReady,
    projected,
  }
})
