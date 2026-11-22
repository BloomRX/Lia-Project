import type { TransportRecord, TransportSnapshot } from '../transports/contracts.ts'
import type { LiaTranscriptionRunOutcome, LiaTranscriptionRunRequest } from './contracts.ts'

import { credentialForDestination } from '../credentials/destination.ts'
import { ProviderError } from '../providers/contracts.ts'
import { isNativeRecordingTranscriptionProvider, isTranscriptionLoopback, parseTranscriptionResponse, prepareTranscriptionRequest, resolveTranscriptionDestination } from './transport.ts'

const MAX_AUDIO_BYTES = 24 * 1024 * 1024
const MAX_JSON_BYTES = 8 * 1024 * 1024
const TIMEOUT_MS = 30_000
const MAX_NAME = 200

export function isTranscriptionObject(value: unknown): value is Record<string, unknown> {
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
export function validateTranscriptionRequest(value: unknown): LiaTranscriptionRunRequest {
  if (!isTranscriptionObject(value))
    throw new ProviderError('configuration')
  if (!Object.keys(value).every(key => ['requestId', 'providerId', 'model', 'fileName', 'mimeType', 'bytes', 'responseFormat', 'language', 'prompt', 'temperature'].includes(key)))
    throw new ProviderError('configuration')
  const { requestId, providerId, model, fileName, mimeType, bytes, responseFormat, language, prompt, temperature } = value
  if (requestId !== undefined && !isTranscriptionRequestId(requestId))
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

export function transcriptionFailure(error: unknown): { ok: false, code: ProviderError['code'], status?: number } {
  return error instanceof ProviderError
    ? { ok: false, code: error.code, ...(error.status === undefined ? {} : { status: error.status }) }
    : { ok: false, code: 'network' }
}

export function isTranscriptionRequestId(value: unknown): value is string {
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
  repository: { read: () => Promise<TransportSnapshot> }
  resolveCredential?: (scope: string, key: string, signal: AbortSignal) => Promise<string | undefined>
  supportsLegacy?: (id: string) => boolean
  fetchForProvider?: (providerId: string) => typeof globalThis.fetch
}

export type RemoteTranscriptionApproval = (providerId: string, destination: string, signal: AbortSignal) => Promise<boolean>

export function createLiaTranscriptionService(options: LiaTranscriptionServiceOptions) {
  const active = new Set<AbortController>()
  let disposed = false

  async function transcribe(input: LiaTranscriptionRunRequest, signal?: AbortSignal, approveRemote?: RemoteTranscriptionApproval): Promise<LiaTranscriptionRunOutcome> {
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
      const request = validateTranscriptionRequest(input)
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
      if (native ? record.protocol !== 'audio-transcription' : (!options.supportsLegacy?.(record.definitionId) || record.protocol !== 'chat-completions'))
        throw new ProviderError('configuration')
      const destination = resolveTranscriptionDestination(record)
      const remote = !isTranscriptionLoopback(destination)
      async function requireApprovedRevision() {
        const current = await abortable(options.repository.read(), controller.signal)
        if (current.revision !== snapshot.revision)
          throw new ProviderError('configuration')
      }
      if (remote) {
        if (!approveRemote || !await abortable(approveRemote(record.providerId, destination.href, controller.signal), controller.signal))
          throw new ProviderError('cancelled')
        await requireApprovedRevision()
      }
      const stored = await abortable(options.resolveCredential?.(record.credentialRef.scope, record.credentialRef.key, controller.signal) ?? Promise.resolve(undefined), controller.signal)
      const credential = credentialForDestination(stored, record.credentialRef.scope, destination, native ? 'transcription' : 'chat')
      const { url, init } = prepareTranscriptionRequest(record, request, credential, options.supportsLegacy)
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
      if (remote)
        await requireApprovedRevision()
      controller.signal.throwIfAborted()
      const response = await abortable((options.fetchForProvider?.(record.providerId) ?? globalThis.fetch)(url, {
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
      const projected = parseTranscriptionResponse(record.definitionId, json, options.supportsLegacy)
      if (credential && [projected.text, projected.language, projected.segments?.map(segment => segment.text ?? '').join('')]
        .some(value => value?.includes(credential))) {
        throw new ProviderError('protocol')
      }
      if (controller.signal.aborted)
        throw controller.signal.reason
      return { ok: true, status: response.status, ...projected }
    }
    catch (error) {
      if (controller.signal.aborted)
        return transcriptionFailure(controller.signal.reason)
      return transcriptionFailure(error)
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
