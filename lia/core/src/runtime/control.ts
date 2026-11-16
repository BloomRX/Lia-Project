/**
 * Canal de controle do Runtime — autenticado, com lista fechada de comandos.
 *
 * O Launcher e o Runtime são processos diferentes, do mesmo usuário, na mesma
 * máquina. O canal existe para três coisas: descobrir se o Runtime está vivo,
 * pedir o encerramento cooperativo e mover credenciais **sem** que elas
 * atravessem um Renderer.
 *
 * Modelo de confiança, explícito:
 *  - a fronteira é a **conta do Windows**. Outro usuário não abre o pipe (a
 *    DACL padrão de named pipe nega escrita a quem não é o criador) e não lê o
 *    arquivo de registro (0600). Malware rodando como o mesmo usuário está
 *    fora do escopo de qualquer mecanismo em espaço de usuário — e este
 *    documento não finge o contrário;
 *  - **PID não autentica**. Um PID pode ser reciclado e `GetNamedPipeClientProcessId`
 *    identifica a conexão, não a mensagem. A identidade aqui é criptográfica:
 *    o Runtime publica sua chave pública X25519; o cliente faz ECDH com uma
 *    chave efêmera; as duas partes derivam a mesma chave de sessão por HKDF; e
 *    toda mensagem carrega um HMAC-SHA256 com um `seq` estritamente crescente.
 *    Sem a chave privada não há como forjar uma resposta nem reapresentar uma
 *    mensagem antiga;
 *  - a sessão é amarrada ao `instanceId` (vai no `info` do HKDF) e a dois
 *    nonces aleatórios. Uma instância antiga respondendo no mesmo endpoint não
 *    fecha o handshake de uma instância nova.
 *
 * O transporte é um named pipe no Windows e um socket Unix no POSIX. O
 * protocolo não depende do transporte: os testes usam o mesmo servidor sobre
 * socket de arquivo.
 */

import type { Socket } from 'node:net'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import {
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { connect, createServer } from 'node:net'
import { unlink } from 'node:fs/promises'

import { isCredentialRevision, isPublicCredentialReference } from '../credentials/owner-channel.ts'

export const CONTROL_CONTRACT_VERSION = '1.0.0'

/**
 * Lista fechada. Um comando fora dela é recusado antes de chegar ao handler —
 * a superfície de ataque do canal é o tamanho desta lista, não o tamanho do
 * produto.
 */
export const CONTROL_COMMANDS = [
  'runtime.ping',
  'runtime.shutdown',
  'runtime.status',
  'credentials.delete',
  'credentials.get',
  'credentials.set',
] as const

export type ControlCommand = typeof CONTROL_COMMANDS[number]

export type ControlErrorCode
  = | 'denied'
    | 'invalid'
    | 'timeout'
    | 'unavailable'
    | 'unreachable'
    | 'unsupported'

export class ControlError extends Error {
  readonly code: ControlErrorCode
  constructor(code: ControlErrorCode, message?: string) {
    super(message ?? `control ${code}`)
    this.name = 'ControlError'
    this.code = code
  }
}

const MAX_FRAME_BYTES = 256 * 1024
const HANDSHAKE_TIMEOUT_MS = 3_000
const REQUEST_TIMEOUT_MS = 5_000
const MAX_CONNECTIONS = 8

export interface ControlRequest {
  command: ControlCommand
  /** Ausente quando o comando não aceita payload. */
  payload?: Record<string, unknown>
  /** Identificador de correlação, gerado pelo cliente. */
  id: string
}

export type ControlHandler = (request: ControlRequest, signal: AbortSignal) => Promise<unknown>

export interface RuntimeControlServerOptions {
  /** Endpoint canônico (ver `runtimeEndpointFor`). */
  endpoint: string
  instanceId: string
  handle: ControlHandler
  /** Chamado DEPOIS de a resposta de `runtime.shutdown` ser enviada. */
  onShutdownRequested?: () => void | Promise<void>
  log?: (line: string) => void
  handshakeTimeoutMs?: number
  requestTimeoutMs?: number
  maxConnections?: number
  /** Override para testes; o padrão é o processo atual. */
  now?: () => number
}

export interface RuntimeControlServer {
  endpoint: string
  /** Chave pública X25519 (base64, 32 bytes) que vai para o registro. */
  publicKey: string
  close: () => Promise<void>
  connectionCount: () => number
}

/* ------------------------------------------------------------------ */
/* Criptografia de sessão                                             */
/* ------------------------------------------------------------------ */

/** Prefixo DER de uma SPKI X25519; os 32 bytes crus vêm depois. */
const X25519_SPKI_PREFIX_HEX = '302a300506032b656e032100'
const X25519_SPKI_PREFIX = Buffer.from(X25519_SPKI_PREFIX_HEX, 'hex')

function publicKeyFromRaw(raw: Buffer) {
  return createPublicKey({ format: 'der', key: Buffer.concat([X25519_SPKI_PREFIX, raw]), type: 'spki' })
}

/**
 * Só o que usamos: exportar a SPKI em DER. Tipar assim evita a união de
 * representações que `generateKeyPairSync` devolve e mantém a função honesta
 * quanto ao que exige da chave.
 */
function rawFromPublicKey(key: { export: (options: { format: 'der', type: 'spki' }) => string | Buffer }): Buffer {
  const der = key.export({ format: 'der', type: 'spki' })
  return Buffer.from(der).subarray(-32)
}

function sessionKeys(shared: Buffer, clientNonce: Buffer, serverNonce: Buffer, instanceId: string, sessionId: string) {
  const salt = Buffer.concat([clientNonce, serverNonce])
  const info = Buffer.from(`lia-runtime-control/${CONTROL_CONTRACT_VERSION}/${instanceId}/${sessionId}`, 'utf8')
  const master = Buffer.from(hkdfSync('sha256', shared, salt, info, 32))
  const c2s = Buffer.from(hkdfSync('sha256', master, salt, Buffer.from(`${info.toString('utf8')}/c2s`, 'utf8'), 32))
  const s2c = Buffer.from(hkdfSync('sha256', master, salt, Buffer.from(`${info.toString('utf8')}/s2c`, 'utf8'), 32))
  return { c2s, s2c }
}

function sign(key: Buffer, sessionId: string, seq: number, body: unknown): string {
  return createHmac('sha256', key)
    .update(`${CONTROL_CONTRACT_VERSION}\n${sessionId}\n${seq}\n${JSON.stringify(body)}`)
    .digest('hex')
}

function signatureMatches(expected: string, received: unknown): boolean {
  if (typeof received !== 'string' || received.length !== expected.length)
    return false
  const left = Buffer.from(expected, 'hex')
  const right = Buffer.from(received, 'hex')
  if (left.length !== right.length || left.length === 0)
    return false
  return timingSafeEqual(left, right)
}

/* ------------------------------------------------------------------ */
/* Validação de payload por comando                                   */
/* ------------------------------------------------------------------ */

export type ControlPayloadCheck
  = | { ok: true, payload?: Record<string, unknown> }
    | { ok: false, reason: string }

const emptyPayload = (payload: unknown): ControlPayloadCheck => {
  if (payload === undefined || payload === null)
    return { ok: true }
  if (typeof payload !== 'object' || Array.isArray(payload))
    return { ok: false, reason: 'payload-must-be-object' }
  return Object.keys(payload).length === 0
    ? { ok: true }
    : { ok: false, reason: 'unexpected-field' }
}

/**
 * Contrato de cada comando. Deliberadamente rígido: campo desconhecido reprova,
 * porque um campo que ninguém lê é um campo que ninguém protege.
 */
export function checkControlPayload(command: ControlCommand, payload: unknown): ControlPayloadCheck {
  switch (command) {
    case 'runtime.ping':
    case 'runtime.status':
      return emptyPayload(payload)

    case 'runtime.shutdown': {
      if (payload === undefined || payload === null)
        return { ok: true, payload: {} }
      if (typeof payload !== 'object' || Array.isArray(payload))
        return { ok: false, reason: 'payload-must-be-object' }
      const record = payload as Record<string, unknown>
      if (Object.keys(record).some(key => key !== 'reason'))
        return { ok: false, reason: 'unexpected-field' }
      if (record.reason !== undefined && (typeof record.reason !== 'string' || record.reason.length > 200))
        return { ok: false, reason: 'invalid-reason' }
      return { ok: true, payload: record }
    }

    case 'credentials.get':
    case 'credentials.delete': {
      if (payload === undefined || payload === null)
        return { ok: false, reason: 'missing-payload' }
      if (typeof payload !== 'object' || Array.isArray(payload))
        return { ok: false, reason: 'payload-must-be-object' }
      const record = payload as Record<string, unknown>
      if (Object.keys(record).some(key => key !== 'scope' && key !== 'key'))
        return { ok: false, reason: 'unexpected-field' }
      if (typeof record.scope !== 'string' || record.scope.length < 1 || record.scope.length > 256)
        return { ok: false, reason: 'invalid-scope' }
      if (record.key !== 'apiKey')
        return { ok: false, reason: 'invalid-key' }
      if (!isPublicCredentialReference(record.scope, record.key))
        return { ok: false, reason: 'forbidden-scope' }
      return { ok: true, payload: record }
    }

    case 'credentials.set': {
      if (payload === undefined || payload === null)
        return { ok: false, reason: 'missing-payload' }
      if (typeof payload !== 'object' || Array.isArray(payload))
        return { ok: false, reason: 'payload-must-be-object' }
      const record = payload as Record<string, unknown>
      if (Object.keys(record).some(key => !['scope', 'key', 'value', 'expectedRevision'].includes(key)))
        return { ok: false, reason: 'unexpected-field' }
      if (typeof record.scope !== 'string' || record.scope.length < 1 || record.scope.length > 256)
        return { ok: false, reason: 'invalid-scope' }
      if (record.key !== 'apiKey')
        return { ok: false, reason: 'invalid-key' }
      if (!isPublicCredentialReference(record.scope, record.key))
        return { ok: false, reason: 'forbidden-scope' }
      if (typeof record.value !== 'string' || record.value.length === 0 || record.value.length > 16_384)
        return { ok: false, reason: 'invalid-value' }
      if (record.expectedRevision !== undefined && !isCredentialRevision(record.expectedRevision))
        return { ok: false, reason: 'invalid-revision' }
      return { ok: true, payload: record }
    }

    default:
      return { ok: false, reason: 'unsupported-command' }
  }
}

/* ------------------------------------------------------------------ */
/* Servidor                                                           */
/* ------------------------------------------------------------------ */

interface ServerSession {
  sessionId: string
  sendKey: Buffer
  receiveKey: Buffer
  lastSeq: number
}

export async function startRuntimeControlServer(options: RuntimeControlServerOptions): Promise<RuntimeControlServer> {
  const log = options.log ?? (() => {})
  const handshakeTimeout = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS
  const maxConnections = options.maxConnections ?? MAX_CONNECTIONS
  const sockets = new Set<Socket>()
  const { privateKey, publicKey } = generateKeyPairSync('x25519')
  const publicKeyRaw = rawFromPublicKey(publicKey)
  let closed = false

  const server = createServer((socket) => {
    socket.on('error', () => {})
    if (closed || sockets.size >= maxConnections) {
      socket.destroy()
      return
    }
    sockets.add(socket)
    socket.setNoDelay?.(true)

    let buffer = Buffer.alloc(0)
    let session: ServerSession | undefined
    let processed = 0
    const controller = new AbortController()
    const handshakeTimer = setTimeout(() => socket.destroy(), handshakeTimeout)
    handshakeTimer.unref?.()

    const send = (frame: Record<string, unknown>) => {
      if (socket.destroyed || closed)
        return
      const line = `${JSON.stringify(frame)}\n`
      if (Buffer.byteLength(line) > MAX_FRAME_BYTES) {
        socket.destroy()
        return
      }
      socket.write(line)
    }

    const deny = (code: string) => {
      send({ code, t: 'deny', v: 1 })
      socket.end()
    }

    const handleHello = (frame: Record<string, unknown>) => {
      if (frame.v !== 1 || frame.instance !== options.instanceId || typeof frame.key !== 'string')
        return deny('instance-mismatch')
      let clientRaw: Buffer
      try {
        clientRaw = Buffer.from(frame.key, 'base64')
        if (clientRaw.length !== 32)
          return deny('bad-key')
      }
      catch {
        return deny('bad-key')
      }
      if (typeof frame.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(frame.nonce))
        return deny('bad-nonce')

      const clientNonce = Buffer.from(frame.nonce, 'hex')
      const serverNonce = randomBytes(16)
      const sessionId = randomUUID()
      let shared: Buffer
      try {
        shared = diffieHellman({ privateKey, publicKey: publicKeyFromRaw(clientRaw) })
      }
      catch {
        return deny('bad-key')
      }
      const keys = sessionKeys(shared, clientNonce, serverNonce, options.instanceId, sessionId)
      session = { lastSeq: 0, receiveKey: keys.c2s, sendKey: keys.s2c, sessionId }
      clearTimeout(handshakeTimer)
      send({ key: publicKeyRaw.toString('base64'), nonce: serverNonce.toString('hex'), session: sessionId, t: 'welcome', v: 1 })
    }

    const handleRequest = async (frame: Record<string, unknown>) => {
      if (!session)
        return deny('no-session')
      if (frame.session !== session.sessionId)
        return deny('bad-session')
      if (!Number.isInteger(frame.seq) || (frame.seq as number) <= session.lastSeq)
        return deny('replay')
      const body = frame.body
      if (typeof body !== 'object' || body === null || Array.isArray(body))
        return deny('bad-body')
      if (!signatureMatches(sign(session.receiveKey, session.sessionId, frame.seq as number, body), frame.mac))
        return deny('bad-mac')
      session.lastSeq = frame.seq as number
      processed += 1
      // Um único socket não vira a porta de entrada de um laço infinito.
      if (processed > 64)
        return deny('too-many-requests')

      const request = body as Record<string, unknown>
      if (typeof request.id !== 'string' || request.id.length > 64)
        return deny('bad-id')
      const command = request.command
      if (typeof command !== 'string' || !(CONTROL_COMMANDS as readonly string[]).includes(command))
        return deny('unsupported-command')
      const check = checkControlPayload(command as ControlCommand, request.payload)
      if (!check.ok)
        return deny('invalid-payload')

      const respond = (result: unknown) => {
        const payload = { id: request.id, ok: true, result }
        send({ body: payload, mac: sign(session!.sendKey, session!.sessionId, frame.seq as number, payload), seq: frame.seq, session: session!.sessionId, t: 'res', v: 1 })
      }

      try {
        const result = await options.handle(
          { command: command as ControlCommand, id: request.id, ...(check.payload ? { payload: check.payload } : {}) },
          controller.signal,
        )
        respond(result ?? null)
        if (command === 'runtime.shutdown' && options.onShutdownRequested) {
          // A resposta sai primeiro; o encerramento depois. Se o processo
          // morresse antes do `write` drenar, o Launcher veria um "aceito"
          // que nunca existiu.
          setImmediate(() => {
            void Promise.resolve(options.onShutdownRequested?.()).catch(() => {})
          })
        }
      }
      catch (error) {
        const code = error instanceof ControlError ? error.code : 'invalid'
        const message = error instanceof ControlError ? error.message : 'command failed'
        const payload = { error: { code, message }, id: request.id, ok: false }
        send({ body: payload, mac: sign(session.sendKey, session.sessionId, frame.seq as number, payload), seq: frame.seq, session: session.sessionId, t: 'res', v: 1 })
      }
    }

    socket.on('data', (chunk) => {
      if (closed)
        return
      buffer = Buffer.concat([buffer, Buffer.from(chunk)])
      if (buffer.length > MAX_FRAME_BYTES) {
        socket.destroy()
        return
      }
      let newline = buffer.indexOf(0x0A)
      while (newline >= 0) {
        const line = buffer.subarray(0, newline).toString('utf8')
        buffer = buffer.subarray(newline + 1)
        newline = buffer.indexOf(0x0A)
        if (!line.trim())
          continue
        let frame: Record<string, unknown>
        try {
          const parsed: unknown = JSON.parse(line)
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            socket.destroy()
            return
          }
          frame = parsed as Record<string, unknown>
        }
        catch {
          socket.destroy()
          return
        }
        if (frame.t === 'hello' && !session)
          handleHello(frame)
        else if (frame.t === 'req')
          void handleRequest(frame)
        else {
          socket.destroy()
          return
        }
      }
    })

    socket.on('close', () => {
      clearTimeout(handshakeTimer)
      controller.abort()
      sockets.delete(socket)
    })
  })

  await assertEndpointAvailable(options.endpoint)
  await listenWithStaleRecovery(server, options.endpoint)

  const startedAt = (options.now ?? Date.now)()
  log(`[lia:runtime] control listening instance=${options.instanceId.slice(0, 8)} uptimeBase=${startedAt}`)

  return {
    connectionCount: () => sockets.size,
    endpoint: options.endpoint,
    publicKey: publicKeyRaw.toString('base64'),
    async close() {
      if (closed)
        return
      closed = true
      for (const socket of sockets)
        socket.destroy()
      sockets.clear()
      await new Promise<void>(resolve => server.close(() => resolve()))
      if (process.platform !== 'win32')
        await unlink(options.endpoint).catch(() => {})
    },
  }
}

/**
 * Instância única, provada por conexão — nunca por existência de arquivo.
 *
 * O `libuv` remove o arquivo do socket Unix antes de cada `bind`. Confiar em
 * EADDRINUSE deixaria um segundo Runtime assumir o endpoint de um Runtime vivo
 * sem que ninguém percebesse. Por isso a checagem é ativa: se algo ATENDE o
 * endpoint, recusa; se o arquivo existe e ninguém atende, é lixo de um crash e
 * pode sair. No Windows o named pipe desaparece com o processo, então a mesma
 * sonda funciona sem tratamento especial.
 */
async function assertEndpointAvailable(endpoint: string): Promise<void> {
  const served = await new Promise<boolean>((resolve) => {
    const probe = connect(endpoint)
    const done = (value: boolean) => {
      probe.destroy()
      resolve(value)
    }
    probe.once('connect', () => done(true))
    probe.once('error', () => done(false))
    setTimeout(() => done(false), 750).unref?.()
  })
  if (served)
    throw new ControlError('denied', 'runtime endpoint is already served by a live instance')
  if (process.platform !== 'win32') {
    // Só depois de provar que ninguém atende: um socket órfão não pode impedir
    // o Runtime de nascer, e um socket vivo não pode ser removido.
    await unlink(endpoint).catch(() => {})
  }
}

/** `listen` simples: a exclusividade já foi provada antes. */
async function listenWithStaleRecovery(server: ReturnType<typeof createServer>, endpoint: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(endpoint)
  })
}

/* ------------------------------------------------------------------ */
/* Cliente                                                            */
/* ------------------------------------------------------------------ */

export interface RuntimeControlTarget {
  endpoint: string
  instanceId: string
  publicKey: string
}

/**
 * Executa UM comando. Cada chamada abre e fecha a própria conexão: o custo é
 * irrelevante para um canal local usado em pulsos e comandos explícitos, e o
 * cliente deixa de ter estado para vazar, reconectar ou ficar preso a uma
 * sessão de um processo que já morreu.
 */
export async function invokeRuntimeControl(
  target: RuntimeControlTarget,
  command: ControlCommand,
  payload?: Record<string, unknown>,
  options: { timeoutMs?: number } = {},
): Promise<unknown> {
  const check = checkControlPayload(command, payload)
  if (!check.ok)
    throw new ControlError('invalid', check.reason)
  const timeout = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const { privateKey, publicKey } = generateKeyPairSync('x25519')
  const clientNonce = randomBytes(16)

  return await new Promise((resolve, reject) => {
    const socket = connect(target.endpoint)
    let buffer = Buffer.alloc(0)
    let session: { id: string, keys: { c2s: Buffer, s2c: Buffer } } | undefined
    let settled = false

    const finish = (error: Error | undefined, value?: unknown) => {
      if (settled)
        return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error)
        reject(error)
      else
        resolve(value)
    }

    // Um timeout unref'd deixaria o processo sair antes de a resposta chegar.
    const timer = setTimeout(() => finish(new ControlError('timeout')), timeout)

    const send = (frame: Record<string, unknown>) => socket.write(`${JSON.stringify(frame)}\n`)

    socket.once('connect', () => {
      send({ instance: target.instanceId, key: rawFromPublicKey(publicKey).toString('base64'), nonce: clientNonce.toString('hex'), t: 'hello', v: 1 })
    })

    socket.on('error', (error: NodeJS.ErrnoException) => {
      finish(new ControlError(error.code === 'ENOENT' || error.code === 'ECONNREFUSED' ? 'unreachable' : 'unreachable', error.code))
    })

    socket.on('close', () => finish(new ControlError('unreachable', 'closed-before-response')))

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)])
      if (buffer.length > MAX_FRAME_BYTES)
        return finish(new ControlError('invalid', 'frame-too-large'))
      let newline = buffer.indexOf(0x0A)
      while (newline >= 0) {
        const line = buffer.subarray(0, newline).toString('utf8')
        buffer = buffer.subarray(newline + 1)
        newline = buffer.indexOf(0x0A)
        if (!line.trim())
          continue
        let frame: Record<string, unknown>
        try {
          frame = JSON.parse(line) as Record<string, unknown>
        }
        catch {
          return finish(new ControlError('invalid', 'bad-frame'))
        }
        if (frame.t === 'deny')
          return finish(new ControlError(frame.code === 'instance-mismatch' ? 'denied' : 'denied', String(frame.code)))
        if (frame.t === 'welcome') {
          if (session)
            return finish(new ControlError('invalid', 'duplicate-welcome'))
          if (typeof frame.session !== 'string' || typeof frame.key !== 'string' || typeof frame.nonce !== 'string')
            return finish(new ControlError('invalid', 'bad-welcome'))
          let serverRaw: Buffer
          try {
            serverRaw = Buffer.from(frame.key, 'base64')
            if (serverRaw.length !== 32)
              throw new Error('bad key length')
          }
          catch {
            return finish(new ControlError('invalid', 'bad-server-key'))
          }
          // A chave publicada no registro TEM de ser a que respondeu: sem esta
          // comparação, qualquer processo que criasse o endpoint se passaria
          // pelo runtime.
          if (serverRaw.toString('base64') !== target.publicKey)
            return finish(new ControlError('denied', 'server-key-mismatch'))
          if (!/^[0-9a-f]{32}$/.test(frame.nonce))
            return finish(new ControlError('invalid', 'bad-nonce'))
          const shared = diffieHellman({ privateKey, publicKey: publicKeyFromRaw(serverRaw) })
          const keys = sessionKeys(shared, clientNonce, Buffer.from(frame.nonce, 'hex'), target.instanceId, frame.session)
          session = { id: frame.session, keys }
          const body = { command, id: randomUUID(), ...(check.payload ? { payload: check.payload } : {}) }
          send({ body, mac: sign(keys.c2s, frame.session, 1, body), seq: 1, session: frame.session, t: 'req', v: 1 })
          return
        }
        if (frame.t === 'res') {
          if (!session || frame.session !== session.id)
            return finish(new ControlError('invalid', 'bad-response-session'))
          if (frame.seq !== 1)
            return finish(new ControlError('invalid', 'bad-response-seq'))
          const body = frame.body
          if (typeof body !== 'object' || body === null || Array.isArray(body))
            return finish(new ControlError('invalid', 'bad-response-body'))
          if (!signatureMatches(sign(session.keys.s2c, session.id, 1, body), frame.mac))
            return finish(new ControlError('denied', 'bad-response-mac'))
          const response = body as Record<string, unknown>
          if (response.ok === true)
            return finish(undefined, response.result)
          const error = (response.error ?? {}) as Record<string, unknown>
          return finish(new ControlError('invalid', typeof error.message === 'string' ? error.message : 'command-failed'))
        }
        return finish(new ControlError('invalid', 'unexpected-frame'))
      }
    })
  })
}

/** Pulso: devolve a identidade que respondeu, ou lança. */
export async function pingRuntime(target: RuntimeControlTarget, timeoutMs = 1_500): Promise<{ instanceId: string, pid: number, uptimeMs: number }> {
  const result = await invokeRuntimeControl(target, 'runtime.ping', undefined, { timeoutMs })
  if (typeof result !== 'object' || result === null)
    throw new ControlError('invalid', 'bad-ping-result')
  const record = result as Record<string, unknown>
  if (record.instanceId !== target.instanceId)
    throw new ControlError('denied', 'instance-mismatch')
  return {
    instanceId: target.instanceId,
    pid: typeof record.pid === 'number' ? record.pid : 0,
    uptimeMs: typeof record.uptimeMs === 'number' ? record.uptimeMs : 0,
  }
}
