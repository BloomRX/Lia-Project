import type { LiaSecretVault } from '@lia/core/secrets/vault'
import type { WebContents } from 'electron'

import type { TransportRecord, TransportSnapshot } from '../../../../../../../lia/core/src/transports/contracts'
import type { LiaTransportPullResult, LiaTransportStartResult } from '../../../shared/eventa/lia-transport-execution'

import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { electronLiaTransportStart } from '../../../shared/eventa/lia-transport-execution'
import { createLiaTransportExecutionService, registerLiaTransportExecutionBridge } from './transport-execution-service'

const handlers = vi.hoisted(() => new Map<unknown, (...args: any[]) => any>())
vi.mock('@moeru/eventa', async (original) => {
  const actual = await original<typeof import('@moeru/eventa')>()
  return { ...actual, defineInvokeHandler: (_context: unknown, event: unknown, handler: (...args: any[]) => any) => handlers.set(event, handler) }
})

const services: ReturnType<typeof createLiaTransportExecutionService>[] = []
const owner = (id = 1) => Object.assign(new EventEmitter(), { id, isDestroyed: () => false }) as unknown as WebContents
function record(providerId = 'service-a', baseUrl = 'https://fixture.invalid/v1/'): TransportRecord {
  return {
    id: providerId,
    providerId,
    definitionId: 'compatible',
    type: 'http',
    protocol: 'chat-completions',
    baseUrl,
    enabled: true,
    adapterOptions: {},
    modelIds: [],
    metadata: {},
    credentialRef: { scope: providerId, key: 'apiKey' },
  }
}
const body = { model: 'free-model', messages: [{ role: 'user', content: 'hello' }] }
const startInput = (providerId = 'service-a') => ({ providerId, operation: 'chat', body })
function id(result: LiaTransportStartResult) {
  expect(result.ok).toBe(true)
  if (!result.ok)
    throw new Error('Expected job')
  return result.id
}
function fixture(fetch: typeof globalThis.fetch = vi.fn(async () => new Response('ok')), records = [record()]) {
  const snapshot: TransportSnapshot = { schemaVersion: 1, revision: 0, records, tombstones: [], migration: { version: 1, imported: [] } }
  const repository = { read: vi.fn(async () => structuredClone(snapshot)) }
  const getSecret = vi.fn((scope: string, key: string) => `${scope}-${key}-synthetic`)
  const vault = { getSecret } as unknown as LiaSecretVault
  const service = createLiaTransportExecutionService({ repository, vault, fetch })
  services.push(service)
  return { service, snapshot, repository, vault, getSecret, fetch }
}
async function allBytes(service: ReturnType<typeof createLiaTransportExecutionService>, sender: WebContents, jobId: string) {
  const bytes: number[] = []
  while (true) {
    const result = await service.pull(sender, { id: jobId, action: 'read' })
    expect(result.ok).toBe(true)
    if (!result.ok || result.done)
      break
    bytes.push(...result.bytes!)
  }
  return new TextDecoder().decode(Uint8Array.from(bytes))
}

afterEach(() => {
  for (const service of services.splice(0))
    service.dispose()
  handlers.clear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('main transport execution', () => {
  it('runs only saved audio transports, rejects injected credentials and closes on invalid media', async () => {
    const providerId = 'openai-compatible-audio-speech'
    const audioRecord: TransportRecord = { ...record(providerId), definitionId: providerId, protocol: 'audio-speech' }
    const fetch = vi.fn(async () => new Response('diagnostic with credential', { headers: { 'content-type': 'application/json' } }))
    const { service, getSecret } = fixture(fetch, [audioRecord])
    const sender = owner()
    const speech = { model: 'model', voice: 'voice', input: 'Olá' }
    const request = { providerId, operation: 'speech', speech }
    expect(service.start(sender, { ...request, speech: { ...speech, apiKey: 'synthetic' } })).toEqual({ ok: false, code: 'configuration' })
    expect(service.start(sender, { ...request, draft: { baseUrl: 'https://other.invalid' } })).toEqual({ ok: false, code: 'configuration' })
    expect(service.start(sender, { ...request, providerId: 'service-a' })).toEqual({ ok: false, code: 'configuration' })
    const chatJob = id(service.start(sender, startInput(providerId)))
    expect(await service.pull(sender, { id: chatJob, action: 'head' })).toEqual({ ok: false, code: 'unsupported' })
    const wrongProtocol = fixture(fetch, [{ ...audioRecord, protocol: 'chat-completions' }])
    const wrongJob = id(wrongProtocol.service.start(sender, startInput(providerId)))
    expect(await wrongProtocol.service.pull(sender, { id: wrongJob, action: 'head' })).toEqual({ ok: false, code: 'unsupported' })
    expect(wrongProtocol.getSecret).not.toHaveBeenCalled()
    const stale = id(service.start(sender, { ...request, expectedBaseUrl: 'https://other.invalid/' }))
    expect(await service.pull(sender, { id: stale, action: 'head' })).toEqual({ ok: false, code: 'configuration' })
    expect(getSecret).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    const audio = id(service.start(sender, request))
    expect(await service.pull(sender, { id: audio, action: 'head' })).toEqual({ ok: false, code: 'protocol' })
    expect(getSecret).toHaveBeenCalledExactlyOnceWith(providerId, 'apiKey')
  })

  it('cancels an in-flight speech request only for its owning window', async () => {
    const providerId = 'openai-audio-speech'
    const audioRecord: TransportRecord = { ...record(providerId), definitionId: providerId, protocol: 'audio-speech' }
    const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('synthetic')), { once: true })
    }))
    const { service } = fixture(fetch, [audioRecord])
    const sender = owner()
    const job = id(service.start(sender, { providerId, operation: 'speech', speech: { model: 'model', voice: 'voice', input: 'Olá' } }))
    const head = service.pull(sender, { id: job, action: 'head' })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(service.cancel(owner(2), { id: job })).toBe(false)
    expect(service.cancel(sender, { id: job })).toBe(true)
    await expect(head).resolves.toEqual({ ok: false, code: 'cancelled' })
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  it('refuses an audio body exceeding the Main byte limit', async () => {
    const providerId = 'openai-audio-speech'
    const audioRecord: TransportRecord = { ...record(providerId), definitionId: providerId, protocol: 'audio-speech' }
    const fetch = vi.fn(async () => new Response(new Uint8Array(8 * 1024 * 1024 + 1), { headers: { 'content-type': 'audio/mpeg' } }))
    const { service } = fixture(fetch, [audioRecord])
    const sender = owner()
    const job = id(service.start(sender, { providerId, operation: 'speech', speech: { model: 'model', voice: 'voice', input: 'Olá' } }))
    expect(await service.pull(sender, { id: job, action: 'head' })).toMatchObject({ ok: true, contentType: 'audio/mpeg' })
    expect(await service.pull(sender, { id: job, action: 'read' })).toEqual({ ok: false, code: 'protocol' })
  })

  it('authenticates real loopback HTTP using the exact record scope, with safe IPC metadata', async () => {
    const received: { path?: string, authorization?: string, body?: string } = {}
    const server = createServer((request, response) => {
      received.path = request.url
      received.authorization = request.headers.authorization
      let data = ''
      request.on('data', chunk => data += chunk)
      request.on('end', () => {
        received.body = data
        response.writeHead(200, { 'content-type': 'application/json', 'x-private': 'private-header' })
        response.end(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error('Missing listener')
      const saved = record('custom', `http://127.0.0.1:${address.port}/v1`)
      saved.credentialRef.scope = 'exact-vault-scope'
      const { service, getSecret } = fixture(globalThis.fetch, [saved])
      const sender = owner()
      const jobId = id(service.start(sender, { ...startInput('custom'), expectedBaseUrl: `${saved.baseUrl}/` }))
      const head = await service.pull(sender, { id: jobId, action: 'head' })
      expect(head).toEqual({ ok: true, status: 200, contentType: 'application/json' })
      expect(await allBytes(service, sender, jobId)).toContain('hello')
      expect(getSecret).toHaveBeenCalledExactlyOnceWith('exact-vault-scope', 'apiKey')
      expect(received).toEqual({ path: '/v1/chat/completions', authorization: 'Bearer exact-vault-scope-apiKey-synthetic', body: JSON.stringify(body) })
      expect(service.activeJobCount).toBe(0)
      expect(sender.listenerCount('destroyed')).toBe(0)
    }
    finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  it('resolves distinct credentials for each operation without definition aliases', async () => {
    const fetch = vi.fn(async (_url, init) => new Response(new Headers(init?.headers).get('authorization')))
    const { service, getSecret } = fixture(fetch as typeof globalThis.fetch, [record(), record('service-b')])
    const sender = owner()
    for (const providerId of ['service-a', 'service-b', 'service-a']) {
      const jobId = id(service.start(sender, startInput(providerId)))
      expect(await allBytes(service, sender, jobId)).toBe(`Bearer ${providerId}-apiKey-synthetic`)
    }
    expect(getSecret.mock.calls).toEqual([['service-a', 'apiKey'], ['service-b', 'apiKey'], ['service-a', 'apiKey']])
  })

  it('allows an explicitly recreated transport with a distinct ID despite the historical provider-ID tombstone', async () => {
    const { service, snapshot } = fixture(undefined, [{ ...record(), id: 'replacement-transport' }])
    snapshot.tombstones = ['service-a']
    snapshot.protectedCredentialScopes = ['service-a']
    const sender = owner()
    const jobId = id(service.start(sender, startInput()))
    expect(await service.pull(sender, { id: jobId, action: 'head' })).toMatchObject({ ok: true, status: 200 })
    expect(await allBytes(service, sender, jobId)).toBe('ok')
  })

  it('returns an ID before starting fetch and cancels before headers', async () => {
    const fetch = vi.fn(async () => new Promise<Response>(() => {}))
    const { service } = fixture(fetch)
    const sender = owner()
    const jobId = id(service.start(sender, startInput()))
    expect(fetch).not.toHaveBeenCalled()
    const pending = service.pull(sender, { id: jobId, action: 'head' })
    expect(service.cancel(sender, { id: jobId })).toBe(true)
    expect(await pending).toEqual({ ok: false, code: 'cancelled' })
    expect(service.activeJobCount).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('cancels an already dispatched request before headers, observes late rejection', async () => {
    let rejectFetch!: (error: Error) => void
    let signal: AbortSignal | undefined
    const fetch = vi.fn((_url, init) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        rejectFetch = reject
      })
    })
    const { service } = fixture(fetch as typeof globalThis.fetch)
    const sender = owner()
    const jobId = id(service.start(sender, startInput()))
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(fetch).toHaveBeenCalledOnce()
    expect(service.cancel(sender, { id: jobId })).toBe(true)
    expect(signal?.aborted).toBe(true)
    rejectFetch(new Error('sensitive-late-error'))
    expect(await service.pull(sender, { id: jobId, action: 'head' })).toEqual({ ok: false, code: 'cancelled' })
  })

  it('discards a late response and releases readers even when upstream cancellation never settles', async () => {
    let resolveFetch!: (response: Response) => void
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const upstream = new ReadableStream<Uint8Array>({ pull() {}, cancel })
    const { service } = fixture(vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })))
    const sender = owner()
    const jobId = id(service.start(sender, startInput()))
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(service.cancel(sender, { id: jobId })).toBe(true)
    resolveFetch(new Response(upstream))
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(cancel).toHaveBeenCalledOnce()
    expect(upstream.locked).toBe(false)
    expect(service.activeJobCount).toBe(0)
  })

  it('releases body reader ownership despite a never settling upstream cancel callback', async () => {
    vi.useFakeTimers()
    const upstream = new ReadableStream<Uint8Array>({ pull() {}, cancel: () => new Promise<void>(() => {}) })
    const { service } = fixture(vi.fn(async () => new Response(upstream)))
    const sender = owner()
    const jobId = id(service.start(sender, startInput()))
    const pending = service.pull(sender, { id: jobId, action: 'read' })
    await vi.advanceTimersByTimeAsync(0)
    expect(service.cancel(sender, { id: jobId })).toBe(true)
    expect(await pending).toEqual({ ok: false, code: 'cancelled' })
    await vi.advanceTimersByTimeAsync(0)
    expect(upstream.locked).toBe(false)
    expect(service.activeJobCount).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['headers', 'repository', 'body'] as const)('bounds the entire %s operation at 30 seconds and releases timers', async (stage) => {
    vi.useFakeTimers()
    const fetch = vi.fn(async () => stage === 'headers' ? new Promise<Response>(() => {}) : new Response(new ReadableStream({ pull() {} })))
    const { service, repository } = fixture(fetch)
    if (stage === 'repository')
      repository.read.mockImplementation(() => new Promise(() => {}))
    const sender = owner()
    const jobId = id(service.start(sender, startInput()))
    const result = service.pull(sender, { id: jobId, action: stage === 'body' ? 'read' : 'head' })
    await vi.advanceTimersByTimeAsync(29999)
    expect(service.activeJobCount).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toEqual({ ok: false, code: 'timeout' })
    expect(service.activeJobCount).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(sender.listenerCount('destroyed')).toBe(0)
  })

  it('denies foreign owners for head, read and cancel', async () => {
    const { service } = fixture()
    const sender = owner(1)
    const foreign = owner(2)
    const jobId = id(service.start(sender, startInput()))
    for (const action of ['head', 'read'])
      expect(await service.pull(foreign, { id: jobId, action })).toEqual({ ok: false, code: 'cancelled' })
    expect(service.cancel(foreign, { id: jobId })).toBe(false)
    expect(await allBytes(service, sender, jobId)).toBe('ok')
  })

  it.each(['destroyed', 'render-process-gone'])('cleans up ownership on %s', async (event) => {
    const { service } = fixture()
    const sender = owner()
    const jobId = id(service.start(sender, startInput()))
    const head = service.pull(sender, { id: jobId, action: 'head' })
    sender.emit(event)
    expect(await head).toEqual({ ok: false, code: 'cancelled' })
    expect(service.activeJobCount).toBe(0)
    expect(sender.listenerCount('destroyed')).toBe(0)
    expect(sender.listenerCount('render-process-gone')).toBe(0)
  })

  it.each(['remove', 'disable', 'edit'] as const)('invalidates active jobs after %s and rejects stale saved requests', async (kind) => {
    const { service, snapshot, fetch } = fixture()
    const sender = owner()
    const jobId = id(service.start(sender, startInput()))
    await service.pull(sender, { id: jobId, action: 'head' })
    if (kind === 'remove') {
      snapshot.records = []
      snapshot.tombstones.push('service-a')
    }
    else if (kind === 'disable') {
      snapshot.records[0].enabled = false
    }
    else {
      snapshot.records[0].baseUrl = 'https://changed.invalid/v1/'
    }
    service.invalidate(snapshot)
    expect(await service.pull(sender, { id: jobId, action: 'read' })).toEqual({ ok: false, code: 'cancelled' })
    const staleId = id(service.start(sender, { ...startInput(), expectedBaseUrl: 'https://fixture.invalid/v1/' }))
    expect(await service.pull(sender, { id: staleId, action: 'head' })).toEqual({ ok: false, code: kind === 'edit' ? 'configuration' : 'unknown-provider' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects missing and ambiguous saved providers and configuration races before credential resolution', async () => {
    const { service, repository, snapshot, getSecret } = fixture()
    const sender = owner()
    repository.read.mockImplementationOnce(() => new Promise(() => {}))
    const pendingId = id(service.start(sender, startInput()))
    await new Promise<void>(resolve => setImmediate(resolve))
    service.invalidate(snapshot)
    expect(await service.pull(sender, { id: pendingId, action: 'head' })).toEqual({ ok: false, code: 'cancelled' })
    for (const records of [[], [record(), { ...record(), id: 'another' }]]) {
      snapshot.records = records
      const jobId = id(service.start(sender, startInput()))
      expect(await service.pull(sender, { id: jobId, action: 'head' })).toEqual({ ok: false, code: 'unknown-provider' })
    }
    expect(getSecret).not.toHaveBeenCalled()
  })

  /**
   * Corte B removed the typed credential from the execution payload.
   *
   * A draft may still name an endpoint that is not persisted yet, because that
   * is how "try this address" works; it may not name a secret. The old test
   * asserted the opposite — that `draft.apiKey` reached the wire — which is
   * precisely the property this cut deletes.
   */
  it('refuses a draft that still carries a credential, and never puts one on the wire', async () => {
    const fetch = vi.fn(async (_url, init) => new Response(new Headers(init?.headers).get('authorization') ?? 'anonymous'))
    const { service, getSecret, snapshot } = fixture(fetch as typeof globalThis.fetch, [])
    const sender = owner()

    // An old client that still sends the key is rejected, not silently stripped:
    // it believes the execution channel transports credentials, and must learn
    // otherwise by failing.
    const legacy = service.start(sender, { ...startInput('openai-compatible'), draft: { baseUrl: 'https://draft.invalid/v1', apiKey: 'typed-synthetic' } } as never)
    expect(legacy.ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(getSecret).not.toHaveBeenCalled()

    // Without the key, a known unsaved draft executes unauthenticated — the vault
    // is not consulted for an address with no record, so nothing is leaked to it.
    const jobId = id(service.start(sender, { ...startInput('openai-compatible'), draft: { baseUrl: 'https://draft.invalid/v1' } }))
    expect(await allBytes(service, sender, jobId)).toBe('anonymous')
    expect(getSecret).not.toHaveBeenCalled()

    snapshot.tombstones.push('openai-compatible')
    for (const providerId of ['openai-compatible', 'custom-unsaved']) {
      const rejectedId = id(service.start(sender, { ...startInput(providerId), draft: { baseUrl: 'https://draft.invalid/v1' } }))
      expect(await service.pull(sender, { id: rejectedId, action: 'head' })).toEqual({ ok: false, code: 'unknown-provider' })
    }
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects any credential-looking field on a draft before touching the network or the vault', async () => {
    const fetch = vi.fn(async () => new Response('ok'))
    const { service, getSecret } = fixture(fetch as typeof globalThis.fetch, [])
    const sender = owner()
    for (const draft of [{ baseUrl: 'https://draft.invalid/v1', apiKey: 'x' }, { baseUrl: 'https://draft.invalid/v1', apiKey: '' }, { baseUrl: 'https://draft.invalid/v1', authorization: 'Bearer x' }]) {
      const result = service.start(sender, { ...startInput('openai-compatible'), draft } as never)
      expect(result).toMatchObject({ ok: false, code: 'configuration' })
    }
    expect(fetch).not.toHaveBeenCalled()
    expect(getSecret).not.toHaveBeenCalled()
  })

  it('bounds draft probes at 15 seconds', async () => {
    vi.useFakeTimers()
    const { service } = fixture(vi.fn(async () => new Promise<Response>(() => {})))
    const sender = owner()
    const jobId = id(service.start(sender, { ...startInput(), draft: { baseUrl: 'https://draft.invalid/' } }))
    const pending = service.pull(sender, { id: jobId, action: 'head' })
    await vi.advanceTimersByTimeAsync(15000)
    expect(await pending).toEqual({ ok: false, code: 'timeout' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never sends a saved vault credential to a changed or unsaved draft endpoint', async () => {
    const authorizations: (string | null)[] = []
    const fetch: typeof globalThis.fetch = vi.fn(async (_url, init) => {
      authorizations.push(new Headers(init?.headers).get('authorization'))
      return new Response('ok')
    })
    const { service, getSecret } = fixture(fetch)
    const sender = owner()
    for (const [providerId, baseUrl] of [
      ['service-a', 'https://other.invalid/v1/'],
      ['openai-compatible', 'https://unsaved.invalid/v1/'],
      ['service-a', 'https://fixture.invalid/v1'],
    ]) {
      const jobId = id(service.start(sender, { ...startInput(providerId), draft: { baseUrl } }))
      expect(await allBytes(service, sender, jobId)).toBe('ok')
    }
    expect(authorizations).toEqual([null, null, 'Bearer service-a-apiKey-synthetic'])
    expect(getSecret).toHaveBeenCalledExactlyOnceWith('service-a', 'apiKey')
  })

  it('rejects a removed known draft even if its record ID differed from its provider ID', async () => {
    const { service, snapshot, fetch } = fixture(undefined, [])
    snapshot.tombstones.push('different-record-id')
    snapshot.protectedCredentialScopes = ['openai-compatible']
    const sender = owner()
    const jobId = id(service.start(sender, { ...startInput('openai-compatible'), draft: { baseUrl: 'https://fixture.invalid/v1/' } }))
    expect(await service.pull(sender, { id: jobId, action: 'head' })).toEqual({ ok: false, code: 'unknown-provider' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends model discovery through the authenticated runtime and returns its bounded pulls', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'model-id', name: 'Model name' }] })))
    const { service } = fixture(fetch)
    const sender = owner()
    const jobId = id(service.start(sender, { providerId: 'service-a', operation: 'models' }))
    expect(JSON.parse(await allBytes(service, sender, jobId))).toEqual({ data: [{ id: 'model-id', label: 'Model name' }] })
    expect(fetch).toHaveBeenCalledWith(new URL('https://fixture.invalid/v1/models'), expect.objectContaining({ method: 'GET' }))
  })

  it('splits large upstream chunks at 64 KiB and denies simultaneous reads', async () => {
    const bytes = new Uint8Array(150000).fill(65)
    const { service } = fixture(vi.fn(async () => new Response(bytes)))
    const sender = owner()
    const jobId = id(service.start(sender, startInput()))
    const firstPending = service.pull(sender, { id: jobId, action: 'read' })
    expect(await service.pull(sender, { id: jobId, action: 'read' })).toEqual({ ok: false, code: 'configuration' })
    const results: LiaTransportPullResult[] = [await firstPending]
    results.push(await service.pull(sender, { id: jobId, action: 'read' }))
    results.push(await service.pull(sender, { id: jobId, action: 'read' }))
    expect(results.map(result => result.ok && result.bytes?.length)).toEqual([65536, 65536, 18928])
    expect(await service.pull(sender, { id: jobId, action: 'read' })).toEqual({ ok: true, done: true })
    expect(service.activeJobCount).toBe(0)
  })

  it('bounds owner/global concurrency without starting rejected jobs', () => {
    const { service } = fixture()
    const owners = [owner(1), owner(2), owner(3), owner(4)]
    for (const sender of owners) {
      for (let index = 0; index < 8; index++)
        id(service.start(sender, startInput()))
      expect(service.start(sender, startInput())).toEqual({ ok: false, code: 'configuration' })
    }
    expect(service.activeJobCount).toBe(32)
    expect(service.start(owner(5), startInput())).toEqual({ ok: false, code: 'configuration' })
  })

  it.each([
    { ...startInput(), providerId: 'x'.repeat(257) },
    { ...startInput(), headers: { authorization: 'private' } },
    { ...startInput(), body: { ...body, headers: { authorization: 'private' } } },
    { ...startInput(), body: { ...body, messages: [{ role: 'user', content: 'x'.repeat(16 * 1024 * 1024) }] } },
    { ...startInput(), draft: { baseUrl: 'https://draft.invalid/', apiKey: 'x'.repeat(16385) } },
    { ...startInput(), draft: { baseUrl: 'https://draft.invalid/', headers: {} } },
    ...['https://user:private@fixture.invalid/', 'https://fixture.invalid/?private=value', 'https://fixture.invalid/#private', 'file:///private', ' https://fixture.invalid/'].map(baseUrl => ({ ...startInput(), draft: { baseUrl } })),
  ])('rejects invalid or oversized IPC payloads before execution', (input) => {
    const { service, fetch, getSecret } = fixture()
    expect(service.start(owner(), input)).toEqual({ ok: false, code: 'configuration' })
    expect(service.activeJobCount).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
    expect(getSecret).not.toHaveBeenCalled()
  })

  it.each([401, 403, 429, 500])('returns only safe HTTP metadata on %s', async (status) => {
    const { service } = fixture(vi.fn(async () => new Response('private-response-key', { status })))
    const sender = owner()
    const jobId = id(service.start(sender, startInput()))
    expect(await service.pull(sender, { id: jobId, action: 'head' })).toEqual({ ok: false, code: [401, 403].includes(status) ? 'credentials' : 'http', status })
    expect(service.activeJobCount).toBe(0)
  })

  it('sanitizes vault and fetch exceptions', async () => {
    for (const cause of ['fetch', 'vault']) {
      const { service, getSecret } = fixture(vi.fn(async () => {
        throw new Error('private-fetch-value')
      }))
      if (cause === 'vault') {
        getSecret.mockImplementation(() => {
          throw new Error('private-vault-value')
        })
      }
      const sender = owner()
      const jobId = id(service.start(sender, startInput()))
      expect(await service.pull(sender, { id: jobId, action: 'head' })).toEqual({ ok: false, code: 'network' })
    }
  })

  it('uses raw Eventa sender metadata and denies missing raw metadata', async () => {
    const { repository, vault, fetch } = fixture()
    vi.stubGlobal('fetch', fetch)
    const context = {} as Parameters<typeof registerLiaTransportExecutionBridge>[0]['context']
    const service = registerLiaTransportExecutionBridge({ context, repository, vault })
    expect(registerLiaTransportExecutionBridge({ context, repository, vault })).toBe(service)
    services.push(service)
    const invoke = handlers.get(electronLiaTransportStart)!
    expect(invoke(startInput(), undefined)).toEqual({ ok: false, code: 'configuration' })
    const sender = owner()
    const jobId = id(invoke(startInput(), { raw: { ipcMainEvent: { sender } } }))
    expect(await allBytes(service, sender, jobId)).toBe('ok')
  })
})
