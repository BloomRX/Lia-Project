import type { Buffer } from 'node:buffer'

import type { LiaSecretVault } from '@lia/core/secrets/vault'

import { join } from 'node:path'

import { createLiaSecretVault as createCoreVault } from '@lia/core/secrets/vault'
import { app, safeStorage } from 'electron'

/**
 * Migration shim (Phase 7): the vault implementation moved to Lia Core at
 * `@lia/core/secrets/vault`, which hosts no Electron import. This AIRI host
 * adapter preserves the established constructor signature (its tests included)
 * and wires the Electron `safeStorage` cipher into the core vault. Do not grow
 * new code here; new code belongs to Lia Core.
 */

interface SecretsDeps {
  /** Path to the ciphertext file (defaults to userData/lia-secrets.json). */
  filePath?: string
  /** Overridable disk reader for deterministic tests. */
  read?: (path: string) => string
  /** Overridable disk writer for deterministic tests. */
  write?: (path: string, data: string) => Promise<void>
  /**
   * Whether OS encryption is usable. Defaults to Electron `safeStorage`, but is
   * injectable so the vault honours exactly the capability it was given.
   */
  encryptionAvailable?: () => boolean
  /** Encrypts a plaintext secret. Defaults to Electron `safeStorage.encryptString`. */
  encrypt?: (value: string) => Buffer | Uint8Array | string
  /** Decrypts the stored ciphertext bytes. Defaults to Electron `safeStorage.decryptString`. */
  decrypt?: (payload: Buffer) => string
}

export function createLiaSecretVault(deps: SecretsDeps = {}): LiaSecretVault {
  return createCoreVault({
    cipher: {
      available: deps.encryptionAvailable ?? (() => safeStorage.isEncryptionAvailable()),
      decrypt: deps.decrypt ?? ((payload: Buffer) => safeStorage.decryptString(payload)),
      encrypt: deps.encrypt ?? ((value: string) => safeStorage.encryptString(value)),
    },
    filePath: deps.filePath ?? join(app.getPath('userData'), 'lia-secrets.json'),
    read: deps.read,
    write: deps.write,
  })
}

export type { LiaSecretVault } from '@lia/core/secrets/vault'

export { ciphertextToBase64 } from '@lia/core/secrets/vault'
