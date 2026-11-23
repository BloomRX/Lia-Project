import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fromBufferPromise } from 'yauzl'

export const maxPersonaImportBytes = 128 * 1024
export const maxPersonaArchiveBytes = 64 * 1024 * 1024

async function readCardArchive(input: Uint8Array): Promise<unknown> {
  if (input.byteLength > maxPersonaArchiveBytes)
    throw new Error('invalid-card')
  const zip = await fromBufferPromise(Buffer.from(input.buffer, input.byteOffset, input.byteLength), {
    strictFileNames: true, validateEntrySizes: true,
  })
  const entries = new Map<string, unknown>()
  try {
    if (zip.entryCount > 32)
      throw new Error('invalid-card')
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName !== 'manifest.json' && entry.fileName !== 'card.json')
        continue
      if (entries.has(entry.fileName) || entry.uncompressedSize > maxPersonaImportBytes)
        throw new Error('invalid-card')
      const stream = await zip.openReadStreamPromise(entry)
      const chunks: Buffer[] = []
      let length = 0
      for await (const chunk of stream) {
        length += chunk.length
        if (length > maxPersonaImportBytes)
          throw new Error('invalid-card')
        chunks.push(chunk)
      }
      entries.set(entry.fileName, JSON.parse(Buffer.concat(chunks).toString('utf8')))
    }
  }
  finally {
    zip.close()
  }
  const manifest = entries.get('manifest.json')
  if (!record(manifest) || manifest.format !== 'airi-character-card' || manifest.version !== 1
    || !record(manifest.card) || manifest.card.path !== 'card.json' || manifest.card.spec !== 'chara_card_v3')
    throw new Error('invalid-card')
  return entries.get('card.json')
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalize(value: unknown) {
  if (!record(value) || !record(value.data) || value.spec !== 'chara_card_v3' || value.spec_version !== '3.0')
    throw new Error('invalid-card')
  const { name, description = '', personality = '', scenario = '' } = value.data
  const parts = [description, personality, scenario]
  if (typeof name !== 'string' || !name.trim() || name.length > 120
    || !parts.every(part => typeof part === 'string'))
    throw new Error('invalid-card')
  if (parts.some(part => part.length > 6_000) || !parts.some(part => part.trim()))
    throw new Error('invalid-card')
  return { name: name.trim(), prompt: parts.map(part => part.trim()).filter(Boolean).join('\n\n') }
}

function cardId(serialized: string) {
  return `card-${createHash('sha256').update(serialized).digest('hex')}`
}

export function createStagePersona(directory: string) {
  return {
    async import(input: unknown) {
      if (!(input instanceof Uint8Array) && (typeof input !== 'string' || Buffer.byteLength(input) > maxPersonaImportBytes))
        throw new Error('invalid-card')
      const card = normalize(typeof input === 'string' ? JSON.parse(input) : await readCardArchive(input))
      const serialized = JSON.stringify(card)
      const id = cardId(serialized)
      await mkdir(directory, { recursive: true })
      const path = join(directory, `${id}.json`)
      const temp = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, serialized, { flag: 'wx', mode: 0o600 })
        await rename(temp, path)
      }
      finally {
        await unlink(temp).catch(() => {})
      }
      return { id, name: card.name }
    },
    async read(id: string) {
      if (!/^card-[a-f0-9]{64}$/.test(id))
        return undefined
      const path = join(directory, `${id}.json`)
      const stat = await lstat(path).catch(() => undefined)
      if (!stat?.isFile() || stat.size > maxPersonaImportBytes)
        return undefined
      const serialized = await readFile(path, 'utf8')
      if (cardId(serialized) !== id)
        return undefined
      const card: unknown = JSON.parse(serialized)
      return record(card) && typeof card.name === 'string' && typeof card.prompt === 'string'
        ? { name: card.name, prompt: card.prompt }
        : undefined
    },
  }
}
