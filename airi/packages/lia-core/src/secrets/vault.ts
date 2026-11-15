import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { safeDestr } from 'destr'

import { withVaultWriteLock } from './vault-lock'

/**
 * Lia secret vault (M1 Phase 4C, extracted to Lia Core in Phase 7).
 *
 * API keys / bearer tokens that the Lia product configures must NEVER live in
 * renderer localStorage nor in `lia/product.json`. This vault stores secrets in
 * the host's **main** process, encrypted with an injected cipher (Electron
 * `safeStorage` in the Electron hosts), on disk as base64 ciphertext under
 * `<lia-user-data>/lia-secrets.json`. Plaintext is never written to disk and
 * never returned to a renderer for persistence.
 *
 * Encryption availability is checked on every write: if the OS keychain is not
 * available, the vault refuses to persist (it never silently falls back to
 * plaintext). Reads/writes happen only via the main-process IPC handlers; the
 * renderer only ever sees a boolean presence/availability result or the value
 * it is setting for a single in-flight request.
 *
 * The on-disk shape is intentionally tiny and keyed by opaque `scope:key` pairs
 * (e.g. scope = a chat provider id, key = `apiKey`).
 */

type VaultFile = Record<string, string> // `scope\0key` -> base64 ciphertext
const metadataKey = '@lia:vault-revisions-v1' // has no NUL, so cannot name a secret
const legacyRevision = 'legacy'
const isRevision = (value: unknown): value is string => typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/.test(value)

function encodeKey(scope: string, key: string): string {
  if (scope.includes('\0') || key.includes('\0'))
    throw new Error('Invalid credential reference')
  return `${scope}\u0000${key}`
}

interface SecretChangeOptions { signal?: AbortSignal, expectedRevision?: string }

interface SecretChange { revision: string, rollback: () => Promise<boolean> }

export interface LiaSecretVault {
  /** Main-only guarded mutation and opaque, single-use rollback. */
  changeSecret?: (scope: string, key: string, value: string | undefined, options?: SecretChangeOptions) => Promise<SecretChange | undefined>
  secretRevision?: (scope: string, key: string) => string
  readSecretSnapshot?: (scope: string, key: string) => { revision: string, value: string | undefined }
  isEncryptionAvailable: () => boolean
  setSecret: (scope: string, key: string, value: string, signal?: AbortSignal, revision?: string) => Promise<boolean>
  getSecret: (scope: string, key: string) => string | undefined
  hasSecret: (scope: string, key: string) => boolean
  deleteSecret: (scope: string, key: string) => Promise<boolean>
}

export interface LiaSecretCipher {
  /** Whether OS encryption is usable (e.g. Electron safeStorage, keychain). */
  available: () => boolean
  /**
   * Encrypts a plaintext secret. The result may be a `Buffer`, another byte
   * array or a string; it is always normalized to the ciphertext bytes before
   * base64 is persisted.
   */
  encrypt: (value: string) => Buffer | Uint8Array | string
  /** Decrypts the stored ciphertext bytes. */
  decrypt: (payload: Buffer) => string
}

export interface SecretsDeps {
  /**
   * Path to the ciphertext file - the host decides where Lia user data lives
   * (`liaProductPaths(vaultFile)` for the Electron hosts). No default: a vault
   * without an explicit home is a vault that might overwrite someone else's.
   */
  filePath: string
  /**
   * The cipher engine. The vault uses exactly the availability/encrypt/decrypt
   * it was constructed with - never an implicit real keychain when the caller
   * supplied its own (a vault built without a usable keychain must never store
   * anything).
   */
  cipher: LiaSecretCipher
  /** Overridable disk reader for deterministic tests. */
  read?: (path: string) => string
  /** Injected writers must check the signal before publishing the new bytes. */
  write?: (path: string, data: string, signal?: AbortSignal) => Promise<void>
}

/**
 * Normalizes an `encrypt()` result to the base64 text that is persisted.
 *
 * Electron's `safeStorage.encryptString` returns a `Buffer`, while an injected
 * implementation may return a string/Uint8Array. Encoding the *bytes* (rather
 * than stringifying the value) keeps the on-disk format a faithful base64 of
 * the ciphertext, so it always round-trips through
 * `Buffer.from(cipher, 'base64')` on read.
 */
export function ciphertextToBase64(encrypted: Buffer | Uint8Array | string): string {
  const bytes = typeof encrypted === 'string' ? Buffer.from(encrypted, 'utf8') : Buffer.from(encrypted)
  return bytes.toString('base64')
}

export function createLiaSecretVault(deps: SecretsDeps): LiaSecretVault {
  const path = deps.filePath
  const read = deps.read ?? ((p: string) => readFileSync(p, 'utf8'))
  const write = deps.write ?? (async (p: string, data: string, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    await mkdir(dirname(p), { recursive: true })
    const tmp = `${p}.${randomUUID()}.tmp`
    try {
      await writeFile(tmp, data)
      if (signal) {
        // No JS callback can abort between admission and atomic replacement.
        signal.throwIfAborted()
        renameSync(tmp, p)
      }
      else {
        await rename(tmp, p)
      }
    }
    catch (error) {
      await rm(tmp, { force: true })
      throw error
    }
  })

  // Encryption capabilities are exactly what the host injected - there is no
  // hidden keychain fallback in the core.
  const isAvailable = deps.cipher.available
  const encrypt = deps.cipher.encrypt
  const decrypt = deps.cipher.decrypt

  // The injected `read` is the single source of truth for reading the vault —
  // existence included. Probing the real filesystem here with `existsSync` would
  // bypass the injected reader (e.g. in tests / alternate storage backends) and
  // make a secret that was just written appear absent. A missing/unreadable file
  // surfaces as a thrown read (default reader: ENOENT) or empty content, both
  // treated as "no secrets yet".
  const load = (): VaultFile => {
    try {
      const raw = read(path)
      if (!raw)
        return {}
      const parsed = safeDestr<VaultFile>(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    }
    catch {
      // Reads stay tolerant, but mutations below must never replace unreadable
      // bytes. A temporary read failure does not establish that the vault is empty.
      return {}
    }
  }

  const save = async (file: VaultFile, signal?: AbortSignal): Promise<boolean> => {
    try {
      signal?.throwIfAborted()
      if (signal)
        await write(path, JSON.stringify(file), signal)
      else
        await write(path, JSON.stringify(file))
      return true
    }
    catch {
      return false
    }
  }

  const loadForWrite = (): VaultFile => {
    try {
      const raw = read(path)
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some(value => typeof value !== 'string'))
        throw new Error('invalid vault')
      return parsed as VaultFile
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT')
        return {}
      throw new Error('Credential storage unavailable')
    }
  }

  function state() {
    const file = loadForWrite()
    const raw = file[metadataKey]
    let absent = legacyRevision
    const revisions = new Map<string, string>()
    if (raw !== undefined) {
      const metadata = JSON.parse(raw)
      if (!metadata || typeof metadata !== 'object' || (metadata.absent !== legacyRevision && !isRevision(metadata.absent))
        || !metadata.live || typeof metadata.live !== 'object' || Array.isArray(metadata.live)) {
        throw new Error('Credential storage unavailable')
      }
      absent = metadata.absent
      for (const [key, revision] of Object.entries(metadata.live)) {
        if (!key.includes('\0') || !Object.hasOwn(file, key) || !isRevision(revision))
          throw new Error('Credential storage unavailable')
        revisions.set(key, revision)
      }
    }
    return { file, absent, revisions }
  }

  function revisionOf(current: ReturnType<typeof state>, reference: string) {
    return current.file[reference] === undefined ? current.absent : current.revisions.get(reference) ?? legacyRevision
  }

  async function commit(reference: string, ciphertext: () => string | undefined, options?: SecretChangeOptions) {
    try {
      return await withVaultWriteLock(async () => {
        const current = state()
        if (options?.expectedRevision !== undefined && revisionOf(current, reference) !== options.expectedRevision)
          return undefined
        const previous = current.file[reference]
        const next = ciphertext()
        const revision = randomUUID()
        if (next === undefined) {
          delete current.file[reference]
          current.revisions.delete(reference)
          current.absent = revision
        }
        else {
          current.file[reference] = next
          current.revisions.set(reference, revision)
        }
        current.file[metadataKey] = JSON.stringify({
          absent: current.absent,
          live: Object.fromEntries(current.revisions),
        })
        return await save(current.file, options?.signal) ? { previous, revision } : undefined
      }, options?.signal)
    }
    catch {
      // Errors from disk, the cipher or an abort may carry private data.
      return undefined
    }
  }

  function change(scope: string, key: string, value: string | undefined, options?: SecretChangeOptions) {
    if (scope.includes('\0') || key.includes('\0') || value === '')
      return Promise.resolve(undefined)
    return commit(encodeKey(scope, key), () => {
      if (value === undefined)
        return undefined
      if (!isAvailable())
        throw new Error('Credential storage unavailable')
      return ciphertextToBase64(encrypt(value))
    }, options)
  }

  function reveal(cipher: string | undefined) {
    return cipher && isAvailable() ? decrypt(Buffer.from(cipher, 'base64')) : undefined
  }

  return {
    changeSecret: async (scope, key, value, options) => {
      const result = await change(scope, key, value, options)
      if (!result)
        return undefined
      return {
        revision: result.revision,
        rollback: async () => Boolean(await commit(encodeKey(scope, key), () => result.previous, { expectedRevision: result.revision })),
      }
    },
    secretRevision: (scope, key) => revisionOf(state(), encodeKey(scope, key)),
    readSecretSnapshot: (scope, key) => {
      const current = state()
      const reference = encodeKey(scope, key)
      return { revision: revisionOf(current, reference), value: reveal(current.file[reference]) }
    },
    isEncryptionAvailable: () => isAvailable(),
    setSecret: async (scope, key, value, signal, revision) => {
      try {
        const expectedRevision = revision ?? revisionOf(state(), encodeKey(scope, key))
        return Boolean(await change(scope, key, value, { signal, expectedRevision }))
      }
      catch { return false }
    },
    getSecret: (scope, key) => reveal(load()[encodeKey(scope, key)]),
    hasSecret: (scope, key) => load()[encodeKey(scope, key)] !== undefined,
    deleteSecret: async (scope, key) => Boolean(await change(scope, key, undefined)),
  }
}
