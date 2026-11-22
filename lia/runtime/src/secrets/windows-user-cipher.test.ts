import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { execPath, platform } from 'node:process'

import { describe, expect, it, vi } from 'vitest'

import { createWindowsUserCipher } from './windows-user-cipher'

function fixture() {
  const keys = new Map<string, Buffer>()
  const protectKey = vi.fn((operation: 'Protect' | 'Unprotect', input: Buffer) => {
    if (operation === 'Protect') {
      const token = randomBytes(24)
      keys.set(token.toString('hex'), Buffer.from(input))
      return token
    }
    const key = keys.get(input.toString('hex'))
    if (!key)
      throw new Error('Invalid token')
    return Buffer.from(key)
  })
  const legacy = {
    available: () => true,
    encrypt: vi.fn(() => Buffer.from('legacy-encrypted')),
    decrypt: vi.fn(() => 'legacy-decrypted'),
  }
  return { legacy, protectKey, cipher: () => createWindowsUserCipher(legacy, { platform: 'win32', protectKey }) }
}

describe('the Windows vault cipher', () => {
  it('opens an entry from another instance without a profile key and uses unique nonces', () => {
    const { cipher, legacy, protectKey } = fixture()
    const writer = cipher()
    const reader = cipher()
    expect(writer.available()).toBe(true)
    const first = writer.encrypt('chave-sintética') as Buffer
    const second = writer.encrypt('chave-sintética') as Buffer
    expect(first.equals(second)).toBe(false)
    expect(first.includes(Buffer.from('chave-sintética'))).toBe(false)
    expect(reader.decrypt(first)).toBe('chave-sintética')
    expect(reader.decrypt(second)).toBe('chave-sintética')
    expect(protectKey.mock.calls.map(([operation]) => operation)).toEqual(['Protect', 'Unprotect'])
    expect(legacy.decrypt).not.toHaveBeenCalled()
  })

  it('authenticates ciphertext and rejects unknown versions without delegating to the old format', () => {
    const { cipher, legacy } = fixture()
    const reader = cipher()
    const entry = cipher().encrypt('synthetic') as Buffer
    entry[entry.length - 1] ^= 1
    expect(() => reader.decrypt(entry)).toThrow()
    expect(() => reader.decrypt(Buffer.from('LIA-WIN-VAULT/9\0'))).toThrow('Unsupported Windows credential format')
    expect(() => reader.decrypt(Buffer.from('LIA-WIN-VAULT/1\0'))).toThrow()
    expect(legacy.decrypt).not.toHaveBeenCalled()
  })

  it('keeps legacy entries readable in their original backend and rejects new writes when DPAPI fails', () => {
    const { legacy, protectKey, cipher } = fixture()
    const storage = cipher()
    expect(storage.decrypt(Buffer.from('legacy-encrypted'))).toBe('legacy-decrypted')
    protectKey.mockImplementation(() => {
      throw new Error('Protection unavailable')
    })
    expect(storage.available()).toBe(false)
    expect(() => storage.encrypt('synthetic')).toThrow()
    expect(legacy.encrypt).not.toHaveBeenCalled()
    expect(createWindowsUserCipher(legacy, { platform: 'linux' })).toBe(legacy)
  })

  it.skipIf(platform !== 'win32')('opens a real DPAPI entry in a separate process', () => {
    const { legacy } = fixture()
    const writer = createWindowsUserCipher(legacy)
    const secret = randomBytes(32).toString('hex')
    const entry = writer.encrypt(secret) as Buffer
    expect(entry.includes(Buffer.from(secret))).toBe(false)
    const digest = createHash('sha256').update(secret).digest('hex')
    const url = new URL('./windows-user-cipher.ts', import.meta.url).href
    const source = [
      `import { createWindowsUserCipher } from ${JSON.stringify(url)};`,
      'import { createHash } from \'node:crypto\';',
      'import { readFileSync } from \'node:fs\';',
      'const legacy = { available: () => false, encrypt: () => { throw new Error(\'Unexpected legacy write\') }, decrypt: () => { throw new Error(\'Unexpected legacy read\') } };',
      'const { entry, digest } = JSON.parse(readFileSync(0, \'utf8\'));',
      'const opened = createWindowsUserCipher(legacy).decrypt(Buffer.from(entry, \'base64\'));',
      'process.exitCode = createHash(\'sha256\').update(opened).digest(\'hex\') === digest ? 0 : 1;',
    ].join('\n')
    const child = spawnSync(execPath, ['--experimental-strip-types', '--input-type=module', '-e', source], {
      input: JSON.stringify({ entry: entry.toString('base64'), digest }),
      maxBuffer: 8192,
      timeout: 10000,
      windowsHide: true,
    })
    expect(child.status).toBe(0)
    expect(child.stdout.length).toBe(0)
  })
})
