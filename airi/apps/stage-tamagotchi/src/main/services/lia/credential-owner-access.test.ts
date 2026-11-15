import type { LiaSecretVault } from '@lia/core/secrets/vault'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CredentialOwnerError, startCredentialOwner } from '../../../../../../../lia/core/src/credentials/owner-channel'
import { initializeCredentialOwner, resolveMainCredential, withCredentialOwner } from './credential-owner-access'

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  close = undefined
  initializeCredentialOwner({})
})
function localVault(): LiaSecretVault {
  return {
    isEncryptionAvailable: () => true,
    hasSecret: () => true,
    getSecret: vi.fn(() => { throw new Error('different profile') }),
    setSecret: vi.fn(async () => true),
    deleteSecret: vi.fn(async () => true),
    secretRevision: () => 'legacy',
  }
}
async function connect(handle: Parameters<typeof startCredentialOwner>[0]['handle']) {
  const lease = await startCredentialOwner({ handle })
  close = lease.close
  const environment = { ...lease.environment }
  initializeCredentialOwner(environment)
  expect(environment).toEqual({})
}
describe('main credential owner access', () => {
  it('uses the original Main owner across profiles and reads rotated credentials without caching', async () => {
    let credential = 'synthetic-first'
    await connect(async () => credential)
    const local = localVault()
    const vault = withCredentialOwner(local)
    expect(await resolveMainCredential(vault, 'configured-service', 'apiKey')).toBe('synthetic-first')
    credential = 'synthetic-second'
    expect(await resolveMainCredential(vault, 'configured-service', 'apiKey')).toBe('synthetic-second')
    expect(local.getSecret).not.toHaveBeenCalled()
  })
  it('preserves a readable old Stage entry only when the owner reports unreadable ciphertext', async () => {
    await connect(async () => {
      throw new CredentialOwnerError('unreadable')
    })
    const local = localVault()
    vi.mocked(local.getSecret).mockReturnValue('old-stage-entry')
    expect(await resolveMainCredential(withCredentialOwner(local), 'configured-service', 'apiKey')).toBe('old-stage-entry')
    expect(local.setSecret).not.toHaveBeenCalled()
  })
  it('fails closed on denial/disconnect rather than falling back to a stale local key', async () => {
    await connect(async () => {
      throw new CredentialOwnerError('denied')
    })
    const local = localVault()
    vi.mocked(local.getSecret).mockReturnValue('stale-entry')
    const vault = withCredentialOwner(local)
    await expect(resolveMainCredential(vault, 'other-service', 'apiKey')).rejects.toMatchObject({ code: 'credentials' })
    await close!()
    await expect(resolveMainCredential(vault, 'configured-service', 'apiKey')).rejects.toMatchObject({ code: 'credentials' })
    expect(local.getSecret).not.toHaveBeenCalled()
  })
  it('routes explicit writes and deletion to the owner without using the Stage cipher', async () => {
    const handle = vi.fn<Parameters<typeof startCredentialOwner>[0]['handle']>(async request => request.operation === 'change' ? 'new-revision' : true)
    await connect(handle)
    const local = localVault()
    const vault = withCredentialOwner(local)
    expect(await vault.setSecret('new-service', 'apiKey', 'synthetic-key')).toBe(true)
    expect(await vault.deleteSecret('new-service', 'apiKey')).toBe(true)
    expect(handle.mock.calls.map(([request]) => request.operation)).toEqual(['change', 'delete'])
    expect(local.setSecret).not.toHaveBeenCalled()
    expect(local.deleteSecret).not.toHaveBeenCalled()
  })
  it('does not resolve or fall back after cancellation', async () => {
    await connect(async () => 'synthetic-key')
    const local = localVault()
    const abort = new AbortController()
    abort.abort()
    await expect(resolveMainCredential(withCredentialOwner(local), 'configured-service', 'apiKey', abort.signal)).rejects.toMatchObject({ code: 'cancelled' })
    expect(local.getSecret).not.toHaveBeenCalled()
  })

  it('uses the revision captured by the caller to replace an orphan key without reading it', async () => {
    const handle = vi.fn<Parameters<typeof startCredentialOwner>[0]['handle']>(async (request) => {
      if (request.operation === 'get')
        throw new CredentialOwnerError('denied')
      return request.expectedRevision === 'captured' ? 'written' : undefined
    })
    await connect(handle)
    const local = localVault()
    const vault = withCredentialOwner(local)
    expect(await vault.setSecret('orphan', 'apiKey', 'synthetic-key', undefined, 'captured')).toBe(true)
    expect(handle.mock.calls.map(([request]) => request)).toEqual([
      { operation: 'change', scope: 'orphan', key: 'apiKey', value: 'synthetic-key', expectedRevision: 'captured' },
    ])
    expect(local.getSecret).not.toHaveBeenCalled()
  })

  it('uses the owner revision to prevent rollback after a newer deletion', async () => {
    let revision = 'first'
    let value: string | undefined = 'synthetic-old'
    const handle = vi.fn<Parameters<typeof startCredentialOwner>[0]['handle']>(async (request) => {
      if (request.operation === 'get')
        return value
      if (request.operation !== 'change' || request.expectedRevision !== revision)
        return undefined
      value = request.value
      revision = 'second'
      return revision
    })
    await connect(handle)
    const local = localVault()
    local.secretRevision = () => 'first'
    const vault = withCredentialOwner(local)
    const change = await vault.changeSecret!('configured-service', 'apiKey', 'synthetic-new')
    expect(change?.revision).toBe('second')
    revision = 'deleted'
    value = undefined
    expect(await change!.rollback()).toBe(false)
    expect(await change!.rollback()).toBe(false)
    expect(value).toBeUndefined()
    expect(handle.mock.calls.at(-1)?.[0]).toEqual({ operation: 'change', scope: 'configured-service', key: 'apiKey', expectedRevision: 'second', value: 'synthetic-old' })
    expect(local.setSecret).not.toHaveBeenCalled()
  })
})
