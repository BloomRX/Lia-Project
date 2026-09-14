import type {
  LiaBootstrapFailureCategory,
  LiaBootstrapPhase,
  LiaBootstrapState,
  LiaBootstrapStep,
  LiaBootstrapStepStatus,
} from '../../../shared/lia-voice'
import type { VoiceRuntimeEnvironment } from './voice-runtime-env'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import { markAlltalkFirstRunDone } from './alltalk-engine-config'
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
 * The environment the pinned `atsetup.bat` builds inside the runtime tree, and
 * the binaries the continuation drives directly instead of scripting a cmd
 * activation: the env itself, the python.exe the pin uses as its "env created"
 * check, and the env's own pip (what a bare `pip` call resolves to under the
 * activated env).
 */
export const MINICONDA_ENV = 'alltalk_environment/env'
export const MINICONDA_ENV_PYTHON = 'alltalk_environment/env/python.exe'
export const MINICONDA_ENV_PIP = 'alltalk_environment/env/Scripts/pip.exe'
export const MINICONDA_CONDA_EXE = 'alltalk_environment/conda/Scripts/conda.exe'

/**
 * The exact Miniconda build the pinned `atsetup.bat`
 * (`MINICONDA_DOWNLOAD_URL` at f16117e9) downloads, with its official record
 * from the repo.anaconda.com index: 85,690,400 bytes and this SHA-256, which
 * the round-5 probe verified byte-for-byte on the real QA machine. Downloads
 * from anywhere else, or bytes that differ in either number, are deleted
 * rather than executed.
 */
export const MINICONDA_INSTALLER_URL = 'https://repo.anaconda.com/miniconda/Miniconda3-py311_24.4.0-0-Windows-x86_64.exe'
export const MINICONDA_INSTALLER_BYTES = 85_690_400
export const MINICONDA_INSTALLER_SHA256 = 'fb6aaeaf92907b8e7598aac0f7b29793a00b27641dc074a961eeb86ff86d0268'

/** `_conda.exe --version`, the pin's own "conda exists and works" check. */
export const CONDA_VERSION_CHECK_TIMEOUT_MS = 2 * 60 * 1000

/** `conda create` of a fresh python=3.11.9 env: minutes on a slow link. */
export const CONDA_ENV_CREATE_TIMEOUT_MS = 30 * 60 * 1000

/** The python version the pin creates its env with (`python=3.11.9`). */
export const ALLTALK_ENV_PYTHON_VERSION = '3.11.9'

/** The DeepSpeed wheel of the pin's `install_deepspeed` step (GitHub release). */
export const DEEPSPEED_WHEEL = 'deepspeed-0.14.0+ce78a63-cp311-cp311-win_amd64.whl'
export const DEEPSPEED_WHEEL_URL = `https://github.com/erew123/alltalk_tts/releases/download/DeepSpeed-14.0/${DEEPSPEED_WHEEL}`

/** One command of the idempotent round-7 continuation. */
export interface AlltalkSetupCommand {
  /** The atsetup.bat label or step the command is lifted from (pin f16117e9). */
  id: string
  command: string
  args: string[]
  timeoutMs: number
  /** Downloaded right before this step when missing; kept on failure for retry. */
  downloadUrl?: string
  /** Deleted by us only after this step succeeds, exactly like the pin's `del`. */
  cleanupPath?: string
  /** False only for steps the pin runs without an errorlevel guard. */
  fatal: boolean
}

/**
 * The round-7 continuation as data: the exact commands the pinned
 * `atsetup.bat` runs after Miniconda works, in the pin's order, with only the
 * targeting mechanism changed - an explicit `--prefix <env>`/the env's own
 * pip.exe instead of an interactive `conda activate` (item 6: the official
 * commands, reused; no menu automation, no reimplementation of the install
 * logic itself). Reading order matches :install_pytorch through the conda
 * clean in :InstallCustomStandalone.
 *
 * Idempotent by the package managers' own nature: satisfied specs do not
 * re-download, so a retry after a mid-sequence failure re-enters cheaply.
 */
export function alltalkSetupCommands(input: {
  condaExe: string
  envDir: string
  envPip: string
  wheelPath: string
}): AlltalkSetupCommand[] {
  const { condaExe, envDir, envPip, wheelPath } = input
  const requirementsStandalone = win32Path('system/requirements/requirements_standalone.txt')
  const requirementsParler = win32Path('system/requirements/requirements_parler.txt')
  return [
    {
      args: ['install', '-y', '--prefix', envDir, 'pytorch==2.2.1', 'torchvision==0.17.1', 'torchaudio==2.2.1', 'pytorch-cuda=12.1', '-c', 'pytorch', '-c', 'nvidia'],
      command: condaExe,
      fatal: true,
      id: 'install_pytorch',
      timeoutMs: 60 * 60 * 1000,
    },
    {
      args: ['install', '-y', '--prefix', envDir, 'pytorch::faiss-cpu'],
      command: condaExe,
      fatal: true,
      id: 'install_faiss',
      timeoutMs: 20 * 60 * 1000,
    },
    {
      args: ['install', '-y', '--prefix', envDir, '-c', 'conda-forge', 'ffmpeg=*=*gpl*'],
      command: condaExe,
      fatal: true,
      id: 'install_ffmpeg-gpl',
      timeoutMs: 20 * 60 * 1000,
    },
    {
      args: ['install', '-y', '--prefix', envDir, '-c', 'conda-forge', 'ffmpeg=*=h*_*', '--no-deps'],
      command: condaExe,
      fatal: true,
      id: 'install_ffmpeg-h',
      timeoutMs: 20 * 60 * 1000,
    },
    {
      args: ['install', '-r', requirementsStandalone],
      command: envPip,
      fatal: true,
      id: 'install_requirements',
      timeoutMs: 45 * 60 * 1000,
    },
    {
      args: ['install', '--upgrade', 'gradio==4.44.1'],
      command: envPip,
      fatal: true,
      id: 'update_gradio',
      timeoutMs: 20 * 60 * 1000,
    },
    {
      args: ['install', DEEPSPEED_WHEEL],
      cleanupPath: wheelPath,
      command: envPip,
      downloadUrl: DEEPSPEED_WHEEL_URL,
      fatal: true,
      id: 'install_deepspeed',
      timeoutMs: 30 * 60 * 1000,
    },
    {
      args: ['install', '-r', requirementsParler],
      command: envPip,
      fatal: true,
      id: 'install_parler',
      timeoutMs: 20 * 60 * 1000,
    },
    {
      args: ['clean', '--all', '--force-pkgs-dirs', '-y'],
      command: condaExe,
      fatal: false,
      id: 'clean_environment',
      timeoutMs: 15 * 60 * 1000,
    },
  ]
}

/** One launcher file the pin echoes into the tree as its final act. */
export interface AlltalkStartScript {
  content: string
  file: string
}

/**
 * The four launchers, byte-for-byte what the pin's echo lines produce: same
 * five-line prolog with the absolute `alltalk_environment` paths of THIS tree
 * (`%cd%` at generation time in the script, `appDir` for us), then each
 * file's own last line. The byte identity is the verification: a kept file is
 * one that already matches; anything else is rewritten (stale absolute paths
 * are the exact remnant a runtime move leaves behind).
 */
export function alltalkStartScripts(appDir: string): AlltalkStartScript[] {
  const app = win32Path(appDir)
  const condaRoot = `${app}\\alltalk_environment\\conda`
  const envDir = `${app}\\alltalk_environment\\env`
  const prolog = [
    '@echo off',
    `cd /D "${app}\\"`,
    `set CONDA_ROOT_PREFIX=${condaRoot}`,
    `set INSTALL_ENV_DIR=${envDir}`,
    `call "${condaRoot}\\condabin\\conda.bat" activate "${envDir}"`,
  ]
  const script = (entry: string[]): string => `${[...prolog, ...entry].join('\r\n')}\r\n`
  return [
    { content: script([]), file: 'start_environment.bat' },
    { content: script(['call python script.py']), file: 'start_alltalk.bat' },
    { content: script(['call python finetune.py']), file: 'start_finetune.bat' },
    { content: script(['call python diagnostics.py']), file: 'start_diagnostics.bat' },
  ]
}

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
 * Files the setup step needs on disk before it may run the continuation.
 *
 * The two requirements files the pinned `atsetup.bat` feeds to `pip install -r`
 * with a *relative* path from its working directory - the exact same files the
 * round-7 continuation installs from. Spawning without them would not fail
 * here - it would fail twenty minutes in, mid-setup, with a pip error far away
 * from the real cause. Refusing first is what keeps the failure named
 * correctly. The pin's script itself stays in the tree but is never executed
 * again (its conda-exists branch targets a RunScript label the file does not
 * define - the upstream bug the round-7 brief item 2 points at).
 */
export const SETUP_INPUTS = [
  'system/requirements/requirements_standalone.txt',
  'system/requirements/requirements_parler.txt',
] as const

/** The step ids, in order. The UI renders these; the runner walks them. */
export const BOOTSTRAP_STEP_IDS = [
  'check-environment',
  'fetch-source',
  'run-setup',
  'configure-engine',
  'verify-install',
  'verify-health',
] as const

export type BootstrapStepId = typeof BOOTSTRAP_STEP_IDS[number]

/** Human-readable purpose of each step, for logs and diagnostics. */
export const STEP_LABELS: Record<BootstrapStepId, string> = {
  'check-environment': 'Checking the computer',
  'fetch-source': 'Downloading the voice system',
  'run-setup': 'Installing the voice system',
  'configure-engine': 'Preparing the voice settings',
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
  /** Reads a text file; undefined answers "missing", like stat does. */
  readFile: (path: string) => Promise<string | undefined>
  writeFile: (path: string, content: string) => Promise<void>
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
  // 'runtime-root' carries the root-resolution/migration lifecycle events,
  // which happen before any bootstrap step exists.
  step: BootstrapStepId | 'bootstrap' | 'runtime-root'
  event: string
  /** Never a secret, never conversation text, never audio. */
  detail?: string
  exitCode?: number | null
  elapsedMs?: number
}

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

    // Already set up? The marker is the launcher the continuation writes as
    // its final act, so its presence means a previous run completed this step.
    if (await deps.exists(`${cwd}/${START_SCRIPT}`)) {
      deps.log({ event: 'skipped-present', step: 'run-setup' })
      setStep('run-setup', { detail: 'already set up', elapsedMs: Date.now() - started, status: 'skipped' })
      return
    }

    // Refuse to spawn into a broken tree (item E of the round-2 brief). The
    // continuation reads these inputs by relative path from its cwd; if the
    // extraction left something out, failing *here* names the missing file
    // instead of surfacing as a pip error twenty minutes in.
    const missingInputs: string[] = []
    for (const input of SETUP_INPUTS) {
      if (!await deps.exists(`${cwd}/${input}`))
        missingInputs.push(input)
    }
    if (missingInputs.length > 0) {
      deps.log({ detail: `missing: ${missingInputs.join(', ')}`, event: 'layout-invalid', step: 'run-setup' })
      throw Object.assign(
        new Error(`setup inputs missing, refusing to run the continuation: ${missingInputs.join(', ')}`),
        { category: 'setup' as const },
      )
    }

    const installer = `${cwd}/${MINICONDA_INSTALLER}`
    const installerDir = `${cwd}/alltalk_environment`
    const condaPrefix = `${cwd}/${MINICONDA_PREFIX}`
    const condaExe = `${cwd}/${MINICONDA_EXE}`
    const envDir = `${cwd}/${MINICONDA_ENV}`
    const envPython = `${cwd}/${MINICONDA_ENV_PYTHON}`

    /** Generic failure: the UI shows this sentence, so no technical nouns. */
    const opaqueFailure = (): Error =>
      Object.assign(new Error('The voice environment could not be prepared; the technical reason is in the log.'), { category: 'setup' as const })

    // 1. The Miniconda installer itself. The pinned atsetup.bat curls it
    // unconditionally (round-3 audit), so an absent file means this machine
    // never got one - fetch it once, from the exact pinned URL, and prove the
    // bytes against the official record before anything executes them.
    if (!await deps.exists(installer)) {
      deps.log({ detail: `url=${MINICONDA_INSTALLER_URL} dest=${installer}`, event: 'miniconda-installer-download-start', step: 'run-setup' })
      await deps.mkdir(installerDir)
      let fetched: { bytes: number, sha256: string }
      try {
        fetched = await deps.download(MINICONDA_INSTALLER_URL, installer)
      }
      catch (error) {
        // A stalled/aborted transfer leaves a partial file; without removal the
        // next attempt would find it "present" and run a corrupted installer.
        await deps.remove(installer).catch(() => undefined)
        throw error
      }
      const integrityOk = fetched.bytes === MINICONDA_INSTALLER_BYTES && fetched.sha256 === MINICONDA_INSTALLER_SHA256
      deps.log({
        detail: `bytes=${fetched.bytes} sha256=${fetched.sha256} expected-bytes=${MINICONDA_INSTALLER_BYTES} expected-sha256=${MINICONDA_INSTALLER_SHA256} integrity=${integrityOk}`,
        event: 'miniconda-installer-download-finished',
        step: 'run-setup',
      })
      if (!integrityOk) {
        await deps.remove(installer).catch(() => undefined)
        throw Object.assign(
          new Error('the voice installer download failed its integrity check'),
          { category: 'download' as const },
        )
      }
    }
    else {
      const presentStat = await deps.stat(installer)
      deps.log({ detail: `installer=${installer} installer-bytes=${presentStat ? presentStat.size : 'unknown'}`, event: 'miniconda-installer-present', step: 'run-setup' })
    }

    // 2. A working Miniconda. Installed by us directly since round 4 (the
    // upstream script runs the same installer through `start /wait` and never
    // checks its outcome), then validated the way the pin itself decides
    // "conda exists": an actual `_conda.exe --version`, so a half-deleted or
    // AV-mangled install is caught here rather than twenty commands later.
    const [prefixExists, condaExeExists] = await Promise.all([deps.exists(condaPrefix), deps.exists(condaExe)])
    deps.log({
      detail: `cwd=${cwd} conda-prefix=${condaPrefix} conda-prefix-exists=${prefixExists} conda-exe=${condaExe} conda-exe-exists=${condaExeExists}`,
      event: 'miniconda-facts',
      step: 'run-setup',
    })

    if (!prefixExists || !condaExeExists) {
      const installerStat = await deps.stat(installer)
      deps.log({
        detail: `cwd=${cwd} exe=${win32Path(installer)} installer-bytes=${installerStat ? installerStat.size : 'unknown'} args=${minicondaInstallerArgs(win32Path(condaPrefix)).join(' ')}`,
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

      // Exit code AND both artefacts, or the stage did not pass (item G).
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

    const versionCheck = await deps.exec(win32Path(condaExe), ['--version'], { cwd, timeoutMs: CONDA_VERSION_CHECK_TIMEOUT_MS })
    deps.log({ detail: outputTail(versionCheck), event: 'miniconda-version-check', exitCode: versionCheck.code, step: 'run-setup' })
    if (versionCheck.code !== 0) {
      deps.log({ detail: 'conda present but does not answer --version; refusing to build on a broken base', event: 'miniconda-broken', step: 'run-setup' })
      throw opaqueFailure()
    }

    // 3. The idempotent continuation (round-7 brief, items 2/5/7): the exact
    // commands the pinned atsetup.bat runs after Miniconda - env, packages,
    // launchers - each verified on its own artefacts. Never the script itself
    // again: its conda-exists branch targets a RunScript label the file does
    // not define (upstream bug, present in the pin and in today's master).
    if (!await deps.exists(envPython)) {
      setStep('run-setup', { detail: 'environment' })
      deps.log({ detail: `prefix=${envDir} python=${ALLTALK_ENV_PYTHON_VERSION}`, event: 'conda-env-create-start', step: 'run-setup' })
      const created = await deps.exec(
        win32Path(condaExe),
        ['create', '--no-shortcuts', '-y', '-k', '--prefix', win32Path(envDir), `python=${ALLTALK_ENV_PYTHON_VERSION}`],
        { cwd, timeoutMs: CONDA_ENV_CREATE_TIMEOUT_MS },
      )
      const envOk = await deps.exists(envPython)
      deps.log({
        detail: `exit=${created.code} env-python-exists=${envOk} ${outputTail(created)}`,
        event: 'conda-env-create-finished',
        exitCode: created.code,
        step: 'run-setup',
      })
      if (created.code !== 0 || !envOk)
        throw opaqueFailure()
    }
    else {
      deps.log({ event: 'conda-env-present', step: 'run-setup' })
    }

    const commands = alltalkSetupCommands({
      condaExe: win32Path(`${cwd}/${MINICONDA_CONDA_EXE}`),
      envDir: win32Path(envDir),
      envPip: win32Path(`${cwd}/${MINICONDA_ENV_PIP}`),
      wheelPath: win32Path(`${cwd}/${DEEPSPEED_WHEEL}`),
    })
    for (const [index, command] of commands.entries()) {
      if (command.downloadUrl && command.cleanupPath && !await deps.exists(command.cleanupPath)) {
        deps.log({ detail: `url=${command.downloadUrl} dest=${command.cleanupPath}`, event: 'setup-component-download-start', step: 'run-setup' })
        let wheel: { bytes: number, sha256: string }
        try {
          wheel = await deps.download(command.downloadUrl, command.cleanupPath)
        }
        catch (error) {
          // Same rule as the installer: a partial wheel must never be the
          // thing the next attempt finds "present" and feeds to pip.
          await deps.remove(command.cleanupPath).catch(() => undefined)
          throw error
        }
        deps.log({ detail: `id=${command.id} bytes=${wheel.bytes} sha256=${wheel.sha256}`, event: 'setup-component-download-finished', step: 'run-setup' })
      }
      // The detail is a stable token plus a real counter - the renderer turns
      // it into words. Never put command names here: they are technical nouns
      // and the log, not the user's screen, is where they belong.
      setStep('run-setup', { detail: `components:${index + 1}/${commands.length}` })
      deps.log({ detail: `id=${command.id} exe=${command.command} args=${command.args.join(' ')}`, event: 'setup-command-start', step: 'run-setup' })
      const result = await deps.exec(command.command, command.args, { cwd, timeoutMs: command.timeoutMs })
      deps.log({ detail: `id=${command.id} ${outputTail(result)}`, event: 'setup-command-finished', exitCode: result.code, step: 'run-setup' })
      if (result.code !== 0) {
        if (!command.fatal) {
          deps.log({ detail: `id=${command.id} tolerated (the pin runs this step without an errorlevel guard)`, event: 'setup-command-nonfatal-failure', step: 'run-setup' })
          continue
        }
        deps.log({ detail: `id=${command.id}`, event: 'setup-command-failed', step: 'run-setup' })
        throw opaqueFailure()
      }
      if (command.cleanupPath)
        await deps.remove(command.cleanupPath).catch(() => undefined)
    }

    // 4. The launchers (item 7: generate/verify). Byte-exact comparison is the
    // verification: identical files are kept, anything else - missing, edited,
    // or carryover from before the runtime moved out of Roaming - is rewritten
    // with this tree's current absolute paths.
    for (const script of alltalkStartScripts(cwd)) {
      const scriptPath = `${cwd}/${script.file}`
      const current = await deps.readFile(scriptPath)
      if (current === script.content) {
        deps.log({ detail: `file=${script.file}`, event: 'start-script-kept', step: 'run-setup' })
        continue
      }
      await deps.writeFile(scriptPath, script.content)
      deps.log({ detail: `file=${script.file} reason=${current === undefined ? 'missing' : 'stale-or-tampered'}`, event: 'start-script-written', step: 'run-setup' })
    }

    deps.log({ elapsedMs: Date.now() - started, event: 'finished', step: 'run-setup' })
    setStep('run-setup', { elapsedMs: Date.now() - started, status: 'done' })
  }

  async function stepConfigureEngine(): Promise<void> {
    const started = Date.now()
    setStep('configure-engine', { status: 'running' })

    // Phase 6 (items H/J): the pin's `script.py` runs its interactive
    // `firstrun.py` menu on every start while `confignew.json.firstrun_model`
    // is true. A managed, windowless spawn cannot answer that menu, so its
    // 60-second timeout expired on the QA machine and the upstream code
    // downloaded Piper - a voice engine that cannot clone voices, chosen
    // nobody asked for. Writing `firstrun_model: false` here, before the first
    // start, is the same file the upstream `set_firstrun_model_false()` writes
    // after its guided flow: a supported pre-configuration, not a patch. It
    // leaves the engine selection empty until the user explicitly prepares the
    // custom voice (see `alltalk-custom-voice-prepare.ts`), which is also what
    // keeps a few gigabytes of XTTS weights out of this base install.
    try {
      const changed = await markAlltalkFirstRunDone(
        { readFile: deps.readFile, writeFile: deps.writeFile },
        appDir(),
      )
      // Always 'done': the step's obligation is that, afterwards, the config
      // file cannot produce the interactive prompt. The detail records whether
      // the walk had to change anything, so a repair log still separates
      // "restored" from "checked, nothing missing".
      setStep('configure-engine', {
        detail: changed ? 'first-run prompt disabled' : 'already configured',
        elapsedMs: Date.now() - started,
        status: 'done',
      })
    }
    catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { category: 'setup' as const })
    }
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
    'configure-engine': stepConfigureEngine,
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
