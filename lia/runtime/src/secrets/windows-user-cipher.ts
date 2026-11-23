import type { LiaSecretCipher } from './vault'

import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { env, platform } from 'node:process'

const marker = Buffer.from('LIA-WIN-VAULT/1\0')
const family = Buffer.from('LIA-WIN-VAULT/')
const wrappedKeyLimit = 4096
const keyBytes = 32
const nonceBytes = 12
const tagBytes = 16

type ProtectKey = (command: 'Protect' | 'Unprotect', input: Buffer) => Buffer

function windowsDpapi(command: 'Protect' | 'Unprotect', input: Buffer): Buffer {
  const windowsDirectory = env.SystemRoot
  if (!windowsDirectory || !isAbsolute(windowsDirectory))
    throw new Error('Windows credential protection is unavailable')
  const system = join(windowsDirectory, 'System32')
  // Keep module autoload out of the restricted PowerShell environment.
  const script = [
    '$ErrorActionPreference = \'Stop\'',
    '$dpapi = [Type]::GetType("System.Security.Cryptography.ProtectedData, System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a", $true)',
    '$inputBytes = [IO.MemoryStream]::new()',
    '[Console]::OpenStandardInput().CopyTo($inputBytes)',
    '$entropy = [Text.Encoding]::UTF8.GetBytes(\'Lia vault key v1\')',
    `$result = $dpapi::${command}($inputBytes.ToArray(), $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    '[Console]::OpenStandardOutput().Write($result, 0, $result.Length)',
  ].join('\n')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const child = spawnSync(join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    encoded,
  ], {
    cwd: system,
    env: { SystemRoot: windowsDirectory, WINDIR: windowsDirectory },
    input,
    maxBuffer: 16384,
    timeout: 5000,
    windowsHide: true,
  })
  if (child.error || child.status !== 0 || !child.stdout?.length)
    throw new Error('Windows credential protection failed')
  return child.stdout
}

/**
 * Same Windows user, independent Chromium profiles. Each entry carries the
 * DPAPI-wrapped AES key. A process keeps at most its writer key and one reader
 * key in memory, so reopening a connection does not spawn a process per read.
 */
export function createWindowsUserCipher(
  legacy: LiaSecretCipher,
  options: { protectKey?: ProtectKey, platform?: NodeJS.Platform } = {},
): LiaSecretCipher {
  if ((options.platform ?? platform) !== 'win32')
    return legacy
  const protectKey = options.protectKey ?? windowsDpapi
  let writer: { key: Buffer, wrapped: Buffer } | undefined
  let reader: { key: Buffer, wrapped: Buffer } | undefined

  function writerKey() {
    if (!writer) {
      const key = randomBytes(keyBytes)
      try {
        const wrapped = protectKey('Protect', key)
        if (!wrapped.length || wrapped.length > wrappedKeyLimit)
          throw new Error('Invalid protected vault key')
        writer = { key, wrapped }
      }
      catch (error) {
        key.fill(0)
        throw error
      }
    }
    return writer
  }

  function readerKey(wrapped: Buffer) {
    if (writer?.wrapped.equals(wrapped))
      return writer.key
    if (reader?.wrapped.equals(wrapped))
      return reader.key
    const key = protectKey('Unprotect', wrapped)
    if (key.length !== keyBytes) {
      key.fill(0)
      throw new Error('Invalid vault key')
    }
    reader?.key.fill(0)
    reader = { key, wrapped: Buffer.from(wrapped) }
    return key
  }

  return {
    available() {
      try {
        writerKey()
        return true
      }
      catch {
        return false
      }
    },
    encrypt(value) {
      const { key, wrapped } = writerKey()
      const header = Buffer.alloc(marker.length + 4)
      marker.copy(header)
      header.writeUInt32BE(wrapped.length, marker.length)
      const nonce = randomBytes(nonceBytes)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      cipher.setAAD(Buffer.concat([header, wrapped]))
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([header, wrapped, nonce, cipher.getAuthTag(), encrypted])
    },
    decrypt(payload) {
      if (!payload.subarray(0, family.length).equals(family))
        return legacy.decrypt(payload)
      const headerSize = marker.length + 4
      if (payload.length < headerSize || !payload.subarray(0, marker.length).equals(marker))
        throw new Error('Unsupported Windows credential format')
      const wrappedSize = payload.readUInt32BE(marker.length)
      const wrappedEnd = headerSize + wrappedSize
      const nonceEnd = wrappedEnd + nonceBytes
      const tagEnd = nonceEnd + tagBytes
      if (!wrappedSize || wrappedSize > wrappedKeyLimit || tagEnd > payload.length)
        throw new Error('Invalid Windows credential format')
      const decipher = createDecipheriv('aes-256-gcm', readerKey(payload.subarray(headerSize, wrappedEnd)), payload.subarray(wrappedEnd, nonceEnd))
      decipher.setAAD(payload.subarray(0, wrappedEnd))
      decipher.setAuthTag(payload.subarray(nonceEnd, tagEnd))
      const plaintext = decipher.update(payload.subarray(tagEnd))
      try {
        return Buffer.concat([plaintext, decipher.final()]).toString('utf8')
      }
      finally {
        plaintext.fill(0)
      }
    },
  }
}
