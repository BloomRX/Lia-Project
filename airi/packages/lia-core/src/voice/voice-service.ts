import type { LiaVoiceEngine, LiaVoiceEngineError as LiaVoiceEngineErrorType, LiaVoiceSynthesisInput, LiaVoiceSynthesisOutput } from './engines/types'
import type { LiaVoiceFallbackConfig } from './config'

import { LiaVoiceEngineError } from './engines/types'

/**
 * The Lia Voice Service - the ONLY way Stage ever obtains speech (Phase
 * 7.8, items 1/2/16/17/25): "Stage should only request speech through the
 * Lia voice bridge/service".
 *
 * Responsibilities (all engine-neutral by contract):
 * - hold the engine registry (concrete engines register at the host seam;
 *   the service itself never names one)
 * - serialize synthesis across ALL engines with one FIFO - an engine that
 *   tolerates parallelism declares it via capabilities; the default is
 *   strict serialization
 * - apply the fallback semantics: the preferred engine unavailable -> a
 *   fallback MAY be used only when explicitly enabled (item 16/24: no
 *   silent backend switch)
 * - emit ONE metadata-only metrics line per synthesis (item 14):
 *   engine, device, textLength, queueWaitMs, generationMs, audioDurationMs,
 *   totalMs, RTF, sampleRate, channels - never text, never audio
 * - derive the capability truth for the persona (item 17): voice is
 *   "available" when ANY usable engine exists behind the service
 */

export interface VoiceServiceSynthesisRecord {
  audioDurationMs?: number
  device?: string
  engine: string
  generationMs?: number
  queueWaitMs: number
  rtf?: number
  sampleRate?: number
  channels?: number
  textLength: number
  totalMs: number
}

export interface VoiceServiceDeps {
  engines: LiaVoiceEngine[]
  fallback: () => LiaVoiceFallbackConfig
  /** Preferences lookup: the selected engine id, if one was selected. */
  preferredEngineId: () => string | undefined
  log?: (record: Record<string, string | number | boolean>) => void
}

interface QueuedSynthesis {
  input: LiaVoiceSynthesisInput
  resolve: (output: LiaVoiceSynthesisOutput) => void
  reject: (error: unknown) => void
  queuedAt: number
}

export function createLiaVoiceService(deps: VoiceServiceDeps) {
  const log = deps.log ?? (() => undefined)
  const queue: QueuedSynthesis[] = []
  let draining = false

  function enginesByPreference(): LiaVoiceEngine[] {
    const preferred = deps.preferredEngineId()
    const list = [...deps.engines].filter(engine => engine.capabilities().clonesVoice)
    list.sort((a, b) => (a.id === preferred ? -1 : 0) - (b.id === preferred ? -1 : 0))
    const fallbacks = deps.engines.filter(engine => !engine.capabilities().clonesVoice)
    return [...list, ...fallbacks]
  }

  /**
   * The route for one request: cloning engines first (preferred id first),
   * then fallback engines - ONLY when the fallback toggle allows them.
   */
  function route(): { engines: LiaVoiceEngine[], fallbackAllowed: boolean } {
    const ordered = enginesByPreference()
    return {
      engines: ordered.filter((engine, index) => {
        if (engine.capabilities().clonesVoice)
          return true
        const fallback = deps.fallback()
        if (!fallback.enabled)
          return false
        // A fallback engine never goes FIRST: it is strictly the tail.
        return index > 0
      }),
      fallbackAllowed: deps.fallback().enabled,
    }
  }

  async function synthesizeOne(input: LiaVoiceSynthesisInput): Promise<LiaVoiceSynthesisOutput> {
    const { engines } = route()
    let lastError: unknown

    for (const engine of engines) {
      const caps = engine.capabilities()
      // A non-cloning engine must NEVER be asked to clone.
      if (!caps.clonesVoice && input.referenceAudioPath)
        input = { ...input, referenceAudioPath: undefined, referenceText: undefined }
      try {
        const output = await engine.synthesize(input)
        return output
      }
      catch (error) {
        lastError = error
        const kind = error instanceof LiaVoiceEngineError ? (error as LiaVoiceEngineErrorType).kind : 'engine-error'
        log({
          engine: engine.id,
          event: 'lia.voice.engine.error',
          kind,
        })
        // Wrong input does not fall to another engine - that is OUR bug.
        if (!caps.clonesVoice || kind === 'input-invalid')
          throw error
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new LiaVoiceEngineError('voice-service', 'engine-unavailable', 'No voice engine could synthesize.')
  }

  async function drain(): Promise<void> {
    if (draining)
      return
    draining = true
    try {
      for (;;) {
        const next = queue.shift()
        if (!next)
          return
        const lockAcquiredAt = Date.now()
        try {
          const output = await synthesizeOne(next.input)
          const totalMs = Date.now() - next.queuedAt
          const record: VoiceServiceSynthesisRecord = {
            audioDurationMs: output.audioDurationMs,
            engine: output.engine,
            generationMs: output.generationMs,
            queueWaitMs: lockAcquiredAt - next.queuedAt,
            sampleRate: output.sampleRate,
            textLength: next.input.text.length,
            totalMs,
            ...(output.channels !== undefined ? { channels: output.channels } : {}),
            ...(output.audioDurationMs && output.generationMs !== undefined
              ? { rtf: Math.round((output.generationMs / output.audioDurationMs) * 1000) / 1000 }
              : {}),
          }
          log({ event: 'lia.voice.synthesize', ...record })
          next.resolve(output)
        }
        catch (error) {
          next.reject(error)
        }
      }
    }
    finally {
      draining = false
    }
  }

  return {
    /** Engine-neutral health of the whole voice product. */
    async state(now: () => number = Date.now): Promise<{
      /** Any engine usable right now (drives voice.available). */
      available: boolean
      primary?: { id: string, ok: boolean, state: string, note?: string }
      fallback?: { id: string, ok: boolean, enabled: boolean, state: string, note?: string }
    }> {
      void now
      const ordered = enginesByPreference()
      const primary = ordered[0]
      const fallbackEngine = ordered.find(engine => !engine.capabilities().clonesVoice)
      const fallbackCfg = deps.fallback()

      let available = false
      let primaryState: { id: string, ok: boolean, state: string, note?: string } | undefined
      let fallbackState: { id: string, ok: boolean, enabled: boolean, state: string, note?: string } | undefined

      if (primary) {
        const health = await primary.health()
        primaryState = { id: primary.id, ok: health.ok, ...(health.note ? { note: health.note } : {}), state: health.state }
        available = available || health.ok
      }
      if (fallbackEngine) {
        const health = fallbackCfg.enabled
          ? await fallbackEngine.health()
          : { note: 'fallback disabled by configuration', ok: false, state: 'unavailable' as const }
        fallbackState = { enabled: fallbackCfg.enabled, id: fallbackEngine.id, ok: health.ok, ...(health.note ? { note: health.note } : {}), state: health.state }
        available = available || health.ok
      }
      return { available, fallback: fallbackState, primary: primaryState }
    },

    synthesize(input: LiaVoiceSynthesisInput): Promise<LiaVoiceSynthesisOutput> {
      return new Promise<LiaVoiceSynthesisOutput>((resolvePromise, rejectPromise) => {
        queue.push({
          input,
          queuedAt: Date.now(),
          reject: rejectPromise,
          resolve: resolvePromise,
        })
        void drain()
      })
    },

    /** Engine passthrough for lifecycle start/stop by the product main. */
    engines: () => deps.engines,
  }
}
