import { Buffer } from 'node:buffer'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { createLiaSecretVault } from './vault'

function fixture(disk = '{}') {
  const write = vi.fn(async (_path: string, value: string) => {
    disk = value
  })
  const vault = createLiaSecretVault({
    filePath: 'injected-vault',
    read: () => disk,
    write,
    cipher: { available: () => true, encrypt: text => Buffer.from(text), decrypt: bytes => bytes.toString() },
  })
  return { vault, write, disk: () => disk }
}

describe('credential writes preserve the existing container', () => {
  it('cancels an in-flight guarded write before replacing the live file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'lia-vault-cancel-'))
    try {
      const filePath = join(directory, 'vault.json')
      const vault = createLiaSecretVault({ filePath, cipher: { available: () => true, encrypt: text => Buffer.from(text), decrypt: bytes => bytes.toString() } })
      expect(await vault.setSecret('internal', 'session', 'previous')).toBe(true)
      const previous = readFileSync(filePath, 'utf8')
      const cancellation = new AbortController()
      const pending = vault.setSecret('internal', 'session', 'cancelled', cancellation.signal)
      cancellation.abort()
      expect(await pending).toBe(false)
      expect(readFileSync(filePath, 'utf8')).toBe(previous)
      expect(readdirSync(directory)).toEqual(['vault.json'])
      expect(await vault.setSecret('internal', 'session', 'current', new AbortController().signal)).toBe(true)
      expect(vault.getSecret('internal', 'session')).toBe('current')
    }
    finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('cleans its encrypted temporary file when the atomic rename fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'lia-vault-atomic-'))
    try {
      const filePath = join(directory, 'occupied-directory')
      mkdirSync(filePath)
      const vault = createLiaSecretVault({ filePath, read: () => '{}', cipher: { available: () => true, encrypt: text => Buffer.from(text), decrypt: bytes => bytes.toString() } })
      expect(await vault.setSecret('new', 'apiKey', 'synthetic-value')).toBe(false)
      expect(readdirSync(directory)).toEqual(['occupied-directory'])
    }
    finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it.each(['{broken', '[]', 'null', '"text"', '{"existing":42}', ''])('refuses set/delete on malformed storage %# without changing bytes', async (raw) => {
    const { vault, write, disk } = fixture(raw)
    expect(await vault.setSecret('new', 'apiKey', 'synthetic-value')).toBe(false)
    expect(await vault.deleteSecret('existing', 'apiKey')).toBe(false)
    expect(write).not.toHaveBeenCalled()
    expect(disk()).toBe(raw)
  })

  it('does not treat access denial as a missing vault', async () => {
    const write = vi.fn(async (_path: string, _value: string) => {})
    const vault = createLiaSecretVault({ filePath: 'injected-vault', read: () => {
      throw Object.assign(new Error('unreadable'), { code: 'EACCES' })
    }, write, cipher: { available: () => true, encrypt: text => Buffer.from(text), decrypt: bytes => bytes.toString() } })
    expect(await vault.setSecret('new', 'apiKey', 'synthetic-value')).toBe(false)
    expect(await vault.deleteSecret('old', 'apiKey')).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('returns a fixed failure when the cipher rejects without exporting its error', async () => {
    const write = vi.fn(async (_path: string, _value: string) => {})
    const vault = createLiaSecretVault({ filePath: 'injected-vault', read: () => '{}', write, cipher: { available: () => true, encrypt: () => {
      throw new Error('SYNTHETIC_PRIVATE_SENTINEL')
    }, decrypt: bytes => bytes.toString() } })
    await expect(vault.setSecret('new', 'apiKey', 'synthetic-value')).resolves.toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('can create a genuinely missing vault', async () => {
    const write = vi.fn(async (_path: string, _value: string) => {})
    const vault = createLiaSecretVault({ filePath: 'injected-vault', read: () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    }, write, cipher: { available: () => true, encrypt: text => Buffer.from(text), decrypt: bytes => bytes.toString() } })
    expect(await vault.setSecret('new', 'apiKey', 'synthetic-value')).toBe(true)
    expect(write).toHaveBeenCalledOnce()
    expect(write.mock.calls[0][1]).not.toContain('synthetic-value')
  })
})
