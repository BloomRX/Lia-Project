import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The vault imports `electron` at module load (for `safeStorage`), so each test
 * rebuilds the module graph with a stubbed `electron` module, mirroring how the
 * config tests mock their own native/electron deps. Disk I/O is injected through
 * the vault's `deps` so these tests run on a plain Node runner.
 */

const CIPHER_MARK = 'ENC;'

/** Simulates a real OS keychain that yields ciphertext (never the plaintext). */
function mockSafeStorage() {
  return {
    isEncryptionAvailable: vi.fn(() => true),
    // Encrypt: produce a recognizable token that is NOT the plaintext. The real
    // safeStorage yields OS-managed ciphertext; this deterministic stand-in lets
    // the test prove we persist encryptString's output rather than the raw value.
    encryptString: vi.fn((value: string) => `${CIPHER_MARK}${Buffer.from(value, 'utf8').toString('base64')}`),
    decryptString: vi.fn((buffer: Buffer) => {
      const text = buffer.toString('utf8')
      if (!text.startsWith(CIPHER_MARK))
        throw new Error('bad ciphertext')
      return Buffer.from(text.slice(CIPHER_MARK.length), 'base64').toString('utf8')
    }),
  }
}

async function loadVault(fs: { disk: string }, { encryptionAvailable = true }: { encryptionAvailable?: boolean } = {}) {
  const safeStorage = mockSafeStorage()
  safeStorage.isEncryptionAvailable.mockReturnValue(encryptionAvailable)

  vi.doMock('electron', () => ({
    app: { getPath: vi.fn(() => '/tmp/user-data') },
    safeStorage,
  }))

  const write = async (_path: string, data: string) => {
    fs.disk = data
  }
  const read = () => fs.disk

  const { createLiaSecretVault } = await import('./secrets')
  const vault = createLiaSecretVault({
    filePath: '/tmp/user-data/lia-secrets.json',
    read,
    write,
  })
  // Base64-decode every stored value so we can inspect what was actually put on
  // disk (i.e. encryptString's output) without the transport base64 wrapper.
  const decodedDisk = () => {
    if (!fs.disk)
      return undefined
    const parsed = JSON.parse(fs.disk) as Record<string, string>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      out[k] = Buffer.from(v, 'base64').toString('utf8')
    }
    return out
  }
  return { vault, safeStorage, readDisk: () => fs.disk, decodedDisk }
}

describe('Lia secret vault', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('reports whether OS encryption is available', async () => {
    const ok = await loadVault({ disk: '' }, { encryptionAvailable: true })
    expect(ok.vault.isEncryptionAvailable()).toBe(true)
    const unavailable = await loadVault({ disk: '' }, { encryptionAvailable: false })
    expect(unavailable.vault.isEncryptionAvailable()).toBe(false)
  })

  it('stores a secret encrypted — never the plaintext on disk', async () => {
    const { vault, decodedDisk, readDisk } = await loadVault({ disk: '' })
    const stored = await vault.setSecret('openai', 'apiKey', 'sk-super-secret-123')
    expect(stored).toBe(true)

    const raw = readDisk()
    expect(raw).toBeTruthy()
    // Plaintext never appears anywhere in the persisted file.
    expect(raw).not.toContain('sk-super-secret-123')

    // What was written is encryptString's output (ciphertext), not the value.
    const decoded = decodedDisk()
    expect(decoded).toBeDefined()
    expect(Object.values(decoded!)[0]).toMatch(new RegExp(`^${CIPHER_MARK}`))
    expect(Object.values(decoded!)[0]).not.toContain('sk-super-secret-123')

    // Round-trips back through decryption on read.
    expect(vault.getSecret('openai', 'apiKey')).toBe('sk-super-secret-123')
    expect(vault.hasSecret('openai', 'apiKey')).toBe(true)
  })

  it('persists across vault instances (read re-opens the encrypted file)', async () => {
    const first = await loadVault({ disk: '' })
    await first.vault.setSecret('groq', 'apiKey', 'gsk-transient')

    // A fresh vault pointing at the same file decrypts the stored secret.
    const second = await loadVault({ disk: first.readDisk() })
    expect(second.vault.getSecret('groq', 'apiKey')).toBe('gsk-transient')
  })

  it('returns undefined / no overwrite when no secret exists for a scope:key', async () => {
    const { vault } = await loadVault({ disk: '' })
    expect(vault.getSecret('openai', 'missing')).toBeUndefined()
    expect(vault.hasSecret('openai', 'missing')).toBe(false)
  })

  it('never stores (and never returns) a secret when encryption is unavailable', async () => {
    const { vault, readDisk } = await loadVault({ disk: '' }, { encryptionAvailable: false })
    const stored = await vault.setSecret('openai', 'apiKey', 'secret')
    expect(stored).toBe(false)
    // Nothing persisted and reads yield nothing.
    expect(readDisk()).toBeFalsy()
    expect(vault.getSecret('openai', 'apiKey')).toBeUndefined()
  })

  it('keeps every stored secret out of plaintext on disk', async () => {
    const { vault, readDisk, decodedDisk } = await loadVault({ disk: '' })
    await vault.setSecret('cerebras', 'apiKey', 'bearer-AAAA')
    await vault.setSecret('openai', 'apiKey', 'sk-second')
    const raw = readDisk()
    expect(raw).not.toContain('bearer-AAAA')
    expect(raw).not.toContain('sk-second')
    for (const value of Object.values(decodedDisk() ?? {})) {
      expect(value).not.toContain('bearer-AAAA')
      expect(value).not.toContain('sk-second')
      expect(value.startsWith(CIPHER_MARK)).toBe(true)
    }
    expect(vault.getSecret('cerebras', 'apiKey')).toBe('bearer-AAAA')
    expect(vault.getSecret('openai', 'apiKey')).toBe('sk-second')
  })

  it('deletes a stored secret and rewrites the file without it', async () => {
    const { vault, decodedDisk } = await loadVault({ disk: '' })
    await vault.setSecret('ollama', 'apiKey', 'ollama-secret')
    expect(vault.hasSecret('ollama', 'apiKey')).toBe(true)

    const removed = await vault.deleteSecret('ollama', 'apiKey')
    expect(removed).toBe(true)
    expect(vault.hasSecret('ollama', 'apiKey')).toBe(false)
    expect(vault.getSecret('ollama', 'apiKey')).toBeUndefined()
    expect(Object.keys(decodedDisk() ?? {})).not.toContain('ollama\0apiKey')
  })

  it('deleting an absent secret is a no-op success', async () => {
    const { vault } = await loadVault({ disk: '' })
    await expect(vault.deleteSecret('x', 'y')).resolves.toBe(true)
  })
})
