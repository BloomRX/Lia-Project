import type { LiaMemoryMetadata, LiaMemoryMetadataInput, LiaMemoryMutation, LiaMemoryResult, LiaMemoryState } from './contracts.ts'

import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { buildMemoryContext } from './context.ts'
import { LIA_MEMORY_CLASSIFICATIONS, LIA_MEMORY_KINDS, LIA_MEMORY_LIMITS } from './contracts.ts'

const empty = (): LiaMemoryState => ({ schemaVersion: 1, enabled: false, entries: [] })
const fail = (code: 'invalid' | 'unavailable' | 'limit' | 'missing'): LiaMemoryResult<never> => ({ ok: false, code })
const queues = new Map<string, Promise<unknown>>()
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function validText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= LIA_MEMORY_LIMITS.text && !containsDisallowedControlCharacter(value)
}

function containsDisallowedControlCharacter(value: string): boolean {
  // Mesma intencao de [\u0000-\u0008\v\f\u000E-\u001F]: recusa caracteres de controle sem usar escapes \\u00XX na regex.
  for (let i = 0; i < value.length; i++) {
    const code = value.codePointAt(i)!
    if (code <= 0x08 || code === 0x0B || code === 0x0C || (code >= 0x0E && code <= 0x1F))
      return true
  }
  return false
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)
}
function canonicalInstant(value: unknown): value is string {
  return typeof value === 'string' && value.length === 24 && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function validMetadataInput(value: unknown): value is LiaMemoryMetadataInput {
  return object(value) && LIA_MEMORY_KINDS.some(kind => kind === value.kind)
    && LIA_MEMORY_CLASSIFICATIONS.some(classification => classification === value.classification)
    && (value.expiresAt === undefined || value.expiresAt === null || canonicalInstant(value.expiresAt))
}

function parseMetadata(value: unknown): LiaMemoryMetadata {
  if (!object(value) || value.provenance !== 'user' || !canonicalInstant(value.createdAt) || !validMetadataInput(value)
    || value.expiresAt === null)
    throw new Error('invalid')
  const { kind, classification, createdAt, expiresAt } = value
  return { kind, classification, provenance: 'user', createdAt, ...(expiresAt === undefined ? {} : { expiresAt }) }
}

function parseState(value: unknown): LiaMemoryState {
  if (!object(value) || value.schemaVersion !== 1 || typeof value.enabled !== 'boolean' || !Array.isArray(value.entries) || value.entries.length > LIA_MEMORY_LIMITS.entries)
    throw new Error('invalid')
  const entries = value.entries.map((entry) => {
    if (!object(entry) || !validId(entry.id) || !validText(entry.text) || typeof entry.updatedAt !== 'string' || entry.updatedAt.length > 40 || !Number.isFinite(Date.parse(entry.updatedAt)))
      throw new Error('invalid')
    const metadata = entry.metadata === undefined ? undefined : parseMetadata(entry.metadata)
    return { id: entry.id, text: entry.text, updatedAt: entry.updatedAt, ...(metadata ? { metadata } : {}) }
  })
  if (new Set(entries.map(entry => entry.id)).size !== entries.length)
    throw new Error('invalid')
  return { schemaVersion: 1, enabled: value.enabled, entries }
}

async function readDocument(path: string): Promise<LiaMemoryState | undefined> {
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 400_000)
      throw new Error('invalid')
    return parseState(JSON.parse(await readFile(path, 'utf8')))
  }
  catch (error) {
    if (object(error) && error.code === 'ENOENT')
      return undefined
    throw error
  }
}

/** One Main-owned instance, shared by every window. A failed write never replaces the old document. */
export function createLiaMemoryStore(params: { filePath: string }) {
  const { filePath } = params
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const next = (queues.get(filePath) ?? Promise.resolve()).then(run, run)
    queues.set(filePath, next)
    const cleanup = () => {
      if (queues.get(filePath) === next)
        queues.delete(filePath)
    }
    void next.then(cleanup, cleanup)
    return next
  }
  async function read(): Promise<LiaMemoryState> {
    return await readDocument(filePath) ?? empty()
  }
  async function write(state: LiaMemoryState, publish = rename): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    const temp = `${filePath}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, JSON.stringify(state), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      await publish(temp, filePath)
    }
    finally {
      await unlink(temp).catch(() => {})
    }
  }
  return {
    importIfMissing: (source: string) => serial(async (): Promise<LiaMemoryResult<boolean>> => {
      try {
        const target = await lstat(filePath).catch((error: unknown) => {
          if (object(error) && error.code === 'ENOENT')
            return undefined
          throw error
        })
        if (target)
          return { ok: true, value: false }
        const state = await readDocument(source)
        if (!state)
          return { ok: true, value: false }
        // Publish the completed document only if the destination is still absent.
        await write(state, link)
        return { ok: true, value: true }
      }
      catch (error) {
        if (object(error) && error.code === 'EEXIST')
          return { ok: true, value: false }
        return fail('unavailable')
      }
    }),
    get: () => serial(async (): Promise<LiaMemoryResult> => {
      try {
        return { ok: true, value: await read() }
      }
      catch { return fail('unavailable') }
    }),
    mutate: (request: LiaMemoryMutation) => serial(async (): Promise<LiaMemoryResult> => {
      try {
        if (!object(request))
          return fail('invalid')
        const state = await read()
        if (request.action === 'enable' && typeof request.enabled === 'boolean') {
          state.enabled = request.enabled
        }
        else if (request.action === 'save' && validText(request.text) && (request.id === undefined || validId(request.id))) {
          const existing = request.id ? state.entries.find(entry => entry.id === request.id) : undefined
          if (request.id && !existing)
            return fail('missing')
          const now = new Date().toISOString()
          let metadata = existing?.metadata
          if (request.metadata !== undefined) {
            if (!validMetadataInput(request.metadata)
              || !Object.keys(request.metadata).every(key => ['kind', 'classification', 'expiresAt'].includes(key)))
              return fail('invalid')
            const { kind, classification } = request.metadata
            const expiresAt = request.metadata.expiresAt === undefined ? metadata?.expiresAt : request.metadata.expiresAt
            metadata = {
              kind, classification, provenance: 'user',
              createdAt: metadata?.createdAt ?? (existing ? new Date(existing.updatedAt).toISOString() : now),
              ...(expiresAt ? { expiresAt } : {}),
            }
          }
          if (existing) {
            existing.text = request.text.trim()
            existing.updatedAt = now
            if (metadata)
              existing.metadata = metadata
          }
          else {
            if (state.entries.length >= LIA_MEMORY_LIMITS.entries)
              return fail('limit')
            state.entries.push({ id: randomUUID(), text: request.text.trim(), updatedAt: now, ...(metadata ? { metadata } : {}) })
          }
        }
        else if (request.action === 'remove' && validId(request.id)) {
          if (!state.entries.some(entry => entry.id === request.id))
            return fail('missing')
          state.entries = state.entries.filter(entry => entry.id !== request.id)
        }
        else if (request.action === 'clear' && request.confirmed === true) {
          state.entries = []
        }
        else {
          return fail('invalid')
        }
        await write(state)
        return { ok: true, value: state }
      }
      catch { return fail('unavailable') }
    }),
    recall: (query: string) => serial(async (): Promise<LiaMemoryResult<string>> => {
      if (typeof query !== 'string' || query.length > LIA_MEMORY_LIMITS.query)
        return fail('invalid')
      try {
        return { ok: true, value: buildMemoryContext(await read(), query) }
      }
      catch { return fail('unavailable') }
    }),
  }
}
