import type { TransportMutation, TransportResult, TransportSnapshot } from '@lia/contracts/transports'
import type { LiaSecretVault } from '@lia/core/secrets/vault'

import { bindCredential } from '@lia/contracts/credentials/destination'
import { describe, expect, it, vi } from 'vitest'

import { createSpeechConfigService } from './speech-config-service'

const providerId = 'openai-compatible-audio-speech'
const baseUrl = 'https://fixture.invalid/v1'
const apiKey = 'synthetic-fixture-key'

function fixture() {
  let snapshot: TransportSnapshot = { schemaVersion: 1, revision: 0, records: [], tombstones: [], migration: { version: 1, imported: [] } }
  let secret: string | undefined
  let keyRevision = 0
  const repository = {
    read: vi.fn(async () => structuredClone(snapshot)),
    mutate: vi.fn(async (mutation: TransportMutation): Promise<TransportResult> => {
      if (mutation.expectedRevision !== snapshot.revision || mutation.kind !== 'put')
        return { ok: false, code: 'conflict' }
      snapshot = { ...snapshot, revision: snapshot.revision + 1, records: [mutation.record] }
      return { ok: true, snapshot }
    }),
  }
  const vault = {
    secretRevision: () => String(keyRevision),
    hasSecret: () => secret !== undefined,
    getSecret: () => secret,
    setSecret: vi.fn(async (_scope: string, _key: string, value: string) => {
      secret = value
      keyRevision++
      return true
    }),
    deleteSecret: vi.fn(async () => {
      secret = undefined
      keyRevision++
      return true
    }),
    async changeSecret(scope: string, key: string, value: string | undefined, options: { expectedRevision?: string } = {}) {
      if (options.expectedRevision !== undefined && options.expectedRevision !== String(keyRevision))
        return undefined
      const previous = secret
      if (value === undefined)
        await vault.deleteSecret()
      else
        await vault.setSecret(scope, key, value)
      const revision = String(keyRevision)
      return { revision, rollback: async () => {
        if (revision !== String(keyRevision))
          return false
        if (previous === undefined)
          await vault.deleteSecret()
        else
          await vault.setSecret(scope, key, previous)
        return true
      } }
    },
  }
  const invalidate = vi.fn()
  return { repository, vault, invalidate, service: createSpeechConfigService(repository, vault as unknown as LiaSecretVault, invalidate) }
}

describe('speech connection configuration', () => {
  it('preserves an orphan key without adopting it for a newly supplied endpoint', async () => {
    const { service, vault, repository } = fixture()
    await vault.setSecret(providerId, 'apiKey', apiKey)
    expect(await service.save({ providerId, baseUrl, revision: 0 })).toEqual({ ok: false, code: 'credentials' })
    expect(repository.mutate).not.toHaveBeenCalled()
    expect(vault.getSecret()).toBe(apiKey)
    expect(vault.setSecret).toHaveBeenCalledTimes(1)
  })
  it('does not request a nonexistent previous credential during first configuration', async () => {
    const { service, vault } = fixture()
    const read = vi.spyOn(vault, 'getSecret').mockImplementation(() => {
      throw new Error('no transport reference yet')
    })
    expect(await service.save({ providerId, baseUrl, revision: 0, apiKey })).toMatchObject({ ok: true })
    expect(read).not.toHaveBeenCalled()
  })
  it('saves only the endpoint as metadata and keeps the key on endpoint-only updates', async () => {
    const { service, vault, repository, invalidate } = fixture()
    expect(await service.save({ providerId, baseUrl, revision: 0, apiKey })).toEqual({
      ok: true,
      config: { baseUrl: `${baseUrl}/`, hasKey: true, revision: 1 },
    })
    expect(await service.save({ providerId, baseUrl: `${baseUrl}/custom`, revision: 1 })).toMatchObject({ ok: true })
    expect(vault.setSecret).toHaveBeenCalledExactlyOnceWith(providerId, 'apiKey', bindCredential(providerId, new URL(baseUrl), apiKey))
    expect(JSON.stringify(await repository.read())).not.toContain(apiKey)
    expect(await service.read({ providerId })).toEqual({ ok: true, config: { baseUrl: `${baseUrl}/custom/`, hasKey: true, revision: 2 } })
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('keeps the original bound speech entries that predate the purpose field', async () => {
    const { service, vault } = fixture()
    expect(await service.save({ providerId, baseUrl, revision: 0, apiKey })).toMatchObject({ ok: true })
    await vault.setSecret(providerId, 'apiKey', JSON.stringify({ version: 1, scope: providerId, origin: new URL(baseUrl).origin, apiKey }))
    expect(await service.read({ providerId })).toMatchObject({ ok: true, config: { hasKey: true } })
    expect(await service.save({ providerId, baseUrl: `${baseUrl}/custom`, revision: 1 })).toMatchObject({ ok: true })
  })

  it('requires entering a key again to change origin, including the TLS port', async () => {
    const { service, repository } = fixture()
    expect(await service.save({ providerId, baseUrl, revision: 0, apiKey })).toMatchObject({ ok: true })
    const other = 'https://fixture.invalid:444/v1'
    expect(await service.save({ providerId, baseUrl: other, revision: 1 })).toEqual({ ok: false, code: 'credentials' })
    expect((await repository.read()).records[0].baseUrl).toBe(`${baseUrl}/`)
    expect(await service.save({ providerId, baseUrl: other, revision: 1, apiKey })).toMatchObject({ ok: true, config: { hasKey: true } })
  })

  it('rejects unsafe destinations, other scopes, stale writes and invalid headers before touching the vault', async () => {
    const { service, vault, repository } = fixture()
    for (const change of [{ baseUrl: 'http://fixture.invalid/v1' }, { baseUrl: `${baseUrl}?token=hidden` }, { providerId: 'unknown' }, { apiKey: 'line\nbreak' }]) {
      expect(await service.save({ providerId, baseUrl, revision: 0, apiKey, ...change })).toEqual({ ok: false, code: 'invalid' })
    }
    expect(await service.save({ providerId, baseUrl, revision: 1, apiKey })).toEqual({ ok: false, code: 'conflict' })
    expect(await service.save({ providerId, baseUrl, revision: 0 })).toEqual({ ok: false, code: 'credentials' })
    expect(vault.setSecret).not.toHaveBeenCalled()
    expect(repository.mutate).not.toHaveBeenCalled()
  })

  it('restores the previous key when the endpoint write fails', async () => {
    const { service, vault, repository } = fixture()
    await service.save({ providerId, baseUrl, revision: 0, apiKey })
    repository.mutate.mockResolvedValueOnce({ ok: false, code: 'conflict' })
    expect(await service.save({ providerId, baseUrl: `${baseUrl}/new`, revision: 1, apiKey: 'replacement' })).toEqual({ ok: false, code: 'conflict' })
    expect(vault.getSecret()).toBe(bindCredential(providerId, new URL(baseUrl), apiKey))
    expect(await service.read({ providerId })).toMatchObject({ config: { baseUrl: `${baseUrl}/`, revision: 1 } })
  })

  it('does not restore a key deleted while the endpoint update is pending', async () => {
    const { service, vault, repository } = fixture()
    await service.save({ providerId, baseUrl, revision: 0, apiKey })
    repository.mutate.mockImplementationOnce(async () => {
      await vault.deleteSecret()
      return { ok: false, code: 'conflict' }
    })
    expect(await service.save({ providerId, baseUrl: `${baseUrl}/new`, revision: 1, apiKey: 'replacement' })).toEqual({ ok: false, code: 'storage' })
    expect(vault.getSecret()).toBeUndefined()
  })
})
