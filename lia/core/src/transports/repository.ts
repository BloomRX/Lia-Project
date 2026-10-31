import type { TransportMutation, TransportRecord, TransportResult, TransportSnapshot } from './contracts.ts'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

import { isTransportRecord } from './validation.ts'

const MAX_RECORDS = 1000
const MAX_FILE_BYTES = 4 * 1024 * 1024
export { isTransportRecord } from './validation.ts'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && value.trim() === value && !/[\u0000-\u001F\u007F]/.test(value)
}

function empty(): TransportSnapshot {
  return { schemaVersion: 1, revision: 0, records: [], tombstones: [], migration: { version: 1, imported: [] } }
}

function parse(value: unknown): { snapshot: TransportSnapshot, rejected: boolean } {
  if (!object(value) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
    || !Array.isArray(value.records) || value.records.length > MAX_RECORDS
    || !Array.isArray(value.tombstones) || !value.tombstones.every(identifier) || value.tombstones.length > MAX_RECORDS
    || !object(value.migration) || value.migration.version !== 1
    || !Array.isArray(value.migration.imported) || !value.migration.imported.every(identifier) || value.migration.imported.length > MAX_RECORDS) {
    throw new Error('Transport configuration unavailable')
  }
  const records: TransportRecord[] = []
  const seen = new Set<string>()
  let rejected = new Set(value.tombstones).size !== value.tombstones.length
    || new Set(value.migration.imported).size !== value.migration.imported.length
  for (const candidate of value.records) {
    if (isTransportRecord(candidate) && !seen.has(candidate.id) && !value.tombstones.includes(candidate.id)) {
      records.push(candidate)
      seen.add(candidate.id)
    }
    else {
      rejected = true
    }
  }
  return {
    snapshot: {
      schemaVersion: 1,
      revision: Number(value.revision),
      records,
      tombstones: [...new Set(value.tombstones)] as string[],
      migration: { version: 1, imported: [...new Set(value.migration.imported)] as string[] },
    },
    rejected,
  }
}

/** One main-process owner per path. Atomic replacement + revision CAS across windows. */
export function createTransportRepository(filePath: string) {
  let queue: Promise<unknown> = Promise.resolve()

  async function readValidated(): Promise<{ snapshot: TransportSnapshot, rejected: boolean }> {
    try {
      const handle = await open(filePath, 'r')
      try {
        const chunks: Buffer[] = []
        let total = 0
        while (true) {
          const chunk = Buffer.alloc(65536)
          const { bytesRead } = await handle.read(chunk)
          if (bytesRead === 0)
            break
          total += bytesRead
          if (total > MAX_FILE_BYTES)
            throw new Error('Transport configuration unavailable')
          chunks.push(chunk.subarray(0, bytesRead))
        }
        return structuredClone(parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
      }
      finally {
        await handle.close()
      }
    }
    catch (error) {
      if (object(error) && error.code === 'ENOENT')
        return { snapshot: empty(), rejected: false }
      throw new Error('Transport configuration unavailable')
    }
  }

  async function read(): Promise<TransportSnapshot> {
    return (await readValidated()).snapshot
  }

  async function write(snapshot: TransportSnapshot) {
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
    const temporary = `${filePath}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify(snapshot), 'utf8')
        await handle.sync()
      }
      finally {
        await handle.close()
      }
      await rename(temporary, filePath)
    }
    finally {
      // This path was generated locally. Never remove anything recursively.
      try {
        await unlink(temporary)
      }
      catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
          throw new Error('Transport configuration unavailable')
      }
    }
  }

  async function apply(mutation: TransportMutation): Promise<TransportResult> {
    try {
      if (!object(mutation) || !Number.isSafeInteger(mutation.expectedRevision) || mutation.expectedRevision < 0)
        return { ok: false, code: 'invalid' }
      const validated = await readValidated()
      // A readable subset is useful for diagnosis, but cannot authorize silent
      // deletion of malformed or inconsistent source rows during the next save.
      if (validated.rejected)
        return { ok: false, code: 'invalid' }
      const current = validated.snapshot
      if (current.revision !== mutation.expectedRevision)
        return { ok: false, code: 'conflict' }
      const next = structuredClone(current)
      if (mutation.kind === 'put') {
        if (!isTransportRecord(mutation.record))
          return { ok: false, code: 'invalid' }
        const previous = next.records.find(record => record.id === mutation.record.id)
        if (previous && (previous.providerId !== mutation.record.providerId || previous.definitionId !== mutation.record.definitionId))
          return { ok: false, code: 'invalid' }
        next.records = next.records.filter(record => record.id !== mutation.record.id)
        next.records.push(structuredClone(mutation.record))
        next.tombstones = next.tombstones.filter(id => id !== mutation.record.id)
      }
      else if (mutation.kind === 'remove') {
        if (!identifier(mutation.id))
          return { ok: false, code: 'invalid' }
        next.records = next.records.filter(record => record.id !== mutation.id)
        if (!next.tombstones.includes(mutation.id))
          next.tombstones.push(mutation.id)
      }
      else if (mutation.kind === 'migrate') {
        if (!Array.isArray(mutation.records) || mutation.records.length > MAX_RECORDS || !mutation.records.every(isTransportRecord))
          return { ok: false, code: 'invalid' }
        for (const candidate of mutation.records) {
          if (next.records.some(record => record.id === candidate.id) || next.tombstones.includes(candidate.id))
            continue
          next.records.push(structuredClone(candidate))
          if (!next.migration.imported.includes(candidate.id))
            next.migration.imported.push(candidate.id)
        }
      }
      else {
        return { ok: false, code: 'invalid' }
      }
      if (next.records.length > MAX_RECORDS || next.tombstones.length > MAX_RECORDS || next.migration.imported.length > MAX_RECORDS)
        return { ok: false, code: 'invalid' }
      if (JSON.stringify(next) === JSON.stringify(current))
        return { ok: true, snapshot: current }
      next.revision++
      if (!Number.isSafeInteger(next.revision) || Buffer.byteLength(JSON.stringify(next)) > MAX_FILE_BYTES)
        return { ok: false, code: 'invalid' }
      await write(next)
      return { ok: true, snapshot: structuredClone(next) }
    }
    catch {
      return { ok: false, code: 'storage' }
    }
  }

  function mutate(mutation: TransportMutation): Promise<TransportResult> {
    // Snapshot synchronously so caller mutation cannot race a queued operation.
    let input: TransportMutation
    try {
      input = structuredClone(mutation)
    }
    catch {
      return Promise.resolve({ ok: false, code: 'invalid' })
    }
    const result = queue.then(() => apply(input))
    queue = result.catch(() => {})
    return result
  }

  return { read, mutate }
}
