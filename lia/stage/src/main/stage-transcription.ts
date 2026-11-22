import type { LiaProductConfigRead } from '@lia/core/product/config'
import type { TransportSnapshot } from '../../../core/src/transports/contracts.ts'

import { createLiaTranscriptionService } from '../../../core/src/transcription/service.ts'
import { resolveTranscriptionDestination } from '../../../core/src/transcription/transport.ts'

const localAdapter = 'app-local-audio-transcription'
const formats = new Map([
  ['audio/webm', 'recording.webm'],
  ['audio/webm;codecs=opus', 'recording.webm'],
  ['audio/wav', 'recording.wav'],
])

export function createStageTranscription(deps: {
  readProduct: () => Promise<LiaProductConfigRead>
  readTransports: () => Promise<TransportSnapshot>
}) {
  return async (bytes: unknown, mimeType: unknown, signal: AbortSignal) => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 24 * 1024 * 1024 || typeof mimeType !== 'string')
      return { ok: false, code: 'configuration' } as const
    const fileName = formats.get(mimeType)
    if (!fileName)
      return { ok: false, code: 'configuration' } as const

    try {
      signal.throwIfAborted()
      const product = await deps.readProduct()
      const preferred = product.status === 'ok' ? product.value.voice?.stt?.preferred : undefined
      if (!preferred?.modelId)
        return { ok: false, code: 'configuration' } as const
      const { providerId, modelId } = preferred

      const repository = {
        async read() {
          const snapshot = await deps.readTransports()
          const candidates = snapshot.records.filter(record => record.providerId === providerId)
          const [record] = candidates
          if (candidates.length !== 1 || record.definitionId !== localAdapter || record.protocol !== 'audio-transcription'
            || snapshot.tombstones.includes(record.id) || !record.modelIds.includes(modelId))
            return { ...snapshot, records: [] }
          const destination = resolveTranscriptionDestination(record)
          return ['127.0.0.1', '[::1]'].includes(destination.hostname) ? snapshot : { ...snapshot, records: [] }
        },
      }
      const service = createLiaTranscriptionService({ repository })
      const result = await service.transcribe({ bytes, fileName, mimeType, model: modelId, providerId }, signal)
      return result.ok ? { ok: true, text: result.text } as const : result
    }
    catch {
      return { ok: false, code: signal.aborted ? 'cancelled' : 'configuration' } as const
    }
  }
}
