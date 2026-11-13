import type { AiriStageManager, AiriStageState } from './airi-stage-manager'

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createCredentialOwnerClient, startCredentialOwner } from '../../../../../lia/core/src/credentials/owner-channel'
import { createTransportRepository } from '../../../../../lia/core/src/transports/repository'
import { createLiaHost } from './lia-host'
import { fixtureEnv, identityCipher, makeLiaHome } from './test-helpers'

const disk = vi.hoisted(() => ({ values: new Map<string, string>(), revisions: new Map<string, number>(), pending: undefined as Promise<void> | undefined, failPublish: false }))
vi.mock('../../../../../lia/core/src/transports/repository', async (original) => {
  const actual = await original<typeof import('../../../../../lia/core/src/transports/repository')>()
  return { ...actual, createTransportRepository: (path: string) => {
    const repository = actual.createTransportRepository(path)
    return { ...repository, mutate: async (mutation: Parameters<typeof repository.mutate>[0]) => {
      if (disk.failPublish && mutation.kind === 'put' && mutation.record.enabled) {
        disk.failPublish = false
        return { ok: false as const, code: 'storage' as const }
      }
      return repository.mutate(mutation)
    } }
  } }
})
vi.mock('@lia/core/secrets/vault', () => ({
  createLiaSecretVault: () => ({
    isEncryptionAvailable: () => true,
    hasSecret: (scope: string) => disk.values.has(scope),
    secretRevision: (scope: string) => String(disk.revisions.get(scope) ?? 0),
    getSecret: (scope: string) => disk.values.get(scope),
    setSecret: async (scope: string, _key: string, value: string) => {
      if (scope === 'holding-write')
        await disk.pending
      disk.values.set(scope, value)
      disk.revisions.set(scope, (disk.revisions.get(scope) ?? 0) + 1)
      return true
    },
    deleteSecret: async (scope: string) => {
      disk.values.delete(scope)
      disk.revisions.set(scope, (disk.revisions.get(scope) ?? 0) + 1)
      return true
    },
    changeSecret: async (scope: string, _key: string, value: string | undefined, options: { expectedRevision?: string, signal?: AbortSignal } = {}) => {
      if (scope === 'holding-write')
        await disk.pending
      const before = String(disk.revisions.get(scope) ?? 0)
      if (options.signal?.aborted || (options.expectedRevision !== undefined && options.expectedRevision !== before))
        return undefined
      const previous = disk.values.get(scope)
      if (value === undefined)
        disk.values.delete(scope)
      else
        disk.values.set(scope, value)
      const revision = Number(before) + 1
      disk.revisions.set(scope, revision)
      return { revision: String(revision), rollback: async () => {
        if (disk.revisions.get(scope) !== revision)
          return false
        if (previous === undefined)
          disk.values.delete(scope)
        else
          disk.values.set(scope, previous)
        disk.revisions.set(scope, revision + 1)
        return true
      } }
    },
  }),
}))
beforeEach(() => {
  disk.values.clear()
  disk.revisions.clear()
  disk.pending = undefined
  disk.failPublish = false
})
async function fixture(onRequest?: () => void, collideProfiles = false) {
  const home = await makeLiaHome()
  let environment: Record<string, string | undefined> = {}
  let state: AiriStageState = { phase: 'stopped', logTail: [] }
  const host = createLiaHost({
    cipher: identityCipher,
    env: fixtureEnv(home),
    enableCredentialOwner: true,
    launcherChromiumProfile: collideProfiles ? home.userData : undefined,
    credentialOwnerFactory: options => startCredentialOwner({ handle: (request, signal) => {
      onRequest?.()
      return options.handle(request, signal)
    } }),
    stageManagerFactory: deps => ({
      holdsOwnedStage: () => state.phase === 'running',
      state: () => state,
      start: async (options: { env?: Record<string, string | undefined> }) => {
        if (state.phase !== 'running') {
          environment = options.env ?? {}
          state = { phase: 'running', logTail: [] }
          deps.onState?.(state)
        }
        return state
      },
      stop: async () => {
        state = { phase: 'stopped', logTail: [] }
        deps.onState?.(state)
      },
    }) as unknown as AiriStageManager,
  })
  return { host, home, environment: () => environment }
}
describe('launcher Main credential lease', () => {
  it('rejects an already queued wrapper write after another writer deletes the entry', async () => {
    const f = await fixture()
    let release!: () => void
    disk.pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const holding = f.host.vault.setSecret('holding-write', 'apiKey', 'synthetic-hold')
    const stale = f.host.vault.setSecret('stale-write', 'apiKey', 'synthetic-stale')
    // The fixture models a committed deletion by the other vault process.
    disk.values.delete('stale-write')
    disk.revisions.set('stale-write', 1)
    release()
    expect(await holding).toBe(true)
    expect(await stale).toBe(false)
    expect(disk.values.has('stale-write')).toBe(false)
  })
  it.each([true, false])('restores the exact original selection fields when publish fails (previous=%s)', async (selected) => {
    const f = await fixture()
    const file = join(f.home.userData, 'lia-product.json')
    const original = JSON.parse(await readFile(file, 'utf8'))
    original.provider.chat = { fallbackEnabled: true, ...(selected ? { preferred: { providerId: 'previous-service', modelId: 'previous-model' }, strategy: 'auto' } : {}) }
    await writeFile(file, JSON.stringify(original))
    disk.failPublish = true
    expect(await f.host.aiConnection.save({ providerId: 'groq', baseUrl: 'https://fixture.invalid/v1', apiKey: 'synthetic-key', modelId: 'new-model', revision: 0, confirmHostChange: true })).toEqual({ ok: false, code: 'storage' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(original)
    expect(await f.host.aiConnection.isSafeToStart()).toBe(selected)
  })
  it('refuses to launch a Stage sharing the active Launcher profile', async () => {
    const f = await fixture(undefined, true)
    await expect(f.host.stage.start()).rejects.toThrow('perfil do Launcher')
    expect(f.environment()).toEqual({})
  })
  it('scopes reads to transports, retains one live lease and revokes it on stop', async () => {
    const f = await fixture()
    try {
      const repository = createTransportRepository(join(f.home.userData, 'lia-transports.json'))
      expect((await repository.mutate({ kind: 'put', expectedRevision: 0, record: {
        id: 'fixture',
        providerId: 'configured-service',
        definitionId: 'configured-service',
        type: 'http',
        protocol: 'chat-completions',
        baseUrl: 'https://fixture.invalid/v1/',
        enabled: true,
        adapterOptions: {},
        modelIds: [],
        metadata: {},
        credentialRef: { scope: 'configured-service', key: 'apiKey' },
      } })).ok).toBe(true)
      await f.host.vault.setSecret('configured-service', 'apiKey', 'synthetic-first')
      await f.host.stage.start()
      const first = { ...f.environment() }
      const client = createCredentialOwnerClient(first)
      expect(await client.request({ operation: 'get', scope: 'configured-service', key: 'apiKey' })).toBe('synthetic-first')
      await expect(client.request({ operation: 'get', scope: 'unreferenced-service', key: 'apiKey' })).rejects.toMatchObject({ code: 'denied' })
      await f.host.stage.start()
      expect(f.environment()).toEqual(first)
      expect(await f.host.stageEnv()).not.toHaveProperty('LIA_CREDENTIAL_OWNER_TOKEN')
      await f.host.stage.stop()
      await expect(client.request({ operation: 'get', scope: 'configured-service', key: 'apiKey' })).rejects.toMatchObject({ code: 'unavailable' })
      await f.host.stage.start()
      expect(f.environment().LIA_CREDENTIAL_OWNER_TOKEN).not.toBe(first.LIA_CREDENTIAL_OWNER_TOKEN)
    }
    finally { await f.host.stage.stop() }
  })
  it('never begins an enqueued credential write after its lease has been revoked', async () => {
    let accept!: () => void
    const accepted = new Promise<void>((resolve) => {
      accept = resolve
    })
    const f = await fixture(accept)
    let release!: () => void
    disk.pending = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      await f.host.stage.start()
      const holding = f.host.vault.setSecret('holding-write', 'apiKey', 'synthetic-hold')
      const client = createCredentialOwnerClient(f.environment())
      const result = client.request({ operation: 'set', scope: 'cancelled-write', key: 'apiKey', value: 'must-not-be-written' }).catch(error => error.code)
      await accepted
      await f.host.stage.stop()
      expect(await result).toBe('unavailable')
      release()
      await holding
      await f.host.vault.setSecret('barrier', 'apiKey', 'synthetic-barrier')
      expect(disk.values.has('cancelled-write')).toBe(false)
    }
    finally {
      release()
      await f.host.stage.stop()
    }
  })
})
