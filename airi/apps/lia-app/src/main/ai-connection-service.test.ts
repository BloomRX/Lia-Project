import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  brainRequirementForChatTurn,
  createProductionBrainAutomaticPolicy,
  createProductionBrainCatalog,
  decideBrainRouteFromProductState,
} from '@lia/core'
import { readLiaProductConfig, updateLiaProductConfig } from '@lia/core/product/config'
import { createLiaSecretVault } from '@lia/core/secrets/vault'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LIA_BRAIN_ENGINE_PROVIDER_MAPPING } from '../../../stage-tamagotchi/src/shared/lia/brain-engine-provider-mapping'
import { LIA_AI_PROVIDER_CATALOG } from '../../../../../lia/core/src/providers/catalog'
import { createTransportRepository } from '../../../../../lia/core/src/transports/repository'
import { isTransportRecord } from '../../../../../lia/core/src/transports/validation'
import { createAiConnectionService } from './ai-connection-service'

const GROQ_URL = 'https://api.groq.com/openai/v1'
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
  const vault = createLiaSecretVault({
    filePath: join(directory, 'vault'),
    cipher: { available: () => true, encrypt: value => Buffer.from(value).reverse(), decrypt: value => Buffer.from(value).reverse().toString() },
    read: () => vaultData,
    write: async (_, value) => {
      vaultData = value
    },
  })
  let selection: { providerId: string, modelId?: string } | undefined
  // The canonical selection writer, exactly as the launcher host wires it.
  const productConfigFile = join(directory, 'lia-product.json')
  const readSelection = async () => {
    const read = await readLiaProductConfig(productConfigFile)
    return read.status === 'ok' ? read.value.provider?.chat?.preferred : selection
  }
  const saveSelection = vi.fn(async (target: { providerId: string, modelId?: string }) => {
    selection = target
    const written = await updateLiaProductConfig(productConfigFile, { provider: { chat: { preferred: target, strategy: 'manual', onboarded: true } } })
    if (written.status !== 'ok')
      throw new Error('Configuration could not be saved')
  })
  const deps = { repository, vault, readSelection, saveSelection }
  return { ...deps, deps, file, productConfigFile, saveSelection, service: createAiConnectionService(deps), getSelection: () => selection }
}

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

describe('explicit replacement of a credential from another profile', () => {
  it('restores the previous model when the final transport CAS fails', async () => {
    const f = await fixture()
    await f.service.save({ providerId: 'groq', baseUrl: 'https://old.invalid/v1', apiKey: 'old-synthetic', modelId: 'old-model', revision: 0, confirmHostChange: true })
    const mutate = f.repository.mutate.bind(f.repository)
    vi.spyOn(f.repository, 'mutate').mockImplementationOnce(mutate).mockResolvedValueOnce({ ok: false, code: 'storage' })
    expect(await f.service.save({ providerId: 'groq', baseUrl: 'https://new.invalid/v1', apiKey: 'new-synthetic', modelId: 'new-model', revision: 2, confirmHostChange: true })).toEqual({ ok: false, code: 'storage' })
    expect(await f.readSelection()).toEqual({ providerId: 'groq', modelId: 'old-model' })
    expect(await f.service.isSafeToStart()).toBe(true)
  })
  it('does not decrypt the old key before accepting an explicit replacement', async () => {
    const f = await fixture()
    await f.vault.setSecret('groq', 'apiKey', 'old-synthetic')
    const read = vi.spyOn(f.vault, 'getSecret').mockImplementation(() => {
      throw new Error('different profile')
    })
    expect(await f.service.save({ providerId: 'groq', baseUrl: GROQ_URL, apiKey: 'new-synthetic', revision: 0 })).toMatchObject({ ok: true })
    expect(read).not.toHaveBeenCalled()
    read.mockRestore()
    expect(f.vault.getSecret('groq', 'apiKey')).toBe('new-synthetic')
  })
  it('restores the opaque old entry if saving the selection fails', async () => {
    const f = await fixture()
    await f.vault.setSecret('groq', 'apiKey', 'old-synthetic')
    const read = vi.spyOn(f.vault, 'getSecret').mockImplementation(() => {
      throw new Error('different profile')
    })
    f.saveSelection.mockRejectedValueOnce(new Error('storage'))
    expect(await f.service.save({ providerId: 'groq', baseUrl: GROQ_URL, apiKey: 'new-synthetic', modelId: 'new-model', revision: 0 })).toEqual({ ok: false, code: 'storage' })
    expect(read).not.toHaveBeenCalled()
    read.mockRestore()
    expect(f.vault.getSecret('groq', 'apiKey')).toBe('old-synthetic')
  })

  it('does not resurrect a key deleted while a failed save is pending', async () => {
    const f = await fixture()
    await f.service.save({ providerId: 'groq', baseUrl: 'https://old.invalid/v1', apiKey: 'old-synthetic', modelId: 'old-model', revision: 0, confirmHostChange: true })
    f.saveSelection.mockImplementationOnce(async () => {
      await f.vault.deleteSecret('groq', 'apiKey')
      throw new Error('storage')
    })
    expect(await f.service.save({ providerId: 'groq', baseUrl: 'https://new.invalid/v1', apiKey: 'new-synthetic', modelId: 'new-model', revision: 2, confirmHostChange: true })).toEqual({ ok: false, code: 'storage' })
    expect(f.vault.hasSecret('groq', 'apiKey')).toBe(false)
    expect(await f.service.isSafeToStart()).toBe(false)
  })
})

describe('launcher real AI connection', () => {
  it('does not authorize an absent canonical selection', async () => {
    const f = await fixture()

    expect(await f.service.getStartReadiness()).toEqual({ ok: false, code: 'selection-missing' })
    expect(await f.service.isSafeToStart()).toBe(false)
  })

  it('does not authorize a managed selection when its transport record is absent', async () => {
    const f = await fixture()
    await f.saveSelection({ providerId: 'groq', modelId: 'openai/gpt-oss-120b' })
    await f.vault.setSecret('groq', 'apiKey', 'synthetic-private-key')

    expect(await f.service.getStartReadiness()).toEqual({ ok: false, code: 'connection-missing' })
  })

  it('distinguishes a missing managed credential from a valid connection', async () => {
    const f = await fixture()
    await f.service.save({ providerId: 'groq', baseUrl: GROQ_URL, apiKey: 'synthetic-private-key', modelId: 'openai/gpt-oss-120b', revision: 0 })
    expect(await f.service.getStartReadiness()).toEqual({
      ok: true,
      managed: true,
      modelId: 'openai/gpt-oss-120b',
      providerId: 'groq',
    })

    await f.vault.deleteSecret('groq', 'apiKey')
    expect(await f.service.getStartReadiness()).toEqual({ ok: false, code: 'credential-missing' })
  })

  it('treats an empty managed credential as missing without returning credential data', async () => {
    const f = await fixture()
    await f.service.save({ providerId: 'groq', baseUrl: GROQ_URL, apiKey: 'synthetic-private-key', modelId: 'openai/gpt-oss-120b', revision: 0 })
    vi.spyOn(f.vault, 'getSecret').mockReturnValue('')

    expect(await f.service.getStartReadiness()).toEqual({ ok: false, code: 'credential-missing' })
  })

  it('reports selection and transport read failures without converting them into permission', async () => {
    const f = await fixture()
    const selectionFailure = createAiConnectionService({ ...f.deps, readSelection: async () => { throw new Error('private read failure') } })
    expect(await selectionFailure.getStartReadiness()).toEqual({ ok: false, code: 'selection-read-failed' })

    await f.service.save({ providerId: 'groq', baseUrl: GROQ_URL, apiKey: 'synthetic-private-key', modelId: 'openai/gpt-oss-120b', revision: 0 })
    vi.spyOn(f.repository, 'read').mockRejectedValueOnce(new Error('private transport failure'))
    expect(await f.service.getStartReadiness()).toEqual({ ok: false, code: 'transport-read-failed' })
  })

  it('blocks inconsistent and disabled managed connection records', async () => {
    const f = await fixture()
    await f.service.save({ providerId: 'groq', baseUrl: GROQ_URL, apiKey: 'synthetic-private-key', modelId: 'openai/gpt-oss-120b', revision: 0 })
    const snapshot = await f.repository.read()
    snapshot.records[0].definitionId = 'different-definition'
    vi.spyOn(f.repository, 'read').mockResolvedValueOnce(snapshot)
    expect(await f.service.getStartReadiness()).toEqual({ ok: false, code: 'connection-inconsistent' })

    const current = await f.repository.read()
    const disabled = await f.repository.mutate({
      kind: 'put',
      expectedRevision: current.revision,
      record: { ...current.records[0], definitionId: 'groq', enabled: false },
    })
    expect(disabled.ok).toBe(true)
    expect(await f.service.getStartReadiness()).toEqual({ ok: false, code: 'connection-disabled' })
  })

  it('blocks a stale canonical model that no longer exists in the managed connection', async () => {
    const f = await fixture()
    await f.service.save({ providerId: 'groq', baseUrl: GROQ_URL, apiKey: 'synthetic-private-key', modelId: 'current-model', revision: 0 })
    await f.saveSelection({ providerId: 'groq', modelId: 'stale-model' })

    expect(await f.service.getStartReadiness()).toEqual({ ok: false, code: 'connection-inconsistent' })
  })

  it('keeps valid unmanaged selections outside the managed transport gate', async () => {
    const f = await fixture()
    await f.saveSelection({ providerId: 'ollama', modelId: 'llama3' })
    expect(await f.service.getStartReadiness()).toEqual({
      ok: true,
      managed: false,
      modelId: 'llama3',
      providerId: 'ollama',
    })
  })

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
    expect(await f.service.save({ providerId: 'groq', baseUrl: endpoint, apiKey: 'synthetic-private-key', revision: 0, confirmHostChange: true })).toMatchObject({ ok: true })
    expect(await f.service.discover('groq')).toEqual({ ok: true, models: [{ id: 'dynamic-model', label: 'dynamic-model' }] })
    expect(await f.service.save({ providerId: 'groq', baseUrl: endpoint, modelId: 'dynamic-model', revision: 2, confirmHostChange: true })).toMatchObject({ ok: true })
    expect(await f.service.probe('groq')).toEqual({ ok: true })
    expect(bodies).toHaveLength(2)
    expect(bodies[1].messages[2]).toMatchObject({ role: 'tool', tool_call_id: 'call-1' })
    expect(JSON.stringify(await f.service.read('groq'))).not.toContain('synthetic-private-key')
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
    await f.service.save({ providerId: 'groq', baseUrl: endpoint, apiKey: 'synthetic-private-key', modelId: 'discovered', revision: 0, confirmHostChange: true })
    for (const next of ['text', 'empty', 'wrong']) {
      mode = next
      expect(await f.service.probe('groq')).toEqual({ ok: false, code: 'protocol' })
    }
  })

  it('preserves an unmanaged legacy record while writing the managed provider', async () => {
    const f = await fixture()
    await f.repository.mutate({ kind: 'put', expectedRevision: 0, record: { id: 'openai-compatible', providerId: 'openai-compatible', definitionId: 'legacy-chat', protocol: 'chat-completions', type: 'http', baseUrl: 'https://service.invalid/v1', modelIds: [], enabled: true, adapterOptions: {}, metadata: {}, credentialRef: { scope: 'openai-compatible', key: 'apiKey' } } })
    expect(await f.service.save({ providerId: 'groq', baseUrl: GROQ_URL, apiKey: 'stale-secret', revision: 0 })).toEqual({ ok: false, code: 'conflict' })
    expect(f.vault.hasSecret('groq', 'apiKey')).toBe(false)
    expect(await f.service.save({ providerId: 'groq', baseUrl: GROQ_URL, revision: 1 })).toMatchObject({ ok: true })
    const records = (await f.repository.read()).records
    expect(records).toHaveLength(2)
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'openai-compatible', definitionId: 'legacy-chat' }),
      expect.objectContaining({ id: 'groq', providerId: 'groq', definitionId: 'groq' }),
    ]))
  })

  it('rolls back transport and key when canonical selection cannot be written', async () => {
    const f = await fixture()
    await f.service.save({ providerId: 'groq', baseUrl: 'https://old.invalid/v1', apiKey: 'old-private', modelId: 'old-model', revision: 0, confirmHostChange: true })
    f.saveSelection.mockRejectedValueOnce(new Error('sensitive upstream error'))
    expect(await f.service.save({ providerId: 'groq', baseUrl: 'https://new.invalid/v1', apiKey: 'new-private', modelId: 'new-model', revision: 2, confirmHostChange: true })).toEqual({ ok: false, code: 'storage' })
    expect(await f.service.read('groq')).toMatchObject({ baseUrl: 'https://old.invalid/v1', modelId: 'old-model' })
    expect(f.vault.getSecret('groq', 'apiKey')).toBe('old-private')
  })

  it('rejects credential-bearing addresses, insecure remote HTTP and unrecognized fields', async () => {
    const f = await fixture()
    for (const baseUrl of ['https://user:private@service.invalid/v1', 'https://service.invalid/v1?key=private', 'http://remote.invalid/v1', 'file:///secret', 'https://service.invalid/#private'])
      expect(await f.service.save({ providerId: 'groq', baseUrl, revision: 0 })).toEqual({ ok: false, code: 'invalid' })
    expect(await f.service.save({ providerId: 'groq', baseUrl: 'https://service.invalid/v1', revision: 0, headers: { secret: 'private' } } as any)).toEqual({ ok: false, code: 'invalid' })
  })

  it('keeps the transport disabled across restart if rollback cannot restore its row', async () => {
    const f = await fixture()
    await f.service.save({ providerId: 'groq', baseUrl: 'https://old.invalid/v1', apiKey: 'old-private', modelId: 'old-model', revision: 0, confirmHostChange: true })
    const original = f.repository.mutate.bind(f.repository)
    vi.spyOn(f.repository, 'mutate')
      .mockImplementationOnce(original)
      .mockResolvedValueOnce({ ok: false, code: 'storage' })
    f.saveSelection.mockRejectedValueOnce(new Error('synthetic sensitive storage failure'))
    expect(await f.service.save({ providerId: 'groq', baseUrl: 'https://new.invalid/v1', apiKey: 'new-private', modelId: 'new-model', revision: 2, confirmHostChange: true })).toEqual({ ok: false, code: 'storage' })
    expect((await f.repository.read()).records[0]).toMatchObject({ baseUrl: 'https://old.invalid/v1', enabled: false })
    const reopened = createAiConnectionService(f.deps)
    expect(await reopened.isSafeToStart()).toBe(false)
    expect(await reopened.discover('groq')).toEqual({ ok: false, code: 'unconfigured' })
    expect(await reopened.save({ providerId: 'groq', baseUrl: 'https://old.invalid/v1', revision: 3, confirmHostChange: true })).toEqual({ ok: false, code: 'credentials' })
    expect(await reopened.save({ providerId: 'groq', baseUrl: 'https://new.invalid/v1', apiKey: 'new-private', modelId: 'new-model', revision: 3, confirmHostChange: true })).toMatchObject({ ok: true })
    expect(await reopened.isSafeToStart()).toBe(true)
  })

  it('requires explicit credential input to change a saved address', async () => {
    const f = await fixture()
    await f.service.save({ providerId: 'groq', baseUrl: 'https://old.invalid/v1', apiKey: 'private', revision: 0, confirmHostChange: true })
    expect(await f.service.save({ providerId: 'groq', baseUrl: 'https://new.invalid/v1', revision: 2, confirmHostChange: true })).toEqual({ ok: false, code: 'credentials' })
    expect(await f.service.save({ providerId: 'groq', baseUrl: 'https://new.invalid/v1', apiKey: '', revision: 2, confirmHostChange: true })).toMatchObject({ ok: true, state: { hasKey: false } })
  })

  it('sanitizes network failures and bounds transports and repository reads at 30 seconds', async () => {
    const f = await fixture()
    await f.service.save({ providerId: 'groq', baseUrl: 'https://service.invalid/v1', apiKey: 'synthetic-private-key', revision: 0, confirmHostChange: true })
    const failed = createAiConnectionService({ ...f.deps, fetch: async () => {
      throw new Error('private key and address')
    } })
    expect(await failed.discover('groq')).toEqual({ ok: false, code: 'network' })
    vi.useFakeTimers()
    const pending = createAiConnectionService({ ...f.deps, repository: { ...f.repository, read: () => new Promise(() => {}) } }).discover('groq')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await pending).toEqual({ ok: false, code: 'timeout' })
  })

  it('serializes save behind an active request so a credential cannot move between addresses', async () => {
    const f = await fixture()
    await f.service.save({ providerId: 'groq', baseUrl: 'https://first.invalid/v1', apiKey: 'first-private', revision: 0, confirmHostChange: true })
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
    const request = service.discover('groq')
    await entered
    const save = service.save({ providerId: 'groq', baseUrl: 'https://second.invalid/v1', apiKey: 'second-private', revision: 2, confirmHostChange: true })
    await Promise.resolve()
    expect(f.vault.getSecret('groq', 'apiKey')).toBe('first-private')
    respond(new Response(JSON.stringify({ data: [] })))
    expect(await request).toEqual({ ok: true, models: [] })
    expect(await save).toMatchObject({ ok: true })
    expect(f.vault.getSecret('groq', 'apiKey')).toBe('second-private')
  })

  it('fails closed on duplicate provider rows and never changes the vault', async () => {
    const f = await fixture()
    await f.service.save({ providerId: 'groq', baseUrl: 'https://service.invalid/v1', revision: 0, confirmHostChange: true })
    const snapshot = await f.repository.read()
    await f.repository.mutate({ kind: 'put', expectedRevision: snapshot.revision, record: { ...snapshot.records[0], id: 'duplicate-record' } })
    expect(await f.service.save({ providerId: 'groq', baseUrl: 'https://service.invalid/v1', apiKey: 'private', revision: 3, confirmHostChange: true })).toEqual({ ok: false, code: 'storage' })
    expect(f.vault.hasSecret('groq', 'apiKey')).toBe(false)
    expect(await f.service.probe('groq')).toEqual({ ok: false, code: 'unconfigured' })
  })

  it('sets unauthenticated capability only on an explicit empty-key save', async () => {
    const f = await fixture()
    await f.service.save({ providerId: 'groq', baseUrl: 'http://127.0.0.1/v1', revision: 0, confirmHostChange: true })
    expect((await f.repository.read()).records[0].adapterOptions.allowUnauthenticated).toBe(false)
    await f.service.save({ providerId: 'groq', baseUrl: 'http://127.0.0.1/v1', apiKey: '', revision: 2, confirmHostChange: true })
    expect((await f.repository.read()).records[0].adapterOptions.allowUnauthenticated).toBe(true)
    await f.service.save({ providerId: 'groq', baseUrl: 'http://127.0.0.1/v1', apiKey: 'private', revision: 4, confirmHostChange: true })
    expect((await f.repository.read()).records[0].adapterOptions.allowUnauthenticated).toBe(false)
  })
})

describe('AI Settings MVP (PROMPT-39)', () => {
  it('exposes a non-secret provider catalog and enforces the availability gate', async () => {
    const f = await fixture()
    const catalog = f.service.catalog()
    const groq = catalog.find(provider => provider.definitionId === 'groq')
    const generic = catalog.find(provider => provider.definitionId === 'openai-compatible')
    expect(groq).toMatchObject({ availability: 'ready', baseUrl: GROQ_URL, engineId: 'groq', stageProviderId: 'groq' })
    expect(generic).toMatchObject({ availability: 'unavailable' })
    expect(JSON.stringify(catalog)).not.toMatch(/secret|bearer|private/i)
    for (const provider of catalog)
      expect(provider).not.toHaveProperty('apiKey')
    expect(await f.service.save({ providerId: 'openai-compatible', baseUrl: 'https://service.invalid/v1', revision: 0 })).toEqual({ ok: false, code: 'provider-unavailable' })
    expect(await f.service.discover('openai-compatible')).toEqual({ ok: false, code: 'invalid' })
  })

  it('creates and updates a credential without ever returning it', async () => {
    const f = await fixture()
    expect(await f.service.read('groq')).toMatchObject({ hasKey: false, selected: false, definitionId: 'groq', stageProviderId: 'groq', engineId: 'groq' })
    await f.service.save({ providerId: 'groq', baseUrl: GROQ_URL, apiKey: 'first-private', revision: 0 })
    expect(f.vault.getSecret('groq', 'apiKey')).toBe('first-private')
    expect(JSON.stringify(await f.service.read('groq'))).not.toContain('first-private')
    const state = await f.service.read('groq')
    await f.service.save({ providerId: 'groq', baseUrl: GROQ_URL, apiKey: 'second-private', revision: state.revision })
    expect(f.vault.getSecret('groq', 'apiKey')).toBe('second-private')
    expect(JSON.stringify(await f.service.read('groq'))).not.toContain('second-private')
    // The key is in the vault, never in the transport document.
    expect(await readFile(f.file, 'utf8')).not.toContain('second-private')
  })

  it('reports a 401 as a typed credentials failure without leaking the body', async () => {
    const f = await fixture()
    const server = createServer((request, response) => {
      response.statusCode = 401
      response.end('{"error":"private upstream detail"}')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanup.push(() => new Promise<void>((resolve, reject) => {
      server.closeAllConnections()
      server.close(error => error ? reject(error) : resolve())
    }))
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('fixture')
    const endpoint = `http://127.0.0.1:${address.port}/v1`
    await f.service.save({ providerId: 'groq', baseUrl: endpoint, apiKey: 'bad-private', revision: 0, confirmHostChange: true })
    const result = await f.service.discover('groq')
    expect(result).toEqual({ ok: false, code: 'http' })
    expect(JSON.stringify(result)).not.toContain('private upstream detail')
  })

  it('discovers models and persists the canonical selection across a restart', async () => {
    const f = await fixture()
    const endpoint = await httpFixture((path) => {
      expect(path).toBe('/v1/models')
      return { data: [{ id: 'openai/gpt-oss-120b' }, { id: 'qwen/qwen3.8-27b' }, { id: 'openai/gpt-oss-120b' }] }
    })
    await f.service.save({ providerId: 'groq', baseUrl: endpoint, apiKey: 'private', revision: 0, confirmHostChange: true })
    expect(await f.service.discover('groq')).toEqual({ ok: true, models: [
      { id: 'openai/gpt-oss-120b', label: 'openai/gpt-oss-120b' },
      { id: 'qwen/qwen3.8-27b', label: 'qwen/qwen3.8-27b' },
    ] })
    const saved = await f.service.save({ providerId: 'groq', baseUrl: endpoint, modelId: 'openai/gpt-oss-120b', revision: 2, confirmHostChange: true })
    expect(saved).toMatchObject({ ok: true, state: { selected: true, modelId: 'openai/gpt-oss-120b' } })
    expect(f.saveSelection).toHaveBeenCalledWith({ providerId: 'groq', modelId: 'openai/gpt-oss-120b' })

    // Reopening the Launcher: a fresh service over the same repository, vault
    // and canonical product document must recover everything.
    const reopened = createAiConnectionService(f.deps)
    expect(await reopened.read('groq')).toMatchObject({
      baseUrl: endpoint,
      hasKey: true,
      modelId: 'openai/gpt-oss-120b',
      selected: true,
      selection: { providerId: 'groq', modelId: 'openai/gpt-oss-120b' },
    })
    expect(await reopened.isSafeToStart()).toBe(true)
  })

  it('accepts a manually typed model id without discovery', async () => {
    const f = await fixture()
    const saved = await f.service.save({ providerId: 'groq', baseUrl: GROQ_URL, apiKey: 'private', modelId: 'manual/model-id', revision: 0 })
    expect(saved).toMatchObject({ ok: true, state: { modelId: 'manual/model-id', selected: true } })
    expect((await f.repository.read()).records[0].modelIds).toEqual(['manual/model-id'])
    expect(await f.service.save({ providerId: 'groq', baseUrl: GROQ_URL, apiKey: 'private', modelId: 'bad\nmodel', revision: 2 })).toEqual({ ok: false, code: 'invalid' })
  })

  it('requires explicit host confirmation and a new credential before moving a saved key', async () => {
    const f = await fixture()
    await f.service.save({ providerId: 'groq', baseUrl: GROQ_URL, apiKey: 'stored-private', revision: 0 })
    // Same host, different path: still a new destination, so the key must be re-entered.
    expect(await f.service.save({ providerId: 'groq', baseUrl: 'https://api.groq.com/other/v1', revision: 2 })).toMatchObject({ ok: false, code: 'credentials' })
    // New host without confirmation is refused before anything is written.
    expect(await f.service.save({ providerId: 'groq', baseUrl: 'https://proxy.invalid/v1', apiKey: 'new-private', revision: 2 })).toEqual({ ok: false, code: 'unconfirmed-host' })
    // Confirmation without a fresh credential is refused too.
    expect(await f.service.save({ providerId: 'groq', baseUrl: 'https://proxy.invalid/v1', revision: 2, confirmHostChange: true })).toEqual({ ok: false, code: 'credentials' })
    expect(f.vault.getSecret('groq', 'apiKey')).toBe('stored-private')
    // Explicit confirmation + fresh credential moves the connection.
    expect(await f.service.save({ providerId: 'groq', baseUrl: 'https://proxy.invalid/v1', apiKey: 'new-private', revision: 2, confirmHostChange: true })).toMatchObject({ ok: true })
    expect(f.vault.getSecret('groq', 'apiKey')).toBe('new-private')
    expect((await f.service.read('groq')).baseUrl).toBe('https://proxy.invalid/v1')
  })

  it('never sends the stored credential to a destination that was not saved', async () => {
    const f = await fixture()
    const seen: string[] = []
    const service = createAiConnectionService({ ...f.deps, fetch: async (url) => {
      seen.push(String(url))
      return new Response(JSON.stringify({ data: [] }))
    } })
    await service.save({ providerId: 'groq', baseUrl: GROQ_URL, apiKey: 'private', revision: 0 })
    expect(await service.discover('groq')).toEqual({ ok: true, models: [] })
    expect(seen).toEqual([`${GROQ_URL}/models`])
  })

  it('integrates the saved selection with the Brain route and the Stage mapping', async () => {
    const f = await fixture()
    expect(await f.service.save({ providerId: 'groq', baseUrl: GROQ_URL, apiKey: 'private', modelId: 'openai/gpt-oss-120b', revision: 0 })).toMatchObject({ ok: true })

    // 1. The canonical product document, written by Lia Core, holds the choice.
    const product = await readLiaProductConfig(f.productConfigFile)
    expect(product.status).toBe('ok')
    const preferred = product.status === 'ok' ? product.value.provider?.chat?.preferred : undefined
    expect(preferred).toEqual({ providerId: 'groq', modelId: 'openai/gpt-oss-120b' })

    // 2. The Brain, under the routing mode the Launcher materializes, selects
    //    the production route (engine + model) for a plain text turn.
    const brainCatalog = createProductionBrainCatalog()
    const decision = decideBrainRouteFromProductState({
      automaticPolicy: createProductionBrainAutomaticPolicy(),
      engines: brainCatalog.engines,
      models: brainCatalog.models,
      requirement: brainRequirementForChatTurn({}),
      snapshot: { brain: { mode: 'automatic' } },
    })
    expect(decision.status).toBe('automatic')
    const route = decision.status === 'automatic' && decision.selection.status === 'selected' ? decision.selection.route : undefined
    expect(route).toMatchObject({ engine: { id: 'groq' }, model: { id: 'openai/gpt-oss-120b' } })

    // 3. The launcher's Brain gate and the Stage mapping both tie the Brain's
    //    engine to the provider the Launcher persisted - no implicit string
    //    equality in the mapping, the audited table is consulted.
    expect(route!.engine.id).toBe(preferred!.providerId)
    expect(route!.model.id).toBe(preferred!.modelId)
    expect(LIA_BRAIN_ENGINE_PROVIDER_MAPPING.providerIdForEngine(route!.engine.id)).toBe(preferred!.providerId)

    // 4. The transport row the Stage reads is valid under the shared contract.
    const record = (await f.repository.read()).records[0]
    expect(isTransportRecord(record)).toBe(true)
    expect(record).toMatchObject({
      definitionId: 'groq',
      providerId: 'groq',
      credentialRef: { key: 'apiKey', scope: 'groq' },
      modelIds: ['openai/gpt-oss-120b'],
    })
    // A second repository instance (the Stage process) sees the same row.
    const stageView = createTransportRepository(f.file)
    expect((await stageView.read()).records[0]).toEqual(record)
  })

  it('publishes a catalog entry whose engine is the same Brain engine the policy ships', () => {
    const groq = LIA_AI_PROVIDER_CATALOG.find(provider => provider.definitionId === 'groq')
    const policy = createProductionBrainAutomaticPolicy()
    expect(policy.routes.some(route => route.engineId === groq?.engineId)).toBe(true)
    expect(policy.routes.some(route => route.modelId === 'openai/gpt-oss-120b')).toBe(true)
  })
})
