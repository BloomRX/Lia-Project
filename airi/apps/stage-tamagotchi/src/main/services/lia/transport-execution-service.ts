import type { LiaSecretVault } from '@lia/core/secrets/vault'
import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { ChatRequest } from '../../../../../../../lia/core/src/providers/contracts'
import type { TransportRecord, TransportSnapshot } from '../../../../../../../lia/core/src/transports/contracts'
import type { createTransportRepository } from '../../../../../../../lia/core/src/transports/repository'
import type { LiaTransportExecutionFailure, LiaTransportPullResult, LiaTransportStartRequest, LiaTransportStartResult } from '../../../shared/eventa/lia-transport-execution'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { defineInvokeHandler } from '@moeru/eventa'

import { ProviderError } from '../../../../../../../lia/core/src/providers/contracts'
import { ProviderRegistry } from '../../../../../../../lia/core/src/providers/registry'
import { ProviderRuntime } from '../../../../../../../lia/core/src/providers/runtime'
import { electronLiaTransportCancel, electronLiaTransportPull, electronLiaTransportStart } from '../../../shared/eventa/lia-transport-execution'

interface Owner {
  id: number
  isDestroyed: () => boolean
  once: {
    (event: 'destroyed', listener: () => void): unknown
    (event: 'render-process-gone', listener: () => void): unknown
  }
  removeListener: {
    (event: 'destroyed', listener: () => void): unknown
    (event: 'render-process-gone', listener: () => void): unknown
  }
}
type Repository = Pick<ReturnType<typeof createTransportRepository>, 'read'>
const MAX_BODY = 16 * 1024 * 1024
const MAX_CHUNK = 64 * 1024
// Persisted compatibility IDs only; they supply no endpoint, model or vendor defaults.
const knownDraftIds = new Set(['openai-compatible', 'lm-studio'])
const chatKeys = new Set(['model', 'messages', 'stream', 'temperature', 'top_p', 'tools', 'tool_choice', 'parallel_tool_calls', 'max_tokens', 'max_completion_tokens', 'presence_penalty', 'frequency_penalty', 'stop', 'response_format', 'seed', 'reasoning_effort', 'reasoning', 'service_tier', 'user', 'stream_options', 'logprobs', 'top_logprobs', 'modalities', 'audio', 'prediction', 'store', 'metadata', 'verbosity'])

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
}

function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && value.trim() === value && !/[\u0000-\u001F\u007F]/.test(value)
}

function endpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || value.trim() !== value)
    throw new ProviderError('configuration')
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new ProviderError('configuration')
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
    return url.href
  }
  catch {
    throw new ProviderError('configuration')
  }
}

/** Check size/depth before serialization; never accept transport controls in a body. */
function validBody(value: unknown): value is ChatRequest {
  let budget = MAX_BODY
  const visit = (item: unknown, depth = 0): boolean => {
    if (depth > 64 || (budget -= 2) < 0)
      return false
    if (item === null || typeof item === 'boolean')
      return true
    if (typeof item === 'number')
      return Number.isFinite(item)
    if (typeof item === 'string')
      return (budget -= Buffer.byteLength(item)) >= 0
    if (Array.isArray(item))
      return item.every(entry => visit(entry, depth + 1))
    return object(item) && Object.entries(item).every(([key, entry]) => {
      budget -= Buffer.byteLength(key) + 3
      return budget >= 0 && visit(entry, depth + 1)
    })
  }
  return object(value) && Object.keys(value).every(key => chatKeys.has(key))
    && typeof value.model === 'string' && !!value.model.trim() && Array.isArray(value.messages) && value.messages.length > 0
    && (value.stream === undefined || typeof value.stream === 'boolean')
    && visit(value) && Buffer.byteLength(JSON.stringify(value)) <= MAX_BODY
}

function validateStart(value: unknown): LiaTransportStartRequest {
  if (!object(value) || !keys(value, ['providerId', 'expectedBaseUrl', 'operation', 'body', 'draft'])
    || !identifier(value.providerId) || !['chat', 'models'].includes(String(value.operation))) {
    throw new ProviderError('configuration')
  }
  if (value.expectedBaseUrl !== undefined)
    endpoint(value.expectedBaseUrl)
  if (value.operation === 'chat' ? !validBody(value.body) : value.body !== undefined)
    throw new ProviderError('configuration')
  if (value.draft !== undefined) {
    if (!object(value.draft) || !keys(value.draft, ['baseUrl', 'apiKey'])
      || (value.draft.apiKey !== undefined && (typeof value.draft.apiKey !== 'string' || Buffer.byteLength(value.draft.apiKey) > 16384))) {
      throw new ProviderError('configuration')
    }
    endpoint(value.draft.baseUrl)
  }
  return structuredClone(value) as unknown as LiaTransportStartRequest
}

function failure(error: unknown): LiaTransportExecutionFailure {
  return error instanceof ProviderError
    ? { ok: false, code: error.code, ...(error.status === undefined ? {} : { status: error.status }) }
    : { ok: false, code: 'network' }
}

interface Job {
  id: string
  owner: Owner
  providerId: string
  record?: TransportRecord
  controller: AbortController
  deadline?: ReturnType<typeof setTimeout>
  launch?: ReturnType<typeof setImmediate>
  runtime?: ProviderRuntime
  reader?: ReadableStreamDefaultReader<Uint8Array>
  remainder?: Uint8Array
  reading: boolean
  head: Promise<LiaTransportPullResult>
  resolveHead: (result: LiaTransportPullResult) => void
  error?: LiaTransportExecutionFailure
}

/** Main owns credentials and network operations; IPC only carries bounded byte pulls. */
export function createLiaTransportExecutionService(params: { repository: Repository, vault: LiaSecretVault, fetch?: typeof globalThis.fetch }) {
  const jobs = new Map<string, Job>()
  const owners = new Map<Owner, () => void>()
  // Safe terminal metadata is bounded and expires lazily, with no live job/timer.
  const terminals = new Map<string, { owner: Owner, result: LiaTransportExecutionFailure, expires: number }>()
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await (params.fetch ?? globalThis.fetch)(input, init)
    // A transport that ignores AbortSignal may resolve after the job is gone.
    if (init?.signal?.aborted) {
      void response.body?.cancel().catch(() => {})
      throw new ProviderError('cancelled')
    }
    return response
  }

  function prune() {
    for (const [id, entry] of terminals) {
      if (entry.expires <= Date.now() || entry.owner.isDestroyed())
        terminals.delete(id)
    }
    while (terminals.size > 128)
      terminals.delete(terminals.keys().next().value!)
  }

  function detach(owner: Owner) {
    if ([...jobs.values()].some(job => job.owner === owner))
      return
    const cleanup = owners.get(owner)
    if (cleanup) {
      owner.removeListener('destroyed', cleanup)
      owner.removeListener('render-process-gone', cleanup)
      owners.delete(owner)
    }
  }

  function finish(job: Job, error?: LiaTransportExecutionFailure) {
    if (!jobs.delete(job.id))
      return
    clearTimeout(job.deadline)
    if (job.launch)
      clearImmediate(job.launch)
    if (error) {
      job.error = error
      terminals.set(job.id, { owner: job.owner, result: error, expires: Date.now() + 30000 })
      prune()
      job.resolveHead(error)
    }
    job.controller.abort()
    job.runtime?.dispose()
    const reader = job.reader
    job.reader = undefined
    job.remainder = undefined
    if (reader) {
      try {
        void reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      catch {
        // A concurrent abort may already have released this reader.
      }
    }
    detach(job.owner)
  }

  function race<T>(promise: Promise<T>, job: Job): Promise<T> {
    return new Promise((resolve, reject) => {
      const signal = job.controller.signal
      const abort = () => {
        signal.removeEventListener('abort', abort)
        reject(new ProviderError(job.error?.code ?? 'cancelled'))
      }
      promise.then((value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      }, (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      })
      if (signal.aborted)
        abort()
      else
        signal.addEventListener('abort', abort, { once: true })
    })
  }

  async function execute(job: Job, request: LiaTransportStartRequest) {
    try {
      const snapshot = await race(params.repository.read(), job)
      const candidates = snapshot.records.filter(record => record.providerId === request.providerId)
      if (candidates.length > 1 || candidates.some(record => !record.enabled)
        || (candidates.length === 0 && snapshot.tombstones.includes(request.providerId))
        || (candidates.length === 0 && (!request.draft || !knownDraftIds.has(request.providerId) || snapshot.protectedCredentialScopes?.includes(request.providerId)))) {
        throw new ProviderError('unknown-provider')
      }
      const record: TransportRecord = candidates[0] ?? {
        id: request.providerId,
        providerId: request.providerId,
        definitionId: request.providerId,
        type: 'http',
        protocol: 'chat-completions',
        baseUrl: request.draft!.baseUrl,
        enabled: true,
        adapterOptions: {},
        modelIds: [],
        metadata: {},
        credentialRef: { scope: request.providerId, key: 'apiKey' },
      }
      job.record = record
      const savedUrl = endpoint(record.baseUrl)
      const draftUrl = request.draft ? endpoint(request.draft.baseUrl) : undefined
      const mayUseVault = !request.draft || (candidates.length === 1 && draftUrl === savedUrl)
      if (!request.draft && request.expectedBaseUrl !== undefined && endpoint(request.expectedBaseUrl) !== savedUrl)
        throw new ProviderError('configuration')
      const registry = new ProviderRegistry()
      registry.register({ id: record.providerId, protocol: record.protocol })
      const runtime = new ProviderRuntime(registry, {
        fetch,
        resolveCredential: () => {
          if (job.controller.signal.aborted)
            throw new ProviderError('cancelled')
          return request.draft?.apiKey ?? (mayUseVault ? params.vault.getSecret(record.credentialRef.scope, record.credentialRef.key) : undefined)
        },
      })
      job.runtime = runtime
      const config = { providerId: record.providerId, baseUrl: draftUrl ?? savedUrl, timeoutMs: request.draft ? 15000 : 30000 }
      const response = request.operation === 'chat'
        ? await race(runtime.dispatch(config, request.body!, { signal: job.controller.signal }), job)
        : new Response(JSON.stringify({ data: await race(runtime.discover(config, { signal: job.controller.signal }), job) }), { headers: { 'content-type': 'application/json' } })
      if (job.controller.signal.aborted) {
        void response.body?.cancel().catch(() => {})
        return
      }
      job.reader = response.body!.getReader()
      job.resolveHead({ ok: true, status: response.status, contentType: response.headers.get('content-type') ?? '' })
    }
    catch (error) {
      finish(job, job.error ?? failure(error))
    }
    finally {
      // Do not retain a draft key after resolving request headers.
      if (request.draft)
        delete request.draft.apiKey
    }
  }

  function start(owner: Owner | undefined, input: unknown): LiaTransportStartResult {
    prune()
    try {
      if (!owner || owner.isDestroyed())
        throw new ProviderError('configuration')
      const request = validateStart(input)
      if (jobs.size >= 32 || [...jobs.values()].filter(job => job.owner === owner).length >= 8)
        throw new ProviderError('configuration')
      let resolveHead!: Job['resolveHead']
      const head = new Promise<LiaTransportPullResult>((resolve) => {
        resolveHead = resolve
      })
      const job: Job = {
        id: randomUUID(),
        owner,
        providerId: request.providerId,
        controller: new AbortController(),
        reading: false,
        head,
        resolveHead,
      }
      job.deadline = setTimeout(finish, request.draft ? 15000 : 30000, job, { ok: false, code: 'timeout' })
      jobs.set(job.id, job)
      if (!owners.has(owner)) {
        const cleanup = () => {
          for (const current of [...jobs.values()]) {
            if (current.owner === owner)
              finish(current, { ok: false, code: 'cancelled' })
          }
          for (const [id, terminal] of terminals) {
            if (terminal.owner === owner)
              terminals.delete(id)
          }
          detach(owner)
        }
        owners.set(owner, cleanup)
        owner.once('destroyed', cleanup)
        owner.once('render-process-gone', cleanup)
      }
      // The invoke result is available before credentials, fetch or headers.
      job.launch = setImmediate(() => {
        void execute(job, request)
      })
      return { ok: true, id: job.id }
    }
    catch (error) {
      return failure(error)
    }
  }

  async function pull(owner: Owner | undefined, input: unknown): Promise<LiaTransportPullResult> {
    prune()
    if (!object(input) || !keys(input, ['id', 'action']) || !identifier(input.id) || !['head', 'read'].includes(String(input.action)))
      return { ok: false, code: 'configuration' }
    const job = jobs.get(input.id)
    if (!job || job.owner !== owner)
      return terminals.get(input.id)?.owner === owner ? terminals.get(input.id)!.result : { ok: false, code: 'cancelled' }
    if (input.action === 'head')
      return job.head
    if (job.reading)
      return { ok: false, code: 'configuration' }
    job.reading = true
    try {
      const head = await job.head
      if (!head.ok || job.error)
        return job.error ?? head
      const result = job.remainder ? { done: false, value: job.remainder } : await race(job.reader!.read(), job)
      if (job.error)
        return job.error
      if (result.done) {
        finish(job)
        return { ok: true, done: true }
      }
      const chunk = result.value!
      job.remainder = chunk.byteLength > MAX_CHUNK ? chunk.subarray(MAX_CHUNK) : undefined
      return { ok: true, done: false, bytes: Array.from(chunk.subarray(0, MAX_CHUNK)) }
    }
    catch (error) {
      const result = job.error ?? failure(error)
      finish(job, result)
      return result
    }
    finally {
      job.reading = false
    }
  }

  function cancel(owner: Owner | undefined, input: unknown): boolean {
    if (!object(input) || !keys(input, ['id']) || !identifier(input.id))
      return false
    const job = jobs.get(input.id)
    if (!job || job.owner !== owner)
      return false
    finish(job, { ok: false, code: 'cancelled' })
    return true
  }

  function invalidate(snapshot: TransportSnapshot) {
    for (const job of [...jobs.values()]) {
      const records = snapshot.records.filter(record => record.providerId === job.providerId)
      if (!job.record || records.length !== 1 || !records[0].enabled || JSON.stringify(records[0]) !== JSON.stringify(job.record))
        finish(job, { ok: false, code: 'cancelled' })
    }
  }

  function dispose() {
    for (const job of [...jobs.values()])
      finish(job, { ok: false, code: 'cancelled' })
    terminals.clear()
  }

  return {
    start,
    pull,
    cancel,
    invalidate,
    dispose,
    get activeJobCount() {
      return jobs.size
    },
  }
}

const applicationServices = new WeakMap<Repository, ReturnType<typeof createLiaTransportExecutionService>>()

export function registerLiaTransportExecutionBridge(params: {
  context: ReturnType<typeof createContext>['context']
  repository: Repository
  vault: LiaSecretVault
}) {
  let service = applicationServices.get(params.repository)
  if (!service) {
    service = createLiaTransportExecutionService(params)
    applicationServices.set(params.repository, service)
  }
  defineInvokeHandler(params.context, electronLiaTransportStart, (request, options) => service.start(options?.raw?.ipcMainEvent?.sender, request))
  defineInvokeHandler(params.context, electronLiaTransportPull, (request, options) => service.pull(options?.raw?.ipcMainEvent?.sender, request))
  defineInvokeHandler(params.context, electronLiaTransportCancel, (request, options) => service.cancel(options?.raw?.ipcMainEvent?.sender, request))
  return service
}
