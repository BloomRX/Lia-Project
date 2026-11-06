import type { LiaSecretVault } from '@lia/core/secrets/vault'
import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { TransportRecord } from '../../../../../../../lia/core/src/transports/contracts'
import type { createTransportRepository } from '../../../../../../../lia/core/src/transports/repository'
import type { LiaTranscriptionRunOutcome, LiaTranscriptionRunRequest } from '../../../shared/eventa/lia-transcription'

import { defineInvokeHandler } from '@moeru/eventa'

import { ProviderError } from '../../../../../../../lia/core/src/providers/contracts'
import { electronLiaTranscriptionRun } from '../../../shared/eventa/lia-transcription'
import { isCuratedChatProvider } from '../../../shared/lia/provider-catalog'
import { withLiaProviderHeaders } from './provider-request-headers'

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
const MAX_TEXT = 200_000
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
  const { providerId, model, fileName, mimeType, bytes, responseFormat, language, prompt, temperature } = value
  if (!text(providerId, 256) || !isCuratedChatProvider(providerId))
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
  return { bytes, fileName, language, mimeType, model, prompt, providerId, responseFormat, temperature }
}

function failure(error: unknown): { ok: false, code: ProviderError['code'], status?: number } {
  return error instanceof ProviderError
    ? { ok: false, code: error.code, ...(error.status === undefined ? {} : { status: error.status }) }
    : { ok: false, code: 'network' }
}

/** Reads at most `limit` bytes of a response, then refuses it. */
async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader)
    throw new ProviderError('protocol')
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break
      total += value.byteLength
      if (total > MAX_JSON_BYTES)
        throw new ProviderError('protocol')
      chunks.push(value)
    }
  }
  finally {
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

  async function transcribe(request: LiaTranscriptionRunRequest): Promise<LiaTranscriptionRunOutcome> {
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const snapshot = await options.repository.read()
      const candidates = snapshot.records.filter((record: TransportRecord) => record.providerId === request.providerId)
      // Exactly one enabled record, or the provider is not configured for this
      // application. A tombstoned or disabled provider must not silently fall
      // back to a default endpoint: that would send a stored credential to an
      // address the user removed.
      if (candidates.length !== 1 || !candidates[0].enabled)
        throw new ProviderError('configuration')
      const record = candidates[0]
      const credential = options.vault.getSecret(record.credentialRef.scope, record.credentialRef.key)
      if (!credential)
        throw new ProviderError('credentials')

      const body = new FormData()
      body.append('model', request.model)
      // `FormData` accepts only views over a plain `ArrayBuffer`; copying the
      // bytes keeps the upload identical while satisfying that contract.
      const audio = request.bytes.buffer.slice(request.bytes.byteOffset, request.bytes.byteOffset + request.bytes.byteLength) as ArrayBuffer
      body.append('file', new Blob([audio], { type: request.mimeType }), request.fileName)
      body.append('response_format', request.responseFormat ?? 'json')
      if (request.responseFormat === 'verbose_json')
        body.append('timestamp_granularities[]', 'segment')
      if (request.language !== undefined)
        body.append('language', request.language)
      if (request.prompt !== undefined)
        body.append('prompt', request.prompt)
      if (request.temperature !== undefined)
        body.append('temperature', String(request.temperature))

      const url = new URL('audio/transcriptions', record.baseUrl)
      const response = await withLiaProviderHeaders(fetch, record.providerId)(url, {
        method: 'POST',
        // No `Content-Type`: the multipart boundary belongs to the body, and
        // setting it by hand would break the request.
        headers: { authorization: `Bearer ${credential}` },
        body,
        signal: controller.signal,
      })

      if (!response.ok) {
        // The upstream body is discarded on purpose: it echoes request content
        // often enough to be a leak vector, and the caller only needs the class.
        void response.body?.cancel().catch(() => {})
        throw new ProviderError(response.status === 401 || response.status === 403 ? 'credentials' : 'http', response.status)
      }
      const json = await boundedJson(response)
      if (!object(json))
        throw new ProviderError('protocol')
      const recognized = typeof json.text === 'string' ? json.text : undefined
      if (recognized === undefined)
        throw new ProviderError('protocol')
      if (recognized.length > MAX_TEXT)
        throw new ProviderError('protocol')
      return {
        ok: true,
        status: response.status,
        text: recognized,
        ...(Array.isArray(json.segments) ? { segments: json.segments as Array<{ text?: string }> } : {}),
        ...(typeof json.language === 'string' && json.language.length <= 32 ? { language: json.language } : {}),
      }
    }
    catch (error) {
      if (controller.signal.aborted && !(error instanceof ProviderError))
        return { ok: false, code: 'timeout' }
      return failure(error)
    }
    finally {
      clearTimeout(deadline)
    }
  }

  return { transcribe }
}

/** One main-process bridge; the renderer only ever receives text or a code. */
export function registerLiaTranscriptionBridge(params: {
  context: ReturnType<typeof createContext>['context']
  repository: Repository
  vault: LiaSecretVault
  fetch?: typeof globalThis.fetch
}) {
  const service = createLiaTranscriptionService({ fetch: params.fetch, repository: params.repository, vault: params.vault })
  defineInvokeHandler(params.context, electronLiaTranscriptionRun, async (payload) => {
    try {
      return await service.transcribe(validate(payload))
    }
    catch (error) {
      return failure(error)
    }
  })
  return service
}
