import type { KokoroInstallDeps } from './install'

import { describe, expect, it } from 'vitest'

import { ensureKokoroInstalled, pythonCandidates } from './install'
import { resolveKokoroLayout } from './layout'
import {
  KOKORO_MODEL_BYTES,
  KOKORO_MODEL_SHA256,
  KOKORO_MODEL_SHARD_URLS,
  KOKORO_MODEL_URL_PRIMARY,
  KOKORO_PIP_REQUIREMENTS,
  KOKORO_VOICES,
  KOKORO_WORKER_PROTOCOL_VERSION,
} from './manifest'

/**
 * The whole install flow, scripted against injected deps: every subprocess
 * spawn, download and hash check is recorded, so tests pin ORDER and FACTS
 * (never approximate behavior, never a real Python).
 */

interface CallLog {
  appends: Array<{ url: string, dest: string }>
  downloads: Array<{ url: string, dest: string }>
  removals: string[]
  renames: Array<{ from: string, to: string }>
  runs: Array<{ args: string[], command: string }>
  writes: Array<{ bytes: number, path: string }>
}

function fakeDeps(log: CallLog, options: { failHf?: boolean, modelDigest?: string, platform?: string, preInstalled?: boolean, pythonVersion?: string } = {}): { deps: KokoroInstallDeps, layout: ReturnType<typeof resolveKokoroLayout> } {
  const platform = options.platform ?? 'linux'
  const layout = resolveKokoroLayout({ home: '/run/lia-voice-runtimes', platform })
  const files = new Map<string, number>()

  if (options.preInstalled) {
    files.set(layout.venvPython, 1)
    files.set(layout.modelFile, KOKORO_MODEL_BYTES)
    for (const voice of KOKORO_VOICES)
      files.set(`${layout.voicesDir}/${voice.name}.bin`, voice.bytes)
    files.set(layout.voicesNpz, 1)
    files.set(layout.workerFile, 1)
    files.set(layout.stateFile, JSON.stringify({
      modelSha256: KOKORO_MODEL_SHA256,
      pipRequirements: [...KOKORO_PIP_REQUIREMENTS],
      protocol: KOKORO_WORKER_PROTOCOL_VERSION,
      pythonVersion: '3.12',
    }).length)
  }

  const deps: KokoroInstallDeps = {
    appendDownload: async (url, dest) => {
      log.appends.push({ dest, url })
    },
    download: async (url, dest) => {
      log.downloads.push({ dest, url })
      if (options.failHf && url === KOKORO_MODEL_URL_PRIMARY && !dest.includes('voices'))
        throw new Error('hf down')
      if (dest.endsWith('.bin.part') || dest === `${layout.modelFile}.part`)
        files.set(dest.replace(/\.part$/, ''), dest.endsWith('bin.part') ? KOKORO_VOICES[0]!.bytes : KOKORO_MODEL_BYTES)
      if (dest === `${layout.modelFile}.part`)
        files.set(dest, KOKORO_MODEL_BYTES)
    },
    existsSync: path => files.has(path),
    mkdirSync: () => undefined,
    log: () => undefined,
    platform,
    readFileSync: (path) => {
      if (path === layout.stateFile && options.preInstalled)
        return JSON.stringify({
          modelSha256: KOKORO_MODEL_SHA256,
          pipRequirements: [...KOKORO_PIP_REQUIREMENTS],
          protocol: KOKORO_WORKER_PROTOCOL_VERSION,
          pythonVersion: '3.12',
        })
      if (!files.has(path))
        throw new Error(`ENOENT: ${path}`)
      return ''
    },
    renameSync: (from, to) => {
      log.renames.push({ from, to })
      if (files.has(from)) {
        files.set(to, files.get(from)!)
        files.delete(from)
      }
      else {
        files.set(to, 1)
      }
    },
    rmSync: (path) => {
      log.removals.push(path)
      files.delete(path)
    },
    run: async (command, args) => {
      log.runs.push({ args: [...args], command })
      if (args.join(' ').includes("sys.version_info"))
        return { code: 0, stdout: `${options.pythonVersion ?? '3.12'}\n`, stderr: '' }
      if (args[0] === '-m' && args[1] === 'venv') {
        files.set(layout.venvPython, 1)
        return { code: 0, stdout: '', stderr: '' }
      }
      if (args.includes('pip'))
        return { code: 0, stdout: '', stderr: '' }
      if (args[0] === layout.npzBuilderFile || args.includes(layout.npzBuilderFile)) {
        files.set(layout.voicesNpz, 1)
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    },
    sha256File: async (path) => {
      const dest = path.replace(/\.part$/, '')
      if (dest === layout.modelFile)
        return options.modelDigest ?? KOKORO_MODEL_SHA256
      const voice = KOKORO_VOICES.find(candidate => dest.endsWith(`${candidate.name}.bin`))
      if (voice)
        return voice.sha256
      return ''
    },
    statSync: path => ({ size: files.get(path) ?? 0 }),
    writeFileSync: (path, data) => {
      log.writes.push({ bytes: data.length, path })
      files.set(path, data.length)
    },
  }

  return { deps, layout }
}

function freshLog(): CallLog {
  return { appends: [], downloads: [], removals: [], renames: [], runs: [], writes: [] }
}

describe('kokoro install (engine-owned, sha256-pinned, idempotent)', () => {
  it('happy path: probe -> venv -> pinned pip -> voices -> npz -> model -> worker -> state', async () => {
    const log = freshLog()
    const { deps, layout } = fakeDeps(log)
    const facts = await ensureKokoroInstalled(layout, deps)

    expect(facts.installed).toBe(true)
    expect(facts.modelSha256).toBe(KOKORO_MODEL_SHA256)
    expect(facts.modelBytes).toBe(KOKORO_MODEL_BYTES)
    expect(facts.modelSource).toBe('huggingface')
    expect(facts.voices).toEqual(KOKORO_VOICES.map(voice => voice.name))

    const commands = log.runs.map(call => `${call.command} ${call.args.join(' ')}`)
    expect(commands[0]).toContain('python3')
    expect(commands[1]).toContain('-m venv')
    expect(commands[2]).toContain('-m pip install')

    // Pin contract: exact requirement strings, and NO accelerated provider
    // package may ever appear in ANY command line this installer runs.
    const pipArgs = log.runs.find(call => call.args.includes('pip'))!.args
    expect(pipArgs).toContain('kokoro-onnx==0.6.1')
    expect(pipArgs).toContain('soundfile')
    for (const call of log.runs)
      expect(call.args.join(' ')).not.toMatch(/directml|cuda/i)

    // Every voice pack was fetched and the npz bundler ran inside the venv.
    expect(log.downloads.filter(d => d.dest.includes('voices'))).toHaveLength(KOKORO_VOICES.length)
    expect(log.downloads.some(d => d.url === KOKORO_MODEL_URL_PRIMARY)).toBe(true)
    expect(log.runs.some(call => call.args[0] === layout.npzBuilderFile || call.args.includes(layout.npzBuilderFile))).toBe(true)

    // Worker + marker were written LAST, from the shipped source bytes.
    const workerWrite = log.writes.find(write => write.path === layout.workerFile)
    expect(workerWrite).toBeDefined()
    expect(workerWrite!.bytes).toBeGreaterThan(1_000)
    const stateWrite = log.writes.find(write => write.path === layout.stateFile)
    expect(stateWrite).toBeDefined()
    const markerOrder = log.writes.findIndex(write => write.path === layout.stateFile)
    expect(markerOrder).toBeGreaterThan(log.writes.findIndex(write => write.path === layout.workerFile))
  })

  it('falls back to jsDelivr shards (concatenated in order) when HF fails', async () => {
    const log = freshLog()
    const { deps, layout } = fakeDeps(log, { failHf: true })
    const facts = await ensureKokoroInstalled(layout, deps)
    expect(facts.modelSource).toBe('jsdelivr-shards')
    expect(log.appends.map(call => call.url)).toEqual([...KOKORO_MODEL_SHARD_URLS])
    expect(log.removals).not.toContain(layout.modelFile)
  })

  it('a model sha mismatch fails the install and never writes the marker', async () => {
    const log = freshLog()
    const { deps, layout } = fakeDeps(log, { modelDigest: 'deadbeef' })
    await expect(ensureKokoroInstalled(layout, deps)).rejects.toMatchObject({ step: 'model' })
    expect(log.writes.some(write => write.path === layout.stateFile)).toBe(false)
    expect(log.removals).toContain(`${layout.modelFile}.part`)
  })

  it('a pre-installed tree is a no-op (marker pins honored, zero downloads, zero subprocess)', async () => {
    const log = freshLog()
    const { deps, layout } = fakeDeps(log, { preInstalled: true })
    const facts = await ensureKokoroInstalled(layout, deps)
    expect(facts.installed).toBe(true)
    expect(log.downloads).toEqual([])
    expect(log.appends).toEqual([])
    expect(log.runs).toEqual([])
    // The worker script is still refreshed from shipped bytes (code wins).
    expect(log.writes.some(write => write.path === layout.workerFile)).toBe(true)
  })

  it('rejects a python outside the pinned range, naming every candidate tried', async () => {
    const log = freshLog()
    const { deps, layout } = fakeDeps(log, { pythonVersion: '3.9' })
    await expect(ensureKokoroInstalled(layout, deps)).rejects.toMatchObject({ step: 'python-probe' })
    await expect(ensureKokoroInstalled(layout, deps)).rejects.toThrow(/python3, python/)
  })

  it('win32: venv python is Scripts/python.exe and the py launcher is probed first', () => {
    expect(pythonCandidates('win32')[0]).toMatchObject({ args: ['-3', '-c', expect.any(String)], command: 'py' })
    expect(pythonCandidates('linux')[0]).toMatchObject({ command: 'python3' })
    const layout = resolveKokoroLayout({ home: 'C:/Lia/runtimes', platform: 'win32' })
    expect(layout.venvPython).toMatch(/Scripts[\\/]python\.exe$/)
  })
})
