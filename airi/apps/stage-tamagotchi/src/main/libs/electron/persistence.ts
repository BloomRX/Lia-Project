import type { BaseIssue, BaseSchema, InferIssue, InferOutput } from 'valibot'

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { safeDestr } from 'destr'
import { app } from 'electron'
import { throttle } from 'es-toolkit'
import { safeParse } from 'valibot'

type ConfigStatus = 'ok' | 'missing' | 'invalid' | 'read-error'

export interface ConfigDiagnostics<T> {
  status: ConfigStatus
  path: string
  issues?: BaseIssue<unknown>[]
  error?: unknown
  raw?: string
  healed?: boolean
  value?: T
}

export interface CreateConfigOptions<T> {
  default?: T
  autoHeal?: boolean
  onValidationFailure?: (diagnostics: ConfigDiagnostics<T>) => void
  onReadError?: (diagnostics: ConfigDiagnostics<T>) => void
}

const persistenceMap = new Map<string, unknown>()
const diagnosticsMap = new Map<string, ConfigDiagnostics<unknown>>()

function createConfigPath(namespace: string, filename: string) {
  return join(app.getPath('userData'), `${namespace}-${filename}`)
}

async function ensureConfigDirectory(path: string) {
  await mkdir(dirname(path), { recursive: true })
}

type PersistedSchema = BaseSchema<unknown, unknown, BaseIssue<unknown>>

function parseWithSchema<TSchema extends PersistedSchema>(
  raw: string,
  schema: TSchema,
): { value?: InferOutput<TSchema>, issues?: InferIssue<TSchema>[] } {
  const parsed = safeDestr<unknown>(raw)
  const result = safeParse(schema, parsed)
  if (result.success) {
    return { value: result.output }
  }
  return { issues: result.issues }
}

export interface Config<TSchema extends PersistedSchema> {
  setup: () => ConfigDiagnostics<InferOutput<TSchema>>
  get: () => InferOutput<TSchema> | undefined
  update: (newData: InferOutput<TSchema>) => void
  getDiagnostics: () => ConfigDiagnostics<InferOutput<TSchema>> | undefined
}

export function createConfig<TSchema extends PersistedSchema>(
  namespace: string,
  filename: string,
  schema: TSchema,
  options?: CreateConfigOptions<InferOutput<TSchema>>,
): Config<TSchema> & { flush: () => Promise<void>, commit: (value: InferOutput<TSchema>) => Promise<void> } {
  const key = `${namespace}:${filename}`
  const autoHeal = options?.autoHeal ?? Boolean(options?.default)

  const configPath = () => createConfigPath(namespace, filename)

  const recordDiagnostics = (diagnostics: ConfigDiagnostics<InferOutput<TSchema>>) => {
    diagnosticsMap.set(key, diagnostics)
    return diagnostics
  }

  let revision = 0
  let scheduledRevision = 0
  let writes: Promise<void> = Promise.resolve()
  let legacyWrites: Promise<void> = Promise.resolve()

  const enqueueSnapshot = (snapshot: string, publish?: () => void) => {
    const path = configPath()
    const write = async () => {
      await ensureConfigDirectory(path)
      const tmpPath = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(tmpPath, snapshot)
        await rename(tmpPath, path)
        publish?.()
      }
      finally {
        await unlink(tmpPath).catch(() => {})
      }
    }
    const next = writes.then(write, write)
    writes = next
    // Observing rejection does not change the promise returned to the caller.
    void next.catch(() => {})
    return next
  }

  const scheduleSave = () => {
    if (scheduledRevision >= revision)
      return legacyWrites
    const savingRevision = revision
    scheduledRevision = savingRevision
    const next = enqueueSnapshot(JSON.stringify(persistenceMap.get(key)))
    legacyWrites = next
    // Legacy update() remains fire-and-forget. flush() receives the original
    // rejecting promise, while this observer prevents unhandled rejections.
    void next.catch((error) => {
      if (scheduledRevision === savingRevision)
        scheduledRevision = savingRevision - 1
      console.error('Failed to save config', error)
    })
    return next
  }
  const save = throttle(() => {
    void scheduleSave()
  }, 250)
  const flush = () => scheduleSave()
  const commit = (value: InferOutput<TSchema>) => {
    const committed = structuredClone(value)
    return enqueueSnapshot(JSON.stringify(committed), () => persistenceMap.set(key, committed))
  }

  const writeHealingConfig = (value: InferOutput<TSchema>) => {
    const path = configPath()
    const snapshot = JSON.stringify(value)
    const heal = async () => {
      await ensureConfigDirectory(path)
      if (existsSync(path)) {
        await copyFile(path, `${path}.bak`).catch(err => console.warn('Failed to create backup for config:', path, err))
      }
      await writeFile(path, snapshot)
    }
    // Healing is a disk write too: the first user update must follow it.
    const next = writes.then(heal, heal)
    writes = next
    legacyWrites = next
    return next.then(() => true, (error) => {
      console.error('Failed to heal config', error)
      return false
    })
  }

  const setup = () => {
    const path = configPath()
    if (!existsSync(path)) {
      const diagnostics = recordDiagnostics({
        status: 'missing',
        path,
        value: options?.default,
      })
      persistenceMap.set(key, options?.default)
      return diagnostics
    }

    try {
      const raw = readFileSync(path, { encoding: 'utf-8' })
      const parsed = parseWithSchema(raw, schema)
      if (parsed.value !== undefined) {
        const diagnostics = recordDiagnostics({
          status: 'ok',
          path,
          value: parsed.value,
        })
        persistenceMap.set(key, parsed.value)
        return diagnostics
      }

      const fallback = options?.default
      const diagnostics = recordDiagnostics({
        status: 'invalid',
        path,
        issues: parsed.issues,
        raw,
        value: fallback,
      })
      options?.onValidationFailure?.(diagnostics)
      persistenceMap.set(key, fallback)

      if (autoHeal && fallback !== undefined) {
        void writeHealingConfig(fallback).then((healed) => {
          if (healed) {
            diagnosticsMap.set(key, { ...diagnostics, healed })
          }
        })
      }
      return diagnostics
    }
    catch (error) {
      const fallback = options?.default
      const diagnostics = recordDiagnostics({
        status: 'read-error',
        path,
        error,
        value: fallback,
      })
      options?.onReadError?.(diagnostics)
      persistenceMap.set(key, fallback)
      return diagnostics
    }
  }

  const update = (newData: InferOutput<TSchema>) => {
    persistenceMap.set(key, newData)
    revision += 1
    save()
  }

  const get = () => persistenceMap.get(key) as InferOutput<TSchema> | undefined

  const getDiagnostics = () => diagnosticsMap.get(key) as ConfigDiagnostics<InferOutput<TSchema>> | undefined

  return {
    setup,
    get,
    update,
    flush,
    commit,
    getDiagnostics,
  }
}
