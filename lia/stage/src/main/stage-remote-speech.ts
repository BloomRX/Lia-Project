import type { LiaProductConfigRead, LiaProductTtsTarget } from '@lia/core/product/config'
import type { TransportSnapshot } from '../../../core/src/transports/contracts.ts'

import { credentialForDestination } from '../../../core/src/credentials/destination.ts'

const maxAudioBytes = 32 * 1024 * 1024

export function supportsStageSpeech(providerId: string) {
  return providerId === 'openai-audio-speech' || providerId === 'openai-compatible-audio-speech'
}

export function createStageRemoteSpeech(deps: {
  readProduct: () => Promise<LiaProductConfigRead>
  readTransports: () => Promise<TransportSnapshot>
  readCredential: (providerId: string) => string | undefined
  approve: (origin: string, signal: AbortSignal) => Promise<boolean>
  fetch?: typeof globalThis.fetch
}) {
  async function destination(target: LiaProductTtsTarget) {
    const { providerId, modelId, voiceId } = target
    const product = await deps.readProduct()
    const current = product.status === 'ok' && product.value.voice?.enabled !== false ? product.value.voice?.tts?.preferred : undefined
    if (!supportsStageSpeech(providerId) || !modelId || !voiceId || modelId.length > 256 || voiceId.length > 256
      || current?.providerId !== providerId || current.modelId !== modelId || current.voiceId !== voiceId)
      return undefined
    const snapshot = await deps.readTransports()
    const candidates = snapshot.records.filter(record => record.providerId === providerId)
    const [record] = candidates
    if (candidates.length !== 1 || !record.enabled || record.protocol !== 'audio-speech'
      || record.definitionId !== providerId || record.credentialRef.scope !== providerId || record.credentialRef.key !== 'apiKey'
      || snapshot.tombstones.includes(record.id) || (record.modelIds.length && !record.modelIds.includes(modelId)))
      return undefined
    const base = new URL(record.baseUrl)
    if (base.username || base.password || base.search || base.hash
      || (base.protocol !== 'https:' && (base.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(base.hostname))))
      return undefined
    base.pathname = `${base.pathname.replace(/\/+$/, '')}/`
    return { id: record.id, url: new URL('audio/speech', base) }
  }

  return async (target: LiaProductTtsTarget, text: string, signal: AbortSignal) => {
    try {
      signal.throwIfAborted()
      const initial = await destination(target)
      if (!initial)
        return { ok: false, code: 'unavailable' } as const
      signal.throwIfAborted()
      if (!await deps.approve(initial.url.origin, signal) || signal.aborted)
        return { ok: false, code: 'cancelled' } as const
      const current = await destination(target)
      signal.throwIfAborted()
      if (!current || current.id !== initial.id || current.url.href !== initial.url.href)
        return { ok: false, code: 'unavailable' } as const
      const token = credentialForDestination(deps.readCredential(target.providerId), target.providerId, current.url, 'speech')
      if (!token)
        return { ok: false, code: 'unavailable' } as const
      const response = await (deps.fetch ?? globalThis.fetch)(current.url, {
        method: 'POST', redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: target.modelId, voice: target.voiceId, input: text, response_format: 'wav' }),
      })
      const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
      if (!response.ok || !response.body || !mime || !['audio/wav', 'audio/x-wav', 'audio/wave', 'application/octet-stream'].includes(mime)) {
        await response.body?.cancel().catch(() => {})
        return { ok: false, code: 'unavailable' } as const
      }
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done)
            break
          size += value.byteLength
          if (size > maxAudioBytes)
            throw new Error('speech-audio-size')
          chunks.push(value)
        }
      }
      finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      signal.throwIfAborted()
      const audio = Buffer.concat(chunks)
      if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE'
        || audio.readUInt32LE(4) !== audio.length - 8 || audio.includes(token))
        return { ok: false, code: 'unavailable' } as const
      return { ok: true, audio: new Uint8Array(audio).buffer } as const
    }
    catch {
      return { ok: false, code: signal.aborted ? 'cancelled' : 'unavailable' } as const
    }
  }
}
