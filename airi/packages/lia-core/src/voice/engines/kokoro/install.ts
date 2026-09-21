import type { KokoroLayout } from './layout'

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import nodePath from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import { inspectKokoroInstall } from './layout'
import {
  KOKORO_MODEL_BYTES,
  KOKORO_MODEL_SHA256,
  KOKORO_MODEL_SHARD_URLS,
  KOKORO_MODEL_URL_PRIMARY,
  KOKORO_PIP_REQUIREMENTS,
  KOKORO_PYTHON_MAX,
  KOKORO_PYTHON_MIN,
  KOKORO_VOICES,
  KOKORO_WORKER_PROTOCOL_VERSION,
  kokoroVoiceUrls,
} from './manifest'
import { KOKORO_NPZ_BUILDER_PY, KOKORO_WORKER_PY } from './worker-script'

const execFileAsync = promisify(execFile)

/**
 * The engine-owned installer for the Kokoro runtime tree (Phase 7.9C).
 *
 * Every step is idempotent, every artifact sits under the engine layout,
 * and integrity is pinned at two levels: exact bytes (sha256) for model +
 * voice packs, and the venv's python (-V probe) for the interpreter.
 * Failure leaves a retryable partial tree, never a half-recognized
 * install: `install-state.json` is written LAST, after every check passed.
 */

export interface KokoroInstallRunResult { code: number, stdout: string, stderr: string }

export interface KokoroInstallDeps {
  /** Runs a program; injected so tests script the whole install without I/O. */
  run: (command: string, args: string[], options?: { cwd?: string }) => Promise<KokoroInstallRunResult>
  /** Streams a URL to `dest` (download impl decides resumption; returns when complete). */
  download: (url: string, dest: string) => Promise<void>
  /** Appends a URL's bytes to `dest` (used to concat model shards in order). */
  appendDownload: (url: string, dest: string) => Promise<void>
  sha256File: (path: string) => Promise<string>
  existsSync: (path: string) => boolean
  mkdirSync: (path: string) => void
  writeFileSync: (path: string, data: string) => void
  readFileSync: (path: string) => string
  renameSync: (from: string, to: string) => void
  rmSync: (path: string) => void
  statSync: (path: string) => { size: number }
  platform: string
  log: (entry: Record<string, string | number | boolean>) => void
}

export interface KokoroInstallFacts {
  installed: true
  layout: KokoroLayout
  modelSha256: string
  modelBytes: number
  pipRequirements: readonly string[]
  pythonPath: string
  pythonVersion: string
  /** How the model was acquired this run, or '' when it was already present. */
  modelSource: 'huggingface' | 'jsdelivr-shards' | ''
  voices: string[]
}

export class KokoroInstallError extends Error {
  readonly step: string

  constructor(step: string, message: string) {
    super(message)
    this.name = 'KokoroInstallError'
    this.step = step
  }
}

// ---------------------------------------------------------------------------
// Production dep implementations (plain node, no Electron).
// ---------------------------------------------------------------------------

async function defaultRun(command: string, args: string[]): Promise<KokoroInstallRunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 10 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 })
    return { code: 0, stdout: String(stdout), stderr: String(stderr) }
  }
  catch (error) {
    const anyError = error as { code?: number, stdout?: string, stderr?: string, message?: string }
    return {
      code: typeof anyError.code === 'number' ? anyError.code : -1,
      stdout: String(anyError.stdout ?? ''),
      stderr: String(anyError.stderr ?? anyError.message ?? ''),
    }
  }
}

async function streamUrlTo(url: string, dest: string, append: boolean): Promise<void> {
  // `fetch` follows redirects by default; the only thing we enforce here is
  // a 2xx - bytes are verified AFTER download by the sha256 gate.
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body)
    throw new KokoroInstallError('download', `download failed: HTTP ${response.status} for ${url}`)

  const { createWriteStream } = await import('node:fs')
  const flags = append ? 'a' : 'w'
  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(dest, { flags })
    stream.on('error', reject)
    stream.on('finish', resolve)
    const reader = response.body!.getReader()
    void (async () => {
      for (;;) {
        const { done, value } = await reader.read()
        if (done)
          break
        stream.write(Buffer.from(value))
      }
      stream.end()
    })().catch((error) => {
      stream.destroy(error)
      reject(error)
    })
  })
}

async function defaultSha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  hash.update(readFileSync(path))
  return hash.digest('hex')
}

export function defaultKokoroInstallDeps(): KokoroInstallDeps {
  return {
    run: defaultRun,
    download: (url, dest) => streamUrlTo(url, dest, false),
    appendDownload: (url, dest) => streamUrlTo(url, dest, true),
    sha256File: defaultSha256File,
    existsSync,
    mkdirSync: path => mkdirSync(path, { recursive: true }),
    writeFileSync: (path, data) => writeFileSync(path, data, 'utf8'),
    readFileSync: path => readFileSync(path, 'utf8'),
    renameSync,
    rmSync: path => rmSync(path, { force: true, recursive: true }),
    statSync: path => statSync(path),
    platform: process.platform,
    log: () => undefined,
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const PYTHON_PROBE_ARGS = ['-c', "import sys;print(f'{sys.version_info[0]}.{sys.version_info[1]}')"]

export function pythonCandidates(platform: string): Array<{ command: string, args: string[] }> {
  return platform === 'win32'
    ? [
        { command: 'py', args: ['-3', ...PYTHON_PROBE_ARGS] },
        { command: 'python', args: PYTHON_PROBE_ARGS },
        { command: 'python3', args: PYTHON_PROBE_ARGS },
      ]
    : [
        { command: 'python3', args: PYTHON_PROBE_ARGS },
        { command: 'python', args: PYTHON_PROBE_ARGS },
      ]
}

function pythonVersionOk(version: string): boolean {
  const match = /^(\d+)\.(\d+)/.exec(version.trim())
  if (!match)
    return false
  const major = Number(match[1])
  const minor = Number(match[2])
  if (major !== KOKORO_PYTHON_MIN[0])
    return false
  return minor >= KOKORO_PYTHON_MIN[1] && minor <= KOKORO_PYTHON_MAX[1]
}

interface PythonResolution { pythonPath: string, version: string }

async function resolvePython(deps: KokoroInstallDeps): Promise<PythonResolution> {
  const tried: string[] = []
  for (const candidate of pythonCandidates(deps.platform)) {
    tried.push(candidate.command)
    const result = await deps.run(candidate.command, candidate.args)
    if (result.code !== 0)
      continue
    const version = result.stdout.trim()
    if (pythonVersionOk(version))
      return { pythonPath: candidate.command, version }
  }
  throw new KokoroInstallError(
    'python-probe',
    `No usable Python found (tried: ${tried.join(', ')}). Kokoro needs Python ${KOKORO_PYTHON_MIN.join('.')}..${KOKORO_PYTHON_MAX.join('.')} on PATH.`,
  )
}

interface StoredInstallState {
  modelSha256?: string
  pipRequirements?: string[]
  protocol?: number
  pythonVersion?: string
}

function readStoredState(layout: KokoroLayout, deps: KokoroInstallDeps): StoredInstallState | undefined {
  try {
    return JSON.parse(deps.readFileSync(layout.stateFile)) as StoredInstallState
  }
  catch {
    return undefined
  }
}

export async function ensureKokoroInstalled(layout: KokoroLayout, deps: KokoroInstallDeps): Promise<KokoroInstallFacts> {
  const state = readStoredState(layout, deps)
  let modelSource: KokoroInstallFacts['modelSource'] = ''
  let python: PythonResolution | undefined

  deps.mkdirSync(layout.rootDir)
  deps.mkdirSync(layout.modelsDir)
  deps.mkdirSync(layout.voicesDir)
  deps.mkdirSync(layout.workerDir)
  deps.mkdirSync(layout.tmpDir)

  // 1-2. Python + venv --------------------------------------------------------
  if (!deps.existsSync(layout.venvPython)) {
    python = await resolvePython(deps)
    deps.log({ event: 'lia.voice.kokoro.install', step: 'python', detail: `${python.pythonPath} ${python.version}` })
    const venv = await deps.run(python.pythonPath, ['-m', 'venv', layout.venvDir])
    if (venv.code !== 0)
      throw new KokoroInstallError('venv', `venv creation failed (exit ${venv.code}): ${venv.stderr.trim().slice(0, 300)}`)
  }

  // 3. Pinned pip requirements -------------------------------------------------
  const pinsMatch = state?.pipRequirements?.join('|') === KOKORO_PIP_REQUIREMENTS.join('|')
  if (!(deps.existsSync(layout.venvPython) && pinsMatch)) {
    const args = ['-m', 'pip', 'install', '--disable-pip-version-check', ...KOKORO_PIP_REQUIREMENTS]
    const pip = await deps.run(layout.venvPython, args)
    if (pip.code !== 0)
      throw new KokoroInstallError('pip', `pip install failed (exit ${pip.code}): ${pip.stderr.trim().slice(0, 300)}`)
    deps.log({ event: 'lia.voice.kokoro.install', step: 'pip', detail: KOKORO_PIP_REQUIREMENTS.join(', ') })
  }

  // 4. Voice packs (sha256-verified) -------------------------------------------
  for (const voice of KOKORO_VOICES) {
    const dest = nodePath.join(layout.voicesDir, `${voice.name}.bin`)
    if (deps.existsSync(dest) && (await deps.sha256File(dest)) === voice.sha256)
      continue
    let downloaded = false
    for (const url of kokoroVoiceUrls(voice.name)) {
      try {
        await deps.download(url, `${dest}.part`)
        deps.renameSync(`${dest}.part`, dest)
        downloaded = true
        break
      }
      catch {
        deps.rmSync(`${dest}.part`)
      }
    }
    if (!downloaded)
      throw new KokoroInstallError('voices', `voice pack ${voice.name} could not be downloaded from any mirror`)
    const digest = await deps.sha256File(dest)
    if (digest !== voice.sha256) {
      deps.rmSync(dest)
      throw new KokoroInstallError('voices', `voice pack ${voice.name} failed sha256 verification (${digest.slice(0, 12)}…)`)
    }
  }

  // 5. voices-pt.npz (bundling step, runs inside the pinned venv) --------------
  if (!deps.existsSync(layout.voicesNpz)) {
    deps.writeFileSync(layout.npzBuilderFile, KOKORO_NPZ_BUILDER_PY)
    const build = await deps.run(layout.venvPython, [layout.npzBuilderFile, layout.voicesDir, layout.voicesNpz])
    if (build.code !== 0 || !deps.existsSync(layout.voicesNpz))
      throw new KokoroInstallError('voices-npz', `voice pack bundling failed (exit ${build.code}): ${build.stderr.trim().slice(0, 300)}`)
  }

  // 6. Model (sha256 hard gate) -------------------------------------------------
  const modelPresent = deps.existsSync(layout.modelFile)
    && deps.statSync(layout.modelFile).size === KOKORO_MODEL_BYTES
    && (await deps.sha256File(layout.modelFile)) === KOKORO_MODEL_SHA256
  if (!modelPresent) {
    let ok = false
    try {
      await deps.download(KOKORO_MODEL_URL_PRIMARY, `${layout.modelFile}.part`)
      ok = true
      modelSource = 'huggingface'
    }
    catch {
      deps.rmSync(`${layout.modelFile}.part`)
      try {
        for (const url of KOKORO_MODEL_SHARD_URLS)
          await deps.appendDownload(url, `${layout.modelFile}.part`)
        ok = true
        modelSource = 'jsdelivr-shards'
      }
      catch (error) {
        deps.rmSync(`${layout.modelFile}.part`)
        throw new KokoroInstallError('model', `model download failed on every mirror: ${errorMessageFrom(error)}`)
      }
    }
    if (ok) {
      const digest = await deps.sha256File(`${layout.modelFile}.part`)
      if (digest !== KOKORO_MODEL_SHA256) {
        deps.rmSync(`${layout.modelFile}.part`)
        throw new KokoroInstallError('model', `model failed sha256 verification (${digest.slice(0, 12)}…)`)
      }
      deps.renameSync(`${layout.modelFile}.part`, layout.modelFile)
    }
  }

  // 7. Worker script: always refreshed from the shipped bytes -------------------
  deps.writeFileSync(layout.workerFile, KOKORO_WORKER_PY)

  // 8. Commit marker (LAST) -----------------------------------------------------
  if (!python) {
    python = { pythonPath: layout.venvPython, version: state?.pythonVersion ?? '' }
  }
  deps.writeFileSync(layout.stateFile, `${JSON.stringify({
    installedAt: new Date().toISOString(),
    modelSha256: KOKORO_MODEL_SHA256,
    modelBytes: KOKORO_MODEL_BYTES,
    pipRequirements: [...KOKORO_PIP_REQUIREMENTS],
    protocol: KOKORO_WORKER_PROTOCOL_VERSION,
    pythonVersion: python.version,
    voices: KOKORO_VOICES.map(voice => voice.name),
  }, null, 2)}\n`)

  const finalCheck = inspectKokoroInstall(layout, deps)
  if (!finalCheck.installed)
    throw new KokoroInstallError('finalize', `install finished but markers are missing: ${finalCheck.missing.join(', ')}`)

  return {
    installed: true,
    layout,
    modelBytes: KOKORO_MODEL_BYTES,
    modelSha256: KOKORO_MODEL_SHA256,
    modelSource,
    pipRequirements: KOKORO_PIP_REQUIREMENTS,
    pythonPath: python.pythonPath,
    pythonVersion: python.version,
    voices: KOKORO_VOICES.map(voice => voice.name),
  }
}
