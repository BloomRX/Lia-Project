import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTransportRepository } from '../../../../../lia/core/src/transports/repository'
import { createLiaHost } from './lia-host'
import { fixtureEnv, identityCipher, makeLiaHome } from './test-helpers'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const cleanup: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const path of cleanup.splice(0))
    await rm(path, { recursive: true, force: true })
})

async function fixture() {
  const home = await makeLiaHome()
  cleanup.push(dirname(dirname(home.appData)))
  let owned = false
  const pairs: { address?: string, key?: string }[] = []
  const events: unknown[] = []
  const repository = createTransportRepository(join(home.userData, 'lia-transports.json'))
  let readKey: () => string | undefined = () => undefined
  const start = vi.fn(async () => {
    pairs.push({ address: (await repository.read()).records[0]?.baseUrl, key: readKey() })
    owned = true
    return { phase: 'running' as const, logTail: [] }
  })
  const host = createLiaHost({
    cipher: identityCipher,
    env: fixtureEnv(home),
    onEvent: (event, detail) => events.push({ event, detail }),
    stageManagerFactory: () => ({
      start,
      holdsOwnedStage: () => owned,
      isAvailable: () => true,
      state: () => ({ phase: owned ? 'running' : 'stopped', logTail: [] }),
      stop: async () => { owned = false },
    }) as never,
    workspaceRoot: '/missing',
  })
  readKey = () => host.vault.getSecret('openai-compatible', 'apiKey')
  expect(await host.aiConnection.save({ baseUrl: 'https://old.invalid/v1', apiKey: 'old-private', modelId: 'model', revision: 0 })).toMatchObject({ ok: true })
  return { host, start, pairs, events, home }
}

describe('shared AI configuration and Stage interlock', () => {
  it.each([
    { scope: 'lia:main:oidc', key: 'session-v1' },
    { scope: 'provider\0alias', key: 'apiKey' },
    { scope: 'provider', key: 'alias\0apiKey' },
  ])('rejects reserved or ambiguous credential references before writing the batch', async (reference) => {
    const f = await fixture()
    const write = vi.spyOn(f.host.vault, 'changeSecret')
    expect(await f.host.updateConfig({ secrets: [{ scope: 'unrelated', key: 'apiKey', value: 'synthetic' }, { ...reference, value: 'synthetic' }], update: {} })).toMatchObject({ status: 'secret-vault-failed' })
    expect(write).not.toHaveBeenCalled()
    expect(f.host.vault.hasSecret('unrelated', 'apiKey')).toBe(false)
  })
  it.each(['conversar', 'start'] as const)('holds %s until a pending save commits or fails and releases the lock', async (entry) => {
    for (const success of [true, false]) {
      const f = await fixture()
      const entered = deferred()
      const release = deferred()
      const original = f.host.vault.changeSecret!.bind(f.host.vault)
      vi.spyOn(f.host.vault, 'changeSecret').mockImplementationOnce(async (...args) => {
        const stored = success ? await original(...args) : undefined
        entered.resolve()
        await release.promise
        return stored
      })
      const saving = f.host.aiConnection.save({ baseUrl: 'https://new.invalid/v1', apiKey: 'new-private', modelId: 'model', revision: 2 })
      await entered.promise
      const starting = entry === 'conversar' ? f.host.conversar() : f.host.stage.start()
      await Promise.resolve()
      await Promise.resolve()
      expect(f.start).not.toHaveBeenCalled()
      release.resolve()
      expect(await saving).toMatchObject({ ok: success })
      expect(await starting).toMatchObject({ phase: 'running' })
      expect(f.pairs).toEqual([{ address: success ? 'https://new.invalid/v1' : 'https://old.invalid/v1', key: success ? 'new-private' : 'old-private' }])
      expect(JSON.stringify(f.events)).not.toContain('private')
    }
  })

  it('refuses a save throughout starting/running ownership without changing the key or address', async () => {
    const f = await fixture()
    const entered = deferred()
    const release = deferred()
    const original = f.start.getMockImplementation()!
    f.start.mockImplementationOnce(async () => {
      entered.resolve()
      await release.promise
      return original()
    })
    const starting = f.host.conversar()
    await entered.promise
    const saving = f.host.aiConnection.save({ baseUrl: 'https://new.invalid/v1', apiKey: 'new-private', revision: 2 })
    release.resolve()
    await starting
    expect(await saving).toEqual({ ok: false, code: 'stage-running' })
    expect(await f.host.aiConnection.read()).toMatchObject({ baseUrl: 'https://old.invalid/v1', revision: 2 })
    expect(f.host.vault.getSecret('openai-compatible', 'apiKey')).toBe('old-private')
    expect(await f.host.aiConnection.save({ baseUrl: 'https://new.invalid/v1', apiKey: 'new-private', revision: 2 })).toEqual({ ok: false, code: 'stage-running' })
    await f.host.stage.stop()
    expect(await f.host.aiConnection.save({ baseUrl: 'https://new.invalid/v1', apiKey: 'new-private', revision: 2 })).toMatchObject({ ok: true })
  })

  it('releases the lock after a failed start', async () => {
    const f = await fixture()
    f.start.mockRejectedValueOnce(new Error('fixture start failure'))
    await expect(f.host.conversar()).rejects.toThrow('fixture start failure')
    expect(await f.host.aiConnection.save({ baseUrl: 'https://new.invalid/v1', apiKey: 'new-private', revision: 2 })).toMatchObject({ ok: true })
  })

  it('blocks every start after a failed key rollback until an explicit save repairs it', async () => {
    const f = await fixture()
    const original = f.host.vault.changeSecret!.bind(f.host.vault)
    vi.spyOn(f.host.vault, 'changeSecret')
      .mockImplementationOnce(async (...args) => {
        await original(...args)
        throw new Error('synthetic private storage failure')
      })
    // No mutation receipt reached this service after the write, so recovery
    // must stay fail-closed instead of restoring an unguarded old value.
    expect(await f.host.aiConnection.save({ baseUrl: 'https://new.invalid/v1', apiKey: 'new-private', revision: 2 })).toEqual({ ok: false, code: 'storage' })
    await expect(f.host.conversar()).rejects.toThrow(/Save the AI service settings again/)
    await expect(f.host.stage.start()).rejects.toThrow(/Save the AI service settings again/)
    expect(f.start).not.toHaveBeenCalled()
    expect(await f.host.aiConnection.discover()).toEqual({ ok: false, code: 'unconfigured' })
    // A fresh host must honor the durable disabled row after a restart too.
    const reopened = createLiaHost({ cipher: identityCipher, env: fixtureEnv(f.home), workspaceRoot: '/missing' })
    await expect(reopened.conversar()).rejects.toThrow(/Save the AI service settings again/)
    await expect(reopened.stage.start()).rejects.toThrow(/Save the AI service settings again/)
    expect((await reopened.homeStatus()).ai.ready).toBe(false)
    expect(await reopened.aiConnection.save({ baseUrl: 'https://old.invalid/v1', revision: 3 })).toEqual({ ok: false, code: 'credentials' })
    expect(await f.host.aiConnection.save({ baseUrl: 'https://new.invalid/v1', apiKey: 'new-private', modelId: 'model', revision: 3 })).toMatchObject({ ok: true })
    await f.host.conversar()
    expect(f.pairs).toEqual([{ address: 'https://new.invalid/v1', key: 'new-private' }])
    expect(JSON.stringify(f.events)).not.toContain('private')
  })
})
