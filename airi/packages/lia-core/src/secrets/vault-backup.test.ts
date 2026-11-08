import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import { createLiaSecretVault } from './vault'

describe('main opaque credential rollback', () => {
  it('never replaces a corrupt container while capturing or restoring an entry', async () => {
    let disk = '{}'
    const write = vi.fn(async () => {})
    const vault = createLiaSecretVault({ filePath: 'injected-storage', cipher: { available: () => true, encrypt: text => Buffer.from(text), decrypt: value => value.toString() }, read: () => disk, write })
    const restore = await vault.backupSecret!('service', 'apiKey')
    disk = '{broken'
    await expect(vault.backupSecret!('service', 'apiKey')).rejects.toThrow('Credential storage unavailable')
    await expect(restore()).rejects.toThrow('Credential storage unavailable')
    expect(write).not.toHaveBeenCalled()
  })
  it('restores unreadable ciphertext exactly and preserves another updated scope', async () => {
    const original = Buffer.from('ciphertext-from-another-profile').toString('base64')
    let disk = JSON.stringify({ 'service\0apiKey': original })
    const decrypt = vi.fn(() => {
      throw new Error('different profile')
    })
    const vault = createLiaSecretVault({
      filePath: 'unused-injected-storage',
      cipher: { available: () => true, encrypt: text => Buffer.from(`new-profile:${text}`), decrypt },
      read: () => disk,
      write: async (_, value) => { disk = value },
    })
    const restore = await vault.backupSecret!('service', 'apiKey')
    expect(await vault.setSecret('service', 'apiKey', 'explicit-replacement')).toBe(true)
    expect(await vault.setSecret('other-service', 'apiKey', 'other-value')).toBe(true)
    expect(await restore()).toBe(true)
    expect(JSON.parse(disk)['service\0apiKey']).toBe(original)
    expect(JSON.parse(disk)['other-service\0apiKey']).toBeDefined()
    expect(decrypt).not.toHaveBeenCalled()
  })
  it('restores absence without deleting sibling entries and reports write failure', async () => {
    let disk = '{}'
    let fail = false
    const vault = createLiaSecretVault({
      filePath: 'unused-injected-storage',
      cipher: { available: () => true, encrypt: text => Buffer.from(text), decrypt: value => value.toString() },
      read: () => disk,
      write: async (_, value) => {
        if (fail)
          throw new Error('write unavailable')
        disk = value
      },
    })
    const restore = await vault.backupSecret!('service', 'apiKey')
    await vault.setSecret('service', 'apiKey', 'replacement')
    await vault.setSecret('other-service', 'apiKey', 'sibling')
    fail = true
    expect(await restore()).toBe(false)
    expect(vault.hasSecret('service', 'apiKey')).toBe(true)
    fail = false
    expect(await restore()).toBe(true)
    expect(vault.hasSecret('service', 'apiKey')).toBe(false)
    expect(vault.getSecret('other-service', 'apiKey')).toBe('sibling')
  })
})
