import type { LiaSecretVault } from '@lia/core/secrets/vault'
import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { WebContents } from 'electron'

import type { TransportRecord } from '../../../../../../../lia/core/src/transports/contracts'
import type { createTransportRepository } from '../../../../../../../lia/core/src/transports/repository'
import type { LiaTranscriptionRunOutcome, LiaTranscriptionRunRequest } from '../../../shared/eventa/lia-transcription'

import { defineInvokeHandler } from '@moeru/eventa'

import { ProviderError } from '../../../../../../../lia/core/src/providers/contracts'
import { electronLiaTranscriptionCancel, electronLiaTranscriptionRun } from '../../../shared/eventa/lia-transcription'
import { isCuratedChatProvider } from '../../../shared/lia/provider-catalog'
import { resolveMainCredential } from './credential-owner-access'
import { withLiaProviderHeaders } from './provider-request-headers'
import { isNativeRecordingTranscriptionProvider, parseTranscriptionResponse, prepareTranscriptionRequest } from './transcription-adapters'

/**
 * Speech-to-text executed in the main process.
 *
 * Why this exists: the Lia's transcription target is Groq, and Groq is a curated
 * chat provider whose credential the renderer is no longer allowed to read.
 * Building the transcription client in the renderer — which is what the shared
 * hearing pipeline does by default — therefore required keeping one exception in
 * `canRendererReadLegacySecret`. This service removes the need for it.
 *
 * Scope, deliberately narrow:
 *
 *  - it does NOT reimplement the hearing pipeline. The File, model, response
 *    format, language, prompt and temperature are the ones the pipeline already
 *    computed; only the HTTP call moves.
 *  - it does NOT introduce a second transport registry. The endpoint comes from
 *    the same `lia-transports.json` record chat uses, so "this provider is
 *    configured" means the same thing in both paths, and a removed provider
 *    stops transcribing exactly as it stops chatting.
 *  - it does NOT accept an endpoint or a credential from the caller. Both are
 *    main's to resolve; the renderer sends audio and options.
 */

const MAX_AUDIO_BYTES = 24 * 1024 * 1024
const MAX_JSON_BYTES = 8 * 1024 * 1024
const TIMEOUT_MS = 30_000
const MAX_NAME = 200

type Repository = Pick<ReturnType<typeof createTransportRepository>, 'read'>

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

/**
 * Normalizes and validates the request, or throws a coded failure.
 *
 * Everything optional stays optional: the pipeline chooses `verbose_json` only
 * when a confidence threshold is active, and a language/prompt only when the
 * provider config carries one.
 */
function validate(value: unknown): LiaTranscriptionRunRequest {
  if (!object(value))
    throw new ProviderError('configuration')
  if (!Object.keys(value).every(key => ['requestId', 'providerId', 'model', 'fileName', 'mimeType', 'bytes', 'responseFormat', 'language', 'prompt', 'temperature'].includes(key)))
    throw new ProviderError('configuration')
  const { requestId, providerId, model, fileName, mimeType, bytes, responseFormat, language, prompt, temperature } = value
  if (requestId !== undefined && !requestIdentifier(requestId))
    throw new ProviderError('configuration')
  if (!text(providerId, 256))
    throw new ProviderError('configuration')
  if (!text(model, MAX_NAME) || !text(fileName, MAX_NAME) || !text(mimeType, MAX_NAME))
    throw new ProviderError('configuration')
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_AUDIO_BYTES)
    throw new ProviderError('configuration')
  if (responseFormat !== undefined && responseFormat !== 'json' && responseFormat !== 'verbose_json')
    throw new ProviderError('configuration')
  if (language !== undefined && (typeof language !== 'string' || language.length > 32))
    throw new ProviderError('configuration')
  if (prompt !== undefined && (typeof prompt !== 'string' || prompt.length > 4000))
    throw new ProviderError('configuration')
  if (temperature !== undefined && (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 1))
    throw new ProviderError('configuration')
  return { requestId, bytes, fileName, language, mimeType, model, prompt, providerId, responseFormat, temperature }
}

function failure(error: unknown): { ok: false, code: ProviderError['code'], status?: number } {
  return error instanceof ProviderError
    ? { ok: false, code: error.code, ...(error.status === undefined ? {} : { status: error.status }) }
    : { ok: false, code: 'network' }
}

function requestIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

/** Stops waiting even when a dependency ignores its abort signal. */
function abortable<T>(operation: Promise<T>, signal: AbortSignal, late?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    function cleanup() {
      signal.removeEventListener('abort', abort)
    }
    function abort() {
      cleanup()
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted)
      abort()
    operation.then((value) => {
      cleanup()
      if (signal.aborted) {
        try {
          late?.(value)
        }
        catch { /* The caller has already cancelled; cleanup must not reject separately. */ }
        reject(signal.reason)
      }
      else {
        resolve(value)
      }
    }, (error) => {
      cleanup()
      reject(error)
    })
  })
}

/** Reads at most `limit` bytes of a response, then refuses it. */
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader)
    throw new ProviderError('protocol')
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted)
    cancel()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal)
      if (done)
        break
      total += value.byteLength
      if (total > MAX_JSON_BYTES)
        throw new ProviderError('protocol')
      chunks.push(value)
    }
  }
  finally {
    signal.removeEventListener('abort', cancel)
    if (signal.aborted || total > MAX_JSON_BYTES)
      cancel()
    try {
      reader.releaseLock()
    }
    catch {
      // A concurrent abort may already have released it.
    }
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(body))
  }
  catch {
    throw new ProviderError('protocol')
  }
}

export interface LiaTranscriptionServiceOptions {
  repository: Repository
  vault: LiaSecretVault
  fetch?: typeof globalThis.fetch
}

export function createLiaTranscriptionService(options: LiaTranscriptionServiceOptions) {
  const fetch = options.fetch ?? globalThis.fetch

  const active = new Set<AbortController>()
  let disposed = false

  async function transcribe(input: LiaTranscriptionRunRequest, signal?: AbortSignal): Promise<LiaTranscriptionRunOutcome> {
    const controller = new AbortController()
    active.add(controller)
    const cancel = () => controller.abort(new ProviderError('cancelled'))
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted || disposed)
      cancel()
    const deadline = setTimeout(() => controller.abort(new ProviderError('timeout')), TIMEOUT_MS)
    try {
      if (controller.signal.aborted)
        throw controller.signal.reason
      const request = validate(input)
      const snapshot = await abortable(options.repository.read(), controller.signal)
      const candidates = snapshot.records.filter((record: TransportRecord) => record.providerId === request.providerId)
      // Exactly one enabled record, or the provider is not configured for this
      // application. A tombstoned or disabled provider must not silently fall
      // back to a default endpoint: that would send a stored credential to an
      // address the user removed.
      if (candidates.length !== 1 || !candidates[0].enabled)
        throw new ProviderError('configuration')
      const record = candidates[0]
      const native = isNativeRecordingTranscriptionProvider(record.definitionId)
      if (native ? record.protocol !== 'audio-transcription' : (!isCuratedChatProvider(record.definitionId) || record.protocol !== 'chat-completions'))
        throw new ProviderError('configuration')
      const credential = await abortable(resolveMainCredential(options.vault, record.credentialRef.scope, record.credentialRef.key, controller.signal), controller.signal)
      const { url, init } = prepareTranscriptionRequest(record, request, credential)
      // Node's multipart Blob producer may enqueue after fetch abort closes its
      // stream. Finish bounded encoding before attaching the HTTP abort signal.
      // Cancellation still ends this operation immediately and prevents dispatch.
      if (init.body instanceof FormData) {
        const encoded = new Request(url, { method: 'POST', body: init.body })
        init.body = await abortable(encoded.arrayBuffer(), controller.signal)
        const headers = new Headers(init.headers)
        headers.set('content-type', encoded.headers.get('content-type')!)
        init.headers = headers
      }
      const response = await abortable(withLiaProviderHeaders(fetch, record.providerId)(url, {
        ...init,
        redirect: 'error',
        signal: controller.signal,
      }), controller.signal, (response) => { void response.body?.cancel().catch(() => {}) })

      if (!response.ok) {
        // The upstream body is discarded on purpose: it echoes request content
        // often enough to be a leak vector, and the caller only needs the class.
        void response.body?.cancel().catch(() => {})
        throw new ProviderError(response.status === 401 || response.status === 403 ? 'credentials' : 'http', response.status)
      }
      const json = await boundedJson(response, controller.signal)
      const projected = parseTranscriptionResponse(record.definitionId, json)
      if (controller.signal.aborted)
        throw controller.signal.reason
      return { ok: true, status: response.status, ...projected }
    }
    catch (error) {
      if (controller.signal.aborted)
        return failure(controller.signal.reason)
      return failure(error)
    }
    finally {
      clearTimeout(deadline)
      signal?.removeEventListener('abort', cancel)
      active.delete(controller)
    }
  }

  function dispose() {
    disposed = true
    for (const controller of active)
      controller.abort(new ProviderError('cancelled'))
  }

  return { transcribe, dispose }
}

/** One main-process bridge; the renderer only ever receives text or a code. */
export function registerLiaTranscriptionBridge(params: {
  context: ReturnType<typeof createContext>['context']
  repository: Repository
  vault: LiaSecretVault
  fetch?: typeof globalThis.fetch
}) {
  const service = createLiaTranscriptionService({ fetch: params.fetch, repository: params.repository, vault: params.vault })
  type Owner = WebContents
  const pending = new Map<string, { owner: Owner, controller: AbortController, cleanup: () => void }>()
  let disposed = false
  defineInvokeHandler(params.context, electronLiaTranscriptionRun, async (payload, options) => {
    try {
      const request = validate(payload)
      const owner = options?.raw?.ipcMainEvent?.sender
      if (disposed || !owner || owner.isDestroyed() || !requestIdentifier(request.requestId))
        throw new ProviderError('configuration')
      if (pending.has(request.requestId) || pending.size >= 32 || [...pending.values()].filter(job => job.owner === owner).length >= 8)
        throw new ProviderError('configuration')
      const controller = new AbortController()
      const cleanup = () => controller.abort()
      const job = { owner, controller, cleanup }
      pending.set(request.requestId, job)
      owner.once('destroyed', cleanup)
      owner.once('render-process-gone', cleanup)
      try {
        return await service.transcribe(request, controller.signal)
      }
      finally {
        if (pending.get(request.requestId) === job)
          pending.delete(request.requestId)
        owner.removeListener('destroyed', cleanup)
        owner.removeListener('render-process-gone', cleanup)
      }
    }
    catch (error) {
      return failure(error)
    }
  })
  defineInvokeHandler(params.context, electronLiaTranscriptionCancel, (payload, options) => {
    if (!object(payload) || Object.keys(payload).length !== 1 || !requestIdentifier(payload.requestId))
      return { ok: false }
    const job = pending.get(payload.requestId)
    if (!job || job.owner !== options?.raw?.ipcMainEvent?.sender)
      return { ok: false }
    job.controller.abort()
    return { ok: true }
  })
  return {
    ...service,
    dispose() {
      disposed = true
      for (const job of pending.values()) {
        job.controller.abort()
        job.owner.removeListener('destroyed', job.cleanup)
        job.owner.removeListener('render-process-gone', job.cleanup)
      }
      pending.clear()
      service.dispose()
    },
  }
}
