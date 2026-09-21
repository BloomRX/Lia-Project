import type { KokoroLayout } from './layout'

import { spawn } from 'node:child_process'
import process from 'node:process'

import { errorMessageFrom } from '@moeru/std'

import { KOKORO_ORT_PROVIDERS, KOKORO_WORKER_PROTOCOL_VERSION } from './manifest'

/**
 * A private line-delimited-JSON (JSONL) client for the kokoro worker
 * process. One client owns one child; after `stop()` the client is done -
 * a restart spawns a new client (the engine factory does exactly that).
 *
 * `spawn` is injectable so tests drive the protocol with a fake child and
 * never touch a real Python interpreter.
 */

export interface KokoroWorkerFacts {
  device: string
  loadMs: number
  model: string
  ortVersion: string
  providersActive: string[]
  sampleRate: number
  voice: string
}

export interface KokoroWorkerSynthesisResult {
  audioDurationMs: number
  channels: number
  generationMs: number
  sampleRate: number
  wavPath: string
}

export interface KokoroChildProcessLike {
  stdin: { write: (chunk: string) => void }
  stdout: { on: (event: string, listener: (chunk: string | Uint8Array) => void) => unknown }
  stderr: { on: (event: string, listener: (chunk: string | Uint8Array) => void) => unknown }
  on: (event: string, listener: (...args: any[]) => void) => unknown
  kill: (signal?: string) => void
  killed: boolean
}

export type KokoroSpawn = (command: string, args: string[], options: { cwd?: string, env?: NodeJS.ProcessEnv }) => KokoroChildProcessLike

export class KokoroWorkerError extends Error {
  readonly reason: 'exit' | 'init-failed' | 'protocol-error' | 'result-error' | 'timeout' | 'cancelled'

  constructor(reason: KokoroWorkerError['reason'], message: string) {
    super(message)
    this.name = 'KokoroWorkerError'
    this.reason = reason
  }
}

export interface KokoroWorkerClientOptions {
  layout: KokoroLayout
  /** Default voice/language sent with init. */
  language: string
  voice: string
  spawnImpl?: KokoroSpawn
  env?: NodeJS.ProcessEnv
  /** Generator workloads: ONNX load only happens at init, synthesis is post-warm. */
  readyTimeoutMs?: number
  synthesizeTimeoutMs?: number
  shutdownGraceMs?: number
  /** Server-side metadata logger (never text, never audio, never a secret). */
  log?: (entry: Record<string, string | number | boolean>) => void
}

export interface KokoroWorkerClient {
  /** Spawns + initializes; resolves with measured facts. Single-flight. */
  start: () => Promise<KokoroWorkerFacts>
  /** Correlated request; rejects with KokoroWorkerError on any failure. */
  synthesize: (request: { id: number, text: string, voice: string, language: string, out: string }) => Promise<KokoroWorkerSynthesisResult>
  /** Idempotent: graceful `shutdown` frame first, SIGTERM fallback, then done. */
  stop: () => Promise<void>
  running: () => boolean
}

interface PendingRequest {
  resolve: (result: KokoroWorkerSynthesisResult) => void
  reject: (error: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

/** Reads newline-delimited JSON from a stream without assuming chunk borders. */
export function createJsonlFrameReader(onFrame: (frame: Record<string, unknown>) => void, onProtocolError: (error: Error) => void) {
  let buffered = ''
  return (chunk: string | Uint8Array) => {
    buffered += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    let newline = buffered.indexOf('\n')
    while (newline !== -1) {
      const line = buffered.slice(0, newline).trim()
      buffered = buffered.slice(newline + 1)
      newline = buffered.indexOf('\n')
      if (!line)
        continue
      try {
        const frame = JSON.parse(line)
        if (typeof frame === 'object' && frame !== null)
          onFrame(frame as Record<string, unknown>)
        else
          onProtocolError(new KokoroWorkerError('protocol-error', 'worker frame is not an object'))
      }
      catch (error) {
        onProtocolError(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }
}

export function createKokoroWorkerClient(options: KokoroWorkerClientOptions): KokoroWorkerClient {
  const spawnImpl = options.spawnImpl ?? (spawn as unknown as KokoroSpawn)
  const readyTimeoutMs = options.readyTimeoutMs ?? 120_000
  const synthesizeTimeoutMs = options.synthesizeTimeoutMs ?? 300_000
  const shutdownGraceMs = options.shutdownGraceMs ?? 5_000
  const log = options.log ?? (() => undefined)

  let child: KokoroChildProcessLike | undefined
  let state: 'idle' | 'starting' | 'ready' | 'stopping' | 'dead' = 'idle'
  let startingPromise: Promise<KokoroWorkerFacts> | undefined
  let facts: KokoroWorkerFacts | undefined
  let initFailure: Error | undefined
  let stderrTail: string[] = []
  const pending = new Map<number, PendingRequest>()
  let readyResolve: ((value: KokoroWorkerFacts) => void) | undefined
  let readyReject: ((error: unknown) => void) | undefined

  function stderrNote(): string {
    const tail = stderrTail.slice(-3).join(' | ').trim()
    return tail ? ` [worker: ${tail.slice(0, 300)}]` : ''
  }

  function settleReady(error?: unknown): void {
    const reject = readyReject
    const resolve = readyResolve
    readyReject = undefined
    readyResolve = undefined
    if (reject && error !== undefined)
      reject(error instanceof Error ? error : new KokoroWorkerError('exit', errorMessageFrom(error)))
    else if (resolve && error === undefined && facts)
      resolve(facts)
  }

  function rejectAllPending(error: KokoroWorkerError): void {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }

  function onFrame(frame: Record<string, unknown>): void {
    if (state === 'dead' || state === 'stopping')
      return
    const event = String(frame.event ?? '')
    if (event === 'ready') {
      const raw = (frame.facts ?? {}) as Record<string, unknown>
      facts = {
        device: String(raw.device ?? 'unknown'),
        loadMs: typeof raw.loadMs === 'number' ? raw.loadMs : 0,
        model: String(raw.model ?? ''),
        ortVersion: String(raw.ortVersion ?? ''),
        providersActive: Array.isArray(raw.providersActive) ? (raw.providersActive as unknown[]).map(String) : [],
        sampleRate: typeof raw.sampleRate === 'number' ? raw.sampleRate : 24_000,
        voice: String(raw.voice ?? ''),
      }
      state = 'ready'
      log({ event: 'lia.voice.kokoro.worker.ready', device: facts.device, loadMs: facts.loadMs, providers: facts.providersActive.join('+') })
      settleReady()
      return
    }
    if (event === 'init-failed') {
      initFailure = new KokoroWorkerError('init-failed', `${String(frame.error ?? 'init failed')}${stderrNote()}`)
      state = 'dead'
      settleReady(initFailure)
      rejectAllPending(initFailure)
      return
    }
    if (event === 'protocol-error') {
      // A protocol error describes the CHANNEL, not a request: fail loudly.
      const error = new KokoroWorkerError('protocol-error', String(frame.error ?? 'protocol error'))
      rejectAllPending(error)
      return
    }
    if (event === 'result') {
      const id = typeof frame.id === 'number' ? frame.id : Number(frame.id)
      const entry = pending.get(id)
      if (!entry)
        return
      clearTimeout(entry.timer)
      pending.delete(id)
      if (frame.ok === true) {
        entry.resolve({
          audioDurationMs: typeof frame.audioMs === 'number' ? frame.audioMs : 0,
          channels: typeof frame.channels === 'number' ? frame.channels : 1,
          generationMs: typeof frame.generationMs === 'number' ? frame.generationMs : 0,
          sampleRate: typeof frame.sampleRate === 'number' ? frame.sampleRate : 24_000,
          wavPath: String(frame.wav ?? ''),
        })
      }
      else {
        entry.reject(new KokoroWorkerError('result-error', String(frame.error ?? 'synthesis failed')))
      }
      return
    }
    if (event === 'shutdown-ok') {
      tryKill('SIGTERM')
    }
    // 'health-ok' and unknown events carry no correlation entry here.
  }

  function tryKill(signal?: string): void {
    try {
      if (child && !child.killed)
        child.kill(signal)
    }
    catch {
      // kill races an already-exited child; both leave us in the same state.
    }
  }

  function onExit(code: unknown, signal: unknown): void {
    const wasStopping = state === 'stopping'
    state = 'dead'
    child = undefined
    if (!wasStopping) {
      const exit = new KokoroWorkerError('exit', `worker exited unexpectedly (code=${String(code)} signal=${String(signal)})${stderrNote()}`)
      settleReady(exit)
      rejectAllPending(exit)
    }
  }

  return {
    start() {
      if (state === 'ready' && facts)
        return Promise.resolve(facts)
      if (state === 'starting' && startingPromise)
        return startingPromise
      if (initFailure)
        return Promise.reject(initFailure)

      state = 'starting'
      stderrTail = []
      startingPromise = new Promise<KokoroWorkerFacts>((resolve, reject) => {
        readyResolve = resolve
        readyReject = reject
      })
      const readyTimer = setTimeout(() => {
        if (state !== 'ready') {
          const error = new KokoroWorkerError('timeout', `worker did not become ready within ${readyTimeoutMs}ms${stderrNote()}`)
          settleReady(error)
          tryKill('SIGTERM')
        }
      }, readyTimeoutMs)
      // then() with both handlers settles fulfilled - no unhandled rejection.
      void startingPromise.then(
        () => clearTimeout(readyTimer),
        () => clearTimeout(readyTimer),
      )

      try {
        child = spawnImpl(options.layout.venvPython, [options.layout.workerFile], {
          cwd: options.layout.workerDir,
          env: { ...(options.env ?? process.env), PYTHONUTF8: '1' },
        })
      }
      catch (error) {
        state = 'dead'
        settleReady(new KokoroWorkerError('exit', `worker spawn failed: ${errorMessageFrom(error)}`))
        return startingPromise
      }

      let exited = false
      child.stdout.on('data', createJsonlFrameReader(onFrame, (error) => {
        log({ event: 'lia.voice.kokoro.worker.frame-error', error: error.message.slice(0, 120) })
      }))
      child.stderr.on('data', (chunk) => {
        stderrTail.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
        if (stderrTail.length > 20)
          stderrTail = stderrTail.slice(-20)
      })
      child.on('error', (error: unknown) => {
        if (exited)
          return
        exited = true
        state = 'dead'
        child = undefined
        settleReady(new KokoroWorkerError('exit', `worker spawn error: ${errorMessageFrom(error)}`))
      })
      child.on('exit', (code: unknown, signal: unknown) => {
        if (exited)
          return
        exited = true
        onExit(code, signal)
      })

      const initFrame = JSON.stringify({
        cmd: 'init',
        protocol: KOKORO_WORKER_PROTOCOL_VERSION,
        model: options.layout.modelFile,
        voicesNpz: options.layout.voicesNpz,
        voice: options.voice,
        language: options.language,
        providers: [...KOKORO_ORT_PROVIDERS],
      })
      child.stdin.write(`${initFrame}\n`)
      return startingPromise
    },

    synthesize(request) {
      if (state !== 'ready' || !child)
        return Promise.reject(new KokoroWorkerError('exit', `worker is ${state}; start() first`))
      return new Promise<KokoroWorkerSynthesisResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(request.id)
          reject(new KokoroWorkerError('timeout', `synthesis timed out after ${synthesizeTimeoutMs}ms`))
        }, synthesizeTimeoutMs)
        pending.set(request.id, { resolve, reject, timer })
        const frame = JSON.stringify({
          cmd: 'synthesize',
          id: request.id,
          text: request.text,
          voice: request.voice,
          language: request.language,
          speed: 1,
          out: request.out,
        })
        try {
          child!.stdin.write(`${frame}\n`)
        }
        catch (error) {
          clearTimeout(timer)
          pending.delete(request.id)
          reject(new KokoroWorkerError('exit', `worker stdin write failed: ${errorMessageFrom(error)}`))
        }
      })
    },

    async stop() {
      if (state === 'dead' || state === 'idle')
        return
      const current = child
      state = 'stopping'
      // A start() waiter must never hang across a shutdown.
      settleReady(new KokoroWorkerError('cancelled', 'worker stop requested'))
      rejectAllPending(new KokoroWorkerError('cancelled', 'worker stop requested'))
      const exitPromise = new Promise<void>((resolve) => {
        if (!current)
          return resolve()
        const exitListener = () => resolve()
        try {
          current.on('exit', exitListener)
        }
        catch {
          resolve()
        }
      })
      if (current) {
        // Graceful frame first; the worker exits its loop and the 'exit'
        // listener below settles the promise. The grace timer is the kill
        // switch for a wedged inference loop.
        try {
          current.stdin.write('{"cmd":"shutdown"}\n')
        }
        catch {
          // a broken pipe means the child is already gone; proceed to kill
        }
      }
      const grace = setTimeout(() => tryKill('SIGTERM'), shutdownGraceMs)
      await Promise.race([exitPromise, new Promise<void>(resolve => setTimeout(resolve, shutdownGraceMs * 2))])
      clearTimeout(grace)
      tryKill('SIGTERM')
      state = 'dead'
      child = undefined
      startingPromise = undefined
    },

    running() {
      return state === 'ready' || state === 'starting'
    },
  }
}
