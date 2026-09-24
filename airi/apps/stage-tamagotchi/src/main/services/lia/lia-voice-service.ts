import type { LiaVoiceEngine } from '@lia/core/voice/engines/types'
import type { MainContext } from '@moeru/eventa/adapters/electron/main'

import type {
  LiaVoiceEngineConfig,
  LiaVoiceStatus,
  LiaVoiceSynthesisRequest,
  LiaVoiceSynthesisResult,
} from '../../../shared/eventa'
import type { LiaProductConfig } from '../../configs/lia-schema'
import type { LiaVoiceProfileStore } from './voice-profiles'

import { readVoiceEnabledConfig, readVoiceEngineConfig, readVoiceFallbackConfig, VOICE_FALLBACK_DEFAULT_ENABLED } from '@lia/core/voice/config'
import { resolveVoiceEngineSelection } from '@lia/core/voice/engines/registry'
import { createLiaVoiceService } from '@lia/core/voice/voice-service'
import { defineInvokeHandler } from '@moeru/eventa'

import {
  electronLiaVoiceEngineConfigGet,
  electronLiaVoiceEngineConfigSet,
  electronLiaVoiceStatus,
  electronLiaVoiceSynthesize,
} from '../../../shared/eventa'
import { defaultLiaProductConfig } from '../../configs/lia-schema'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'

/**
 * The Lia Voice IPC bridge (Phase 7.8, items 1/2/16/17; engine-neutral
 * since Phase 7.8C).
 *
 * One process-scoped Voice Service instance. The renderer's only verbs are
 * `status` and `synthesize`; engine selection, fallback semantics and
 * metrics are the main process's job. Phase 7.8C registers NO concrete
 * engine: the service honestly answers "unavailable" until a modular
 * engine (Kokoro is the first candidate) is registered at this seam - the
 * IPC surface already carries everything it will need, so the renderer
 * contract does not change.
 */

interface LiaVoiceServiceParams {
  context: MainContext
  liaProductConfig: { get: () => LiaProductConfig | undefined, update: (value: LiaProductConfig) => void }
  store: LiaVoiceProfileStore
  onVoiceAvailabilityChanged?: (available: boolean) => void
  /**
   * The engines this build registers at the host seam (Phase 7.9C: the
   * Kokoro engine, constructed by the product main). The bridge itself
   * stays engine-neutral: it only ever sees the LiaVoiceEngine contract.
   */
  engines?: LiaVoiceEngine[]
}

const capabilityCacheTtlMs = 5_000

let silentWav: ArrayBuffer | undefined

/**
 * Phase 7.9H-B1: a small, valid, fully-silent WAV. When the product voice
 * switch is OFF, the synthesis gate hands this back instead of reaching an
 * engine: the pipeline decodes it and plays silence - no synthesis happens,
 * nothing audible plays, and no provider error or fallback loop is
 * triggered. Engine/runtime management is untouched either way.
 */
function silentWavBuffer(): ArrayBuffer {
  if (silentWav)
    return silentWav
  const sampleRate = 16_000
  const samples = 1_600 // 100 ms of 16-bit mono silence
  const dataSize = samples * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const writeLabel = (offset: number, label: string): void => {
    for (let i = 0; i < label.length; i++)
      view.setUint8(offset + i, label.charCodeAt(i))
  }
  writeLabel(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeLabel(8, 'WAVE')
  writeLabel(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeLabel(36, 'data')
  view.setUint32(40, dataSize, true)
  // The sample bytes are already zero - silence.
  silentWav = buffer
  return buffer
}

export function registerLiaVoiceBridge(params: LiaVoiceServiceParams) {
  const { context, liaProductConfig, store } = params
  const engines = params.engines ?? []

  // Phase 7.9H-B1: the ONE central speech-output gate. Absent/true means
  // enabled (the product default); only an explicit `voice.enabled: false`
  // opts the user out. Opting out silences spoken output WITHOUT touching
  // runtime management: engines stay installed/registered (prewarm keeps
  // running), text stays fully available, Stage launch never fails, and a
  // later re-enable resumes the existing engine path with zero reinstall.
  const voiceEnabled = () => readVoiceEnabledConfig(liaProductConfig.get()?.voice)

  // Phase 7.9F: the selected engine is resolved ONCE at this host seam
  // (default -> Kokoro; configured-but-unknown -> honest unavailable,
  // never a silent switch). The renderer never resolves selection itself.
  const selection = () => resolveVoiceEngineSelection({
    availableEngineIds: engines.map(engine => engine.id),
    preferred: readVoiceEngineConfig(liaProductConfig.get()?.voice).preferred,
  })
  const service = createLiaVoiceService({
    engines,
    fallback: () => readVoiceFallbackConfig(liaProductConfig.get()?.voice),
    preferredEngineId: () => selection().engineId,
    selection,
    log: record => console.info(Object.entries(record).map(([key, value]) => `${key}=${String(value)}`).join(' ')),
  })

  // Engine lifecycle is engine-owned on the way in (lazy start via
  // health/synthesize) and host-released on the way out: a quitting app
  // never leaves a voice worker behind. Idempotent by engine contract.
  onAppBeforeQuit(() => Promise.allSettled(engines.map(engine => engine.stop())).then(() => undefined))

  // Capability cache: state() hits health endpoints; the persona's
  // turn-boundary snapshot must never stall on a TCP timeout.
  let cache: { expiresAt: number, available: boolean } | undefined
  async function voiceAvailable(): Promise<boolean> {
    // The product switch wins over any probe cache: while voice is off the
    // capability truth is honestly "no voice" (persona stays text-only);
    // skipping the cache also makes a re-enable visible on the next probe.
    if (!voiceEnabled())
      return false
    if (cache && Date.now() < cache.expiresAt)
      return cache.available
    try {
      const state = await service.state()
      cache = { available: state.available, expiresAt: Date.now() + capabilityCacheTtlMs }
      return state.available
    }
    catch {
      return cache?.available ?? false
    }
  }

  function voiceChanged(): void {
    cache = undefined
    void voiceAvailable().then((available) => {
      params.onVoiceAvailabilityChanged?.(available)
    }).catch(() => undefined)
  }

  defineInvokeHandler(context, electronLiaVoiceStatus, async (): Promise<LiaVoiceStatus> => {
    // Voice off: honestly not ready. The startup greeting's existing
    // ready-wait therefore ends in its honest `voice-unavailable` outcome -
    // nothing is synthesized, nothing plays, the latch stays unclaimed.
    if (!voiceEnabled())
      return { note: 'voice-disabled', state: 'unavailable' }
    try {
      const state = await service.state()
      if (!state.available)
        return { note: state.primary?.note ?? state.fallback?.note, state: 'unavailable' }
      const engine = state.primary?.ok
        ? state.primary.id
        : state.fallback?.ok ? state.fallback.id : 'unregistered'
      return { engine, state: 'ready' }
    }
    catch {
      return { state: 'unavailable' }
    }
  })

  defineInvokeHandler(
    context,
    electronLiaVoiceSynthesize,
    async (request: LiaVoiceSynthesisRequest): Promise<LiaVoiceSynthesisResult> => {
      // Voice off: silence instead of synthesis. No engine is touched (not
      // even lazily started), so spoken output stops while the runtime
      // stays installed and managed for a later re-enable.
      if (!voiceEnabled())
        return { audio: silentWavBuffer(), engine: 'none' }

      const profileId = String(request?.profileId ?? '').trim()
      if (!profileId) {
        // Stock engines (Kokoro first, Phase 7.9C) ship their voices with
        // the engine: no user profile is needed and the engine default
        // voice (pf_dora, pt-BR) answers. Cloning engines keep requiring a
        // profile below; the reference-stripping in the Voice Service is
        // the belt-and-braces guarantee no stock engine ever receives one.
        const output = await service.synthesize({
          language: String(request?.language ?? '').trim() || undefined,
          text: String(request?.text ?? ''),
        })
        return { audio: output.audio, engine: output.engine }
      }

      const profile = await store.get(profileId)
      if (!profile)
        throw new Error('The selected voice profile no longer exists.')

      const reference = profile.files.find(file => file.role === 'referenceAudio')
        ?? profile.files[0]
      if (!reference)
        throw new Error('The selected voice profile has no reference audio.')

      const referenceAudioPath = store.resolveFile(profileId, reference.filename)
      if (!referenceAudioPath)
        throw new Error('The selected voice profile reference file is missing.')

      const output = await service.synthesize({
        language: String(request?.language ?? '').trim() || undefined,
        profileId,
        referenceAudioPath,
        // The profile's OWN transcript, user-supplied: cloning engines take
        // the canonical reference and this text verbatim.
        referenceText: profile.metadata?.referenceText ?? undefined,
        text: String(request?.text ?? ''),
      })
      return { audio: output.audio, engine: output.engine }
    },
  )

  defineInvokeHandler(context, electronLiaVoiceEngineConfigGet, async (): Promise<LiaVoiceEngineConfig> => {
    const voice = liaProductConfig.get()?.voice
    const engine = readVoiceEngineConfig(voice)
    const fallback = readVoiceFallbackConfig(voice)
    return {
      ...(engine.preferred !== undefined ? { engine: { preferred: engine.preferred } } : {}),
      fallback: {
        enabled: fallback.enabled ?? VOICE_FALLBACK_DEFAULT_ENABLED,
        ...(fallback.engineId ? { engineId: fallback.engineId } : {}),
      },
    }
  })

  defineInvokeHandler(context, electronLiaVoiceEngineConfigSet, async (update: LiaVoiceEngineConfig): Promise<void> => {
    const current = liaProductConfig.get() ?? defaultLiaProductConfig
    // A tiny, schema-validated merge: engine/fallback keys only - the legacy
    // alltalk block is out of reach of this writer by construction.
    const voice = { ...(current.voice ?? {}) } as Record<string, unknown>
    if (update.engine?.preferred !== undefined) {
      const preferred = update.engine.preferred.trim()
      if (preferred)
        voice.engine = { preferred }
      else
        delete voice.engine
    }
    if (update.fallback !== undefined) {
      voice.fallback = {
        ...(voice.fallback as Record<string, unknown> | undefined),
        ...(update.fallback.enabled !== undefined ? { enabled: update.fallback.enabled === true } : {}),
        ...(update.fallback.engineId !== undefined && update.fallback.engineId.trim() ? { engineId: update.fallback.engineId.trim() } : {}),
      }
    }
    liaProductConfig.update({ ...current, voice: voice as LiaProductConfig['voice'] })
    voiceChanged()
  })

  return {
    /** Recomputes capabilities after config/runtime changes. */
    voiceChanged,
    voiceAvailable,
  }
}
