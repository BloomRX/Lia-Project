import type { LiaProductConfigRead, LiaProductVoiceConfig } from '@lia/core/product/config'
import type { LiaVoiceEngine } from '@lia/core/voice/engines/types'

import { readVoiceEnabledConfig, readVoiceEngineConfig, readVoiceFallbackConfig } from '@lia/core/voice/config'
import { resolveVoiceEngineSelection } from '@lia/core/voice/engines/registry'
import { createLiaVoiceService } from '@lia/core/voice/voice-service'

import { supportsStageSpeech } from './stage-remote-speech.ts'
import type { createStageRemoteSpeech } from './stage-remote-speech.ts'

interface VoiceJob {
  cancelled: boolean
  synthesizing: boolean
  stopping?: Promise<void>
  controller: AbortController
}

export function createStageVoice(
  engine: LiaVoiceEngine,
  readProduct: () => Promise<LiaProductConfigRead>,
  remoteSpeech?: ReturnType<typeof createStageRemoteSpeech>,
) {
  let voice: LiaProductVoiceConfig | undefined
  let pending: VoiceJob | undefined
  let disposed = false
  const selection = () => resolveVoiceEngineSelection({
    availableEngineIds: [engine.id],
    preferred: readVoiceEngineConfig(voice).preferred,
  })
  const service = createLiaVoiceService({
    engines: [engine],
    fallback: () => readVoiceFallbackConfig(voice),
    preferredEngineId: () => selection().engineId,
    selection,
  })

  async function cancel() {
    const job = pending
    if (!job)
      return
    job.cancelled = true
    job.controller.abort()
    if (job.synthesizing)
      await (job.stopping ??= engine.stop())
  }

  return {
    async speak(text: string | undefined) {
      if (pending || disposed || !text?.trim())
        return { ok: false, code: 'unavailable' } as const
      const job: VoiceJob = { cancelled: false, synthesizing: false, controller: new AbortController() }
      pending = job
      try {
        const config = await readProduct()
        if (job.cancelled)
          return { ok: false, code: 'cancelled' } as const
        if (disposed || config.status !== 'ok')
          return { ok: false, code: 'unavailable' } as const
        voice = config.value.voice
        if (!readVoiceEnabledConfig(voice))
          return { ok: false, code: 'disabled' } as const
        const target = voice?.tts?.preferred
        if (target && supportsStageSpeech(target.providerId))
          return await remoteSpeech?.(target, text.slice(0, 8_000), job.controller.signal) ?? { ok: false, code: 'unavailable' } as const
        job.synthesizing = true
        const { audio } = await service.synthesize({ text: text.slice(0, 8_000) })
        if (job.cancelled)
          return { ok: false, code: 'cancelled' } as const
        return disposed || audio.byteLength > 32 * 1024 * 1024
          ? { ok: false, code: 'unavailable' } as const
          : { ok: true, audio } as const
      }
      catch {
        return { ok: false, code: job.cancelled ? 'cancelled' : 'unavailable' } as const
      }
      finally {
        await job.stopping?.catch(() => {})
        pending = undefined
      }
    },
    cancel,
    async stop() {
      disposed = true
      const localSynthesis = pending?.synthesizing
      await cancel()
      if (!localSynthesis)
        await engine.stop()
    },
  }
}
