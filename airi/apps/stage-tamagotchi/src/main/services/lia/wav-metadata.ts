/**
 * Phase 7.7.2, items 7-9: safe structural metadata of a WAV buffer.
 *
 * Reads ONLY the RIFF container headers: the `fmt ` chunk (format, channels,
 * sample rate, bit depth) and the `data` chunk size (duration math). NEVER
 * interprets audio samples - no content crosses a log line, now or ever.
 */

export interface WavMetadata {
  /** e.g. `PCM`. */
  codec: string
  sampleRate?: number
  channels?: number
  bitDepth?: number
  dataBytes?: number
  durationMs?: number
  container: 'RIFF/WAVE' | 'unknown'
}

const AUDIO_FORMAT_NAMES: Record<number, string> = {
  0x0001: 'PCM',
  0x0003: 'IEEE float',
  0x0006: 'A-law',
  0x0007: 'mu-law',
  0xFFFE: 'WAVE_FORMAT_EXTENSIBLE',
}

export function sniffWavMetadata(input: ArrayBuffer | Uint8Array): WavMetadata {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const meta: WavMetadata = { codec: 'unknown', container: 'unknown' }

  try {
    if (bytes.byteLength < 12)
      return meta
    const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
    const wave = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
    if (riff !== 'RIFF' || wave !== 'WAVE')
      return meta
    meta.container = 'RIFF/WAVE'

    let offset = 12
    while (offset + 8 <= bytes.byteLength) {
      const chunkId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
      const chunkSize = view.getUint32(offset + 4, true)
      const body = offset + 8
      if (chunkId === 'fmt ' && body + 16 <= bytes.byteLength) {
        const format = view.getUint16(body, true)
        meta.codec = AUDIO_FORMAT_NAMES[format] ?? `format 0x${format.toString(16)}`
        meta.channels = view.getUint16(body + 2, true)
        meta.sampleRate = view.getUint32(body + 4, true)
        meta.bitDepth = view.getUint16(body + 14, true)
      }
      if (chunkId === 'data') {
        meta.dataBytes = chunkSize
        if (meta.sampleRate && meta.channels && meta.bitDepth) {
          const bytesPerSample = meta.bitDepth / 8
          if (bytesPerSample > 0)
            meta.durationMs = Math.round((chunkSize / (meta.sampleRate * meta.channels * bytesPerSample)) * 1000)
        }
      }
      // Chunks are word-aligned.
      offset = body + chunkSize + (chunkSize % 2)
    }
  }
  catch {
    // A truncated or alien buffer reports whatever was proven so far.
  }
  return meta
}
