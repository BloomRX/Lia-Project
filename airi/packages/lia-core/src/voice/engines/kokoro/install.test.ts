import type { KokoroInstallDeps, KokoroInstallRunResult } from './install'

import { describe, expect, it } from 'vitest'

import { ensureKokoroInstalled, parsePyLauncherInventory } from './install'
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

function fakeDeps(log: CallLog, options: { failHf?: boolean, modelDigest?: string, platform?: string, preInstalled?: boolean, pythonVersion?: string, runScript?: (command: string, args: string[]) => KokoroInstallRunResult | undefined } = {}): { deps: KokoroInstallDeps, layout: ReturnType<typeof resolveKokoroLayout> } {
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
      const scripted = options.runScript?.(command, args)
      if (scripted)
        return scripted
      if (args.join(' ').includes("sys.version_info"))
        return { code: 0, stdout: `${options.pythonVersion ?? '3.12'}\n`, stderr: '' }
      // Position-independent: launcher prefix args (`py -3.11 -m venv ...`)
      // must not hide the venv step.
      const mIndex = args.indexOf('-m')
      if (mIndex >= 0 && args[mIndex + 1] === 'venv') {
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

  it('win32: 3.14 as the machine default + 3.11 side-by-side -> the launcher inventory picks 3.11, and the out-of-range default is never even probed', async () => {
    const log = freshLog()
    const python311 = 'C:\\Program Files\\Python311\\python.exe'
    const { deps, layout } = fakeDeps(log, {
      platform: 'win32',
      runScript: (command, args) => {
        if (command === 'py' && args.join(' ') === '-0p') {
          return { code: 0, stdout: [
            ' -V:3.14 *        C:\\Program Files\\Python314\\python.exe',
            ' -V:3.11          C:\\Program Files\\Python311\\python.exe',
            '',
          ].join('\r\n'), stderr: '' }
        }
        if (command === python311 && args.includes('-c'))
          return { code: 0, stdout: '3.11\n', stderr: '' }
        // Any other probe is an unscripted interpreter: it does not exist.
        if (args.includes('-c'))
          return { code: 1, stdout: '', stderr: 'not installed' }
        return undefined
      },
    })

    const facts = await ensureKokoroInstalled(layout, deps)
    expect(facts.installed).toBe(true)
    expect(facts.pythonPath).toBe(python311)
    expect(facts.pythonVersion).toBe('3.11')

    // Exactly ONE interpreter probe ran - against 3.11's real path. The
    // 3.14 default row produced NO probe call (skipped pre-probe).
    const probes = log.runs.filter(call => call.args.includes('-c'))
    expect(probes).toHaveLength(1)
    expect(probes[0]!.command).toBe(python311)
    expect(log.runs.some(call => call.command === 'py' && call.args.join(' ') === '-0p')).toBe(true)
    expect(log.runs.some(call => /3\.14/.test(`${call.command} ${call.args.join(' ')}`))).toBe(false)

    // The venv is created with the interpreter PATH directly (launcher
    // flags are not needed once we know where 3.11 lives).
    const venv = log.runs.find(call => call.args.includes('venv'))!
    expect(venv.command).toBe(python311)
    expect(venv.args).toEqual(['-m', 'venv', layout.venvDir])
  })

  it('win32: inventory unusable -> explicit py -3.x flags, and the flags travel with EVERY invocation (probe, venv)', async () => {
    const log = freshLog()
    const { deps, layout } = fakeDeps(log, {
      platform: 'win32',
      runScript: (command, args) => {
        if (command === 'py' && args.join(' ') === '-0p')
          return { code: 1, stdout: '', stderr: 'launcher inventory broken' }
        if (command === 'py' && args[0] === '-3.13')
          return { code: 1, stdout: '', stderr: 'not installed' }
        if (command === 'py' && args[0] === '-3.12')
          return { code: 1, stdout: '', stderr: 'not installed' }
        if (command === 'py' && args[0] === '-3.11' && args.includes('-c'))
          return { code: 0, stdout: '3.11\n', stderr: '' }
        if (args.includes('-c'))
          return { code: 1, stdout: '', stderr: 'not installed' }
        return undefined
      },
    })

    const facts = await ensureKokoroInstalled(layout, deps)
    expect(facts.pythonPath).toBe('py')
    expect(facts.pythonVersion).toBe('3.11')

    // Probe order pinned: 3.13 and 3.12 were asked first and declined.
    const probes = log.runs.filter(call => call.args.includes('-c'))
    expect(probes.map(call => call.args[0])).toEqual(['-3.13', '-3.12', '-3.11'])
    // Launcher flags MUST travel with the venv call or we'd create a 3.14 venv.
    const venv = log.runs.find(call => call.args.includes('venv'))!
    expect(venv.command).toBe('py')
    expect(venv.args).toEqual(['-3.11', '-m', 'venv', layout.venvDir])
  })

  it('win32: only an out-of-range 3.14 exists -> the error names EVERY attempt and explains the intentional skip', async () => {
    const log = freshLog()
    const { deps, layout } = fakeDeps(log, {
      platform: 'win32',
      runScript: (command, args) => {
        if (command === 'py' && args.join(' ') === '-0p')
          return { code: 0, stdout: ' -V:3.14 *        C:\\Program Files\\Python314\\python.exe\r\n', stderr: '' }
        // PATH names exist but all resolve to 3.14: probed, then rejected.
        if ((command === 'python' || command === 'python3') && args.includes('-c'))
          return { code: 0, stdout: '3.14\n', stderr: '' }
        if (args.includes('-c'))
          return { code: 1, stdout: '', stderr: 'not installed' }
        return undefined
      },
    })

    await expect(ensureKokoroInstalled(layout, deps)).rejects.toMatchObject({ name: 'KokoroInstallError', step: 'python-probe' })
    await expect(ensureKokoroInstalled(layout, deps)).rejects.toThrow(/py -3\.13, py -3\.12, py -3\.11, py -3\.10, python, python3/)
    await expect(ensureKokoroInstalled(layout, deps)).rejects.toThrow(/3\.14\) is skipped on purpose/)
    // No venv, no pip, no downloads: failure stops at the probe step.
    expect(log.runs.some(call => call.args.includes('venv'))).toBe(false)
    expect(log.runs.some(call => call.args.includes('pip'))).toBe(false)
    expect(log.downloads).toEqual([])
  })

  it('py -0p inventory parsing: default marker, path column with spaces, pathless rows', () => {
    expect(parsePyLauncherInventory([
      ' -V:3.14 *        C:\\Program Files\\Python314\\python.exe',
      ' -V:3.11',
      ' -V:3.10          D:\\bin\\py\\python.exe',
      '',
    ].join('\r\n'))).toEqual([
      { version: '3.14', path: 'C:\\Program Files\\Python314\\python.exe' },
      { version: '3.11' },
      { version: '3.10', path: 'D:\\bin\\py\\python.exe' },
    ])
  })

  it('venv interpreter convention: Scripts/python.exe on win32, bin/python elsewhere', () => {
    expect(resolveKokoroLayout({ home: 'C:/Lia/runtimes', platform: 'win32' }).venvPython).toMatch(/Scripts[\\/]python\.exe$/)
    expect(resolveKokoroLayout({ home: '/run/lia', platform: 'linux' }).venvPython).toMatch(/bin[\\/]python$/)
  })
})
