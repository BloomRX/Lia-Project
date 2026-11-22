import type { LiaProductConfigRead, LiaProductVoiceConfig } from '@lia/core/product/config'
import type { LiaVoiceEngine } from '@lia/core/voice/engines/types'

import { readVoiceEnabledConfig, readVoiceEngineConfig, readVoiceFallbackConfig } from '@lia/core/voice/config'
import { resolveVoiceEngineSelection } from '@lia/core/voice/engines/registry'
import { createLiaVoiceService } from '@lia/core/voice/voice-service'

export function createStageVoice(engine: LiaVoiceEngine, readProduct: () => Promise<LiaProductConfigRead>) {
  let voice: LiaProductVoiceConfig | undefined
  let pending = false
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

  return {
    async speak(text: string | undefined) {
      if (pending || disposed || !text?.trim())
        return { ok: false, code: 'unavailable' } as const
      pending = true
      try {
        const config = await readProduct()
        if (disposed || config.status !== 'ok')
          return { ok: false, code: 'unavailable' } as const
        voice = config.value.voice
        if (!readVoiceEnabledConfig(voice))
          return { ok: false, code: 'disabled' } as const
        const { audio } = await service.synthesize({ text: text.slice(0, 8_000) })
        return disposed || audio.byteLength > 32 * 1024 * 1024
          ? { ok: false, code: 'unavailable' } as const
          : { ok: true, audio } as const
      }
      catch {
        return { ok: false, code: 'unavailable' } as const
      }
      finally {
        pending = false
      }
    },
    async stop() {
      disposed = true
      await engine.stop()
    },
  }
}
