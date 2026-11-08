import type { Socket } from 'node:net'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type CredentialOwnerErrorCode = 'unavailable' | 'unreadable' | 'denied' | 'cancelled'
export class CredentialOwnerError extends Error {
  readonly code: CredentialOwnerErrorCode
  constructor(code: CredentialOwnerErrorCode) {
    super(`Credential owner ${code}`)
    this.name = 'CredentialOwnerError'
    this.code = code
  }
}

export interface CredentialOwnerRequest {
  operation: 'get' | 'set' | 'delete'
  scope: string
  key: 'apiKey'
  value?: string
}
type Result = string | boolean | undefined
const PIPE = 'LIA_CREDENTIAL_OWNER_PIPE'
const TOKEN = 'LIA_CREDENTIAL_OWNER_TOKEN'
const DEADLINE = 5_000
const MAX_BYTES = 128 * 1024
const noncePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const codes = new Set(['unavailable', 'unreadable', 'denied', 'cancelled'])
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
function validRequest(value: unknown): value is CredentialOwnerRequest {
  if (!object(value) || Object.keys(value).some(key => !['operation', 'scope', 'key', 'value'].includes(key)))
    return false
  if (typeof value.operation !== 'string' || !['get', 'set', 'delete'].includes(value.operation) || value.key !== 'apiKey')
    return false
  if (typeof value.scope !== 'string' || value.scope.length < 1 || value.scope.length > 256
    || Array.from(value.scope).some(character => character.charCodeAt(0) < 32 || (character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159))) {
    return false
  }
  return value.operation === 'set'
    ? typeof value.value === 'string' && value.value.length > 0 && value.value.length <= 16_384
    : !Object.hasOwn(value, 'value')
}
function validResult(value: unknown): value is Result {
  return value === undefined || typeof value === 'boolean' || (typeof value === 'string' && value.length <= 16_384)
}
function pathFor(nonce: string) {
  return process.platform === 'win32' ? `\\\\.\\pipe\\lia-credential-owner-${nonce}` : join(tmpdir(), `lia-credential-owner-${nonce}.sock`)
}
function validPath(path: unknown): path is string {
  if (typeof path !== 'string')
    return false
  const prefix = process.platform === 'win32' ? '\\\\.\\pipe\\lia-credential-owner-' : join(tmpdir(), 'lia-credential-owner-')
  const nonce = path.slice(prefix.length, process.platform === 'win32' ? undefined : -5)
  return noncePattern.test(nonce) && path === pathFor(nonce)
}
function validToken(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/**
 * Consume bootstrap capability before constructing renderer/child environments.
 * This is a Main-only capability, not protection against malware running as the same user.
 */
export function takeCredentialOwnerEnvironment(environment: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key of [PIPE, TOKEN]) {
    if (typeof environment[key] === 'string')
      result[key] = environment[key]!
    delete environment[key]
  }
  return result
}

export async function startCredentialOwner(options: {
  handle: (request: CredentialOwnerRequest, signal: AbortSignal) => Promise<Result>
}): Promise<{ environment: Record<string, string>, close: () => Promise<void> }> {
  const path = pathFor(randomUUID())
  const token = randomBytes(32).toString('hex')
  const connections = new Set<Socket>()
  let closed = false
  let closing: Promise<void> | undefined
  const server = createServer((socket) => {
    socket.on('error', () => {})
    if (closed || connections.size >= 8) {
      socket.destroy()
      return
    }
    connections.add(socket)
    const controller = new AbortController()
    let buffer = Buffer.alloc(0)
    let dispatched = false
    let finished = false
    const timer = setTimeout(() => socket.destroy(), DEADLINE)
    const respond = (response: Record<string, unknown>) => {
      if (finished || closed || socket.destroyed || controller.signal.aborted)
        return
      finished = true
      socket.end(`${JSON.stringify({ version: 1, ...response })}\n`)
    }
    socket.once('close', () => {
      clearTimeout(timer)
      connections.delete(socket)
      controller.abort()
      buffer = Buffer.alloc(0)
    })
    socket.once('end', () => {
      controller.abort()
      socket.destroy()
    })
    socket.on('data', (chunk: Buffer) => {
      if (dispatched) {
        socket.destroy()
        return
      }
      if (buffer.length + chunk.length > MAX_BYTES) {
        socket.destroy()
        return
      }
      buffer = Buffer.concat([buffer, chunk])
      const newline = buffer.indexOf(10)
      if (newline === -1)
        return
      dispatched = true
      if (newline !== buffer.length - 1) {
        respond({ error: 'denied' })
        return
      }
      let frame: unknown
      try {
        frame = JSON.parse(buffer.subarray(0, newline).toString('utf8'))
      }
      catch {
        respond({ error: 'denied' })
        return
      }
      buffer = Buffer.alloc(0)
      if (!object(frame) || frame.version !== 1 || !validToken(frame.token)
        || !timingSafeEqual(Buffer.from(frame.token, 'hex'), Buffer.from(token, 'hex'))
        || Object.keys(frame).some(key => !['version', 'token', 'request'].includes(key)) || !validRequest(frame.request)) {
        respond({ error: 'denied' })
        return
      }
      const request = frame.request
      // Always observe handler rejection, even after disconnect or shutdown.
      void Promise.resolve().then(() => {
        if (closed || controller.signal.aborted)
          throw new CredentialOwnerError('cancelled')
        return options.handle(request, controller.signal)
      }).then((value) => {
        if (!validResult(value)) {
          respond({ error: 'unavailable' })
          return
        }
        respond(value === undefined ? { ok: true } : { ok: true, value })
      }, (error: unknown) => {
        respond({ error: error instanceof CredentialOwnerError && codes.has(error.code) ? error.code : 'unavailable' })
      })
    })
  })
  await new Promise<void>((resolve, reject) => {
    const onError = () => {
      reject(new CredentialOwnerError('unavailable'))
    }
    server.once('error', onError)
    server.listen(path, () => {
      server.off('error', onError)
      resolve()
    })
  })
  server.on('error', () => {})
  return {
    environment: { [PIPE]: path, [TOKEN]: token },
    close: () => {
      if (closing)
        return closing
      closed = true
      for (const socket of connections) socket.destroy()
      closing = new Promise<void>(resolve => server.close(() => resolve()))
      return closing
    },
  }
}

export function createCredentialOwnerClient(environment: Record<string, string | undefined>) {
  const path = environment[PIPE]
  const token = environment[TOKEN]
  return {
    request(request: CredentialOwnerRequest, signal?: AbortSignal): Promise<Result> {
      if (signal?.aborted)
        return Promise.reject(new CredentialOwnerError('cancelled'))
      if (!validPath(path) || !validToken(token))
        return Promise.reject(new CredentialOwnerError('unavailable'))
      if (!validRequest(request))
        return Promise.reject(new CredentialOwnerError('denied'))
      return new Promise((resolve, reject) => {
        let settled = false
        let buffer = Buffer.alloc(0)
        const socket = createConnection(path)
        const timer = setTimeout(() => finish(new CredentialOwnerError('unavailable')), DEADLINE)
        function finish(error?: CredentialOwnerError, value?: Result) {
          if (settled)
            return
          settled = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
          socket.destroy()
          buffer = Buffer.alloc(0)
          if (error)
            reject(error)
          else resolve(value)
        }
        function abort() {
          finish(new CredentialOwnerError('cancelled'))
        }
        socket.once('connect', () => {
          if (!settled)
            socket.write(`${JSON.stringify({ version: 1, token, request })}\n`)
        })
        socket.on('error', () => finish(new CredentialOwnerError('unavailable')))
        socket.once('close', () => finish(new CredentialOwnerError('unavailable')))
        socket.on('data', (chunk: Buffer) => {
          if (buffer.length + chunk.length > MAX_BYTES) {
            finish(new CredentialOwnerError('unavailable'))
            return
          }
          buffer = Buffer.concat([buffer, chunk])
          const newline = buffer.indexOf(10)
          if (newline < 0)
            return
          try {
            const frame: unknown = JSON.parse(buffer.subarray(0, newline).toString('utf8'))
            if (newline !== buffer.length - 1 || !object(frame) || frame.version !== 1)
              throw new CredentialOwnerError('unavailable')
            if (typeof frame.error === 'string' && codes.has(frame.error)) {
              finish(new CredentialOwnerError(frame.error as CredentialOwnerErrorCode))
              return
            }
            if (frame.ok !== true || !validResult(frame.value))
              throw new CredentialOwnerError('unavailable')
            finish(undefined, frame.value)
          }
          catch { finish(new CredentialOwnerError('unavailable')) }
        })
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted)
          abort()
      })
    },
  }
}
