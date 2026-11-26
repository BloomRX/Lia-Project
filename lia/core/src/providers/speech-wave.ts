import type { Buffer } from 'node:buffer'

/** Checks the RIFF envelope before audio crosses from Main to a renderer. */
export function isSpeechWave(bytes: Buffer): boolean {
  if (bytes.length < 44 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE'
    || bytes.readUInt32LE(4) !== bytes.length - 8)
    return false

  let format = false
  let data = false
  let offset = 12
  let chunks = 0
  while (offset < bytes.length) {
    if (++chunks > 4096 || offset + 8 > bytes.length)
      return false
    const name = bytes.toString('latin1', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    offset = start + size + (size % 2)
    if (offset > bytes.length)
      return false
    if (name === 'fmt ') {
      if (format || size < 16 || !bytes.readUInt16LE(start) || !bytes.readUInt16LE(start + 2)
        || !bytes.readUInt32LE(start + 4) || !bytes.readUInt16LE(start + 12))
        return false
      format = true
    }
    if (name === 'data') {
      if (!format || data || size === 0)
        return false
      data = true
    }
  }
  return format && data
}
