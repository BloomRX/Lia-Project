import type { LiaProductConfigRead } from '@lia/core/product/config'
import type { RemoteTranscriptionApproval } from '../../../core/src/transcription/service.ts'
import type { TransportSnapshot } from '../../../core/src/transports/contracts.ts'

import { ProviderError } from '../../../core/src/providers/contracts.ts'
import { createLiaTranscriptionService } from '../../../core/src/transcription/service.ts'
import { isNativeRecordingTranscriptionProvider, isTranscriptionLoopback, resolveTranscriptionDestination } from '../../../core/src/transcription/transport.ts'

const localAdapter = 'app-local-audio-transcription'
const formats = new Map([
  ['audio/webm', 'recording.webm'],
  ['audio/webm;codecs=opus', 'recording.webm'],
  ['audio/wav', 'recording.wav'],
])

export function createStageTranscription(deps: {
  fetchForProvider?: (providerId: string) => typeof globalThis.fetch
  readCredential?: (providerId: string) => string | undefined | Promise<string | undefined>
  readProduct: () => Promise<LiaProductConfigRead>
  readTransports: () => Promise<TransportSnapshot>
}) {
  async function readPreference() {
    const product = await deps.readProduct()
    return product.status === 'ok' ? product.value.voice?.stt?.preferred : undefined
  }

  return async (bytes: unknown, mimeType: unknown, signal: AbortSignal, approveRemote?: RemoteTranscriptionApproval) => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 24 * 1024 * 1024 || typeof mimeType !== 'string')
      return { ok: false, code: 'configuration' } as const
    const fileName = formats.get(mimeType)
    if (!fileName)
      return { ok: false, code: 'configuration' } as const

    try {
      signal.throwIfAborted()
      const preferred = await readPreference()
      if (!preferred?.modelId)
        return { ok: false, code: 'configuration' } as const
      const { providerId, modelId } = preferred

      const repository = {
        async read() {
          const snapshot = await deps.readTransports()
          const current = await readPreference()
          if (current?.providerId !== providerId || current.modelId !== modelId)
            throw new ProviderError('configuration')
          const candidates = snapshot.records.filter(record => record.providerId === providerId)
          const [record] = candidates
          if (candidates.length !== 1 || !record.enabled || !isNativeRecordingTranscriptionProvider(record.definitionId)
            || record.protocol !== 'audio-transcription' || record.credentialRef.scope !== providerId || record.credentialRef.key !== 'apiKey'
            || snapshot.tombstones.includes(record.id) || !record.modelIds.includes(modelId))
            throw new ProviderError('configuration')
          const destination = resolveTranscriptionDestination(record)
          const allowed = record.definitionId === localAdapter
            ? ['127.0.0.1', '[::1]'].includes(destination.hostname)
            : destination.protocol === 'https:' && !isTranscriptionLoopback(destination)
          if (!allowed)
            throw new ProviderError('configuration')
          return snapshot
        },
      }
      let approved = false
      const service = createLiaTranscriptionService({
        repository,
        fetchForProvider: deps.fetchForProvider,
        resolveCredential: async scope => approved ? deps.readCredential?.(scope) : undefined,
      })
      const result = await service.transcribe({ bytes, fileName, mimeType, model: modelId, providerId }, signal, async (...args) => {
        approved = await approveRemote?.(...args) === true
        return approved
      })
      return result.ok ? { ok: true, text: result.text } as const : result
    }
    catch {
      return { ok: false, code: signal.aborted ? 'cancelled' : 'configuration' } as const
    }
  }
}
