import type { LiaSecretVault } from '@lia/core/secrets/vault'

import type { TransportMutation, TransportResult, TransportSnapshot } from '../../../../../../../lia/core/src/transports/contracts'

import { describe, expect, it, vi } from 'vitest'

import { createSpeechConfigService } from './speech-config-service'

const providerId = 'openai-compatible-audio-speech'
const baseUrl = 'https://fixture.invalid/v1'
const apiKey = 'synthetic-fixture-key'

function fixture() {
  let snapshot: TransportSnapshot = { schemaVersion: 1, revision: 0, records: [], tombstones: [], migration: { version: 1, imported: [] } }
  let secret: string | undefined
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
    hasSecret: () => secret !== undefined,
    getSecret: () => secret,
    setSecret: vi.fn(async (_scope: string, _key: string, value: string) => {
      secret = value
      return true
    }),
    deleteSecret: vi.fn(async () => {
      secret = undefined
      return true
    }),
  }
  const invalidate = vi.fn()
  return { repository, vault, invalidate, service: createSpeechConfigService(repository, vault as unknown as LiaSecretVault, invalidate) }
}

describe('speech connection configuration', () => {
  it('saves only the endpoint as metadata and keeps the key on endpoint-only updates', async () => {
    const { service, vault, repository, invalidate } = fixture()
    expect(await service.save({ providerId, baseUrl, revision: 0, apiKey })).toEqual({
      ok: true,
      config: { baseUrl: `${baseUrl}/`, hasKey: true, revision: 1 },
    })
    expect(await service.save({ providerId, baseUrl: `${baseUrl}/custom`, revision: 1 })).toMatchObject({ ok: true })
    expect(vault.setSecret).toHaveBeenCalledExactlyOnceWith(providerId, 'apiKey', apiKey)
    expect(JSON.stringify(await repository.read())).not.toContain(apiKey)
    expect(await service.read({ providerId })).toEqual({ ok: true, config: { baseUrl: `${baseUrl}/custom/`, hasKey: true, revision: 2 } })
    expect(invalidate).toHaveBeenCalledTimes(2)
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
    expect(vault.getSecret()).toBe(apiKey)
    expect(await service.read({ providerId })).toMatchObject({ config: { baseUrl: `${baseUrl}/`, revision: 1 } })
  })
})
