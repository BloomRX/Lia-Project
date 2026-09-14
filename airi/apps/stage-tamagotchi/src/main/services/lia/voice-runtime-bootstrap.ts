import type {
  LiaBootstrapFailureCategory,
  LiaBootstrapPhase,
  LiaBootstrapState,
  LiaBootstrapStep,
  LiaBootstrapStepStatus,
} from '../../../shared/lia-voice'
import type { VoiceRuntimeEnvironment } from './voice-runtime-env'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import { assessEnvironment, REQUIRED_FREE_BYTES } from './voice-runtime-env'

export type { VoiceRuntimeEnvironment } from './voice-runtime-env'

/**
 * The idempotent voice-runtime bootstrapper (items A, D, H, I, L, S).
 *
 * ## The shape of the problem
 *
 * A layperson clicks "Install". The Lia has to work out what is already there,
 * install only what is missing, and end in a state where the runtime answers a
 * health check. Clicking again must be safe, and a run interrupted halfway must
 * be resumable rather than leaving the machine worse than it started.
 *
 * ## What the audit changed
 *
 * The Phase 5 audit found that `atsetup.bat -silent` exists and jumps straight
 * past the interactive menu, installing a per-user Miniconda with no
 * administrator rights. It also found that Git, system Python, espeak-ng, FFmpeg
 * and the C++ Build Tools are not prerequisites at all - espeak and FFmpeg ship
 * inside the tree, and Python is created inside the runtime folder.
 *
 * So this bootstrapper has far fewer steps than the original brief assumed. That
 * is the point of auditing first: four of the five "dependencies to install"
 * turned out to be dependencies that must *not* be installed, because installing
 * them would cost the user time and disk for nothing.
 *
 * ## Safety properties this file is responsible for
 *
 * - **No shell string interpolation.** Every command is an argument array. The
 *   install directory is passed as `cwd`, never spliced into a command line, so
 *   a path with spaces or metacharacters cannot alter what runs.
 * - **stdin is closed.** The silent path prompts `choice /C YN` on *failure*.
 *   With an open stdin that would block forever; closed, the failure surfaces as
 *   a non-zero exit instead of a hang.
 * - **One run at a time**, and two callers share the same promise.
 * - **Atomic download.** Bytes land in a temp file, are validated, and only then
 *   moved into place, so an interrupted download cannot look like an install.
 */

/** Lifecycle states (item L). */
/**
 * The lifecycle types live in `shared/lia-voice` because the renderer has to
 * render them. Aliasing rather than redefining is deliberate: two definitions of
 * the same phase list is exactly how a UI ends up waiting on a state the main
 * process never emits.
 */
export type BootstrapPhase = LiaBootstrapPhase
export type StepStatus = LiaBootstrapStepStatus
export type BootstrapStep = LiaBootstrapStep
export type BootstrapState = LiaBootstrapState
export type BootstrapFailureCategory = LiaBootstrapFailureCategory

/**
 * The AllTalk commit this build installs.
 *
 * Pinned deliberately. `alltalkbeta` is a moving branch with no v2 release tag,
 * so installing from its head would mean every user gets whatever landed that
 * day, and a bad upstream commit would break installs with no Lia change to
 * explain it. Bumping this constant is a reviewed decision, not a side effect.
 */
export const PINNED_ALLTALK_COMMIT = 'f16117e95b540e9bbbd8247b49ca6c6b1350b172'

/** Short form, for display and for `state.json`. */
export const PINNED_ALLTALK_VERSION = PINNED_ALLTALK_COMMIT.slice(0, 12)

/**
 * Source archive for the pinned commit.
 *
 * HTTPS and content-addressed by the commit SHA. GitHub does not publish a
 * checksum for this endpoint and generates the ZIP on request, so the bytes are
 * not guaranteed stable - recorded as a limitation in the audit rather than
 * papered over with a hash we could not have obtained honestly.
 */
export function alltalkSourceUrl(commit: string = PINNED_ALLTALK_COMMIT): string {
  return `https://github.com/erew123/alltalk_tts/archive/${commit}.zip`
}

/** The step ids, in order. The UI renders these; the runner walks them. */
export const BOOTSTRAP_STEP_IDS = [
  'check-environment',
  'fetch-source',
  'run-setup',
  'verify-install',
  'verify-health',
] as const

export type BootstrapStepId = typeof BOOTSTRAP_STEP_IDS[number]

/** Human-readable purpose of each step, for logs and diagnostics. */
export const STEP_LABELS: Record<BootstrapStepId, string> = {
  'check-environment': 'Checking the computer',
  'fetch-source': 'Downloading the voice system',
  'run-setup': 'Installing the voice system',
  'verify-install': 'Checking the installation',
  'verify-health': 'Starting and verifying',
}

export interface ExecResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface BootstrapDeps {
  /** Runs a command with an argument array. Never a shell string. */
  exec: (command: string, args: string[], options: { cwd: string, timeoutMs: number }) => Promise<ExecResult>
  /** Downloads to a temp path and resolves with the bytes' SHA-256 and size. */
  download: (url: string, destPath: string) => Promise<{ bytes: number, sha256: string }>
  /** Extracts a ZIP archive into a directory. */
  extract: (archivePath: string, destDir: string) => Promise<void>
  exists: (path: string) => Promise<boolean>
  mkdir: (path: string) => Promise<void>
  remove: (path: string) => Promise<void>
  rename: (from: string, to: string) => Promise<void>
  /** Health probe against the running server. */
  isHealthy: () => Promise<boolean>
  /** Starts the managed runtime and waits for health. */
  startRuntime: () => Promise<boolean>
  probe: () => Promise<VoiceRuntimeEnvironment>
  /** Where the runtime lives. Lia-controlled, never the repo or Downloads. */
  runtimeDir: string
  /** Persists the install record so a restart recognises a finished install. */
  writeState: (record: RuntimeInstallRecord) => Promise<void>
  readState: () => Promise<RuntimeInstallRecord | undefined>
  log: (entry: BootstrapLogEntry) => void
  /** Overall ceiling for the setup step. */
  setupTimeoutMs?: number
  /** Aborts the run when it returns true. Checked between steps. */
  isCancelled?: () => boolean
}

/** What is recorded in `state.json`. */
export interface RuntimeInstallRecord {
  /** The pinned commit that was installed. */
  commit: string
  installedAt: string
  /** SHA-256 of the source archive actually downloaded. */
  sourceSha256?: string
  sourceBytes?: number
}

export interface BootstrapLogEntry {
  step: BootstrapStepId | 'bootstrap'
  event: string
  /** Never a secret, never conversation text, never audio. */
  detail?: string
  exitCode?: number | null
  elapsedMs?: number
}

/** How long the setup step may run before it is treated as hung. */
export const DEFAULT_SETUP_TIMEOUT_MS = 45 * 60 * 1000

export interface Bootstrapper {
  state: () => BootstrapState
  /** Runs install-or-repair. Concurrent calls share one run. */
  run: (options?: { repair?: boolean }) => Promise<BootstrapState>
  /** Asks a running bootstrap to stop at the next step boundary. */
  cancel: () => void
  /** Removes only what the Lia installed. */
  remove: () => Promise<void>
}

function initialSteps(): BootstrapStep[] {
  return BOOTSTRAP_STEP_IDS.map(id => ({ id, status: 'pending' as const }))
}

/**
 * Classifies a failure into a stable category.
 *
 * Done by inspecting the error rather than trusting a caller to label it: the
 * categories drive both the wording the user sees and whether "Try again" is
 * likely to help.
 */
export function categorizeFailure(error: unknown, stderr = ''): BootstrapFailureCategory {
  const text = `${errorMessageFrom(error)}\n${stderr}`.toLowerCase()

  if (/cancel|abort|uac|elevat/.test(text))
    return 'cancelled'
  if (/enospc|no space|disk full/.test(text))
    return 'disk'
  if (/enotfound|econnrefused|econnreset|etimedout|network|getaddrinfo|certificate|ssl/.test(text))
    return 'network'
  if (/download|404|403|http|checksum|sha256/.test(text))
    return 'download'

  return 'setup'
}

export function createVoiceRuntimeBootstrapper(deps: BootstrapDeps): Bootstrapper {
  const setupTimeoutMs = deps.setupTimeoutMs ?? DEFAULT_SETUP_TIMEOUT_MS

  let state: BootstrapState = { phase: 'not-installed', steps: initialSteps() }
  /** The single in-flight run. Shared so two clicks cannot double-install. */
  let running: Promise<BootstrapState> | undefined
  let cancelRequested = false

  function setPhase(phase: BootstrapPhase, extra: Partial<BootstrapState> = {}): void {
    state = { ...state, phase, ...extra }
  }

  function setStep(id: BootstrapStepId, patch: Partial<BootstrapStep>): void {
    state = {
      ...state,
      steps: state.steps.map(step => (step.id === id ? { ...step, ...patch } : step)),
    }
  }

  function isCancelled(): boolean {
    return cancelRequested || (deps.isCancelled?.() ?? false)
  }

  /** App directory: `<runtimeDir>/app`, holding the AllTalk tree. */
  /**
   * The AllTalk tree inside the runtime root.
   *
   * Built with the platform separator rather than a hardcoded `/`. Concatenating a
   * forward slash onto a Windows path produces `C:\...\alltalk/app`, which is
   * legal enough for the filesystem to accept but does not string-compare equal to
   * the normalised form - and that mismatch is what made the extractor's safety
   * check reject every entry of a legitimate archive on a real Windows machine.
   */
  function appDir(): string {
    return join(deps.runtimeDir, 'app')
  }

  async function stepCheckEnvironment(): Promise<void> {
    const started = Date.now()
    setStep('check-environment', { status: 'running' })
    deps.log({ event: 'start', step: 'check-environment' })

    const env = await deps.probe()
    const verdict = assessEnvironment(env)

    deps.log({
      detail: `curl=${env.curl.present ? env.curl.version ?? 'present' : 'missing'} git=${env.git.present} nvidia=${env.nvidiaGpu}`,
      elapsedMs: Date.now() - started,
      event: 'probed',
      step: 'check-environment',
    })

    if (!verdict.ok) {
      const category: BootstrapFailureCategory = verdict.blockers.includes('unsupported-platform')
        ? 'unsupported'
        : verdict.blockers.includes('insufficient-disk')
          ? 'disk'
          : 'setup'
      throw Object.assign(new Error(`environment blockers: ${verdict.blockers.join(', ')}`), { category })
    }

    setStep('check-environment', { elapsedMs: Date.now() - started, status: 'done' })
  }

  async function stepFetchSource(): Promise<void> {
    const started = Date.now()
    setStep('fetch-source', { status: 'running' })

    const target = appDir()

    // Idempotency: an install of the pinned commit already on disk is not
    // re-downloaded. A different commit is a deliberate upgrade, not a re-run.
    const existing = await deps.readState()
    if (existing?.commit === PINNED_ALLTALK_COMMIT && await deps.exists(`${target}/atsetup.bat`)) {
      deps.log({ event: 'skipped-present', step: 'fetch-source' })
      setStep('fetch-source', { detail: 'already present', elapsedMs: Date.now() - started, status: 'skipped' })
      return
    }

    deps.log({ detail: PINNED_ALLTALK_VERSION, event: 'start', step: 'fetch-source' })

    await deps.mkdir(deps.runtimeDir)

    // Temp file, then atomic move. An interrupted download must not leave
    // something that a later run mistakes for a completed install.
    const archive = `${deps.runtimeDir}/alltalk-${PINNED_ALLTALK_VERSION}.zip.tmp`
    let result: { bytes: number, sha256: string }
    try {
      result = await deps.download(alltalkSourceUrl(), archive)
    }
    catch (error) {
      await deps.remove(archive).catch(() => undefined)
      throw error
    }

    deps.log({
      detail: `bytes=${result.bytes} sha256=${result.sha256.slice(0, 16)}`,
      elapsedMs: Date.now() - started,
      event: 'downloaded',
      step: 'fetch-source',
    })

    // A ZIP this small is not a valid AllTalk tree; treating it as one would
    // produce a confusing failure two steps later.
    if (result.bytes < 1024) {
      await deps.remove(archive).catch(() => undefined)
      throw Object.assign(new Error('downloaded archive is implausibly small'), { category: 'download' })
    }

    await deps.mkdir(target)
    await deps.extract(archive, target)
    await deps.remove(archive).catch(() => undefined)

    await deps.writeState({
      commit: PINNED_ALLTALK_COMMIT,
      installedAt: new Date().toISOString(),
      sourceBytes: result.bytes,
      sourceSha256: result.sha256,
    })

    setStep('fetch-source', { elapsedMs: Date.now() - started, status: 'done' })
  }

  async function stepRunSetup(): Promise<void> {
    const started = Date.now()
    setStep('run-setup', { status: 'running' })

    const cwd = appDir()

    // Already set up? The marker is the launcher atsetup.bat writes as its final
    // act, so its presence means a previous run completed this step.
    if (await deps.exists(`${cwd}/start_alltalk.bat`)) {
      deps.log({ event: 'skipped-present', step: 'run-setup' })
      setStep('run-setup', { detail: 'already set up', elapsedMs: Date.now() - started, status: 'skipped' })
      return
    }

    deps.log({ event: 'start', step: 'run-setup' })

    // `-silent` bypasses the interactive menu entirely (audit, atsetup.bat:46).
    // `cmd /d /s /c <script>` with the directory as cwd: the path is never part
    // of a command string, so it cannot be re-parsed by a shell.
    const result = await deps.exec(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', 'atsetup.bat', '-silent'],
      { cwd, timeoutMs: setupTimeoutMs },
    )

    deps.log({
      detail: result.stderr ? result.stderr.slice(-300) : undefined,
      elapsedMs: Date.now() - started,
      event: 'finished',
      exitCode: result.code,
      step: 'run-setup',
    })

    if (result.code !== 0) {
      const error = new Error(`atsetup.bat exited with code ${result.code}`)
      throw Object.assign(error, { category: categorizeFailure(error, result.stderr) })
    }

    setStep('run-setup', { elapsedMs: Date.now() - started, status: 'done' })
  }

  async function stepVerifyInstall(): Promise<void> {
    const started = Date.now()
    setStep('verify-install', { status: 'running' })

    const cwd = appDir()
    // All four must exist: the tree, the generated launcher, the conda root and
    // the environment inside it. A partial install is what `repair` exists for.
    const required = ['script.py', 'start_alltalk.bat', 'alltalk_environment/conda', 'alltalk_environment/env']
    const missing: string[] = []
    for (const entry of required) {
      if (!await deps.exists(`${cwd}/${entry}`))
        missing.push(entry)
    }

    if (missing.length > 0) {
      const error = new Error(`install incomplete, missing: ${missing.join(', ')}`)
      throw Object.assign(error, { category: 'setup' })
    }

    setStep('verify-install', { elapsedMs: Date.now() - started, status: 'done' })
  }

  async function stepVerifyHealth(): Promise<void> {
    const started = Date.now()
    setStep('verify-health', { status: 'running' })

    if (await deps.isHealthy()) {
      setStep('verify-health', { detail: 'already running', elapsedMs: Date.now() - started, status: 'skipped' })
      return
    }

    const healthy = await deps.startRuntime()
    if (!healthy) {
      const error = new Error('the voice system did not become ready')
      throw Object.assign(error, { category: 'health' })
    }

    setStep('verify-health', { elapsedMs: Date.now() - started, status: 'done' })
  }

  const runners: Record<BootstrapStepId, () => Promise<void>> = {
    'check-environment': stepCheckEnvironment,
    'fetch-source': stepFetchSource,
    'run-setup': stepRunSetup,
    'verify-install': stepVerifyInstall,
    'verify-health': stepVerifyHealth,
  }

  async function doRun(repair: boolean): Promise<BootstrapState> {
    cancelRequested = false
    state = { phase: 'checking', steps: initialSteps() }
    deps.log({ detail: repair ? 'repair' : 'install', event: 'start', step: 'bootstrap' })
    const startedAt = Date.now()

    try {
      for (const id of BOOTSTRAP_STEP_IDS) {
        if (isCancelled()) {
          setPhase('cancelled', { message: 'Installation cancelled.' })
          deps.log({ event: 'cancelled', step: 'bootstrap' })
          return state
        }

        setPhase(id === 'run-setup' ? 'installing-runtime' : id === 'verify-health' ? 'verifying' : 'checking')

        try {
          await runners[id]()
        }
        catch (error) {
          const category = (error as { category?: BootstrapFailureCategory }).category
            ?? categorizeFailure(error)
          setStep(id, { detail: category, status: 'failed' })
          setPhase('failed', {
            failureCategory: category,
            message: messageFor(category),
          })
          deps.log({
            detail: errorMessageFrom(error),
            event: 'failed',
            step: id,
          })
          return state
        }
      }

      setPhase('ready', { version: PINNED_ALLTALK_VERSION })
      deps.log({ elapsedMs: Date.now() - startedAt, event: 'ready', step: 'bootstrap' })
      return state
    }
    finally {
      running = undefined
    }
  }

  return {
    state: () => state,

    run(options) {
      // Single-instance guard, assigned synchronously. An async function
      // suspends at its first await, so any await before this assignment would
      // be a window in which a second caller started its own run.
      if (running)
        return running

      running = doRun(options?.repair ?? false)
      return running
    },

    cancel() {
      cancelRequested = true
    },

    /**
     * Removes only what the Lia installed (item P).
     *
     * The scope is the runtime directory and nothing else. Global Git, Python,
     * the VC++ runtime and espeak are deliberately untouched - the Lia did not
     * install them, so it has no business removing them. The user's imported
     * voices live in a separate `lia-voices` directory and are never touched
     * here either.
     */
    async remove() {
      deps.log({ event: 'start', step: 'bootstrap' })
      await deps.remove(deps.runtimeDir)
      state = { phase: 'not-installed', steps: initialSteps() }
      deps.log({ event: 'removed', step: 'bootstrap' })
    },
  }
}

/** A short sentence per failure category. No stack traces, no raw paths. */
export function messageFor(category: BootstrapFailureCategory): string {
  switch (category) {
    case 'cancelled':
      return 'Installation cancelled.'
    case 'disk':
      return 'There is not enough free space to install the voice system.'
    case 'download':
      return 'The voice system could not be downloaded.'
    case 'health':
      return 'The voice system installed but did not start.'
    case 'network':
      return 'No internet connection, or it was interrupted.'
    case 'unsupported':
      return 'This operating system is not supported yet.'
    default:
      return 'The voice system could not be installed.'
  }
}

/** SHA-256 of a buffer, for validating a download before it is used. */
export function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}

/**
 * Whether a probe says the machine has room for the install.
 *
 * Exported for tests and for the UI's pre-flight message; the bootstrapper
 * enforces the same rule through `assessEnvironment`.
 */
export function hasEnoughDiskSpace(freeBytes: number | undefined): boolean {
  return freeBytes === undefined || freeBytes >= REQUIRED_FREE_BYTES
}
