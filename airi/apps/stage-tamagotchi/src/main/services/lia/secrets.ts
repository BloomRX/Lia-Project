import type { Buffer } from 'node:buffer'

import type { LiaSecretVault } from '@lia/core/secrets/vault'

import process from 'node:process'

import { join } from 'node:path'

import { createLiaSecretVault as createCoreVault } from '@lia/core/secrets/vault'
import { app, safeStorage } from 'electron'

import { withCredentialOwner } from './credential-owner-access'

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
  write?: (path: string, data: string, signal?: AbortSignal) => Promise<void>
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
  return withCredentialOwner(createCoreVault({
    cipher: {
      available: deps.encryptionAvailable ?? (() => safeStorage.isEncryptionAvailable()),
      decrypt: deps.decrypt ?? ((payload: Buffer) => safeStorage.decryptString(payload)),
      encrypt: deps.encrypt ?? ((value: string) => safeStorage.encryptString(value)),
    },
    // `LIA_VAULT_FILE` é o contrato do produto: um cofre só, o mesmo arquivo que
    // o Launcher lê. Antes desta correção o Stage ignorava a variável e caía no
    // `userData` — funcionava por coincidência de caminho e quebrava assim que o
    // perfil do Stage fosse isolado.
    filePath: deps.filePath ?? (process.env.LIA_VAULT_FILE?.trim() || join(app.getPath('userData'), 'lia-secrets.json')),
    read: deps.read,
    write: deps.write,
  }))
}

export type { LiaSecretVault } from '@lia/core/secrets/vault'

export { ciphertextToBase64 } from '@lia/core/secrets/vault'
