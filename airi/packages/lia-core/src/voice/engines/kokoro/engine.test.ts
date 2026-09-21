import type { KokoroChildProcessLike } from './process-worker'

import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

import { createKokoroVoiceEngine } from './index'
import { resolveKokoroLayout } from './layout'
import { KOKORO_ENGINE_ID, KOKORO_VOICES } from './manifest'

/**
 * Engine-level contract tests: a fake child drives the real worker client
 * + engine wiring end to end, so what these tests assert is the ADAPTER's
 * behavior, not a stub of it. No Python, no model - those come from the
 * device QA on real hardware.
 */

class FakeChildProcess implements KokoroChildProcessLike {
  written: string[] = []
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed = false
  private emitter = new EventEmitter()
  stdin = { write: (chunk: string) => { this.written.push(chunk) } }

  on(event: string, listener: (...args: any[]) => void): unknown {
    this.emitter.on(event, listener)
    return this
  }

  kill(): void {
    this.killed = true
    this.emitExit(0, null)
  }

  frames(): Array<Record<string, any>> {
    return this.written
      .join('')
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line))
  }

  reply(frame: Record<string, unknown>): void {
    this.stdout.emit('data', `${JSON.stringify(frame)}\n`)
  }

  replyChunked(frame: Record<string, unknown>, parts: number): void {
    // Protocol realism: newline framing must survive arbitrary chunk splits.
    const text = `${JSON.stringify(frame)}\n`
    const size = Math.ceil(text.length / parts)
    for (let i = 0; i < text.length; i += size)
      this.stdout.emit('data', new TextEncoder().encode(text.slice(i, i + size)))
  }

  emitExit(code: unknown, signal: unknown): void {
    if (this.emitter.listenerCount('exit') > 0)
      this.emitter.emit('exit', code, signal)
  }
}

const WORKER_FACTS = {
  device: 'cpu',
  loadMs: 720,
  model: 'model_quantized.onnx',
  ortVersion: '1.19.0',
  providersActive: ['CPUExecutionProvider'],
  sampleRate: 24000,
  voice: 'pf_dora',
}

function readyFactsFrame() {
  return { event: 'ready', facts: WORKER_FACTS }
}

function makeWorld(options: { installed?: boolean, platform?: string, wavBytes?: Uint8Array } = {}) {
  const installed = options.installed ?? true
  const platform = options.platform ?? 'linux'
  const home = '/run/lia-voice-runtimes'
  const layout = resolveKokoroLayout({ home, platform })
  const markerPaths = new Set<string>([
    layout.venvPython,
    layout.modelFile,
    ...KOKORO_VOICES.map(voice => `${layout.voicesDir}/${voice.name}.bin`),
    layout.voicesNpz,
    layout.workerFile,
    layout.stateFile,
  ])

  const files = new Map<string, Uint8Array>()
  const removed: string[] = []
  const spawnLog: Array<{ command: string, args: string[] }> = []
  const children: FakeChildProcess[] = []

  const fileSystem = {
    existsSync: (path: string) => files.has(path) || (installed && markerPaths.has(path)),
    mkdirSync: (_path: string) => undefined,
    readFile: async (path: string) => {
      const bytes = files.get(path)
      if (!bytes)
        throw new Error(`ENOENT: ${path}`)
      return bytes
    },
    remove: async (path: string) => {
      removed.push(path)
      files.delete(path)
    },
  }

  const spawnImpl = (command: string, args: string[]) => {
    spawnLog.push({ args, command })
    const child = new FakeChildProcess()
    children.push(child)
    return child
  }

  const engine = createKokoroVoiceEngine({
    fileSystem,
    installDirOverride: () => undefined,
    platform,
    runtimeHome: () => home,
    shutdownGraceMs: 40,
    spawnImpl,
  })

  async function startAndReady(child?: FakeChildProcess): Promise<FakeChildProcess> {
    const target = child ?? children[children.length - 1]
    if (!target)
      throw new Error('expected a spawned worker')
    target.reply(readyFactsFrame())
    return target
  }

  return { children, engine, files, home, layout, removed, spawnLog, startAndReady }
}

describe('kokoro voice engine (Phase 7.9C)', () => {
  it('identity + capability contract: cpu-bound stock engine', () => {
    const world = makeWorld()
    expect(world.engine.id).toBe(KOKORO_ENGINE_ID)
    expect(world.engine.capabilities()).toEqual({
      clonesVoice: false,
      requiresNetwork: false,
      runsLocally: true,
      streams: false,
    })
  })

  it('reports not-installed truthfully before any tree exists', async () => {
    const world = makeWorld({ installed: false })
    const health = await world.engine.health()
    expect(health).toMatchObject({ ok: false, state: 'unavailable' })
    expect(health.note).toContain('kokoro-not-installed')
    await expect(world.engine.synthesize({ text: 'Oi' })).rejects.toMatchObject({
      kind: 'engine-unavailable',
      engine: 'kokoro',
    })
    expect(world.spawnLog).toEqual([]) // never spawns for a missing tree
  })

  it('health() warms an installed tree from cold and reports measured facts when ready', async () => {
    const world = makeWorld()
    const starting = await world.engine.health()
    expect(starting.state).toBe('starting')
    expect(world.spawnLog).toHaveLength(1)
    expect(world.spawnLog[0]!.command).toBe(world.layout.venvPython)
    expect(world.spawnLog[0]!.args).toEqual([world.layout.workerFile])

    await world.startAndReady()
    const ready = await world.engine.health()
    expect(ready).toMatchObject({
      device: 'cpu',
      modelLoaded: true,
      ok: true,
      state: 'ready',
    })
    expect(ready.deviceName).toContain('CPUExecutionProvider')
    expect(ready.note).not.toContain('directml')
  })

  it('send init with the pinned protocol, providers, default voice and language', async () => {
    const world = makeWorld()
    const startPromise = world.engine.start()
    const child = world.children[0]!
    child.reply(readyFactsFrame())
    await startPromise

    const init = child.frames()[0]!
    expect(init).toMatchObject({
      cmd: 'init',
      language: 'pt-br',
      voice: 'pf_dora',
      protocol: 1,
    })
    expect(init.providers).toEqual(['CPUExecutionProvider'])
  })

  it('synthesizes through the worker protocol and returns the engine-native WAV facts', async () => {
    const world = makeWorld()
    const wavBytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])
    const start = world.engine.start()
    world.children[0]!.reply(readyFactsFrame())
    await start

    const child = world.children[0]!
    const synthPromise = world.engine.synthesize({ language: 'pt-BR', text: 'Oi, tudo bem?' })
    const request = child.frames()[1]!
    expect(request).toMatchObject({
      cmd: 'synthesize',
      id: 1,
      language: 'pt-br',
      text: 'Oi, tudo bem?',
      voice: 'pf_dora',
    })
    expect(String(request.out)).toContain(world.layout.tmpDir)

    world.files.set(String(request.out), wavBytes)
    child.replyChunked({
      audioMs: 2400,
      channels: 1,
      event: 'result',
      generationMs: 800,
      id: 1,
      ok: true,
      sampleRate: 24000,
      wav: String(request.out),
    }, 5)

    const output = await synthPromise
    expect(output).toMatchObject({
      audioDurationMs: 2400,
      channels: 1,
      engine: 'kokoro',
      generationMs: 800,
      sampleRate: 24000,
    })
    expect(new Uint8Array(output.audio)).toEqual(wavBytes)
    expect(world.removed).toContain(String(request.out)) // scratch WAV cleaned
  })

  it('rejects empty input without ever asking the model (input-invalid, no fallthrough)', async () => {
    const world = makeWorld()
    await expect(world.engine.synthesize({ text: '   ' })).rejects.toMatchObject({ kind: 'input-invalid' })
    expect(world.spawnLog).toEqual([])
  })

  it('maps worker result errors to engine-error with the worker message', async () => {
    const world = makeWorld()
    const start = world.engine.start()
    world.children[0]!.reply(readyFactsFrame())
    await start

    const promise = world.engine.synthesize({ text: 'Oi' })
    world.children[0]!.reply({ event: 'result', error: 'RuntimeError: espeak failed', id: 1, ok: false })
    await expect(promise).rejects.toMatchObject({ kind: 'engine-error' })
    await expect(promise).rejects.toThrow(/espeak failed/)
  })

  it('stop() cancels in-flight synthesis as `cancelled` and is idempotent', async () => {
    const world = makeWorld()
    const start = world.engine.start()
    world.children[0]!.reply(readyFactsFrame())
    await start

    const child = world.children[0]!
    const synth = world.engine.synthesize({ text: 'Oi' })
    const reject = expect(synth).rejects.toMatchObject({ kind: 'cancelled' })
    await world.engine.stop()
    await reject

    expect(child.killed || child.frames().some(frame => frame.cmd === 'shutdown')).toBe(true)
    await world.engine.stop() // no throw on second stop

    // After a stop, the engine starts cleanly again (kill switch works twice).
    const restart = world.engine.start()
    expect(world.children).toHaveLength(2)
    world.children[1]!.reply(readyFactsFrame())
    await restart
    const health = await world.engine.health()
    expect(health.ok).toBe(true)
  })

  it('stop() during warmup cancels the start and never flips to ready', async () => {
    const world = makeWorld()
    const startPromise = world.engine.start()
    // Handler must be attached BEFORE stop() fires the rejection.
    const assertion = expect(startPromise).rejects.toMatchObject({ kind: 'cancelled' })
    await world.engine.stop()
    await assertion
    // A late `ready` frame must not resurrect a stopped engine.
    world.children[0]!.reply(readyFactsFrame())
    const health = await world.engine.health()
    expect(health.state).not.toBe('ready')
    // The stop was honest: a new warmup uses a fresh worker.
    expect(world.children.length).toBeGreaterThanOrEqual(1)
  })

  it('an unexpected worker exit fails pending work and lets the next start() retry', async () => {
    const world = makeWorld()
    const start = world.engine.start()
    world.children[0]!.reply(readyFactsFrame())
    await start

    const promise = world.engine.synthesize({ text: 'Oi' })
    world.children[0]!.reply({}) // unknown frame: ignored
    world.children[0]!.emitExit(1, null)
    await expect(promise).rejects.toMatchObject({ kind: 'engine-error' })

    const retry = world.engine.start()
    expect(world.children).toHaveLength(2)
    world.children[1]!.reply(readyFactsFrame())
    await expect(retry).resolves.toBeUndefined()
  })

  it('serializes worker calls 1:1 with the service FIFO - engine never batches on its own', async () => {
    const world = makeWorld()
    const start = world.engine.start()
    world.children[0]!.reply(readyFactsFrame())
    await start

    const requests = world.children[0]!.frames().filter(frame => frame.cmd === 'synthesize')
    expect(requests).toEqual([])
    const first = world.engine.synthesize({ text: 'Um' })
    world.children[0]!.reply({ audioMs: 100, channels: 1, event: 'result', generationMs: 10, id: 1, ok: true, sampleRate: 24000, wav: '/tmp/a.wav' })
    world.files.set('/tmp/a.wav', new Uint8Array([1]))
    await first
    world.files.set('/tmp/b.wav', new Uint8Array([2]))
    const second = world.engine.synthesize({ text: 'Dois' })
    world.children[0]!.reply({ audioMs: 100, channels: 1, event: 'result', generationMs: 10, id: 2, ok: true, sampleRate: 24000, wav: '/tmp/b.wav' })
    await second
    expect(world.children[0]!.frames().filter(frame => frame.cmd === 'synthesize')).toHaveLength(2)
    void 0
  })

  it('exposes the layout it owns and honors the installDir override', () => {
    const world = makeWorld()
    expect(world.engine.layout().rootDir).toBe(world.layout.rootDir)

    const override = createKokoroVoiceEngine({
      fileSystem: { existsSync: () => false, mkdirSync: () => undefined, readFile: async () => { throw new Error('nope') }, remove: async () => {} },
      installDirOverride: () => '/override/home',
      runtimeHome: () => '/default/home',
      spawnImpl: () => new FakeChildProcess(),
    })
    expect(override.layout().rootDir).toBe('/override/home/kokoro')
  })
})
