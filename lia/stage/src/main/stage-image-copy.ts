import { randomUUID } from 'node:crypto'
import { link, open, unlink } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join } from 'node:path'

import { maxStageImageBytes } from '../shared/chat-image.ts'

export interface StageImageMetadata {
  format: 'png' | 'jpeg'
  width: number
  height: number
  bytes: number
}

type FailureCode = 'invalid' | 'cancelled' | 'exists' | 'unavailable'
export type StageImageCopyResult = { ok: true, image: StageImageMetadata } | { ok: false, code: FailureCode }
export interface StageImageCopyAudit {
  at: string
  outcome: 'saved' | FailureCode
  image?: StageImageMetadata
}

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const jpegFrames = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF])
const auditLimit = 32

function metadata(bytes: Buffer): StageImageMetadata | undefined {
  if (bytes.subarray(0, 8).equals(pngSignature)) {
    if (bytes.length < 33 || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR')
      return undefined
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    if (!width || !height || width > 0x7FFFFFFF || height > 0x7FFFFFFF)
      return undefined
    return { format: 'png', width, height, bytes: bytes.length }
  }

  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8)
    return undefined
  let offset = 2
  while (offset + 1 < bytes.length) {
    if (bytes[offset++] !== 0xFF)
      return undefined
    while (bytes[offset] === 0xFF)
      offset++
    const marker = bytes[offset++]!
    // The frame header must precede the start of scan and end of image.
    if (marker < 0xC0 || marker === 0xDA || marker === 0xD9
      || (marker >= 0xD0 && marker <= 0xD8) || offset + 2 > bytes.length)
      return undefined
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length)
      return undefined
    if (jpegFrames.has(marker)) {
      if (length < 11 || length !== 8 + 3 * bytes[offset + 7]!)
        return undefined
      const height = bytes.readUInt16BE(offset + 3)
      const width = bytes.readUInt16BE(offset + 5)
      if (!height || !width)
        return undefined
      return { format: 'jpeg', width, height, bytes: bytes.length }
    }
    offset += length
  }
  return undefined
}

function view(input: unknown): Buffer | undefined {
  if (!(input instanceof Uint8Array) || input.byteLength < 8 || input.byteLength > maxStageImageBytes)
    return undefined
  return Buffer.from(input.buffer, input.byteOffset, input.byteLength)
}

function validDestination(destination: string, image: StageImageMetadata): boolean {
  if (!isAbsolute(destination))
    return false
  const suffix = extname(destination).toLowerCase()
  return image.format === 'png' ? suffix === '.png' : suffix === '.jpg' || suffix === '.jpeg'
}

/** Inspects dimensions only. It neither decodes nor transforms the selected file. */
export function createStageImageCopy() {
  const history: StageImageCopyAudit[] = []
  function finish(result: StageImageCopyResult, image?: StageImageMetadata): StageImageCopyResult {
    const at = new Date().toISOString()
    const outcome = result.ok ? 'saved' : result.code
    history.push(image ? { at, outcome, image: { ...image } } : { at, outcome })
    if (history.length > auditLimit)
      history.shift()
    return result
  }

  return {
    inspect(input: unknown) {
      const bytes = view(input)
      return bytes && metadata(bytes)
    },
    async save(input: unknown, signal: AbortSignal, chooseDestination: (image: StageImageMetadata) => Promise<string | undefined>): Promise<StageImageCopyResult> {
      if (signal.aborted)
        return finish({ ok: false, code: 'cancelled' })
      const source = view(input)
      const bytes = source && Buffer.from(source)
      const image = bytes && metadata(bytes)
      if (!bytes || !image)
        return finish({ ok: false, code: 'invalid' })

      let staged: string | undefined
      try {
        const destination = await chooseDestination({ ...image })
        if (!destination || signal.aborted)
          return finish({ ok: false, code: 'cancelled' }, image)
        if (!validDestination(destination, image))
          return finish({ ok: false, code: 'invalid' }, image)

        const temporary = join(dirname(destination), `.lia-image-${randomUUID()}.tmp`)
        const file = await open(temporary, 'wx+', 0o600)
        staged = temporary
        try {
          await file.writeFile(bytes)
          const verified = Buffer.alloc(bytes.length + 1)
          const { bytesRead } = await file.read(verified, 0, verified.length, 0)
          if (bytesRead !== bytes.length || !bytes.equals(verified.subarray(0, bytesRead)))
            return finish({ ok: false, code: 'unavailable' }, image)
        }
        finally {
          await file.close()
        }
        if (signal.aborted)
          return finish({ ok: false, code: 'cancelled' }, image)

        // A hard link publishes verified bytes without overwriting a concurrent writer.
        await link(staged, destination)
        return finish({ ok: true, image }, image)
      }
      catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code
        return finish({ ok: false, code: signal.aborted ? 'cancelled' : code === 'EEXIST' ? 'exists' : 'unavailable' }, image)
      }
      finally {
        if (staged)
          await unlink(staged).catch(() => {})
      }
    },
    audit(): StageImageCopyAudit[] {
      return history.map(entry => entry.image ? { ...entry, image: { ...entry.image } } : { ...entry })
    },
  }
}
