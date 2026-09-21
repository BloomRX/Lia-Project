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

/**
 * One inventory line of the py launcher (`py -0p`):
 * ` -V:3.13 *        C:\\Program Files\\Python313\\python.exe`
 * The path column is optional (`-0` lists without it) and may contain spaces.
 */
export function parsePyLauncherInventory(output: string): Array<{ version: string, path?: string }> {
  const entries: Array<{ version: string, path?: string }> = []
  for (const raw of output.split(/\r?\n/)) {
    const match = /-V:(\d+\.\d+)\s*\*?\s*(.+)?$/.exec(raw)
    if (!match)
      continue
    const entry: { version: string, path?: string } = { version: match[1]! }
    const path = match[2]?.trim()
    if (path)
      entry.path = path
    entries.push(entry)
  }
  return entries
}

export interface PythonResolution {
  pythonPath: string
  /** Launcher flags that must travel with every invocation (e.g. `py -3.11`). */
  prefixArgs?: readonly string[]
  version: string
}

async function probePython(
  deps: KokoroInstallDeps,
  tried: string[],
  command: string,
  prefixArgs: readonly string[],
  label: string,
): Promise<PythonResolution | undefined> {
  tried.push(label)
  const probe = await deps.run(command, [...prefixArgs, ...PYTHON_PROBE_ARGS])
  if (probe.code !== 0)
    return undefined
  const version = probe.stdout.trim()
  if (!pythonVersionOk(version))
    return undefined
  return { pythonPath: command, prefixArgs, version }
}

async function resolvePython(deps: KokoroInstallDeps): Promise<PythonResolution> {
  const tried: string[] = []
  if (deps.platform === 'win32') {
    // 1. The py launcher's own inventory first - the case that burned this
    // phase: the DEFAULT python on the machine is 3.14 (out of range), and a
    // supported 3.11 sits right next to it. We must see BOTH and pick 3.11.
    tried.push('py -0p (inventory)')
    const listed = await deps.run('py', ['-0p'])
    if (listed.code === 0) {
      for (const entry of parsePyLauncherInventory(listed.stdout)) {
        // Out-of-range installs (3.14) are skipped before any probe call.
        if (!pythonVersionOk(entry.version))
          continue
        const hit = entry.path
          ? await probePython(deps, tried, entry.path, [], entry.path)
          : await probePython(deps, tried, 'py', [`-${entry.version}`], `py -${entry.version}`)
        if (hit)
          return hit
      }
    }
    // 2. Explicit version flags in descending preference: covers machines
    // where the inventory output could not be parsed but versions exist.
    for (const minor of [13, 12, 11, 10]) {
      const hit = await probePython(deps, tried, 'py', [`-3.${minor}`], `py -3.${minor}`)
      if (hit)
        return hit
    }
    // 3. Generic names: an org installer without the launcher, or a PATH
    // alias pointing at a supported interpreter even when 3.14 is default.
    for (const command of ['python', 'python3']) {
      const hit = await probePython(deps, tried, command, [], command)
      if (hit)
        return hit
    }
  }
  else {
    for (const command of ['python3', 'python']) {
      const hit = await probePython(deps, tried, command, [], command)
      if (hit)
        return hit
    }
  }
  throw new KokoroInstallError(
    'python-probe',
    `No supported Python found (Kokoro needs ${KOKORO_PYTHON_MIN.join('.')}..${KOKORO_PYTHON_MAX.join('.')}). Tried: ${tried.join(', ')}. `
    + 'An out-of-range default (e.g. 3.14) is skipped on purpose, never fails the run: install any supported version side-by-side and re-run.',
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
    const venv = await deps.run(python.pythonPath, [...(python.prefixArgs ?? []), '-m', 'venv', layout.venvDir])
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
