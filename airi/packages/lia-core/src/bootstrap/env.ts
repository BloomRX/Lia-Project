import process from 'node:process'

/**
 * Environment probe for the managed voice runtime (item C).
 *
 * Pure and injectable: every command runs through a `run` function the caller
 * supplies, so the whole probe is testable without a Windows machine, and the
 * security property that matters - no user-controlled string ever reaches a
 * shell - holds by construction, because nothing here builds a command string.
 *
 * ## What this probe deliberately does NOT check for
 *
 * The Phase 5 audit (`M1-ALLTALK-INSTALL-AUDIT.md`) established that Git, system
 * Python, espeak-ng, FFmpeg and the MS C++ Build Tools are *not* prerequisites:
 *
 * - `atsetup.bat` only invokes `git` from its update menu, never on the install
 *   path;
 * - espeak-ng and FFmpeg ship inside the AllTalk tree;
 * - Python is created inside the runtime folder by a Miniconda the installer
 *   fetches itself, with `/AddToPath=0 /RegisterPython=0`, so the user's Python
 *   is never touched;
 * - Build Tools are not referenced by the installer at all.
 *
 * So this probe reports them when it happens to see them - useful in diagnostics
 * - but **no step treats their absence as something to fix**. Installing a
 * dependency the runtime does not need is a cost the user pays for nothing, and
 * item E is explicit that nothing gets installed without a proven requirement.
 *
 * The one thing that *is* a hard requirement is `curl`, which the installer uses
 * to fetch Miniconda. It ships with Windows 10 1803 and later.
 */

export interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
}

/** Runs a command with an argument array. Never a shell string. */
export type RunCommand = (command: string, args: string[]) => Promise<CommandResult>

export interface ProbeStatus {
  /** Whether the tool answered at all. */
  present: boolean
  /** Parsed version, when one could be read. */
  version?: string
  /** Raw first line, for diagnostics only. Redacted of paths by the UI layer. */
  detail?: string
}

export interface VoiceRuntimeEnvironment {
  platform: NodeJS.Platform
  arch: string
  /** The only hard prerequisite. */
  curl: ProbeStatus
  /** Reported for diagnostics; absence is never remediated. */
  git: ProbeStatus
  python: ProbeStatus
  winget: ProbeStatus
  espeak: ProbeStatus
  /**
   * Whether an NVIDIA GPU is present.
   *
   * Drives one decision only: whether to warn that the official installer pulls
   * the CUDA PyTorch stack. It never triggers a CUDA install - a machine with an
   * NVIDIA card still gets whatever the official installer does.
   */
  nvidiaGpu: boolean
  /** Free bytes on the target volume, when it could be read. */
  freeBytes?: number
  /**
   * Where the runtime would be installed.
   *
   * Probed so a path the installer cannot use is reported before anything is
   * downloaded, not after.
   */
  runtimeDir?: string
}

/** Pulls `x.y.z` out of arbitrary `--version` output. */
export function parseVersion(output: string): string | undefined {
  const match = /(\d+(?:\.\d+)+)/.exec(output)
  return match?.[1]
}

/**
 * Reads a version from a command's output.
 *
 * A non-zero exit is not treated as "absent" on its own: plenty of tools print a
 * version and exit non-zero. What decides presence is whether anything
 * recognisable came back on either stream.
 */
async function probe(run: RunCommand, command: string, args: string[]): Promise<ProbeStatus> {
  try {
    const result = await run(command, args)
    const text = `${result.stdout}\n${result.stderr}`.trim()
    if (!text)
      return { present: false }

    return {
      present: true,
      version: parseVersion(text),
      detail: text.split('\n')[0]?.slice(0, 200),
    }
  }
  catch {
    // A missing executable rejects (ENOENT). That is the normal "not installed"
    // answer, not an error to surface.
    return { present: false }
  }
}

/**
 * Detects an NVIDIA GPU on Windows via `wmic`.
 *
 * Deliberately conservative: any failure reports `false`. The result only feeds
 * an explanatory message, so a false negative costs a missing hint while a false
 * positive would wrongly reassure someone about hardware they do not have.
 */
async function hasNvidiaGpu(run: RunCommand, platform: NodeJS.Platform): Promise<boolean> {
  if (platform !== 'win32')
    return false

  try {
    const result = await run('wmic', ['path', 'win32_VideoController', 'get', 'name'])
    return /nvidia/i.test(result.stdout)
  }
  catch {
    return false
  }
}

export interface ProbeDeps {
  run: RunCommand
  platform?: NodeJS.Platform
  arch?: string
  /** Free bytes on the volume the runtime would be installed to. */
  freeBytes?: () => Promise<number | undefined>
  /** Where the runtime would be installed, for the path check. */
  runtimeDir?: string
}

export async function probeVoiceRuntimeEnvironment(deps: ProbeDeps): Promise<VoiceRuntimeEnvironment> {
  const platform = deps.platform ?? process.platform
  const arch = deps.arch ?? process.arch
  const { run } = deps

  const [curl, git, python, winget, espeak, nvidiaGpu] = await Promise.all([
    probe(run, 'curl', ['--version']),
    probe(run, 'git', ['--version']),
    probe(run, 'python', ['--version']),
    probe(run, 'winget', ['--version']),
    probe(run, 'espeak-ng', ['--version']),
    hasNvidiaGpu(run, platform),
  ])

  return {
    platform,
    arch,
    curl,
    git,
    python,
    winget,
    espeak,
    nvidiaGpu,
    ...(deps.freeBytes ? { freeBytes: await deps.freeBytes() } : {}),
    ...(deps.runtimeDir ? { runtimeDir: deps.runtimeDir } : {}),
  }
}

/**
 * The minimum bytes the install needs.
 *
 * The official docs cite ~24 GB free during install, settling at ~10 GB. Asking
 * for the peak is what prevents a half-finished install that leaves the user
 * with neither a working runtime nor their disk space back.
 */
export const REQUIRED_FREE_BYTES = 24 * 1024 * 1024 * 1024

export interface ReadinessVerdict {
  /** True when the machine can run the installer as-is. */
  ok: boolean
  /** Stable ids, so the UI can translate without parsing prose. */
  blockers: string[]
}

/**
 * Decides whether installation can proceed.
 *
 * Returns blocker ids rather than sentences: wording belongs to the locale files,
 * and a machine-readable verdict is what the bootstrapper has to branch on.
 */
/**
 * Characters `atsetup.bat` warns about (it does not abort on these).
 *
 * Mirrors the script's own character class so the Lia says the same thing the
 * installer would, rather than inventing a stricter rule of its own.
 */
const INSTALLER_SPECIAL_CHARS = /[!#$%&()*+,;<=>?@[\]^`{|}~]/

/**
 * Whether the installer can run in `dir`.
 *
 * `atsetup.bat` aborts outright when the working directory contains a space
 * (line 353 of the silent path): Miniconda cannot be installed silently under one.
 * The runtime lives under `userData`, which on Windows includes the user's name -
 * and "C:\Users\John Smith\..." is common.
 *
 * Catching this here is the difference between an instant, explainable refusal and
 * a 97 MB download that ends in the installer printing a sentence about folder
 * names and exiting.
 */
export function assessInstallPath(dir: string): { blocker?: string, ok: boolean, warning?: string } {
  if (dir.includes(' '))
    return { blocker: 'path-has-space', ok: false }

  if (INSTALLER_SPECIAL_CHARS.test(dir))
    return { ok: true, warning: 'path-has-special-characters' }

  return { ok: true }
}

export function assessEnvironment(env: VoiceRuntimeEnvironment): ReadinessVerdict {
  const blockers: string[] = []

  // The installer shells out to curl to fetch Miniconda. Without it there is no
  // way forward that does not mean reimplementing the installer.
  if (!env.curl.present)
    blockers.push('missing-curl')

  if (env.platform !== 'win32')
    blockers.push('unsupported-platform')

  if (env.freeBytes !== undefined && env.freeBytes < REQUIRED_FREE_BYTES)
    blockers.push('insufficient-disk')

  // Checked last because it is the only blocker whose wording has to tell the user
  // something about their own machine rather than about the Lia.
  if (env.runtimeDir) {
    const verdict = assessInstallPath(env.runtimeDir)
    if (!verdict.ok && verdict.blocker)
      blockers.push(verdict.blocker)
  }

  return { blockers, ok: blockers.length === 0 }
}
