import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fromBufferPromise } from 'yauzl'

import type { LiaIntensityContextId, LiaPersonalityAttributes } from '../../../core/src/persona/default.ts'

import { LIA_DEFAULT_PERSONA, renderLiaPersonaDescription, renderLiaPersonaPersonality, renderLiaPersonaScenario } from '../../../core/src/persona/default.ts'

export const maxPersonaImportBytes = 128 * 1024
export const maxPersonaArchiveBytes = 64 * 1024 * 1024

async function readPackageEntries(input: Uint8Array, entryPath: string, entryLimit: number) {
  if (input.byteLength > maxPersonaArchiveBytes)
    throw new Error('invalid-card')
  const zip = await fromBufferPromise(Buffer.from(input.buffer, input.byteOffset, input.byteLength), {
    strictFileNames: true, validateEntrySizes: true,
  })
  const entries = new Map<string, Buffer>()
  try {
    if (zip.entryCount > 32)
      throw new Error('invalid-card')
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName !== 'manifest.json' && entry.fileName !== entryPath)
        continue
      const limit = entry.fileName === 'manifest.json' ? maxPersonaImportBytes : entryLimit
      if (entries.has(entry.fileName) || entry.uncompressedSize > limit)
        throw new Error('invalid-card')
      const stream = await zip.openReadStreamPromise(entry)
      const chunks: Buffer[] = []
      let length = 0
      for await (const chunk of stream) {
        length += chunk.length
        if (length > limit)
          throw new Error('invalid-card')
        chunks.push(chunk)
      }
      entries.set(entry.fileName, Buffer.concat(chunks))
    }
  }
  finally {
    zip.close()
  }
  const manifestData = entries.get('manifest.json')
  const contents = entries.get(entryPath)
  if (!manifestData)
    throw new Error('invalid-card')
  const manifest: unknown = JSON.parse(manifestData.toString('utf8'))
  if (!record(manifest) || manifest.format !== 'airi-character-card' || manifest.version !== 1
    || !record(manifest.card) || manifest.card.path !== 'card.json' || manifest.card.spec !== 'chara_card_v3')
    throw new Error('invalid-card')
  return { manifest, contents }
}

async function readCardArchive(input: Uint8Array): Promise<unknown> {
  const { contents } = await readPackageEntries(input, 'card.json', maxPersonaImportBytes)
  if (!contents)
    throw new Error('invalid-card')
  return JSON.parse(contents.toString('utf8'))
}

export async function readPackagedAvatar(input: unknown): Promise<Uint8Array | 'live2d-unavailable'> {
  if (!(input instanceof Uint8Array))
    throw new Error('invalid-card')
  const path = 'models/body-model.vrm'
  const { contents, manifest } = await readPackageEntries(input, path, maxPersonaArchiveBytes)
  const model = record(manifest.resources) ? manifest.resources.displayModel : undefined
  if (record(model) && model.format === 'live2d-zip' && model.path === 'models/body-model.zip')
    return 'live2d-unavailable'
  if (!contents || !record(model) || model.format !== 'vrm' || model.path !== path)
    throw new Error('invalid-card-avatar')
  return new Uint8Array(contents)
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

const traitKeys = Object.keys(LIA_DEFAULT_PERSONA.attributes) as (keyof LiaPersonalityAttributes)[]
export const defaultTraits = {
  attributes: LIA_DEFAULT_PERSONA.attributes,
  contextId: LIA_DEFAULT_PERSONA.intensity.defaultContextId,
}

function parseTraits(input: unknown) {
  if (!record(input) || Object.keys(input).some(key => key !== 'attributes' && key !== 'contextId') || !record(input.attributes))
    return undefined
  const { attributes, contextId } = input
  if (!LIA_DEFAULT_PERSONA.intensity.contexts.some(context => context.id === contextId)
    || Object.keys(attributes).length !== traitKeys.length)
    return undefined
  const values = { ...LIA_DEFAULT_PERSONA.attributes }
  for (const key of traitKeys) {
    const value = attributes[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
      return undefined
    values[key] = value
  }
  return { attributes: values, contextId: contextId as LiaIntensityContextId }
}

export function createStagePersona(directory: string) {
  async function persist(card: { name: string, prompt: string, traits?: typeof defaultTraits }) {
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
  }
  return {
    async import(input: unknown) {
      if (!(input instanceof Uint8Array) && (typeof input !== 'string' || Buffer.byteLength(input) > maxPersonaImportBytes))
        throw new Error('invalid-card')
      const card = normalize(typeof input === 'string' ? JSON.parse(input) : await readCardArchive(input))
      return persist(card)
    },
    async customize(input: unknown) {
      const traits = parseTraits(input)
      if (!traits)
        throw new Error('invalid-personality')
      const persona = {
        ...LIA_DEFAULT_PERSONA,
        attributes: traits.attributes,
        intensity: { ...LIA_DEFAULT_PERSONA.intensity, defaultContextId: traits.contextId },
      }
      const prompt = [
        renderLiaPersonaDescription(persona),
        renderLiaPersonaPersonality(persona, { includeUserName: false, includeDefaultTraitSummary: false }),
        renderLiaPersonaScenario(persona),
      ].join('\n\n')
      return persist({ name: 'Lia personalizada', prompt, traits })
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
      if (!record(card) || typeof card.name !== 'string' || typeof card.prompt !== 'string')
        return undefined
      const traits = parseTraits(card.traits)
      return { name: card.name, prompt: card.prompt, ...(traits ? { traits } : {}) }
    },
  }
}
