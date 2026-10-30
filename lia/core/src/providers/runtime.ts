import type {
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  JsonValue,
  OperationOptions,
  ProviderConfig,
  ProviderModel,
  ProviderRuntimeOptions,
} from './contracts.ts'
import type { ProviderRegistry, RegisteredProvider } from './registry.ts'

import { ProviderError } from './contracts.ts'

export interface ProviderInstance {
  readonly config: Readonly<Required<ProviderConfig>>
  readonly definition: RegisteredProvider
}

interface ActiveOperation {
  providerId: string
  controller: AbortController
  timedOut: boolean
  finish: () => void
}

function validJson(value: unknown, depth = 0): value is JsonValue {
  if (depth > 64)
    return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true
  if (typeof value === 'number')
    return Number.isFinite(value)
  if (Array.isArray(value))
    return value.every(item => validJson(item, depth + 1))
  if (typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    return false
  return Object.values(value).every(item => validJson(item, depth + 1))
}

function validateRequest(request: ChatRequest): void {
  if (typeof request.model !== 'string' || !request.model.trim() || !Array.isArray(request.messages) || request.messages.length === 0)
    throw new ProviderError('configuration')
  if (!request.messages.every((message) => {
    if (!message || Array.isArray(message) || typeof message !== 'object')
      return false
    return typeof message.role === 'string' && ['system', 'developer', 'user', 'assistant', 'tool'].includes(message.role)
  })) {
    throw new ProviderError('configuration')
  }
  if (!Object.values(request).every(value => value === undefined || validJson(value)))
    throw new ProviderError('configuration')
}

function abortError(operation: ActiveOperation): ProviderError {
  return new ProviderError(operation.timedOut ? 'timeout' : 'cancelled')
}

/** Guard complete SSE frames before an SDK can turn an error body into an exception. */
function createSseGuard() {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  const encoder = new TextEncoder()
  const maxFrameBytes = 1024 * 1024
  let pending = ''

  function inspect(frame: string): void {
    if (encoder.encode(frame).length > maxFrameBytes)
      throw new ProviderError('protocol')
    const lines = frame.replace(/^\uFEFF/, '').split(/\r?\n/)
    if (lines.some(line => /^event:\s*error\s*$/.test(line)))
      throw new ProviderError('protocol')
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n')
    if (!data || data === '[DONE]')
      return
    try {
      const parsed = JSON.parse(data)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.error != null)
        throw new ProviderError('protocol')
    }
    catch {
      throw new ProviderError('protocol')
    }
  }

  return (chunk?: Uint8Array, done = false): Uint8Array[] => {
    try {
      pending += decoder.decode(chunk, { stream: !done })
    }
    catch {
      throw new ProviderError('protocol')
    }
    const frames: Uint8Array[] = []
    let boundary
    while ((boundary = /\r?\n\r?\n/.exec(pending)) !== null) {
      const end = boundary.index + boundary[0].length
      const frame = pending.slice(0, end)
      inspect(frame)
      frames.push(encoder.encode(frame))
      pending = pending.slice(end)
    }
    if (encoder.encode(pending).length > maxFrameBytes)
      throw new ProviderError('protocol')
    if (done && pending) {
      inspect(pending)
      frames.push(encoder.encode(pending))
      pending = ''
    }
    return frames
  }
}

function raceAbort<T>(promise: Promise<T>, operation: ActiveOperation): Promise<T> {
  const signal = operation.controller.signal
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(operation))
      return
    }
    const abort = () => reject(abortError(operation))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** Native execution with no dependency on an upstream registry, renderer or SDK. */
export class ProviderRuntime {
  #registry: ProviderRegistry
  #fetch: typeof globalThis.fetch
  #resolveCredential: NonNullable<ProviderRuntimeOptions['resolveCredential']>
  #instances = new Map<string, ProviderInstance>()
  #active = new Set<ActiveOperation>()

  constructor(registry: ProviderRegistry, options: ProviderRuntimeOptions = {}) {
    this.#registry = registry
    this.#fetch = options.fetch ?? ((...args) => globalThis.fetch(...args))
    this.#resolveCredential = options.resolveCredential ?? (() => undefined)
  }

  get instanceCount(): number {
    return this.#instances.size
  }

  get activeOperationCount(): number {
    return this.#active.size
  }

  getInstance(config: ProviderConfig): ProviderInstance {
    const definition = this.#registry.get(config.providerId)
    let baseUrl: string
    try {
      const url = new URL(config.baseUrl)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
        throw new ProviderError('configuration')
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
      baseUrl = url.href
    }
    catch {
      throw new ProviderError('configuration')
    }
    const timeoutMs = config.timeoutMs ?? 30000
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300000)
      throw new ProviderError('configuration')
    const effective = Object.freeze({
      providerId: config.providerId,
      baseUrl,
      credentialRequired: definition.credentialRequired === true || config.credentialRequired === true,
      timeoutMs,
    })
    const current = this.#instances.get(config.providerId)
    if (current && JSON.stringify(current.config) === JSON.stringify(effective))
      return current
    if (current)
      this.dispose(config.providerId)
    const instance = Object.freeze({ config: effective, definition })
    this.#instances.set(config.providerId, instance)
    return instance
  }

  #begin(instance: ProviderInstance, options: OperationOptions): ActiveOperation {
    const controller = new AbortController()
    const forwardAbort = () => controller.abort()
    let timer: ReturnType<typeof setTimeout>
    const operation: ActiveOperation = {
      providerId: instance.config.providerId,
      controller,
      timedOut: false,
      finish: () => {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', forwardAbort)
        this.#active.delete(operation)
      },
    }
    timer = setTimeout(() => {
      operation.timedOut = true
      controller.abort()
    }, instance.config.timeoutMs)
    this.#active.add(operation)
    if (options.signal?.aborted)
      controller.abort()
    else
      options.signal?.addEventListener('abort', forwardAbort, { once: true })
    return operation
  }

  async #request(instance: ProviderInstance, path: string, options: OperationOptions, request?: ChatRequest): Promise<Response> {
    if (options.signal?.aborted)
      throw new ProviderError('cancelled')
    const operation = this.#begin(instance, options)
    try {
      const credential = await raceAbort(Promise.resolve().then(() => this.#resolveCredential(instance.config.providerId)), operation)
      if (operation.controller.signal.aborted)
        throw abortError(operation)
      if (instance.config.credentialRequired && !credential)
        throw new ProviderError('credentials')
      const headers = new Headers({ accept: request?.stream ? 'text/event-stream' : 'application/json' })
      if (credential)
        headers.set('authorization', `Bearer ${credential}`)
      if (request)
        headers.set('content-type', 'application/json')
      const response = await raceAbort(this.#fetch(new URL(path, instance.config.baseUrl), {
        method: request ? 'POST' : 'GET',
        headers,
        body: request ? JSON.stringify(request) : undefined,
        signal: operation.controller.signal,
        redirect: 'error',
      }), operation)
      if (!response.ok) {
        const failure = new ProviderError([401, 403].includes(response.status) ? 'credentials' : 'http', response.status)
        try {
          await raceAbort(response.body?.cancel() ?? Promise.resolve(), operation)
        }
        catch {
          // Preserve safe HTTP metadata even if upstream body cleanup also fails.
          throw failure
        }
        throw failure
      }
      if (!response.body)
        throw new ProviderError('empty')
      if (request?.stream && response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream') {
        try {
          await raceAbort(response.body.cancel(), operation)
        }
        catch {
          throw new ProviderError('protocol')
        }
        throw new ProviderError('protocol')
      }
      return this.#managedBody(response, operation, request?.stream === true)
    }
    catch (error) {
      operation.finish()
      if (error instanceof ProviderError)
        throw error
      if (operation.controller.signal.aborted)
        throw abortError(operation)
      throw new ProviderError('network')
    }
  }

  #managedBody(response: Response, operation: ActiveOperation, streaming: boolean): Response {
    const reader = response.body!.getReader()
    const guard = streaming ? createSseGuard() : undefined
    let closed = false
    let abort: () => void
    const finish = () => {
      closed = true
      operation.controller.signal.removeEventListener('abort', abort)
      operation.finish()
    }
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        abort = () => {
          if (closed)
            return
          controller.error(abortError(operation))
          finish()
          // The operation is already failed; cleanup must not leak a raw exception.
          void reader.cancel().catch(() => {})
        }
        operation.controller.signal.addEventListener('abort', abort, { once: true })
        if (operation.controller.signal.aborted)
          abort()
      },
      pull: async (controller) => {
        try {
          while (true) {
            if (closed)
              return
            const result = await raceAbort(reader.read(), operation)
            if (closed)
              return
            const chunks = guard ? guard(result.value, result.done) : result.done ? [] : [result.value]
            for (const chunk of chunks)
              controller.enqueue(chunk)
            if (result.done) {
              finish()
              controller.close()
              reader.releaseLock()
              return
            }
            if (chunks.length > 0)
              return
          }
        }
        catch (error) {
          if (!closed) {
            controller.error(error instanceof ProviderError ? error : operation.controller.signal.aborted ? abortError(operation) : new ProviderError('network'))
            finish()
            void reader.cancel().catch(() => {})
          }
        }
      },
      cancel: async () => {
        finish()
        try {
          await reader.cancel()
          reader.releaseLock()
        }
        catch {
          throw new ProviderError('network')
        }
      },
    })
    return new Response(body, { status: response.status, headers: response.headers })
  }

  async dispatch(config: ProviderConfig, request: ChatRequest, options: OperationOptions = {}): Promise<Response> {
    validateRequest(request)
    const instance = this.getInstance(config)
    if (!instance.definition.capabilities.text || (request.stream && !instance.definition.capabilities.streaming))
      throw new ProviderError('unsupported')
    return this.#request(instance, 'chat/completions', options, request)
  }

  async chat(config: ProviderConfig, request: ChatRequest, options: OperationOptions = {}): Promise<ChatResponse> {
    const response = await this.dispatch(config, { ...request, stream: false }, options)
    let json
    try {
      json = await response.json()
    }
    catch (error) {
      if (error instanceof ProviderError)
        throw error
      throw new ProviderError('protocol')
    }
    const text = json?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text.trim())
      throw new ProviderError('empty')
    return { text }
  }

  async* stream(config: ProviderConfig, request: ChatRequest, options: OperationOptions = {}): AsyncGenerator<ChatStreamEvent> {
    const response = await this.dispatch(config, { ...request, stream: true }, options)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let hasText = false
    try {
      while (true) {
        const chunk = await reader.read()
        buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true })
        let boundary
        while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
          const event = buffer.slice(0, boundary.index)
          buffer = buffer.slice(boundary.index + boundary[0].length)
          const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n')
          if (!data)
            continue
          if (data === '[DONE]') {
            if (!hasText)
              throw new ProviderError('empty')
            yield { type: 'done' }
            return
          }
          let parsed
          try {
            parsed = JSON.parse(data)
          }
          catch {
            throw new ProviderError('protocol')
          }
          if (parsed.error)
            throw new ProviderError('protocol')
          const text = parsed?.choices?.[0]?.delta?.content
          if (text !== undefined && text !== null && typeof text !== 'string')
            throw new ProviderError('protocol')
          if (typeof text === 'string' && text.length > 0) {
            hasText = hasText || text.trim().length > 0
            yield { type: 'text', text }
          }
        }
        if (chunk.done)
          throw new ProviderError(hasText ? 'protocol' : 'empty')
      }
    }
    finally {
      try {
        await reader.cancel()
      }
      finally {
        reader.releaseLock()
      }
    }
  }

  async discover(config: ProviderConfig, options: OperationOptions = {}): Promise<ProviderModel[]> {
    const instance = this.getInstance(config)
    if (!instance.definition.capabilities.modelDiscovery)
      throw new ProviderError('unsupported')
    const response = await this.#request(instance, 'models', options)
    let json
    try {
      json = await response.json()
    }
    catch (error) {
      if (error instanceof ProviderError)
        throw error
      throw new ProviderError('protocol')
    }
    if (!Array.isArray(json?.data))
      throw new ProviderError('protocol')
    const seen = new Set<string>()
    const models: ProviderModel[] = []
    for (const item of json.data) {
      if (typeof item?.id !== 'string' || !item.id.trim() || seen.has(item.id))
        continue
      seen.add(item.id)
      models.push({ id: item.id, label: typeof item.name === 'string' ? item.name : item.id })
    }
    return models
  }

  dispose(providerId?: string): void {
    for (const operation of this.#active) {
      if (providerId === undefined || operation.providerId === providerId) {
        operation.controller.abort()
        operation.finish()
      }
    }
    if (providerId === undefined)
      this.#instances.clear()
    else
      this.#instances.delete(providerId)
  }
}
