import { bindCredential } from '@lia/contracts/credentials/destination'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { oidcSessionScope, registerLiaSecretsBridge } from './secrets-service'

const handlers = vi.hoisted(() => new Map<string, (value: any) => any>())
vi.mock('@moeru/eventa', async original => ({
  ...await original<typeof import('@moeru/eventa')>(),
  defineInvokeHandler: (_context: unknown, event: { receiveEvent: { id: string } }, handler: (value: any) => any) => {
    handlers.set(event.receiveEvent.id, handler)
  },
}))
vi.mock('./secrets', () => ({ createLiaSecretVault: vi.fn() }))

function handler(name: string) {
  return handlers.get(`eventa:invoke:lia:secret:${name}-receive`)!
}
const trustedSender = () => true
function setup(allowRendererRead?: (scope: string) => Promise<boolean>, isAllowedSender: (event: any) => boolean = trustedSender) {
  const values = new Map<string, string>()
  const revisions = new Map<string, number>()
  const reference = (scope: string, key: string) => `${scope}:${key}`
  const vault = {
    isEncryptionAvailable: () => true,
    hasSecret: vi.fn((scope: string, key: string) => values.has(`${scope}:${key}`)),
    getSecret: vi.fn((scope: string, key: string) => values.get(`${scope}:${key}`)),
    setSecret: vi.fn(async (scope: string, key: string, value: string, _signal?: AbortSignal, expectedRevision?: string) => {
      if (expectedRevision !== undefined && expectedRevision !== String(revisions.get(reference(scope, key)) ?? 0))
        return false
      values.set(`${scope}:${key}`, value)
      revisions.set(reference(scope, key), (revisions.get(reference(scope, key)) ?? 0) + 1)
      return true
    }),
    deleteSecret: vi.fn(async (scope: string, key: string) => {
      values.delete(reference(scope, key))
      revisions.set(reference(scope, key), (revisions.get(reference(scope, key)) ?? 0) + 1)
      return true
    }),
    secretRevision: (scope: string, key: string) => String(revisions.get(reference(scope, key)) ?? 0),
  }
  registerLiaSecretsBridge({ context: {} as never, vault, allowRendererRead, isAllowedSender })
  return { vault, values }
}
beforeEach(() => handlers.clear())

describe('secret bridge ownership and migration', () => {
  it('keeps a destination-bound key off of generic get, set and adopt even for an unknown alias', async () => {
    const { vault, values } = setup(async () => true)
    const scope = 'custom-stt'
    const key = 'apiKey'
    const value = bindCredential(scope, new URL('https://speech.invalid'), 'synthetic-key')
    expect(await handler('set')({ scope, key, value })).toBe(false)
    expect(await handler('adopt')({ scope, key, value })).toBe('unavailable')
    expect(vault.setSecret).not.toHaveBeenCalled()
    values.set(`${scope}:${key}`, value)
    expect(await handler('get')({ scope, key })).toBeUndefined()
  })
  it('requires the dedicated speech configuration path to write speech credentials', async () => {
    const { vault } = setup()
    const input = { scope: 'openai-audio-speech', key: 'apiKey', value: 'synthetic-plain' }
    expect(await handler('set')(input)).toBe(false)
    expect(await handler('adopt')(input)).toBe('unavailable')
    expect(vault.setSecret).not.toHaveBeenCalled()
  })
  it.each(['session-v1', 'apiKey'])('blocks every Renderer vault operation for the OIDC scope (%s)', async (key) => {
    const allow = vi.fn(async () => true)
    const { vault, values } = setup(allow)
    const reference = { scope: oidcSessionScope, key }
    const slot = `${oidcSessionScope}:${key}`
    values.set(slot, 'SYNTHETIC_MAIN_ONLY')

    expect(await handler('get')(reference)).toBeUndefined()
    expect(await handler('has')(reference)).toBe(false)
    expect(await handler('set')({ ...reference, value: 'SYNTHETIC_REPLACEMENT' })).toBe(false)
    expect(await handler('adopt')({ ...reference, value: 'SYNTHETIC_MAIN_ONLY' })).toBe('unavailable')
    expect(await handler('delete')(reference)).toBe(false)
    expect(values.get(slot)).toBe('SYNTHETIC_MAIN_ONLY')
    expect(allow).not.toHaveBeenCalled()
    expect(vault.getSecret).not.toHaveBeenCalled()
    expect(vault.hasSecret).not.toHaveBeenCalled()
    expect(vault.setSecret).not.toHaveBeenCalled()
    expect(vault.deleteSecret).not.toHaveBeenCalled()
  })
  it('does not read or export a protected credential, even when present', async () => {
    const { vault, values } = setup()
    values.set('protected:apiKey', 'SYNTHETIC_PRIVATE_VALUE')
    expect(await handler('get')({ scope: 'protected', key: 'apiKey' })).toBeUndefined()
    expect(vault.getSecret).not.toHaveBeenCalled()
    expect(await handler('has')({ scope: 'protected', key: 'apiKey' })).toBe(true)
  })
  it('reads an explicitly permitted legacy credential through the existing policy', async () => {
    const { vault, values } = setup(async scope => scope === 'legacy')
    values.set('legacy:apiKey', 'SYNTHETIC_LEGACY_VALUE')
    expect(await handler('get')({ scope: 'legacy', key: 'apiKey' })).toBe('SYNTHETIC_LEGACY_VALUE')
    expect(vault.getSecret).toHaveBeenCalledExactlyOnceWith('legacy', 'apiKey')
  })
  it('fails closed when the authority check rejects, without disclosing the error', async () => {
    const { vault } = setup(async () => {
      throw new Error('SYNTHETIC_PRIVATE_VALUE')
    })
    expect(await handler('get')({ scope: 'protected', key: 'apiKey' })).toBeUndefined()
    expect(vault.getSecret).not.toHaveBeenCalled()
  })
  it('serializes import-if-missing with an explicit key update and preserves the new key', async () => {
    const { values } = setup()
    const reference = { scope: 'protected', key: 'apiKey' }
    const update = handler('set')({ ...reference, value: 'SYNTHETIC_NEW' })
    const staleImport = handler('set')({ ...reference, value: 'SYNTHETIC_OLD', onlyIfMissing: true })
    expect(await update).toBe(true)
    expect(await staleImport).toBe(false)
    expect(values.get('protected:apiKey')).toBe('SYNTHETIC_NEW')
  })

  it.each(['set', 'adopt'])('does not publish an enqueued %s after a different writer deletes its slot', async (operation) => {
    const { vault, values } = setup()
    let release!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const firstWrite = vault.setSecret.getMockImplementation()!
    let entered!: () => void
    const pendingWrite = new Promise<void>((resolve) => {
      entered = resolve
    })
    vault.setSecret.mockImplementationOnce(async (...args) => {
      entered()
      await hold
      return firstWrite(...args)
    })
    const holder = handler('set')({ scope: 'other', key: 'apiKey', value: 'unrelated' })
    await pendingWrite
    const stale = handler(operation)({ scope: 'protected', key: 'apiKey', value: 'SYNTHETIC_STALE' })
    await vault.deleteSecret('protected', 'apiKey')
    release()
    expect(await holder).toBe(true)
    expect(await stale).toBe(operation === 'set' ? false : 'conflict')
    expect(values.has('protected:apiKey')).toBe(false)
    expect(values.get('other:apiKey')).toBe('unrelated')
  })
  it('rejects oversized values, control characters and invalid references before vault access', async () => {
    const { vault } = setup()
    expect(await handler('set')({ scope: 'protected', key: 'apiKey', value: 'x'.repeat(16385) })).toBe(false)
    expect(await handler('get')({ scope: 'bad\u0000scope', key: 'apiKey' })).toBeUndefined()
    expect(await handler('delete')({ scope: 'x'.repeat(257), key: 'apiKey' })).toBe(false)
    expect(vault.setSecret).not.toHaveBeenCalled()
    expect(vault.getSecret).not.toHaveBeenCalled()
    expect(vault.deleteSecret).not.toHaveBeenCalled()
  })
})

describe('secret adoption (legacy plaintext folded into the vault)', () => {
  it('stores an absent secret and reports that the vault now holds it', async () => {
    const { values } = setup()
    expect(await handler('adopt')({ scope: 'protected', key: 'apiKey', value: 'SYNTHETIC_LEGACY' })).toBe('stored')
    expect(values.get('protected:apiKey')).toBe('SYNTHETIC_LEGACY')
  })

  it('reports a match without writing again, so a repeated launch is idempotent', async () => {
    const { vault, values } = setup()
    values.set('protected:apiKey', 'SYNTHETIC_LEGACY')
    expect(await handler('adopt')({ scope: 'protected', key: 'apiKey', value: 'SYNTHETIC_LEGACY' })).toBe('matching')
    expect(vault.setSecret).not.toHaveBeenCalled()
  })

  it('reports a conflict and leaves the newer stored value untouched', async () => {
    const { vault, values } = setup()
    values.set('protected:apiKey', 'SYNTHETIC_NEWER')
    expect(await handler('adopt')({ scope: 'protected', key: 'apiKey', value: 'SYNTHETIC_LEGACY' })).toBe('conflict')
    expect(values.get('protected:apiKey')).toBe('SYNTHETIC_NEWER')
    expect(vault.setSecret).not.toHaveBeenCalled()
  })

  it('reports unavailable instead of throwing when the payload is not a valid reference', async () => {
    const { vault } = setup()
    expect(await handler('adopt')({ scope: 'bad\u0000scope', key: 'apiKey', value: 'SYNTHETIC_LEGACY' })).toBe('unavailable')
    expect(await handler('adopt')({ scope: 'protected', key: 'apiKey', value: '' })).toBe('unavailable')
    expect(await handler('adopt')({ scope: 'protected', key: 'apiKey', value: 'x'.repeat(16385) })).toBe('unavailable')
    expect(vault.setSecret).not.toHaveBeenCalled()
    expect(vault.getSecret).not.toHaveBeenCalled()
  })

  it('never returns the stored value, only the verdict', async () => {
    const { values } = setup()
    values.set('protected:apiKey', 'SYNTHETIC_NEWER')
    const outcome = await handler('adopt')({ scope: 'protected', key: 'apiKey', value: 'SYNTHETIC_LEGACY' })
    expect(typeof outcome).toBe('string')
    expect(JSON.stringify(outcome)).not.toContain('SYNTHETIC_NEWER')
  })
})

describe('secret bridge sender policy', () => {
  // The policy is the only thing standing between "any renderer that loaded
  // the preload" and "the windows that legitimately own the vault". Every
  // denial must be observable as an answer, never as a vault call: a caption
  // window that can read `has` can map which providers the user configured,
  // and one that can `delete` can destroy them.
  it('denies every operation from an untrusted sender without touching the vault', async () => {
    const allow = vi.fn(async () => true)
    const { vault, values } = setup(allow, () => false)
    values.set('legacy:apiKey', 'SYNTHETIC_LEGACY_VALUE')

    const reference = { scope: 'legacy', key: 'apiKey' }
    expect(await handler('get')(reference)).toBeUndefined()
    expect(await handler('has')(reference)).toBe(false)
    expect(await handler('set')({ ...reference, value: 'SYNTHETIC_REPLACEMENT' })).toBe(false)
    expect(await handler('adopt')({ ...reference, value: 'SYNTHETIC_LEGACY_VALUE' })).toBe('unavailable')
    expect(await handler('delete')(reference)).toBe(false)
    expect(await handler('encryption-available')(undefined)).toBe(false)

    expect(vault.getSecret).not.toHaveBeenCalled()
    expect(vault.hasSecret).not.toHaveBeenCalled()
    expect(vault.setSecret).not.toHaveBeenCalled()
    expect(vault.deleteSecret).not.toHaveBeenCalled()
    expect(allow).not.toHaveBeenCalled()
    expect(values.get('legacy:apiKey')).toBe('SYNTHETIC_LEGACY_VALUE')
  })

  it('still serves the trusted sender after a denied one', async () => {
    let trusted = false
    const { values } = setup(async () => true, () => trusted)
    values.set('legacy:apiKey', 'SYNTHETIC_LEGACY_VALUE')

    expect(await handler('get')({ scope: 'legacy', key: 'apiKey' })).toBeUndefined()
    trusted = true
    expect(await handler('get')({ scope: 'legacy', key: 'apiKey' })).toBe('SYNTHETIC_LEGACY_VALUE')
  })

  it('fails closed when the policy itself throws', async () => {
    const { values } = setup(async () => true, () => {
      throw new Error('renderer gone')
    })
    values.set('legacy:apiKey', 'SYNTHETIC_LEGACY_VALUE')
    expect(await handler('get')({ scope: 'legacy', key: 'apiKey' })).toBeUndefined()
  })
})
