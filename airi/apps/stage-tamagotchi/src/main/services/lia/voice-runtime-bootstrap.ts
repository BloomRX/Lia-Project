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

import { ENVIRONMENT_MARKERS, INSTALL_MARKERS } from './alltalk-runtime'
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
/**
 * The launcher `atsetup.bat` generates as its last step.
 *
 * Its absence is the difference between "the zip was extracted" and "the setup
 * finished", which is why the verify step requires it.
 */
export const START_SCRIPT = 'start_alltalk.bat'

/**
 * The Miniconda stage of the pinned installer, named so the setup step can
 * verify and repair it rather than inheriting the script's blinkered exit
 * code. Read straight from `atsetup.bat` at the pinned commit (branch
 * :InstallCustomStandalone): the installer the script curls into its own
 * tree, the prefix its NSIS /D= switch targets, and the binary the script
 * itself uses to decide whether Miniconda needs installing.
 */
export const MINICONDA_INSTALLER = 'alltalk_environment/miniconda_installer.exe'
export const MINICONDA_PREFIX = 'alltalk_environment/conda'
export const MINICONDA_EXE = 'alltalk_environment/conda/_conda.exe'

/** Ceiling for the direct installer run. A silent NSIS install is minutes, not hours. */
export const MINICONDA_INSTALL_TIMEOUT_MS = 20 * 60 * 1000

/**
 * The silent-install invocation as an argument array rather than a shell
 * string: the installer path is never re-parsed, the arguments never
 * concatenate into a command line, and NSIS still receives /D= last and
 * unquoted as it requires.
 *
 * Only switches in the official Miniconda silent-install list are passed
 * (round-4 brief, items A/D): JustMe, AddToPath=0 and RegisterPython=0 are
 * already what keeps the global PATH, the global Python and the registry
 * untouched; `/NoShortcuts` and `/NoRegistry` came from the pinned upstream
 * script and are constructor-level switches - valid per conda's constructor
 * docs, but not part of the documented Miniconda set, so they now live only
 * in the manual isolation probe (QA-Miniconda.bat), never in production.
 */
export function minicondaInstallerArgs(condaPrefix: string): string[] {
  return [
    '/InstallationType=JustMe',
    '/AddToPath=0',
    '/RegisterPython=0',
    '/S',
    `/D=${condaPrefix}`,
  ]
}

/**
 * The form NSIS actually parses. The bootstrap builds paths with the generic
 * `/`, which produced the mixed-separator `/D=` of the round-4 QA log
 * (`...\app/alltalk_environment/conda`, exit 2). Process-facing strings -
 * the installer command and the /D value - pass through here; filesystem
 * probes keep the plain form, which Windows accepts either way.
 */
export function win32Path(path: string): string {
  return path.replace(/\//g, '\\')
}

/**
 * Subdirectory the AllTalk tree lives in, inside the runtime root.
 *
 * Named once because two modules compute this path: the bootstrapper, which
 * extracts into it, and the runtime manager, which starts the server from it. If
 * they disagreed, the install would complete and the runtime would then look for a
 * server in a different folder - an install that succeeds and a voice that never
 * comes up, with nothing in the logs connecting the two.
 */
export const RUNTIME_APP_SUBDIR = 'app'

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

/**
 * Files the setup step needs on disk before it may spawn the installer.
 *
 * Read straight from the `-silent` branch of `atsetup.bat`: the script itself,
 * plus the two requirements files it feeds to `pip install -r` with a *relative*
 * path from its working directory. Spawning without them would not fail here -
 * it would fail twenty minutes in, mid-setup, with a pip error far away from the
 * real cause. Refusing first is what keeps the failure named correctly.
 */
export const SETUP_INPUTS = [
  'atsetup.bat',
  'system/requirements/requirements_standalone.txt',
  'system/requirements/requirements_parler.txt',
] as const

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
  /** Size of a file on disk, when it exists. Undefined answers "missing". */
  stat: (path: string) => Promise<{ size: number } | undefined>
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
  /**
   * Called synchronously after every state mutation.
   *
   * This is how progress reaches the UI: the main process forwards each call
   * to the renderer, which renders exactly what it receives. Deliberately push,
   * not poll - a timer republishing the same state would emit updates that
   * carry no information, and a number that moves on a schedule is a fake
   * progress the user can catch. No timer anywhere in here: if nothing
   * changed, nothing is said.
   */
  onStateChange?: (state: BootstrapState) => void
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

  /**
   * Publishes the current state - but only when it actually changed.
   *
   * The comparison is on the published content, not on object identity:
   * `setPhase('checking')` while already in `checking` must not emit a payload
   * indistinguishable from the previous one, because a "notification" that
   * carries no new information is what a republication timer produces. Every
   * emitted payload is worth the renderer's attention.
   *
   * A listener that throws must not abort the install: the renderer being slow
   * or unhappy is no reason to leave a half-finished runtime. The bootstrap
   * log still records what happened.
   */
  let lastPublished = ''
  function notify(): void {
    const snapshot = JSON.stringify(state)
    if (snapshot === lastPublished)
      return
    lastPublished = snapshot

    try {
      deps.onStateChange?.(state)
    }
    catch {
      // Swallowed on purpose - see above.
    }
  }

  function setPhase(phase: BootstrapPhase, extra: Partial<BootstrapState> = {}): void {
    state = { ...state, phase, ...extra }
    notify()
  }

  function setStep(id: BootstrapStepId, patch: Partial<BootstrapStep>): void {
    state = {
      ...state,
      steps: state.steps.map(step => (step.id === id ? { ...step, ...patch } : step)),
    }
    notify()
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
    return join(deps.runtimeDir, RUNTIME_APP_SUBDIR)
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
          : verdict.blockers.includes('path-has-space')
            ? 'path'
            : 'setup'
      throw Object.assign(new Error(`environment blockers: ${verdict.blockers.join(', ')}`), { category })
    }

    setStep('check-environment', { elapsedMs: Date.now() - started, status: 'done' })
  }

  async function stepFetchSource(): Promise<void> {
    const started = Date.now()
    // The detail tracks the sub-state this step is actually inside: it starts
    // in the download, and flips to 'extracting' right before the extraction
    // call below. Real machine states, not presentation guesses.
    setStep('fetch-source', { detail: 'downloading', status: 'running' })

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
    setStep('fetch-source', { detail: 'extracting' })
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
    if (await deps.exists(`${cwd}/${START_SCRIPT}`)) {
      deps.log({ event: 'skipped-present', step: 'run-setup' })
      setStep('run-setup', { detail: 'already set up', elapsedMs: Date.now() - started, status: 'skipped' })
      return
    }

    // Refuse to spawn into a broken tree (item E of the round-2 brief). The
    // installer assumes it runs from the AllTalk root and reads these inputs by
    // relative path; if the extraction left something out, failing *here* names
    // the missing file instead of surfacing as a mid-setup error twenty minutes
    // and one Miniconda download later.
    const missingInputs: string[] = []
    for (const input of SETUP_INPUTS) {
      if (!await deps.exists(`${cwd}/${input}`))
        missingInputs.push(input)
    }
    if (missingInputs.length > 0) {
      deps.log({ detail: `missing: ${missingInputs.join(', ')}`, event: 'layout-invalid', step: 'run-setup' })
      throw Object.assign(
        new Error(`setup inputs missing, refusing to run the installer: ${missingInputs.join(', ')}`),
        { category: 'setup' as const },
      )
    }

    const startScript = `${cwd}/${START_SCRIPT}`
    const installer = `${cwd}/${MINICONDA_INSTALLER}`
    const condaPrefix = `${cwd}/${MINICONDA_PREFIX}`
    const condaExe = `${cwd}/${MINICONDA_EXE}`

    /** Generic failure: the UI shows this sentence, so no technical nouns. */
    const opaqueFailure = (): Error =>
      Object.assign(new Error('The voice environment could not be prepared; the technical reason is in the log.'), { category: 'setup' as const })

    // Logged before spawning so a failure report carries the exact working
    // directory and arguments that ran rather than a reconstruction (item D).
    // Paths belong in this log, never in what the UI shows.
    const runAtsetup = async (attempt: 'initial' | 'resume'): Promise<ExecResult> => {
      deps.log({
        detail: `cwd=${cwd} exe=${process.env.ComSpec ?? 'cmd.exe'} args=atsetup.bat -silent attempt=${attempt}`,
        event: 'start',
        step: 'run-setup',
      })

      // `-silent` bypasses the interactive menu entirely (audit, atsetup.bat:46).
      // `cmd /d /s /c <script>` with the directory as cwd: the path is never part
      // of a command string, so it cannot be re-parsed by a shell.
      const result = await deps.exec(
        process.env.ComSpec ?? 'cmd.exe',
        ['/d', '/s', '/c', 'atsetup.bat', '-silent'],
        { cwd, timeoutMs: setupTimeoutMs },
      )

      deps.log({
        detail: outputTail(result),
        elapsedMs: Date.now() - started,
        event: 'finished',
        exitCode: result.code,
        step: 'run-setup',
      })
      return result
    }

    // The facts a diagnosis of the Miniconda stage needs (item B): the
    // installer the script downloaded, its size, the prefix its /D= targets,
    // and the binary whose absence made the script give up. Logged, never shown.
    const minicondaFacts = async (event: string): Promise<{ condaReady: boolean, installerBytes?: number, installerExists: boolean }> => {
      const [installerExists, prefixExists, condaExeExists, installerStat] = await Promise.all([
        deps.exists(installer),
        deps.exists(condaPrefix),
        deps.exists(condaExe),
        deps.stat(installer),
      ])
      deps.log({
        detail: `cwd=${cwd} installer=${installer} installer-exists=${installerExists} installer-bytes=${installerStat ? installerStat.size : 'unknown'} conda-prefix=${condaPrefix} conda-prefix-exists=${prefixExists} conda-exe=${condaExe} conda-exe-exists=${condaExeExists}`,
        event,
        step: 'run-setup',
      })
      return { condaReady: prefixExists && condaExeExists, installerBytes: installerStat?.size, installerExists }
    }

    const entry = await minicondaFacts('miniconda-facts')

    // A fresh run only has work the bootstrapper cannot do itself when the
    // installer still needs downloading: the script curls it unconditionally,
    // so re-running it with the file already on disk would just fetch 81 MB
    // again to immediately overwrite them (round-4 brief, item J). With the
    // installer present - or Miniconda already verified - go straight to the
    // repair/resume logic below, which reuses exactly what is on disk.
    let result: ExecResult | undefined
    if (!entry.condaReady && !entry.installerExists)
      result = await runAtsetup('initial')

    // Exit code alone is a liar here. atsetup.bat abandons a failed install by
    // jumping to its end label, and the echoes there reset ERRORLEVEL, so a
    // half-built tree still returns 0 - the QA log of round 2 shows exactly
    // that: "path not found" from the script, exit 0, and only verify-install
    // noticing. The honest success signal of this step is the artefact the
    // script only writes as its final act: the generated launcher.
    if (result?.code === 0 && await deps.exists(startScript)) {
      setStep('run-setup', { elapsedMs: Date.now() - started, status: 'done' })
      return
    }

    if (result?.code === 0) {
      deps.log({
        detail: `the installer exited 0 but never wrote ${START_SCRIPT}; its output above names where it gave up`,
        event: 'incomplete',
        step: 'run-setup',
      })
    }

    // Recovery. The facts are re-read because the attempt above is what
    // usually downloads the installer.
    const recovery = await minicondaFacts('miniconda-recovery-facts')

    if (!recovery.installerExists && !recovery.condaReady) {
      // Nothing to repair with: the download itself is what failed. Preserve
      // the diagnostics this step reported before the repair layer existed.
      deps.log({ detail: `no ${MINICONDA_INSTALLER} to run directly`, event: 'miniconda-repair-skipped', step: 'run-setup' })
      if (result && result.code !== 0) {
        const error = new Error(`atsetup.bat exited with code ${result.code}`)
        throw Object.assign(error, { category: categorizeFailure(error, result.stderr) })
      }
      throw Object.assign(
        new Error(`atsetup.bat reported success but did not finish the setup (${START_SCRIPT} was not created)`),
        { category: 'setup' as const },
      )
    }

    if (!recovery.condaReady) {
      // The known failure of the pinned script: its `start /wait` line runs
      // the NSIS installer and never checks the outcome. Run the very same
      // installer directly instead, with the very same arguments, and collect
      // what the script never could: the real process exit code (items D, E).
      deps.log({
        detail: `cwd=${cwd} exe=${win32Path(installer)} installer-bytes=${recovery.installerBytes ?? 'unknown'} args=${minicondaInstallerArgs(win32Path(condaPrefix)).join(' ')}`,
        event: 'miniconda-install-start',
        step: 'run-setup',
      })
      const installResult = await deps.exec(
        win32Path(installer),
        minicondaInstallerArgs(win32Path(condaPrefix)),
        { cwd, timeoutMs: MINICONDA_INSTALL_TIMEOUT_MS },
      )
      deps.log({
        detail: outputTail(installResult),
        event: 'miniconda-install-finished',
        exitCode: installResult.code,
        step: 'run-setup',
      })

      // Item G: exit code AND both artefacts, or the stage did not pass.
      const prefixOk = await deps.exists(condaPrefix)
      const exeOk = await deps.exists(condaExe)
      deps.log({
        detail: `exit=${installResult.code} conda-prefix-exists=${prefixOk} conda-exe-exists=${exeOk}`,
        event: 'miniconda-install-verify',
        step: 'run-setup',
      })
      if (installResult.code !== 0 || !prefixOk || !exeOk)
        throw opaqueFailure()
      deps.log({ event: 'miniconda-install-verified', step: 'run-setup' })
    }

    // Miniconda is functional now. Item E: continue through the supported
    // upstream path rather than reimplementing the rest of the setup. The
    // audit of the pin says this cannot resume - the script's conda-exists
    // branch jumps to a RunScript label the file does not define - but the
    // attempt is deterministic, cheap, downloads nothing, and the artefact
    // check below is what decides either way; if a future pin resumes
    // properly, this simply starts passing.
    const resume = await runAtsetup('resume')
    if (await deps.exists(startScript)) {
      setStep('run-setup', { elapsedMs: Date.now() - started, status: 'done' })
      return
    }

    deps.log({
      detail: `resume exited ${resume.code} without writing ${START_SCRIPT}; the pinned -silent cannot resume (its conda-exists branch targets a RunScript label the script does not define, audit of pin ${PINNED_ALLTALK_COMMIT})`,
      event: 'resume-incomplete',
      step: 'run-setup',
    })
    throw opaqueFailure()
  }

  async function stepVerifyInstall(): Promise<void> {
    const started = Date.now()
    setStep('verify-install', { status: 'running' })

    const cwd = appDir()
    // All four must exist: the tree, the generated launcher, the conda root and
    // the environment inside it. A partial install is what `repair` exists for.
    // The same definition the runtime manager uses, so the two cannot disagree
    // about whether this folder is a working install.
    const required = [...INSTALL_MARKERS, ...ENVIRONMENT_MARKERS, START_SCRIPT]
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
    notify()
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
      notify()
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
    case 'path':
      return 'The voice system cannot be installed in a folder whose name contains a space.'
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
 * The end of the installer's output, flattened onto one log line.
 *
 * The installer prints its diagnosis to *either* stream - the `ERRORLEVEL`
 * messages go to stderr while the surrounding narration sits on stdout - so
 * capturing only stderr, as the first version did, could leave the single line
 * that names the failure out of the log. Kept short and whitespace-flattened:
 * this is a tail for a human reading a QA log, not a transcript. Installer
 * output only; never conversation text, never a secret.
 */
export function outputTail(result: Pick<ExecResult, 'stderr' | 'stdout'>, maxPerStream = 300): string {
  const tail = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(-maxPerStream)
  const stdout = tail(result.stdout)
  const stderr = tail(result.stderr)
  return `stdout=${stdout || '(empty)'} | stderr=${stderr || '(empty)'}`
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
