import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLiaSecretVault } from '@lia/core/secrets/vault'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTransportRepository } from '../../../../../lia/core/src/transports/repository'
import { createAiConnectionService } from './ai-connection-service'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const action of cleanup.splice(0).reverse()) await action()
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lia-ai-connection-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'transports.json')
  const repository = createTransportRepository(file)
  // The fixture starts with an existing valid empty container. Empty bytes
  // now represent a truncated vault and must remain unwritable.
  let vaultData = '{}'
  const vault = createLiaSecretVault({ filePath: join(directory, 'vault'), cipher: { available: () => true, encrypt: value => Buffer.from(value).reverse(), decrypt: value => Buffer.from(value).reverse().toString() }, read: () => vaultData, write: async (_, value) => {
    vaultData = value
  } })
  let selection: { providerId: string, modelId?: string } | undefined
  const readSelection = async () => selection
  const saveSelection = vi.fn(async (target: { providerId: string, modelId?: string }) => {
    selection = target
  })
  const deps = { repository, vault, readSelection, saveSelection }
  return { ...deps, deps, file, service: createAiConnectionService(deps) }
}

describe('explicit replacement of a credential from another profile', () => {
  it('restores the previous model when the final transport CAS fails', async () => {
    const f = await fixture()
    await f.service.save({ baseUrl: 'https://old.invalid/v1', apiKey: 'old-synthetic', modelId: 'old-model', revision: 0 })
    const mutate = f.repository.mutate.bind(f.repository)
    vi.spyOn(f.repository, 'mutate').mockImplementationOnce(mutate).mockResolvedValueOnce({ ok: false, code: 'storage' })
    expect(await f.service.save({ baseUrl: 'https://new.invalid/v1', apiKey: 'new-synthetic', modelId: 'new-model', revision: 2 })).toEqual({ ok: false, code: 'storage' })
    expect(await f.readSelection()).toEqual({ providerId: 'openai-compatible', modelId: 'old-model' })
    expect(await f.service.isSafeToStart()).toBe(true)
  })
  it('does not decrypt the old key before accepting an explicit replacement', async () => {
    const f = await fixture()
    await f.vault.setSecret('openai-compatible', 'apiKey', 'old-synthetic')
    const read = vi.spyOn(f.vault, 'getSecret').mockImplementation(() => {
      throw new Error('different profile')
    })
    expect(await f.service.save({ baseUrl: 'https://fixture.invalid/v1', apiKey: 'new-synthetic', revision: 0 })).toMatchObject({ ok: true })
    expect(read).not.toHaveBeenCalled()
    read.mockRestore()
    expect(f.vault.getSecret('openai-compatible', 'apiKey')).toBe('new-synthetic')
  })
  it('restores the opaque old entry if saving the selection fails', async () => {
    const f = await fixture()
    await f.vault.setSecret('openai-compatible', 'apiKey', 'old-synthetic')
    const read = vi.spyOn(f.vault, 'getSecret').mockImplementation(() => {
      throw new Error('different profile')
    })
    f.saveSelection.mockRejectedValueOnce(new Error('storage'))
    expect(await f.service.save({ baseUrl: 'https://fixture.invalid/v1', apiKey: 'new-synthetic', revision: 0 })).toEqual({ ok: false, code: 'storage' })
    expect(read).not.toHaveBeenCalled()
    read.mockRestore()
    expect(f.vault.getSecret('openai-compatible', 'apiKey')).toBe('old-synthetic')
  })
})

async function httpFixture(handler: (path: string, body: any, authorization?: string) => unknown) {
  const server = createServer(async (request, response) => {
    let text = ''
    for await (const chunk of request) text += chunk
    const body = handler(request.url ?? '', text ? JSON.parse(text) : undefined, request.headers.authorization)
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(body))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close(error => error ? reject(error) : resolve())
  }))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('fixture')
  return `http://127.0.0.1:${address.port}/v1`
}

describe('launcher real AI connection', () => {
  it('saves address separately from secrets, discovers live models and proves tool result reaches final answer', async () => {
    const f = await fixture()
    const bodies: any[] = []
    const endpoint = await httpFixture((path, body, authorization) => {
      expect(authorization).toBe('Bearer synthetic-private-key')
      if (path === '/v1/models')
        return { data: [{ id: 'dynamic-model' }] }
      expect(path).toBe('/v1/chat/completions')
      bodies.push(body)
      if (body.messages.length === 1)
        return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lia_connection_check', arguments: '{}' } }] } }] }
      return { choices: [{ message: { role: 'assistant', content: body.messages.at(-1).content } }] }
    })
    expect(await f.service.save({ baseUrl: endpoint, apiKey: 'synthetic-private-key', revision: 0 })).toMatchObject({ ok: true })
    expect(await f.service.discover()).toEqual({ ok: true, models: [{ id: 'dynamic-model', label: 'dynamic-model' }] })
    expect(await f.service.save({ baseUrl: endpoint, modelId: 'dynamic-model', revision: 2 })).toMatchObject({ ok: true })
    expect(await f.service.probe()).toEqual({ ok: true })
    expect(bodies).toHaveLength(2)
    expect(bodies[1].messages[2]).toMatchObject({ role: 'tool', tool_call_id: 'call-1' })
    expect(JSON.stringify(await f.service.read())).not.toContain('synthetic-private-key')
    expect(await readFile(f.file, 'utf8')).not.toContain('synthetic-private-key')
  })

  it('does not approve a text ping or an empty/missing final response', async () => {
    const f = await fixture()
    let mode = 'text'
    const endpoint = await httpFixture((_, body) => {
      if (mode === 'text')
        return { choices: [{ message: { content: 'hello' } }] }
      if (body.messages.length === 1)
        return { choices: [{ message: { tool_calls: [{ id: 'call', type: 'function', function: { name: 'lia_connection_check', arguments: '{}' } }] } }] }
      return { choices: [{ message: { content: mode === 'empty' ? '' : 'unrelated answer' } }] }
    })
    await f.service.save({ baseUrl: endpoint, modelId: 'discovered', revision: 0 })
    for (const next of ['text', 'empty', 'wrong']) {
      mode = next
      expect(await f.service.probe()).toEqual({ ok: false, code: 'protocol' })
    }
  })

  it('rejects a stale save before changing the vault and preserves existing record identity', async () => {
    const f = await fixture()
    await f.repository.mutate({ kind: 'put', expectedRevision: 0, record: { id: 'openai-compatible', providerId: 'openai-compatible', definitionId: 'legacy-chat', protocol: 'chat-completions', type: 'http', baseUrl: 'https://service.invalid/v1', modelIds: [], enabled: true, adapterOptions: {}, metadata: {}, credentialRef: { scope: 'openai-compatible', key: 'apiKey' } } })
    expect(await f.service.save({ baseUrl: 'https://service.invalid/v1', apiKey: 'stale-secret', revision: 0 })).toEqual({ ok: false, code: 'conflict' })
    expect(f.vault.hasSecret('openai-compatible', 'apiKey')).toBe(false)
    expect(await f.service.save({ baseUrl: 'https://service.invalid/v1', revision: 1 })).toMatchObject({ ok: true })
    expect((await f.repository.read()).records).toMatchObject([{ id: 'openai-compatible', definitionId: 'legacy-chat' }])
  })

  it('rolls back transport and key when canonical selection cannot be written', async () => {
    const f = await fixture()
    await f.service.save({ baseUrl: 'https://old.invalid/v1', apiKey: 'old-private', modelId: 'old-model', revision: 0 })
    f.saveSelection.mockRejectedValueOnce(new Error('sensitive upstream error'))
    expect(await f.service.save({ baseUrl: 'https://new.invalid/v1', apiKey: 'new-private', modelId: 'new-model', revision: 2 })).toEqual({ ok: false, code: 'storage' })
    expect(await f.service.read()).toMatchObject({ baseUrl: 'https://old.invalid/v1', modelId: 'old-model' })
    expect(f.vault.getSecret('openai-compatible', 'apiKey')).toBe('old-private')
  })

  it('rejects credential-bearing addresses, insecure remote HTTP and unrecognized fields', async () => {
    const f = await fixture()
    for (const baseUrl of ['https://user:private@service.invalid/v1', 'https://service.invalid/v1?key=private', 'http://remote.invalid/v1', 'file:///secret', 'https://service.invalid/#private'])
      expect(await f.service.save({ baseUrl, revision: 0 })).toEqual({ ok: false, code: 'invalid' })
    expect(await f.service.save({ baseUrl: 'https://service.invalid/v1', revision: 0, headers: { secret: 'private' } } as any)).toEqual({ ok: false, code: 'invalid' })
  })

  it('keeps the transport disabled across restart if rollback cannot restore its row', async () => {
    const f = await fixture()
    await f.service.save({ baseUrl: 'https://old.invalid/v1', apiKey: 'old-private', modelId: 'old-model', revision: 0 })
    const original = f.repository.mutate.bind(f.repository)
    vi.spyOn(f.repository, 'mutate')
      .mockImplementationOnce(original)
      .mockResolvedValueOnce({ ok: false, code: 'storage' })
    f.saveSelection.mockRejectedValueOnce(new Error('synthetic sensitive storage failure'))
    expect(await f.service.save({ baseUrl: 'https://new.invalid/v1', apiKey: 'new-private', modelId: 'new-model', revision: 2 })).toEqual({ ok: false, code: 'storage' })
    expect((await f.repository.read()).records[0]).toMatchObject({ baseUrl: 'https://old.invalid/v1', enabled: false })
    const reopened = createAiConnectionService(f.deps)
    expect(await reopened.isSafeToStart()).toBe(false)
    expect(await reopened.discover()).toEqual({ ok: false, code: 'unconfigured' })
    expect(await reopened.save({ baseUrl: 'https://old.invalid/v1', revision: 3 })).toEqual({ ok: false, code: 'credentials' })
    expect(await reopened.save({ baseUrl: 'https://new.invalid/v1', apiKey: 'new-private', modelId: 'new-model', revision: 3 })).toMatchObject({ ok: true })
    expect(await reopened.isSafeToStart()).toBe(true)
  })

  it('requires explicit credential input to change a saved address', async () => {
    const f = await fixture()
    await f.service.save({ baseUrl: 'https://old.invalid/v1', apiKey: 'private', revision: 0 })
    expect(await f.service.save({ baseUrl: 'https://new.invalid/v1', revision: 2 })).toEqual({ ok: false, code: 'credentials' })
    expect(await f.service.save({ baseUrl: 'https://new.invalid/v1', apiKey: '', revision: 2 })).toMatchObject({ ok: true, state: { hasKey: false } })
  })

  it('sanitizes network failures and bounds transports and repository reads at 30 seconds', async () => {
    const f = await fixture()
    await f.service.save({ baseUrl: 'https://service.invalid/v1', revision: 0 })
    const failed = createAiConnectionService({ ...f.deps, fetch: async () => {
      throw new Error('private key and address')
    } })
    expect(await failed.discover()).toEqual({ ok: false, code: 'network' })
    vi.useFakeTimers()
    const pending = createAiConnectionService({ ...f.deps, repository: { ...f.repository, read: () => new Promise(() => {}) } }).discover()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await pending).toEqual({ ok: false, code: 'timeout' })
  })

  it('serializes save behind an active request so a credential cannot move between addresses', async () => {
    const f = await fixture()
    await f.service.save({ baseUrl: 'https://first.invalid/v1', apiKey: 'first-private', revision: 0 })
    let release!: () => void
    const entered = new Promise<void>((resolve) => {
      release = resolve
    })
    let respond!: (value: Response) => void
    const service = createAiConnectionService({ ...f.deps, fetch: async (url, init) => {
      expect(String(url)).toBe('https://first.invalid/v1/models')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer first-private' })
      release()
      return new Promise<Response>((resolve) => {
        respond = resolve
      })
    } })
    const request = service.discover()
    await entered
    const save = service.save({ baseUrl: 'https://second.invalid/v1', apiKey: 'second-private', revision: 2 })
    await Promise.resolve()
    expect(f.vault.getSecret('openai-compatible', 'apiKey')).toBe('first-private')
    respond(new Response(JSON.stringify({ data: [] })))
    expect(await request).toEqual({ ok: true, models: [] })
    expect(await save).toMatchObject({ ok: true })
    expect(f.vault.getSecret('openai-compatible', 'apiKey')).toBe('second-private')
  })

  it('fails closed on duplicate provider rows and never changes the vault', async () => {
    const f = await fixture()
    await f.service.save({ baseUrl: 'https://service.invalid/v1', revision: 0 })
    const snapshot = await f.repository.read()
    await f.repository.mutate({ kind: 'put', expectedRevision: snapshot.revision, record: { ...snapshot.records[0], id: 'duplicate-record' } })
    expect(await f.service.save({ baseUrl: 'https://service.invalid/v1', apiKey: 'private', revision: 3 })).toEqual({ ok: false, code: 'storage' })
    expect(f.vault.hasSecret('openai-compatible', 'apiKey')).toBe(false)
    expect(await f.service.probe()).toEqual({ ok: false, code: 'unconfigured' })
  })

  it('sets unauthenticated capability only on an explicit empty-key save', async () => {
    const f = await fixture()
    await f.service.save({ baseUrl: 'http://127.0.0.1/v1', revision: 0 })
    expect((await f.repository.read()).records[0].adapterOptions.allowUnauthenticated).toBe(false)
    await f.service.save({ baseUrl: 'http://127.0.0.1/v1', apiKey: '', revision: 2 })
    expect((await f.repository.read()).records[0].adapterOptions.allowUnauthenticated).toBe(true)
    await f.service.save({ baseUrl: 'http://127.0.0.1/v1', apiKey: 'private', revision: 4 })
    expect((await f.repository.read()).records[0].adapterOptions.allowUnauthenticated).toBe(false)
  })
})
