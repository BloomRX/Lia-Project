import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { safeDestr } from 'destr'
import { app, safeStorage } from 'electron'

/**
 * Lia secret vault (M1 Phase 4C).
 *
 * API keys / bearer tokens that the Lia product configures must NEVER live in
 * renderer localStorage nor in `lia/product.json`. This vault stores secrets in
 * the Electron **main** process, encrypted with `safeStorage`, on disk as
 * base64 ciphertext under `userData/lia-secrets.json`. Plaintext is never
 * written to disk and never returned to the renderer for persistence.
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

const encodeKey = (scope: string, key: string): string => `${scope}\u0000${key}`

export interface LiaSecretVault {
  isEncryptionAvailable: () => boolean
  setSecret: (scope: string, key: string, value: string) => Promise<boolean>
  getSecret: (scope: string, key: string) => string | undefined
  hasSecret: (scope: string, key: string) => boolean
  deleteSecret: (scope: string, key: string) => Promise<boolean>
}

interface SecretsDeps {
  /** Path to the ciphertext file (defaults to userData/lia-secrets.json). */
  filePath?: string
  /** Overridable disk reader for deterministic tests. */
  read?: (path: string) => string
  /** Overridable disk writer for deterministic tests. */
  write?: (path: string, data: string) => Promise<void>
  /**
   * Whether OS encryption is usable. Defaults to Electron `safeStorage`, but is
   * injectable so the vault honours exactly the capability it was given (a
   * vault constructed without a usable keychain must never store anything).
   */
  encryptionAvailable?: () => boolean
  /**
   * Encrypts a plaintext secret. Defaults to Electron
   * `safeStorage.encryptString` (a `Buffer`). Alternate implementations may
   * return a string; the result is always normalized to the ciphertext bytes
   * before base64 is persisted.
   */
  encrypt?: (value: string) => Buffer | Uint8Array | string
  /** Decrypts the stored ciphertext bytes. Defaults to Electron `safeStorage.decryptString`. */
  decrypt?: (payload: Buffer) => string
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
function ciphertextToBase64(encrypted: Buffer | Uint8Array | string): string {
  const bytes = typeof encrypted === 'string' ? Buffer.from(encrypted, 'utf8') : Buffer.from(encrypted)
  return bytes.toString('base64')
}

export function createLiaSecretVault(deps: SecretsDeps = {}): LiaSecretVault {
  const path = deps.filePath ?? join(app.getPath('userData'), 'lia-secrets.json')
  const read = deps.read ?? ((p: string) => readFileSync(p, 'utf8'))
  const write = deps.write ?? (async (p: string, data: string) => {
    await mkdir(dirname(p), { recursive: true })
    const tmp = `${p}.${randomUUID()}.tmp`
    await writeFile(tmp, data)
    await rename(tmp, p)
  })

  // Encryption capabilities are injected when provided and otherwise fall back
  // to Electron's safeStorage. The vault therefore uses exactly the
  // availability/encrypt/decrypt it was constructed with — never an implicit
  // real keychain when the caller supplied its own.
  const isAvailable = deps.encryptionAvailable ?? (() => safeStorage.isEncryptionAvailable())
  const encrypt = deps.encrypt ?? ((value: string) => safeStorage.encryptString(value))
  const decrypt = deps.decrypt ?? ((payload: Buffer) => safeStorage.decryptString(payload))

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
      // A missing or corrupted/legacy file must not brick the app. Treat as
      // empty; the next successful write recreates it. No secret material is
      // lost that we can read anyway, and we never log file contents.
      return {}
    }
  }

  const save = async (file: VaultFile): Promise<boolean> => {
    try {
      await write(path, JSON.stringify(file))
      return true
    }
    catch {
      return false
    }
  }

  return {
    isEncryptionAvailable: () => isAvailable(),
    setSecret: async (scope, key, value) => {
      if (!isAvailable() || value.length === 0)
        return false
      const file = load()
      file[encodeKey(scope, key)] = ciphertextToBase64(encrypt(value))
      return save(file)
    },
    getSecret: (scope, key) => {
      const file = load()
      const cipher = file[encodeKey(scope, key)]
      if (!cipher)
        return undefined
      if (!isAvailable())
        return undefined
      return decrypt(Buffer.from(cipher, 'base64'))
    },
    hasSecret: (scope, key) => load()[encodeKey(scope, key)] !== undefined,
    deleteSecret: async (scope, key) => {
      const file = load()
      if (!(encodeKey(scope, key) in file))
        return true
      delete file[encodeKey(scope, key)]
      return save(file)
    },
  }
}
