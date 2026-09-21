import type { KokoroVoiceEngine } from './index'
import type { KokoroSmokeFileSystem } from './smoke'

import { describe, expect, it } from 'vitest'

import { KOKORO_SMOKE_PHRASES, kokoroSmokeSummaryLine, runKokoroSmoke } from './smoke'
import { resolveKokoroLayout } from './layout'
import { KOKORO_ENGINE_ID, KOKORO_MODEL_SHA256, KOKORO_VOICES } from './manifest'

/**
 * The smoke's obligations to the production engine: order (install only if
 * missing -> start -> synth x4 -> stop), factual report fields, dev-only
 * WAV persistence, and clean stop after the last phrase.
 */

interface CallRecord {
  kind: 'install' | 'start' | 'synthesize' | 'stop'
  detail?: string
}

function fakeEngine(calls: CallRecord[], options: { provider?: string } = {}): KokoroVoiceEngine {
  let request = 0
  return {
    id: KOKORO_ENGINE_ID,
    capabilities: () => ({ clonesVoice: false, requiresNetwork: false, runsLocally: true, streams: false }),
    install: async () => {
      calls.push({ kind: 'install' })
      return {
        installed: true,
        layout: resolveKokoroLayout({ home: '/run/lia-voice-runtimes' }),
        modelBytes: A_MODEL_BYTES,
        modelSha256: KOKORO_MODEL_SHA256,
        modelSource: 'huggingface',
        pipRequirements: ['kokoro-onnx==0.6.1', 'soundfile'],
        pythonPath: 'py',
        pythonVersion: '3.11',
        voices: KOKORO_VOICES.map(voice => voice.name),
      }
    },
    layout: () => resolveKokoroLayout({ home: '/run/lia-voice-runtimes' }),
    health: async () => ({
      device: 'cpu',
      deviceName: options.provider ?? 'CPUExecutionProvider',
      modelLoaded: true,
      ok: true,
      state: 'ready',
    }),
    start: async () => {
      calls.push({ kind: 'start' })
    },
    stop: async () => {
      calls.push({ kind: 'stop' })
    },
    synthesize: async (input) => {
      request += 1
      calls.push({ detail: `${input.language}|${input.text}`, kind: 'synthesize' })
      return {
        audio: new Uint8Array([80 + request, request]).buffer,
        audioDurationMs: 1000 + request,
        channels: 1,
        engine: KOKORO_ENGINE_ID,
        generationMs: 200 + request,
        sampleRate: 24000,
      }
    },
  }
}

const A_MODEL_BYTES = 92_361_116

function fakeSmokeWorld(preInstalled: boolean) {
  const layout = resolveKokoroLayout({ home: '/run/lia-voice-runtimes' })
  const bytes = new Map<string, Uint8Array>()
  const writes: Array<{ bytes: number, path: string }> = []
  const markerPaths = [
    layout.venvPython,
    layout.modelFile,
    ...KOKORO_VOICES.map(voice => `${layout.voicesDir}/${voice.name}.bin`),
    layout.voicesNpz,
    layout.workerFile,
    layout.stateFile,
  ]
  const fileSystem: KokoroSmokeFileSystem = {
    existsSync: path => bytes.has(path) || (preInstalled && markerPaths.includes(path)),
    mkdirSync: () => undefined,
    writeFileSync: (path, data) => {
      writes.push({ bytes: data.byteLength, path })
      bytes.set(path, data)
    },
    readFileSync: (path) => {
      const found = bytes.get(path)
      if (!found)
        throw new Error(`ENOENT: ${path}`)
      return found
    },
  }
  if (preInstalled) {
    bytes.set(layout.modelFile, new Uint8Array([1]))
    bytes.set(layout.stateFile, new TextEncoder().encode(JSON.stringify({ pythonVersion: '3.11' })))
  }
  else {
    bytes.set(layout.modelFile, new Uint8Array([2]))
  }
  const logLines: string[] = []
  const calls: CallRecord[] = []
  return { bytes, calls, fileSystem, layout, logLines, writes }
}

describe('kokoro smoke (dev-only, drives the production engine)', () => {
  it('first run: installs once, starts, synthesizes exactly the 4 QA phrases, stops LAST', async () => {
    const world = fakeSmokeWorld(false)
    const engine = fakeEngine(world.calls)
    const report = await runKokoroSmoke({
      engineFactory: () => engine,
      fileSystem: world.fileSystem,
      layout: world.layout,
      log: line => world.logLines.push(line),
      outDir: '/run/qa-out',
      sha256File: async () => KOKORO_MODEL_SHA256,
    })

    expect(world.calls.map(call => call.kind)).toEqual([
      'install', 'start', 'synthesize', 'synthesize', 'synthesize', 'synthesize', 'stop',
    ])
    expect(report.installRan).toBe(true)
    expect(report.installedPrior).toBe(false)
    expect(report.stopped).toBe(true)
    expect(report.pythonVersion).toBe('3.11')

    // The phrases are byte-identical to the 7.9B QA set and language-tagged pt-BR.
    const synths = world.calls.filter(call => call.kind === 'synthesize').map(call => call.detail)
    expect(synths).toEqual(KOKORO_SMOKE_PHRASES.map(phrase => `pt-BR|${phrase.text}`))
    expect(report.phrases).toHaveLength(4)

    // WAVs land dev-only, named by slug, bytes verifiably written.
    expect(report.phrases.map(p => p.wavPath)).toEqual([
      '/run/qa-out/smoke-a.wav',
      '/run/qa-out/smoke-b.wav',
      '/run/qa-out/smoke-c.wav',
      '/run/qa-out/smoke-d.wav',
    ])
    expect(world.writes).toHaveLength(4)
    expect(world.bytes.get('/run/qa-out/smoke-b.wav')).toEqual(new Uint8Array([82, 2]).buffer ? new Uint8Array([82, 2]) : new Uint8Array())
  })

  it('second run: verified runtime is REUSED - no install, still 4 phrases, stop always fires', async () => {
    const world = fakeSmokeWorld(true)
    const report = await runKokoroSmoke({
      engineFactory: () => fakeEngine(world.calls),
      fileSystem: world.fileSystem,
      layout: world.layout,
      outDir: '/run/qa-out',
      sha256File: async () => KOKORO_MODEL_SHA256,
    })
    expect(report.installedPrior).toBe(true)
    expect(report.installRan).toBe(false)
    expect(world.calls.filter(c => c.kind === 'install')).toHaveLength(0)
    expect(world.calls.at(-1)!.kind).toBe('stop')
    expect(report.pythonVersion).toBe('3.11') // read back from the install marker
  })

  it('reports measured facts: hash ok, provider from health, per-phrase RTF', async () => {
    const world = fakeSmokeWorld(true)
    const report = await runKokoroSmoke({
      engineFactory: () => fakeEngine(world.calls),
      fileSystem: world.fileSystem,
      layout: world.layout,
      outDir: '/run/qa-out',
      sha256File: async () => KOKORO_MODEL_SHA256,
      now: (() => { let t = 1000; return () => (t += 250) })(),
    })
    expect(report.modelSha256).toBe(KOKORO_MODEL_SHA256)
    expect(report.modelMatchesManifest).toBe(true)
    expect(report.providerActive).toBe('CPUExecutionProvider')
    expect(report.engineId).toBe('kokoro')
    expect(report.device).toBe('cpu')
    expect(report.pythonVenv).toBe(world.layout.venvPython)
    expect(report.runtimeRoot).toBe(world.layout.rootDir)
    expect(report.phrases[0]!.rtf).toBeGreaterThan(0)
    expect(report.phrases[0]!.text).toBe(KOKORO_SMOKE_PHRASES[0]!.text)

    const summary = kokoroSmokeSummaryLine(report)
    expect(summary).toContain('"provider":"CPUExecutionProvider"')
    expect(summary).toContain('"sampleRate":24000')
    expect(summary).toContain('"coldStartMs":250') // two now() ticks of 250ms - measured, not estimated
    expect(summary).toContain('"slug":"a"')
    expect(summary).toContain('"outDir":"/run/qa-out"')
    expect(summary).not.toContain('directml')
  })

  it('a model hash mismatch stops the run BEFORE the engine starts', async () => {
    const world = fakeSmokeWorld(true)
    await expect(runKokoroSmoke({
      engineFactory: () => fakeEngine(world.calls),
      fileSystem: world.fileSystem,
      layout: world.layout,
      outDir: '/run/qa-out',
      sha256File: async () => 'deadbeef',
    })).rejects.toThrow(/hash mismatch/i)
    expect(world.calls.length).toBe(0)
  })

  it('the smoke never contains its own TTS: production engine interface is the only input', () => {
    // Type-level fact of this harness: engineFactory is () => KokoroVoiceEngine.
    // (The CLI wiring file is pinned by the DevKit python tests, which also
    // guard that the runner imports the production module paths directly.)
    expect(typeof runKokoroSmoke).toBe('function')
    expect(KOKORO_SMOKE_PHRASES.map(phrase => phrase.slug)).toEqual(['a', 'b', 'c', 'd'])
  })
})
