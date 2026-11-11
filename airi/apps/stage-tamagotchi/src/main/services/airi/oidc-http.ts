import type { OidcHttpFailure, OidcHttpPort, OidcHttpPullResult, OidcHttpRequest } from '../../../shared/eventa/lia-oidc-http'
import type { createOidcSessionOwner } from './oidc-session'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { createOidcTextEgress } from './oidc-egress'

const maxChunk = 64 * 1024
const maxJson = 2 * 1024 * 1024
const maxEvent = 256 * 1024
const maxAudio = 32 * 1024 * 1024
const chatFields = new Set(['model', 'messages', 'stream', 'tools', 'tool_choice', 'temperature', 'top_p', 'max_tokens', 'max_completion_tokens', 'stop', 'presence_penalty', 'frequency_penalty', 'seed', 'response_format', 'parallel_tool_calls', 'reasoning_effort', 'stream_options', 'user'])

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
}

function text(value: unknown, limit = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit
}

function fields(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every(key => allowed.includes(key))
}

function jsonWithin(value: unknown, maxBytes: number, forbidAuthority = false): boolean {
  let budget = maxBytes
  const visit = (item: unknown, depth: number): boolean => {
    if (depth > 32 || (budget -= 2) < 0)
      return false
    if (item === null || typeof item === 'boolean')
      return true
    if (typeof item === 'number')
      return Number.isFinite(item)
    if (typeof item === 'string')
      return (budget -= Buffer.byteLength(item)) >= 0
    if (Array.isArray(item))
      return item.length <= 4096 && item.every(entry => visit(entry, depth + 1))
    return record(item) && Object.entries(item).every(([key, entry]) => (!forbidAuthority || !/token|secret|password|authorization|headers|endpoint|url|__proto__|constructor|prototype/i.test(key))
      && (budget -= Buffer.byteLength(key)) >= 0 && visit(entry, depth + 1))
  }
  return visit(value, 0) && Buffer.byteLength(JSON.stringify(value)) <= maxBytes
}

function parse(value: unknown): OidcHttpRequest | undefined {
  if (!record(value) || !jsonWithin(value, maxJson))
    return
  switch (value.kind) {
    case 'chat':
      if (fields(value, ['kind', 'body', 'chatSessionId']) && record(value.body)
        && Object.keys(value.body).every(key => chatFields.has(key)) && text(value.body.model)
        && Array.isArray(value.body.messages) && value.body.messages.length > 0
        && value.body.stream === true && (value.chatSessionId === undefined || text(value.chatSessionId))) {
        return structuredClone(value) as unknown as OidcHttpRequest
      }
      return
    case 'speech':
      if (fields(value, ['kind', 'model', 'voice', 'input', 'responseFormat', 'speed', 'extraBody']) && text(value.model) && text(value.voice) && text(value.input, 4096)
        && (value.responseFormat === undefined || ['mp3', 'wav', 'ogg', 'pcm', 'opus', 'flac', 'aac'].includes(String(value.responseFormat)))
        && (value.speed === undefined || (typeof value.speed === 'number' && Number.isFinite(value.speed) && value.speed >= 0.25 && value.speed <= 4))
        && (value.extraBody === undefined || (record(value.extraBody) && jsonWithin(value.extraBody, 32 * 1024, true)))) {
        return structuredClone(value) as unknown as OidcHttpRequest
      }
      return
    case 'transcription':
    case 'list-chats':
      return fields(value, ['kind']) ? { kind: value.kind } : undefined
    case 'delete-chat':
      return fields(value, ['kind', 'chatId']) && text(value.chatId) && value.chatId !== '.' && value.chatId !== '..' ? { kind: 'delete-chat', chatId: value.chatId } : undefined
    case 'create-chat': {
      const chat = value.chat
      if (!fields(value, ['kind', 'chat']) || !record(chat) || !fields(chat, ['id', 'type', 'title', 'members'])
        || (chat.id !== undefined && !text(chat.id)) || (chat.title !== undefined && !text(chat.title, 1024))
        || (chat.type !== undefined && !['private', 'bot', 'group', 'channel'].includes(String(chat.type)))) {
        return
      }
      if (chat.members !== undefined && (!Array.isArray(chat.members) || chat.members.length > 256 || !chat.members.every(member => record(member)
        && fields(member, ['type', 'userId', 'characterId']) && ['user', 'character', 'bot'].includes(String(member.type))
        && (member.userId === undefined || text(member.userId)) && (member.characterId === undefined || text(member.characterId))))) {
        return
      }
      return structuredClone(value) as unknown as OidcHttpRequest
    }
  }
}

function remoteChat(value: unknown) {
  if (!record(value) || !text(value.id) || !['private', 'bot', 'group', 'channel'].includes(String(value.type))
    || (value.title !== null && typeof value.title !== 'string') || !text(value.createdAt, 64) || !text(value.updatedAt, 64)) {
    throw new Error('Invalid chat response')
  }
  return { id: value.id, type: value.type, title: value.title, createdAt: value.createdAt, updatedAt: value.updatedAt }
}

function privateJson(value: unknown, check: (text: string) => boolean): boolean {
  if (typeof value === 'string')
    return check(value)
  if (Array.isArray(value))
    return value.some(item => privateJson(item, check))
  return record(value) && Object.entries(value).some(([key, item]) => check(key) || privateJson(item, check))
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader)
    throw new Error('Missing JSON response')
  const chunks: Uint8Array[] = []
  let length = 0
  const abort = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      const chunk = await reader.read()
      signal.throwIfAborted()
      if (chunk.done)
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
      length += chunk.value.byteLength
      if (length > maxJson)
        throw new Error('JSON response too large')
      chunks.push(chunk.value)
    }
  }
  finally {
    signal.removeEventListener('abort', abort)
    abort()
    reader.releaseLock()
  }
}

type Session = Pick<ReturnType<typeof createOidcSessionOwner>, 'withAccess' | 'refreshAccess'>

interface Job {
  id: string
  controller: AbortController
  deadline?: ReturnType<typeof setTimeout>
  signal?: AbortSignal
  removeCaller: () => void
  request: OidcHttpRequest
  response: PromiseWithResolvers<OidcHttpPullResult | ReadableStreamDefaultReader<Uint8Array>>
  closed: PromiseWithResolvers<void>
  upload?: ReadableStreamDefaultController<Uint8Array>
  uploadDemand?: PromiseWithResolvers<void>
  uploadEnded: boolean
  uploading: boolean
  uploadBytes: number
  outputBytes: number
  reader?: ReadableStreamDefaultReader<Uint8Array>
  reading: boolean
  remainder?: Uint8Array
  contentType: Extract<OidcHttpPullResult, { ok: true }>['contentType']
  terminal?: OidcHttpFailure
}

/** Inactive Main-owned HTTP ports. Authentication never crosses the port. */
export function createOidcHttpService(options: { origin: URL, session: Session, fetch?: typeof fetch }) {
  const origin = new URL(options.origin)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  if ((origin.protocol !== 'https:' && (origin.protocol !== 'http:' || !local)) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    throw new Error('Invalid OIDC HTTP origin')
  const transport = options.fetch ?? globalThis.fetch
  const windows = new Map<number, OidcHttpPort>()
  let disposed = false
  let active = 0

  function forWindow(windowId: number): OidcHttpPort {
    if (!Number.isSafeInteger(windowId) || windowId <= 0 || (windows.size >= 16 && !windows.has(windowId)))
      throw new Error('Invalid OIDC window')
    const existing = windows.get(windowId)
    if (existing)
      return existing
    const jobs = new Map<string, Job>()
    let closed = disposed

    function finish(job: Job, error?: OidcHttpFailure) {
      if (!job.controller.signal.aborted) {
        active--
        job.terminal = error
        clearTimeout(job.deadline)
        job.removeCaller()
        job.controller.abort()
        job.uploadDemand?.resolve()
        try {
          job.upload?.error(new Error('OIDC upload closed'))
        }
        catch {}
        const reader = job.reader
        if (reader)
          void reader.cancel().catch(() => {}).finally(() => reader.releaseLock())
        job.closed.resolve()
        if (error)
          job.response.resolve(error)
      }
    }

    function errorFor(job: Job): OidcHttpFailure {
      return job.terminal ?? { ok: false, code: 'cancelled' }
    }

    async function execute(job: Job, retried = false) {
      let unauthorized = false
      try {
        const result = await options.session.withAccess(job.controller.signal, async (token, sessionSignal, privateValue) => {
          const signal = AbortSignal.any([job.controller.signal, sessionSignal])
          job.signal = signal
          const abort = () => finish(job, { ok: false, code: 'cancelled' })
          signal.addEventListener('abort', abort, { once: true })
          try {
            signal.throwIfAborted()
            let path = '/api/v1/chats'
            const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
            const init: RequestInit & { duplex?: 'half' } = { credentials: 'omit', redirect: 'error', signal, headers }
            switch (job.request.kind) {
              case 'chat':
                path = '/api/v1/openai/chat/completions'
                init.method = 'POST'
                init.body = JSON.stringify(job.request.body)
                headers['Content-Type'] = 'application/json'
                if (job.request.chatSessionId)
                  headers['x-airi-session-id'] = job.request.chatSessionId
                break
              case 'speech':
                path = '/api/v1/audio/speech'
                init.method = 'POST'
                init.body = JSON.stringify({
                  model: job.request.model,
                  voice: job.request.voice,
                  input: job.request.input,
                  ...(job.request.responseFormat && { response_format: job.request.responseFormat }),
                  ...(job.request.speed !== undefined && { speed: job.request.speed }),
                  ...(job.request.extraBody && { extra_body: job.request.extraBody }),
                })
                headers['Content-Type'] = 'application/json'
                break
              case 'transcription':
                path = '/api/v1/audio/transcriptions/stream'
                init.method = 'POST'
                init.duplex = 'half'
                init.body = new ReadableStream<Uint8Array>({
                  start(controller) {
                    job.upload = controller
                    job.uploadDemand?.resolve()
                  },
                  pull() { job.uploadDemand?.resolve() },
                  cancel() { finish(job, { ok: false, code: 'cancelled' }) },
                }, { highWaterMark: 1 })
                break
              case 'create-chat':
                init.method = 'POST'
                init.body = JSON.stringify(job.request.chat)
                headers['Content-Type'] = 'application/json'
                break
              case 'delete-chat':
                path += `/${encodeURIComponent(job.request.chatId)}`
                init.method = 'DELETE'
                break
            }
            let response = await transport(new URL(path, origin), init)
            if (response.status === 409 && job.request.kind === 'create-chat' && job.request.chat.id && !signal.aborted) {
              const requestedId = job.request.chat.id
              void response.body?.cancel().catch(() => {})
              const all = await transport(new URL('/api/v1/chats', origin), { headers, credentials: 'omit', redirect: 'error', signal })
              if (all.ok) {
                const list = await readJson(all, signal)
                if (record(list) && Array.isArray(list.chats)) {
                  const existing = list.chats.find(chat => record(chat) && chat.id === requestedId)
                  if (existing)
                    response = Response.json(remoteChat(existing))
                }
              }
              else {
                void all.body?.cancel().catch(() => {})
              }
            }
            if (signal.aborted) {
              void response.body?.cancel().catch(() => {})
              signal.throwIfAborted()
            }
            if (!response.ok) {
              void response.body?.cancel().catch(() => {})
              if (response.status === 401) {
                unauthorized = true
                return true
              }
              finish(job, { ok: false, code: response.status === 401 ? 'unauthenticated' : response.status < 500 ? 'rejected' : 'unavailable', status: response.status })
              return true
            }
            const source = response.body?.getReader() ?? (job.request.kind === 'delete-chat' ? new Blob([]).stream().getReader() : undefined)
            if (!source)
              throw new Error('Missing OIDC response body')
            job.reader = source
            const isSse = job.request.kind === 'chat' || job.request.kind === 'transcription'
            if (isSse) {
              if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream'))
                throw new Error('Invalid stream type')
              job.contentType = 'text/event-stream'
              const decoder = new TextDecoder('utf-8', { fatal: true })
              const encoder = new TextEncoder()
              let pending = ''
              let total = 0
              const egress = createOidcTextEgress(privateValue)
              let held = ''
              let partial = false
              let trailingCR = false
              function normalizeLines(text: string, final = false) {
                const raw = (trailingCR ? '\r' : '') + text
                trailingCR = !final && raw.endsWith('\r')
                return (trailingCR ? raw.slice(0, -1) : raw).replace(/\r\n?/g, '\n')
              }
              const events = new ReadableStream<Uint8Array>({
                async pull(controller) {
                  try {
                    while (true) {
                      signal.throwIfAborted()
                      const boundary = /\n\n/.exec(pending)
                      if (boundary) {
                        const end = boundary.index + boundary[0].length
                        const event = pending.slice(0, end)
                        pending = pending.slice(end)
                        if (event.length > maxEvent || privateValue(event) || /^event:\s*error\s*$/m.test(event))
                          throw new Error('Invalid stream event')
                        const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.startsWith('data: ') ? line.slice(6) : line.slice(5)).join('\n')
                        if (data && data !== '[DONE]') {
                          const decoded: unknown = JSON.parse(data)
                          if (privateJson(decoded, privateValue) || (record(decoded) && ('error' in decoded || decoded.type === 'error')))
                            throw new Error('Invalid stream data')
                          partial = job.request.kind === 'transcription' ? egress.inspectTranscription(decoded) : egress.inspectChat(decoded)
                        }
                        held += event
                        if (held.length > maxJson)
                          throw new Error('Held stream exceeds limit')
                        if (partial)
                          continue
                        controller.enqueue(encoder.encode(held))
                        held = ''
                        return
                      }
                      const chunk = await source.read()
                      signal.throwIfAborted()
                      if (chunk.done) {
                        pending += normalizeLines(decoder.decode(), true)
                        if (pending.includes('\n\n'))
                          continue
                        source.releaseLock()
                        if (pending.trim())
                          throw new Error('Incomplete stream event')
                        if (held)
                          controller.enqueue(encoder.encode(held))
                        controller.close()
                        return
                      }
                      total += chunk.value.byteLength
                      if (total > maxAudio || pending.length + chunk.value.byteLength > maxEvent)
                        throw new Error('Stream exceeds limit')
                      pending += normalizeLines(decoder.decode(chunk.value, { stream: true }))
                    }
                  }
                  catch {
                    finish(job, signal.aborted ? errorFor(job) : { ok: false, code: 'unavailable' })
                    controller.error(new Error('OIDC stream failed'))
                  }
                },
                cancel() { void source.cancel().catch(() => {}).finally(() => source.releaseLock()) },
              }, { highWaterMark: 0 })
              job.reader = events.getReader()
            }
            else if (job.request.kind === 'speech') {
              const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
              if (!['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/pcm', 'audio/opus', 'audio/flac', 'audio/aac'].includes(mime ?? ''))
                throw new Error('Invalid audio response')
              job.contentType = mime as Job['contentType']
              let tail = ''
              let held: Uint8Array[] = []
              let heldLength = 0
              const audio = new ReadableStream<Uint8Array>({
                async pull(controller) {
                  try {
                    while (true) {
                      const chunk = await source.read()
                      signal.throwIfAborted()
                      if (chunk.done) {
                        source.releaseLock()
                        if (heldLength)
                          controller.enqueue(Buffer.concat(held))
                        controller.close()
                        return
                      }
                      const combined = tail + Buffer.from(chunk.value).toString('latin1')
                      if (privateValue(combined))
                        throw new Error('Private audio response')
                      tail = combined.slice(-16_384)
                      held.push(chunk.value)
                      heldLength += chunk.value.byteLength
                      if (heldLength > maxAudio)
                        throw new Error('Audio response too large')
                      if (privateValue(tail, true))
                        continue
                      controller.enqueue(Buffer.concat(held))
                      held = []
                      heldLength = 0
                      return
                    }
                  }
                  catch {
                    finish(job, signal.aborted ? errorFor(job) : { ok: false, code: 'unavailable' })
                    controller.error(new Error('OIDC audio failed'))
                  }
                },
                cancel() { void source.cancel().catch(() => {}).finally(() => source.releaseLock()) },
              }, { highWaterMark: 0 })
              job.reader = audio.getReader()
            }
            else {
              const chunks: Uint8Array[] = []
              let length = 0
              while (true) {
                const chunk = await source.read()
                signal.throwIfAborted()
                if (chunk.done)
                  break
                length += chunk.value.byteLength
                if (length > maxJson)
                  throw new Error('Chat response too large')
                chunks.push(chunk.value)
              }
              source.releaseLock()
              let data: unknown = { ok: true }
              if (job.request.kind !== 'delete-chat') {
                const raw = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
                if (job.request.kind === 'list-chats') {
                  if (!record(raw) || !Array.isArray(raw.chats) || raw.chats.length > 4096)
                    throw new Error('Invalid chat list')
                  data = { chats: raw.chats.map(remoteChat) }
                }
                else {
                  data = remoteChat(raw)
                }
              }
              const serialized = JSON.stringify(data)
              if (privateJson(data, privateValue))
                throw new Error('Invalid chat projection')
              job.reader = new Blob([serialized]).stream().getReader()
            }
            job.response.resolve(job.reader)
            await job.closed.promise
            return true
          }
          finally {
            signal.removeEventListener('abort', abort)
          }
        })
        const accessSignal = job.signal ?? job.controller.signal
        if (accessSignal.aborted) {
          finish(job, { ok: false, code: 'cancelled' })
        }
        else if (unauthorized && result !== undefined) {
          // Refresh outside the old access action. Only the read is replayed.
          const renewed = !retried && await options.session.refreshAccess(accessSignal)
          if (accessSignal.aborted)
            finish(job, { ok: false, code: 'cancelled' })
          else if (renewed && job.request.kind === 'list-chats')
            await execute(job, true)
          else
            finish(job, { ok: false, code: 'unauthenticated', status: 401 })
        }
        else if (result === undefined && !job.controller.signal.aborted) {
          finish(job, { ok: false, code: 'unauthenticated' })
        }
      }
      catch {
        finish(job, job.controller.signal.aborted ? errorFor(job) : { ok: false, code: 'unavailable' })
      }
    }

    const port: OidcHttpPort = {
      open(payload, caller) {
        if (closed || disposed || caller?.aborted)
          return { ok: false, code: 'cancelled' }
        const request = parse(payload)
        if (!request)
          return { ok: false, code: 'invalid-request' }
        for (const [id, job] of jobs) {
          if (job.controller.signal.aborted)
            jobs.delete(id)
        }
        if (jobs.size >= 4 || active >= 32)
          return { ok: false, code: 'busy' }
        const controller = new AbortController()
        const job: Job = {
          id: randomUUID(),
          controller,
          request,
          response: Promise.withResolvers(),
          closed: Promise.withResolvers(),
          removeCaller: () => {},
          uploadEnded: false,
          uploading: false,
          uploadBytes: 0,
          outputBytes: 0,
          reading: false,
          contentType: 'application/json',
        }
        const cancel = () => finish(job, { ok: false, code: 'cancelled' })
        job.removeCaller = () => caller?.removeEventListener('abort', cancel)
        job.deadline = setTimeout(finish, 120_000, job, { ok: false, code: 'timeout' })
        caller?.addEventListener('abort', cancel, { once: true })
        jobs.set(job.id, job)
        active++
        void execute(job)
        return { ok: true, id: job.id }
      },
      async pull(id) {
        const job = jobs.get(id)
        if (!job || job.controller.signal.aborted)
          return job ? errorFor(job) : { ok: false, code: 'invalid-request' }
        if (job.reading)
          return { ok: false, code: 'busy' }
        job.reading = true
        try {
          const response = await job.response.promise
          if (job.controller.signal.aborted)
            return errorFor(job)
          if ('ok' in response)
            return response
          const chunk = job.remainder ? { done: false, value: job.remainder } : await response.read()
          if (job.controller.signal.aborted)
            return errorFor(job)
          const bytes = chunk.value ?? new Uint8Array()
          if (!job.remainder)
            job.outputBytes += bytes.byteLength
          if (job.outputBytes > maxAudio)
            throw new Error('OIDC output exceeds limit')
          if (chunk.done) {
            finish(job)
            jobs.delete(id)
          }
          job.remainder = bytes.byteLength > maxChunk ? bytes.subarray(maxChunk) : undefined
          return { ok: true, done: !!chunk.done, contentType: job.contentType, bytes: Array.from(bytes.subarray(0, maxChunk)) }
        }
        catch {
          finish(job, job.controller.signal.aborted ? errorFor(job) : { ok: false, code: 'unavailable' })
          return errorFor(job)
        }
        finally { job.reading = false }
      },
      async write(id, chunk) {
        const job = jobs.get(id)
        if (!job || job.request.kind !== 'transcription' || job.uploadEnded || job.controller.signal.aborted)
          return { ok: false, code: 'invalid-request' }
        if (job.uploading)
          return { ok: false, code: 'busy' }
        if (chunk !== null && (!(chunk instanceof Uint8Array) || !chunk.byteLength || chunk.byteLength > maxChunk || job.uploadBytes + chunk.byteLength > maxAudio))
          return { ok: false, code: 'invalid-request' }
        job.uploading = true
        // Capture mutable caller bytes before the first await.
        const bytes = chunk?.slice()
        try {
          while (!job.upload || (job.upload.desiredSize ?? 0) <= 0) {
            if (job.controller.signal.aborted)
              return errorFor(job)
            job.uploadDemand = Promise.withResolvers<void>()
            // The owner can still be refreshing before upload setup.
            await Promise.race([job.uploadDemand.promise, job.closed.promise])
          }
          if (job.controller.signal.aborted)
            return errorFor(job)
          if (bytes) {
            job.upload.enqueue(bytes)
            job.uploadBytes += bytes.byteLength
          }
          else {
            job.uploadEnded = true
            job.upload.close()
          }
          return { ok: true }
        }
        catch {
          finish(job, { ok: false, code: 'unavailable' })
          return errorFor(job)
        }
        finally { job.uploading = false }
      },
      cancel(id) {
        const job = jobs.get(id)
        if (!job || job.controller.signal.aborted)
          return false
        finish(job, { ok: false, code: 'cancelled' })
        return true
      },
      dispose() {
        closed = true
        for (const job of jobs.values())
          finish(job, { ok: false, code: 'cancelled' })
        jobs.clear()
        windows.delete(windowId)
      },
    }
    windows.set(windowId, port)
    return port
  }

  return {
    forWindow,
    dispose() {
      disposed = true
      for (const port of windows.values())
        port.dispose()
    },
  }
}
