import type { OidcPrivateValueCheck } from './oidc-session'

import { Buffer } from 'node:buffer'

import { defineInvoke, defineInvokeEventa, defineOutboundEventa } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/websocket/native'

import { createOidcTextEgress } from './oidc-egress'

interface WireMessage {
  id: string
  chatId: string
  senderId: string | null
  role: 'system' | 'user' | 'assistant' | 'tool' | 'error'
  content: string
  seq: number
  createdAt: number
  updatedAt: number
}
interface NewMessagesPayload { chatId: string, messages: WireMessage[], fromSeq: number, toSeq: number }
interface SendMessagesRequest { chatId: string, messages: Array<{ id: string, role: string, content: string }> }
interface SendMessagesResponse { seq: number }
interface PullMessagesRequest { chatId: string, afterSeq: number, limit?: number }
interface PullMessagesResponse { messages: WireMessage[], seq: number }

// Lia owns this narrow wire contract. Compatibility is exercised against the
// server's public Eventa declarations in the fixture, without a runtime import.
const authenticate = defineInvokeEventa<{ userId: string }, { token: string }>('chat:authenticate')
const sendMessages = defineInvokeEventa<SendMessagesResponse, SendMessagesRequest>('chat:send-messages')
const pullMessages = defineInvokeEventa<PullMessagesResponse, PullMessagesRequest>('chat:pull-messages')
const newMessages = defineOutboundEventa<NewMessagesPayload>('chat:new-messages')

type Status = 'idle' | 'connecting' | 'open' | 'closed'
type Context = ReturnType<typeof createContext>['context']
type WithAccess = <T>(caller: AbortSignal, action: (token: string, signal: AbortSignal, containsPrivateValue: OidcPrivateValueCheck) => Promise<T>) => Promise<T | undefined>

export interface OidcSpeechStart {
  model: string
  voice: string
  responseFormat?: 'mp3' | 'opus' | 'aac' | 'flac' | 'pcm'
  extraBody?: Record<string, unknown>
  ttsTrigger?: 'auto' | 'manual'
  ttsSource?: 'chat_auto_tts' | 'manual_preview' | 'settings_test'
  ttsVoiceType?: 'official_default' | 'official_selected' | 'custom_configured' | 'voice_pack' | 'unknown'
}

export type OidcSpeechEvent
  = | { event: 'audio', audio: ArrayBuffer }
    | { event: 'session.started' | 'session.finished' | 'sentence.start' | 'sentence.end' | 'subtitle', text?: string, payload?: { text?: string, index?: number, start?: number, end?: number } }

interface SpeechHandle {
  done: Promise<void>
  send: (frame: unknown) => void
  appendText: (text: string) => void
  finish: () => void
  cancel: () => void
}

const maxFrame = 256 * 1024
const maxBuffer = 512 * 1024
const roles = ['system', 'user', 'assistant', 'tool', 'error']
const failure = () => new Error('OIDC socket unavailable')

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
}

function text(value: unknown, max = 1024): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every(key => keys.includes(key))
}

function safeExtra(value: unknown, depth = 0): boolean {
  if (depth > 8)
    return false
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))
    return true
  if (Array.isArray(value))
    return value.length <= 128 && value.every(item => safeExtra(item, depth + 1))
  return object(value) && Object.keys(value).length <= 128 && Object.entries(value).every(([key, item]) => !/token|secret|password|authorization|headers|endpoint|url|__proto__|constructor|prototype/i.test(key) && safeExtra(item, depth + 1))
}

function wireMessage(value: unknown): value is WireMessage {
  return object(value) && text(value.id) && text(value.chatId) && (value.senderId === null || text(value.senderId))
    && roles.includes(value.role as string) && typeof value.content === 'string' && value.content.length <= 64 * 1024
    && integer(value.seq) && integer(value.createdAt) && integer(value.updatedAt)
}

function messages(value: unknown): value is WireMessage[] {
  return Array.isArray(value) && value.length <= 256 && value.every(wireMessage)
}

function projectMessages(value: WireMessage[]): WireMessage[] {
  return value.map(({ id, chatId, senderId, role, content, seq, createdAt, updatedAt }) => ({ id, chatId, senderId, role, content, seq, createdAt, updatedAt }))
}

function push(value: unknown): NewMessagesPayload | undefined {
  if (!object(value) || !text(value.chatId) || !integer(value.fromSeq) || !integer(value.toSeq)
    || value.fromSeq > value.toSeq || !messages(value.messages) || value.messages.some(message => message.chatId !== value.chatId)) {
    return
  }
  return { chatId: value.chatId, fromSeq: value.fromSeq, toSeq: value.toSeq, messages: projectMessages(value.messages) }
}

function notify<T>(listeners: Set<(event: T) => void>, value: T) {
  for (const listener of listeners) {
    try {
      listener(value)
    }
    catch { /* A UI callback cannot affect transport ownership. */ }
  }
}

function reflectsSecret(value: unknown, privateValue: (text: string) => boolean, depth = 0): boolean {
  if (depth > 32)
    return true
  if (typeof value === 'string') {
    if (privateValue(value))
      return true
    try {
      return privateValue(decodeURIComponent(value))
    }
    catch { return false }
  }
  if (Array.isArray(value))
    return value.some(item => reflectsSecret(item, privateValue, depth + 1))
  if (object(value))
    return Object.entries(value).some(([key, item]) => privateValue(key) || reflectsSecret(item, privateValue, depth + 1))
  return false
}

/** Prepared Main-only adapter. No IPC registration or production consumer. */
export function createOidcSocketService(options: {
  origin: URL
  withAccess: WithAccess
  refreshAccess?: (signal: AbortSignal) => Promise<boolean>
  createWebSocket?: (url: string) => WebSocket
}) {
  const { protocol, hostname, username, password, pathname, search, hash } = options.origin
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
  if ((protocol !== 'https:' && (protocol !== 'http:' || !loopback)) || username || password || pathname !== '/' || search || hash)
    throw new Error('Invalid desktop OIDC origin')
  const base = options.origin.origin
  const factory = options.createWebSocket ?? (url => new WebSocket(url))
  const windows = new Map<number, ReturnType<typeof makeWindow>>()
  let disposed = false

  function url(path: string, token?: string) {
    const result = new URL(path, base)
    result.protocol = protocol === 'https:' ? 'wss:' : 'ws:'
    if (token)
      result.searchParams.set('token', token)
    return result.href
  }

  function makeWindow() {
    const lifetime = new AbortController()
    let dead = false
    let enabled = false
    let status: Status = 'idle'
    let ctx: Context | undefined
    let socket: WebSocket | undefined
    let connection: AbortController | undefined
    let reconnect: ReturnType<typeof setTimeout> | undefined
    let retries = 0
    let authRefreshUsed = false
    let connecting: Promise<boolean> | undefined
    let pending = 0
    const statusListeners = new Set<(value: Status) => void>()
    const pushListeners = new Set<(value: NewMessagesPayload) => void>()
    const speeches = new Set<ReturnType<typeof startSpeech>>()
    const setStatus = (value: Status) => {
      status = value
      notify(statusListeners, value)
    }

    function stopChat() {
      clearTimeout(reconnect)
      reconnect = undefined
      connection?.abort()
      connection = undefined
      connecting = undefined
      ctx?.abort(failure())
      ctx = undefined
      socket = undefined
    }

    function schedule() {
      if (!enabled || dead || reconnect)
        return
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(retries++, 5))
      reconnect = setTimeout(() => {
        reconnect = undefined
        void connect()
      }, Math.floor(delay * (0.5 + Math.random() * 0.5)))
      reconnect.unref?.()
    }

    async function connect(): Promise<boolean> {
      if (dead)
        return false
      enabled = true
      if (status === 'open')
        return true
      if (connecting)
        return connecting
      clearTimeout(reconnect)
      reconnect = undefined
      connection?.abort()
      const attempt = new AbortController()
      connection = attempt
      const caller = AbortSignal.any([lifetime.signal, attempt.signal])
      setStatus('connecting')
      let ready!: (value: boolean) => void
      let settled = false
      const result = new Promise<boolean>((resolve) => {
        ready = (value) => {
          if (!settled) {
            settled = true
            resolve(value)
          }
        }
      })
      connecting = result
      let unauthorized = false
      let ownerAborted = false
      let accessSignal = caller
      let accessAccepted = false
      void options.withAccess(caller, async (token, signal, privateValue) => {
        if (signal.aborted)
          return
        accessSignal = AbortSignal.any([caller, signal])
        await new Promise<void>((resolve) => {
          let ws: WebSocket
          let context: Context | undefined
          let stopPush: (() => void) | undefined
          let finished = false
          let timer: ReturnType<typeof setTimeout> | undefined
          const finish = () => {
            if (finished)
              return
            finished = true
            ownerAborted = signal.aborted
            clearTimeout(timer)
            signal.removeEventListener('abort', finish)
            stopPush?.()
            context?.abort(failure())
            if (connection === attempt) {
              ctx = undefined
              socket = undefined
            }
            if (ws) {
              ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
              try {
                ws.close()
              }
              catch {}
            }
            ready(false)
            resolve()
          }
          timer = setTimeout(finish, 15_000)
          signal.addEventListener('abort', finish, { once: true })
          try {
            ws = factory(url('/ws/v2/chat'))
            socket = ws
            // Eventa's native adapter logs malformed wire data. A private facade
            // admits only bounded valid envelopes and never exposes a bearer URL.
            const facade = {
              url: url('/ws/v2/chat'),
              send(data: string) {
                if (finished || signal.aborted || ws.bufferedAmount > maxBuffer)
                  throw failure()
                ws.send(data)
              },
              onmessage: null,
              onopen: null,
              onclose: null,
              onerror: null,
            } as unknown as WebSocket
            context = createContext(facade).context
            stopPush = context.on(newMessages, (event) => {
              if (!finished && status === 'open' && connection === attempt) {
                const value = push(event.body)
                if (value)
                  notify(pushListeners, value)
                else
                  finish()
              }
            })
            ws.onmessage = (event) => {
              if (finished || signal.aborted)
                return
              try {
                if (typeof event.data !== 'string' || event.data.length > maxFrame)
                  throw failure()
                const body: unknown = JSON.parse(event.data)
                if (reflectsSecret(body, privateValue))
                  throw failure()
                if (!object(body) || !text(body.id) || typeof body.type !== 'string' || !object(body.payload) || body.payload.id !== body.type)
                  throw failure()
                facade.onmessage?.(event)
              }
              catch { finish() }
            }
            ws.onopen = () => {
              if (finished || signal.aborted)
                return
              void defineInvoke(context!, authenticate)({ token }).then((response) => {
                if (!object(response) || !text(response.userId))
                  throw failure()
                if (!finished && !signal.aborted && connection === attempt) {
                  clearTimeout(timer)
                  ctx = context
                  retries = 0
                  authRefreshUsed = false
                  setStatus('open')
                  ready(true)
                }
              }).catch(finish)
            }
            ws.onerror = finish
            ws.onclose = (event) => {
              unauthorized = event.code === 4001
              finish()
            }
          }
          catch { finish() }
        })
        return true
      }).then((result) => {
        accessAccepted = result === true
      }).catch(() => {}).finally(async () => {
        ready(false)
        if (connecting === result)
          connecting = undefined
        if (connection !== attempt)
          return
        setStatus(enabled ? 'closed' : 'idle')
        if (connection !== attempt)
          return
        if (accessSignal.aborted || ownerAborted || !accessAccepted || dead) {
          connection = undefined
          enabled = false
          return
        }
        if (unauthorized) {
          // End the old owner action before requesting token rotation. No RPC
          // or speech data is replayed across this authorization boundary.
          const renewed = !authRefreshUsed && await options.refreshAccess?.(accessSignal).catch(() => false)
          if (connection !== attempt)
            return
          if (!renewed || accessSignal.aborted) {
            connection = undefined
            enabled = false
            return
          }
          authRefreshUsed = true
        }
        connection = undefined
        schedule()
      })
      return result
    }

    async function rpc<T>(request: unknown, event: typeof sendMessages | typeof pullMessages, project: (value: unknown) => T | undefined): Promise<T> {
      if (dead || !ctx || status !== 'open' || !socket || socket.bufferedAmount > maxBuffer || pending >= 16)
        throw failure()
      const active = ctx
      pending++
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            stopChat()
            setStatus('closed')
            schedule()
            reject(failure())
          }, 15_000)
        })
        const value = await Promise.race([defineInvoke(active, event as typeof sendMessages)(request as SendMessagesRequest), timeout])
        if (dead || ctx !== active)
          throw failure()
        const output = project(value)
        if (!output)
          throw failure()
        return output
      }
      catch { throw failure() }
      finally {
        pending--
        clearTimeout(timer)
      }
    }

    function startSpeech(value: unknown, onEvent: (event: OidcSpeechEvent) => void) {
      if (dead || speeches.size >= 2 || !object(value) || !exact(value, ['model', 'voice', 'responseFormat', 'extraBody', 'ttsTrigger', 'ttsSource', 'ttsVoiceType'])
        || !text(value.model) || !text(value.voice) || (value.responseFormat !== undefined && !['mp3', 'opus', 'aac', 'flac', 'pcm'].includes(value.responseFormat as string))
        || (value.extraBody !== undefined && (!object(value.extraBody) || !safeExtra(value.extraBody) || JSON.stringify(value.extraBody).length > 16 * 1024))
        || (value.ttsTrigger !== undefined && !['auto', 'manual'].includes(value.ttsTrigger as string))
        || (value.ttsSource !== undefined && !['chat_auto_tts', 'manual_preview', 'settings_test'].includes(value.ttsSource as string))
        || (value.ttsVoiceType !== undefined && !['official_default', 'official_selected', 'custom_configured', 'voice_pack', 'unknown'].includes(value.ttsVoiceType as string))) {
        throw failure()
      }
      const start = { event: 'start', model: value.model, voice: value.voice, response_format: value.responseFormat ?? 'mp3', ...(value.extraBody ? { extra_body: JSON.parse(JSON.stringify(value.extraBody)) } : {}) }
      const analytics = { tts_trigger: value.ttsTrigger ?? 'manual', tts_source: value.ttsSource ?? 'manual_preview', tts_voice_type: value.ttsVoiceType ?? 'unknown' }
      const controller = new AbortController()
      let ws: WebSocket | undefined
      let ended = false
      let finishing = false
      let bytes = 0
      let textBytes = 0
      let eventCount = 0
      const queue: string[] = []
      let queueBytes = 0
      let rejectDone!: (error: Error) => void
      let resolveDone!: () => void
      const done = new Promise<void>((resolve, reject) => {
        resolveDone = resolve
        rejectDone = reject
      })
      // Consumers may attach after synchronous cancel; do not leak an unhandled rejection.
      void done.catch(() => {})
      let timer: ReturnType<typeof setTimeout> | undefined
      let handle: SpeechHandle
      const end = (success: boolean) => {
        if (ended)
          return
        ended = true
        clearTimeout(timer)
        queue.length = 0
        queueBytes = 0
        if (ws) {
          ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
          try {
            if (!success && ws.readyState === 1 && ws.bufferedAmount <= maxBuffer)
              ws.send(JSON.stringify({ event: 'cancel' }))
            ws.close()
          }
          catch {}
        }
        controller.abort()
        speeches.delete(handle)
        if (success)
          resolveDone()
        else
          rejectDone(failure())
      }
      const send = (frame: unknown) => {
        if (ended || finishing || dead)
          throw failure()
        if (!object(frame) || (frame.event !== 'text' && frame.event !== 'finish')
          || (frame.event === 'text' && (!exact(frame, ['event', 'text']) || !text(frame.text, 16 * 1024)))
          || (frame.event === 'finish' && !exact(frame, ['event']))) {
          throw failure()
        }
        if (frame.event === 'text')
          textBytes += (frame.text as string).length
        const data = JSON.stringify(frame.event === 'text' ? { event: 'text', text: frame.text } : { event: 'finish' })
        if (textBytes > maxBuffer || queue.length >= 128 || queueBytes + data.length > maxBuffer || (ws?.bufferedAmount ?? 0) > maxBuffer) {
          end(false)
          throw failure()
        }
        if (frame.event === 'finish')
          finishing = true
        if (ws?.readyState === 1) {
          try {
            ws.send(data)
          }
          catch { end(false) }
        }
        else {
          queue.push(data)
          queueBytes += data.length
        }
      }
      handle = { done, send, appendText: (input: string) => send({ event: 'text', text: input }), finish: () => send({ event: 'finish' }), cancel: () => end(false) }
      timer = setTimeout(end, 120_000, false)
      speeches.add(handle)
      void options.withAccess(AbortSignal.any([lifetime.signal, controller.signal]), async (token, signal, privateValue) => {
        if (signal.aborted || ended)
          return
        const abort = () => end(false)
        signal.addEventListener('abort', abort, { once: true })
        const textEgress = createOidcTextEgress(privateValue)
        let audioTail = ''
        let audioHeld = false
        let textHeld = false
        let heldBytes = 0
        const held: OidcSpeechEvent[] = []
        const emit = (event: OidcSpeechEvent, size: number, final = false) => {
          heldBytes += size
          if (heldBytes > maxBuffer || held.length >= 256)
            throw failure()
          held.push(event)
          if ((!audioHeld && !textHeld) || final) {
            for (const item of held) {
              if (ended || signal.aborted)
                return
              onEvent(item)
            }
            held.length = 0
            heldBytes = 0
          }
        }
        try {
          const target = new URL(url('/api/v1/audio/speech/ws', token))
          for (const [key, item] of Object.entries(analytics))
            target.searchParams.set(key, item as string)
          ws = factory(target.href)
          ws.binaryType = 'arraybuffer'
          ws.onopen = () => {
            if (ended || signal.aborted)
              return
            try {
              ws!.send(JSON.stringify(start))
              for (const frame of queue) {
                if (ws!.bufferedAmount > maxBuffer)
                  throw failure()
                ws!.send(frame)
              }
              queue.length = 0
              queueBytes = 0
            }
            catch { end(false) }
          }
          ws.onmessage = (event) => {
            if (ended || signal.aborted)
              return
            try {
              if (++eventCount > 4096)
                throw failure()
              if (event.data instanceof ArrayBuffer) {
                bytes += event.data.byteLength
                if (event.data.byteLength > maxBuffer || bytes > 32 * 1024 * 1024)
                  throw failure()
                audioTail += Buffer.from(event.data).toString('latin1')
                if (privateValue(audioTail))
                  throw failure()
                audioTail = audioTail.slice(-16_384)
                audioHeld = privateValue(audioTail, true)
                emit({ event: 'audio', audio: event.data.slice(0) }, event.data.byteLength)
                return
              }
              if (typeof event.data !== 'string' || event.data.length > maxFrame)
                throw failure()
              const data: unknown = JSON.parse(event.data)
              if (reflectsSecret(data, privateValue) || !object(data)
                || !['session.started', 'sentence.start', 'sentence.end', 'subtitle', 'session.finished'].includes(data.event as string)) {
                throw failure()
              }
              if (data.text !== undefined && !text(data.text, 16 * 1024))
                throw failure()
              let payload: { text?: string, index?: number, start?: number, end?: number } | undefined
              if (data.payload !== undefined) {
                if (!object(data.payload))
                  throw failure()
                const source = data.payload
                if ((source.text !== undefined && !text(source.text, 16 * 1024)) || ['index', 'start', 'end'].some(key => source[key] !== undefined && (typeof source[key] !== 'number' || !Number.isFinite(source[key]) || (source[key] as number) < 0)))
                  throw failure()
                payload = { text: source.text as string | undefined, index: source.index as number | undefined, start: source.start as number | undefined, end: source.end as number | undefined }
              }
              const output = { event: data.event as Exclude<OidcSpeechEvent['event'], 'audio'>, text: data.text as string | undefined, payload }
              textHeld = textEgress.inspect(output)
              emit(output, event.data.length, data.event === 'session.finished')
              if (data.event === 'session.finished')
                end(true)
            }
            catch { end(false) }
          }
          ws.onerror = () => end(false)
          ws.onclose = () => end(false)
          await done.catch(() => {})
        }
        finally { signal.removeEventListener('abort', abort) }
      }).catch(() => {}).finally(() => end(false))
      return handle
    }

    return {
      chat: {
        connect,
        status: () => status,
        disconnect() {
          enabled = false
          stopChat()
          setStatus('idle')
        },
        sendMessages(value: unknown): Promise<SendMessagesResponse> {
          if (!object(value) || !exact(value, ['chatId', 'messages']) || !text(value.chatId) || !Array.isArray(value.messages) || value.messages.length > 256
            || !value.messages.every(message => object(message) && exact(message, ['id', 'role', 'content']) && text(message.id) && roles.includes(message.role as string) && typeof message.content === 'string' && message.content.length <= 64 * 1024)
            || JSON.stringify(value).length > maxFrame) {
            return Promise.reject(failure())
          }
          return rpc(value, sendMessages, response => object(response) && integer(response.seq) ? { seq: response.seq } : undefined)
        },
        pullMessages(value: unknown): Promise<PullMessagesResponse> {
          if (!object(value) || !exact(value, ['chatId', 'afterSeq', 'limit']) || !text(value.chatId) || !integer(value.afterSeq)
            || (value.limit !== undefined && (!integer(value.limit) || value.limit < 1 || value.limit > 256))) {
            return Promise.reject(failure())
          }
          return rpc(value, pullMessages, response => object(response) && integer(response.seq) && messages(response.messages) ? { seq: response.seq, messages: projectMessages(response.messages) } : undefined)
        },
        onNewMessages(handler: (value: NewMessagesPayload) => void) {
          if (dead || pushListeners.size >= 32)
            throw failure()
          pushListeners.add(handler)
          return () => {
            pushListeners.delete(handler)
          }
        },
        onStatusChange(handler: (value: Status) => void) {
          if (dead || statusListeners.size >= 32)
            throw failure()
          statusListeners.add(handler)
          return () => {
            statusListeners.delete(handler)
          }
        },
      },
      speech: { start: startSpeech },
      dispose() {
        if (dead)
          return
        dead = true
        enabled = false
        lifetime.abort()
        stopChat()
        for (const speech of speeches)
          speech.cancel()
        status = 'idle'
        pushListeners.clear()
        statusListeners.clear()
      },
    }
  }

  return {
    /** windowId is supplied by trusted Main routing, never by a renderer payload. */
    forWindow(windowId: number) {
      if (disposed || !Number.isSafeInteger(windowId) || windowId < 0)
        throw failure()
      let window = windows.get(windowId)
      if (!window) {
        if (windows.size >= 16)
          throw failure()
        window = makeWindow()
        windows.set(windowId, window)
      }
      return window
    },
    disposeWindow(windowId: number) {
      windows.get(windowId)?.dispose()
      windows.delete(windowId)
    },
    dispose() {
      disposed = true
      for (const window of windows.values())
        window.dispose()
      windows.clear()
    },
  }
}
