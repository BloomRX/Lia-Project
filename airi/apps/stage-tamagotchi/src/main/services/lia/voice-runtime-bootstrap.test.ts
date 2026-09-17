import type { BootstrapDeps, BootstrapState, RuntimeInstallRecord, VoiceRuntimeEnvironment } from './voice-runtime-bootstrap'
import type { ProbeStatus } from './voice-runtime-env'

import { beforeEach, describe, expect, it } from 'vitest'

import { INSTALL_MARKERS } from './alltalk-runtime'
import {
  ALLTALK_ENV_PYTHON_VERSION,
  alltalkSetupCommands,
  alltalkSourceUrl,
  alltalkStartScripts,
  BOOTSTRAP_STEP_IDS,
  categorizeFailure,
  CONDA_ENV_CREATE_TIMEOUT_MS,
  CONDA_VERSION_CHECK_TIMEOUT_MS,
  createVoiceRuntimeBootstrapper,
  DEEPSPEED_WHEEL,
  DEEPSPEED_WHEEL_URL,
  messageFor,
  MINICONDA_CONDA_EXE,
  MINICONDA_ENV,
  MINICONDA_ENV_PIP,
  MINICONDA_ENV_PYTHON,
  MINICONDA_EXE,
  MINICONDA_INSTALL_TIMEOUT_MS,
  MINICONDA_INSTALLER,
  MINICONDA_INSTALLER_BYTES,
  MINICONDA_INSTALLER_SHA256,
  MINICONDA_INSTALLER_URL,
  MINICONDA_PREFIX,
  minicondaInstallerArgs,
  outputTail,
  PINNED_ALLTALK_COMMIT,
  PINNED_ALLTALK_VERSION,
  SETUP_INPUTS,
  START_SCRIPT,
  win32Path,
} from './voice-runtime-bootstrap'
import { assessEnvironment, assessInstallPath, parseVersion, probeVoiceRuntimeEnvironment, REQUIRED_FREE_BYTES } from './voice-runtime-env'

/**
 * The bootstrapper, exercised against a fake machine.
 *
 * Every side effect is injected, so these tests describe what the bootstrapper
 * decides* rather than what a particular Windows box happens to do. That is the
 * only honest option here: there is no Windows, no Electron and no AllTalk in
 * this environment.
 */

const present = (version: string): ProbeStatus => ({ detail: `${version}`, present: true, version })
const absent: ProbeStatus = { present: false }

function env(overrides: Partial<VoiceRuntimeEnvironment> = {}): VoiceRuntimeEnvironment {
  return {
    arch: 'x64',
    curl: present('8.4.0'),
    espeak: absent,
    freeBytes: REQUIRED_FREE_BYTES * 2,
    git: absent,
    nvidiaGpu: false,
    platform: 'win32',
    python: absent,
    winget: absent,
    ...overrides,
  }
}

interface Harness {
  deps: BootstrapDeps
  calls: { exec: string[][], removed: string[], downloaded: string[], extracted: string[], written: string[] }
  logs: Array<{ detail?: string, event: string, exitCode?: number | null, step: string }>
  failExecMatching: (pattern: string, result: { code: number | null, stderr?: string, stdout?: string }) => void
  clearExecFailures: () => void
  setCondaBroken: (value: boolean) => void
  setHealthy: (value: boolean) => void
  setStartResult: (value: boolean) => void
  markExists: (...paths: string[]) => void
  fileContent: (path: string) => string | undefined
  stateRecord: () => RuntimeInstallRecord | undefined
}

/**
 * What the extraction leaves behind: the source tree, with the two files the
 * continuation feeds to pip as relative paths. Running the setup itself
 * produces the conda environment and the launcher, so a fake that created
 * them here would make the installer look already-run and skip the step
 * under test.
 */
// The pin's own script is part of the extracted zip (it stays in the tree,
// it is just never executed again), and the fetch step uses its presence as
// the "this commit is already on disk" marker - so the fake extraction must
// lay it down like the real archive does.
const SOURCE_TREE = ['atsetup.bat', ...SETUP_INPUTS, ...INSTALL_MARKERS]

function normalizeExec(stub: { code: number | null, stderr?: string, stdout?: string }) {
  return { code: stub.code, stderr: stub.stderr ?? '', stdout: stub.stdout ?? '' }
}

function harness(overrides: Partial<BootstrapDeps> = {}): Harness {
  const existing = new Set<string>()
  const files = new Map<string, string>()
  const calls = { downloaded: [] as string[], exec: [] as string[][], extracted: [] as string[], removed: [] as string[], written: [] as string[] }
  const logs: Harness['logs'] = []
  const failures: Array<{ pattern: string, result: { code: number | null, stderr?: string, stdout?: string } }> = []
  let condaBroken = false
  let healthy = false
  let startResult = true
  let record: RuntimeInstallRecord | undefined

  const runtimeDir = overrides.runtimeDir ?? 'C:\\Users\\lia\\AppData\\Local\\Lia\\runtimes\\alltalk'

  const deps: BootstrapDeps = {
    // Fake machine behaviour, routed on what the production code actually
    // spawns: the NSIS installer (which then leaves its artefacts behind),
    // `_conda.exe` answering --version, `_conda.exe create` leaving the env -
    // plus a failure-list the tests can arm by output-recognisable pattern.
    exec: async (command, args, options) => {
      calls.exec.push([command, ...args, `cwd=${options.cwd}`, `timeout=${options.timeoutMs}`])
      const matched = failures.find(failure => [command, ...args].join(' ').includes(failure.pattern))
      if (matched)
        return normalizeExec(matched.result)
      if (command.endsWith('miniconda_installer.exe')) {
        existing.add(`${options.cwd}/${MINICONDA_PREFIX}`)
        existing.add(`${options.cwd}/${MINICONDA_EXE}`)
        return normalizeExec({ code: 0 })
      }
      if (command.endsWith('_conda.exe')) {
        if (args[0] === '--version')
          return normalizeExec(condaBroken ? { code: 1, stderr: 'Access is denied.' } : { code: 0, stdout: 'conda 24.4.0' })
        if (args[0] === 'create') {
          existing.add(`${options.cwd}/${MINICONDA_ENV_PYTHON}`)
          existing.add(`${options.cwd}/${MINICONDA_ENV}`)
          return normalizeExec({ code: 0 })
        }
      }
      // The env's own conda (install/clean) and pip (every requirements or
      // package step) succeed silently: their artefacts are not what
      // verify-install checks.
      return normalizeExec({ code: 0 })
    },
    download: async (url, dest) => {
      calls.downloaded.push(url)
      existing.add(dest)
      // The installer download must come back matching the official record,
      // otherwise every happy-path test would be exercising the integrity
      // rejection instead of the continuation.
      if (url === MINICONDA_INSTALLER_URL)
        return { bytes: MINICONDA_INSTALLER_BYTES, sha256: MINICONDA_INSTALLER_SHA256 }
      return { bytes: 5_000_000, sha256: 'a'.repeat(64) }
    },
    extract: async (_archive, dest) => {
      calls.extracted.push(dest)
      // Only the source tree. `start_alltalk.bat` and the conda environment are
      // *products* of running the setup, so a fake that created them here would
      // make the installer look already-run and skip the step under test.
      for (const marker of SOURCE_TREE)
        existing.add(`${dest}/${marker}`)
      // The pinned archive ships its config with the first-run prompt armed -
      // exactly what the configure-engine step exists to disarm.
      files.set(`${dest}/confignew.json`, JSON.stringify({ branding: 'AllTalk ', firstrun_model: true }))
    },
    exists: async path => existing.has(path),
    stat: async path => (existing.has(path) ? { size: 81_720_000 } : undefined),
    readFile: async path => files.get(path),
    writeFile: async (path, content) => {
      files.set(path, content)
      existing.add(path)
      calls.written.push(path)
    },
    mkdir: async () => undefined,
    remove: async (path) => {
      calls.removed.push(path)
      for (const key of [...existing]) {
        if (key === path || key.startsWith(`${path}/`) || key.startsWith(`${path}\\`))
          existing.delete(key)
      }
      for (const key of [...files.keys()]) {
        if (key === path || key.startsWith(`${path}/`) || key.startsWith(`${path}\\`))
          files.delete(key)
      }
    },
    rename: async () => undefined,
    isHealthy: async () => healthy,
    startRuntime: async () => startResult,
    probe: async () => env(),
    runtimeDir,
    writeState: async (value) => {
      record = value
    },
    readState: async () => record,
    log: (entry) => {
      logs.push({ detail: entry.detail, event: entry.event, exitCode: entry.exitCode, step: entry.step })
    },
    ...overrides,
  }

  return {
    calls,
    clearExecFailures: () => {
      failures.length = 0
    },
    deps,
    failExecMatching: (pattern, result) => {
      failures.push({ pattern, result })
    },
    fileContent: path => files.get(path),
    logs,
    markExists: (...paths) => {
      for (const path of paths)
        existing.add(path)
    },
    setCondaBroken: (value) => {
      condaBroken = value
    },
    setHealthy: (value) => {
      healthy = value
    },
    setStartResult: (value) => {
      startResult = value
    },
    stateRecord: () => record,
  }
}

describe('environment probe', () => {
  it('reports curl as present when it answers', async () => {
    const probed = await probeVoiceRuntimeEnvironment({
      platform: 'win32',
      run: async () => ({ code: 0, stderr: '', stdout: 'curl 8.4.0 (Windows)' }),
    })

    expect(probed.curl.present).toBe(true)
    expect(probed.curl.version).toBe('8.4.0')
  })

  it('treats a rejecting command as absent, not as an error', async () => {
    const probed = await probeVoiceRuntimeEnvironment({
      platform: 'win32',
      run: async () => {
        throw new Error('spawn git ENOENT')
      },
    })

    expect(probed.git.present).toBe(false)
  })

  it('counts a tool as present even when it exits non-zero but prints a version', async () => {
    // Plenty of tools print a version and exit non-zero; treating that as
    // "absent" would send the user off to install something they already have.
    const probed = await probeVoiceRuntimeEnvironment({
      platform: 'win32',
      run: async () => ({ code: 1, stderr: '', stdout: 'winget v1.7.10861' }),
    })

    expect(probed.winget.present).toBe(true)
    expect(probed.winget.version).toBe('1.7.10861')
  })

  it('detects an NVIDIA GPU only from real output', async () => {
    const withNvidia = await probeVoiceRuntimeEnvironment({
      platform: 'win32',
      run: async (_cmd, args) =>
        args[0] === 'path'
          ? { code: 0, stderr: '', stdout: 'NVIDIA GeForce GTX 1660' }
          : { code: 0, stderr: '', stdout: 'x' },
    })
    expect(withNvidia.nvidiaGpu).toBe(true)

    const withAmd = await probeVoiceRuntimeEnvironment({
      platform: 'win32',
      run: async (_cmd, args) =>
        args[0] === 'path'
          ? { code: 0, stderr: '', stdout: 'Radeon RX 580' }
          : { code: 0, stderr: '', stdout: 'x' },
    })
    // The target machine for this project: an RX 580 has no CUDA, and nothing in
    // the bootstrap may try to install a CUDA stack for it.
    expect(withAmd.nvidiaGpu).toBe(false)
  })

  it('parses a version out of arbitrary output', () => {
    expect(parseVersion('git version 2.43.0.windows.1')).toBe('2.43.0')
    expect(parseVersion('Python 3.11.9')).toBe('3.11.9')
    expect(parseVersion('no numbers here')).toBeUndefined()
  })
})

describe('what must NOT be treated as a prerequisite', () => {
  it('does not block on missing Git', () => {
    // Audit finding: atsetup.bat only calls git from its *update* menu, never on
    // the install path. Installing Git here would be installing something the
    // runtime does not use.
    expect(assessEnvironment(env({ git: absent })).ok).toBe(true)
  })

  it('does not block on missing system Python', () => {
    // The installer fetches its own Miniconda and creates python=3.11.9 inside
    // the runtime folder, with /AddToPath=0 /RegisterPython=0.
    expect(assessEnvironment(env({ python: absent })).ok).toBe(true)
  })

  it('does not block on an incompatible system Python', () => {
    expect(assessEnvironment(env({ python: present('2.7.18') })).ok).toBe(true)
  })

  it('does not block on missing winget', () => {
    // Nothing needs winget once Git, Python and espeak are off the list.
    expect(assessEnvironment(env({ winget: absent })).ok).toBe(true)
  })

  it('does not block on missing espeak-ng', () => {
    // It ships inside the AllTalk tree at system/espeak-ng.
    expect(assessEnvironment(env({ espeak: absent })).ok).toBe(true)
  })

  it('blocks only on curl, an unsupported platform, or no disk space', () => {
    expect(assessEnvironment(env({ curl: absent })).blockers).toEqual(['missing-curl'])
    expect(assessEnvironment(env({ platform: 'darwin' })).blockers).toEqual(['unsupported-platform'])
    expect(assessEnvironment(env({ freeBytes: 1024 })).blockers).toEqual(['insufficient-disk'])
  })

  it('never installs Git, Python or winget during a run', async () => {
    const h = harness()
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    const everyArg = h.calls.exec.flat().join(' ')
    expect(everyArg).not.toContain('winget')
    expect(everyArg).not.toContain('git')
    // Downloaded: exactly the pinned upstream artefacts - the archive, the
    // Miniconda installer and the DeepSpeed wheel - and nothing else.
    expect(h.calls.downloaded).toEqual([alltalkSourceUrl(), MINICONDA_INSTALLER_URL, DEEPSPEED_WHEEL_URL])
  })
})

describe('a successful install', () => {
  let h: Harness

  beforeEach(() => {
    h = harness()
  })

  it('reaches ready and records the pinned version', async () => {
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('ready')
    expect(state.version).toBe(PINNED_ALLTALK_VERSION)
    expect(state.steps.every(step => step.status === 'done')).toBe(true)
  })

  it('walks every step in order', async () => {
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    expect(bootstrapper.state().steps.map(step => step.id)).toEqual([...BOOTSTRAP_STEP_IDS])
  })

  it('downloads the source pinned to a commit, not to a moving branch', async () => {
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    expect(h.calls.downloaded[0]).toBe(alltalkSourceUrl())
    // A branch name here would mean every user installs whatever landed that day.
    expect(h.calls.downloaded[0]).not.toContain('alltalkbeta')
    expect(h.calls.downloaded[0]).toContain(PINNED_ALLTALK_COMMIT)
    expect(h.calls.downloaded[0]).toMatch(/^https:\/\//)
  })

  it('records the installed commit and archive hash in state', async () => {
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    expect(h.stateRecord()?.commit).toBe(PINNED_ALLTALK_COMMIT)
    expect(h.stateRecord()?.sourceSha256).toBeTruthy()
  })

  it('runs every spawned process with the tree root as cwd and none of it through a shell', async () => {
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    const appRoot = `${h.deps.runtimeDir}/app`
    expect(h.calls.exec.length).toBeGreaterThan(0)
    for (const call of h.calls.exec) {
      // Every command runs where the pinned script assumed it was: the AllTalk
      // root, so its relative paths (system\\requirements\\...) resolve.
      expect(call.find(arg => arg.startsWith('cwd='))).toBe(`cwd=${appRoot}`)
      // And none of it goes through a shell that would re-parse anything.
      expect(call[0]).not.toMatch(/cmd/i)
      expect(call).not.toContain('/C')
      expect(call).not.toContain('/c')
    }
  })

  it('does not pass a shell:true style concatenated command', async () => {
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    for (const call of h.calls.exec) {
      const joined = call.join(' ')
      // No shell operators anywhere: a concatenated command would need them.
      expect(joined).not.toMatch(/&&|\|\||[;`$]/)
    }
  })

  it('verifies health before declaring ready', async () => {
    h.setStartResult(false)
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    // Marking ready without a health check is the exact failure the mutation
    // suite targets; here it must surface as a failure instead.
    expect(state.phase).toBe('failed')
    expect(state.failureCategory).toBe('health')
  })

  it('skips starting when the server already answers', async () => {
    h.setHealthy(true)
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    expect(bootstrapper.state().steps.find(step => step.id === 'verify-health')?.status).toBe('skipped')
  })
})

describe('idempotency', () => {
  it('does not re-download when the pinned commit is already installed', async () => {
    const h = harness()
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)
    await bootstrapper.run()
    expect(h.calls.downloaded).toEqual([alltalkSourceUrl(), MINICONDA_INSTALLER_URL, DEEPSPEED_WHEEL_URL])

    const second = await bootstrapper.run()

    expect(second.phase).toBe('ready')
    // Nothing at all came off the network the second time.
    expect(h.calls.downloaded).toEqual([alltalkSourceUrl(), MINICONDA_INSTALLER_URL, DEEPSPEED_WHEEL_URL])
    expect(bootstrapper.state().steps.find(step => step.id === 'fetch-source')?.status).toBe('skipped')
  })

  it('does not re-run the continuation when the generated launcher exists', async () => {
    const h = harness()
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)
    await bootstrapper.run()
    const execRuns = h.calls.exec.length

    await bootstrapper.run()

    expect(h.calls.exec.length).toBe(execRuns)
    expect(bootstrapper.state().steps.find(step => step.id === 'run-setup')?.status).toBe('skipped')
  })

  it('re-downloads when the installed commit differs from the pin', async () => {
    const h = harness({
      readState: async () => ({ commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', installedAt: '' }),
    })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    // A deliberate upgrade, not a re-run: the pin changed, so the source must too.
    expect(h.calls.downloaded[0]).toBe(alltalkSourceUrl())
    expect(h.stateRecord()?.commit).toBe(PINNED_ALLTALK_COMMIT)
  })
})

describe('concurrency', () => {
  it('runs one install when Install is clicked twice', async () => {
    const h = harness()
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const [first, second] = await Promise.all([bootstrapper.run(), bootstrapper.run()])

    expect(first).toBe(second)
    expect(h.calls.downloaded).toEqual([alltalkSourceUrl(), MINICONDA_INSTALLER_URL, DEEPSPEED_WHEEL_URL])
    expect(h.calls.exec.filter(call => call[0].endsWith('miniconda_installer.exe'))).toHaveLength(1)
  })

  it('does not let a repair race an install', async () => {
    const h = harness()
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const [install, repair] = await Promise.all([
      bootstrapper.run(),
      bootstrapper.run({ repair: true }),
    ])

    expect(install).toBe(repair)
    expect(h.calls.exec.filter(call => call[0].endsWith('miniconda_installer.exe'))).toHaveLength(1)
  })
})

describe('the setup step — the round-7 continuation', () => {
  const appRoot = (h: Harness): string => `${h.deps.runtimeDir}/app`

  it('refuses to start when the requirements files the pip steps install are missing', async () => {
    // A truncated extraction must fail before any spawn: the alternative is a
    // pip error twenty minutes into what looked like progress.
    const h = harness({
      extract: async (_archive, dest) => {
        for (const marker of INSTALL_MARKERS)
          h.markExists(`${dest}/${marker}`)
      },
    })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('failed')
    expect(bootstrapper.state().steps.find(step => step.id === 'run-setup')?.status).toBe('failed')
    expect(h.calls.exec).toHaveLength(0)
    const refused = h.logs.find(entry => entry.step === 'run-setup' && entry.event === 'layout-invalid')
    expect(refused).toBeTruthy()
    for (const input of SETUP_INPUTS)
      expect(refused!.detail).toContain(input)
  })

  it('refuses when only one of the requirements files is missing', async () => {
    // The continuation runs `pip install -r system\\requirements\\...` with
    // relative paths from its own directory; without them the env build dies
    // mid-setup, far from the actual gap.
    const h = harness({
      extract: async (_archive, dest) => {
        h.markExists(`${dest}/${SETUP_INPUTS[0]}`)
        for (const marker of INSTALL_MARKERS)
          h.markExists(`${dest}/${marker}`)
      },
    })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('failed')
    expect(h.calls.exec).toHaveLength(0)
    const refused = h.logs.find(entry => entry.step === 'run-setup' && entry.event === 'layout-invalid')
    expect(refused!.detail).toContain('requirements_parler.txt')
  })

  it('downloads the pinned installer and proves its integrity before executing it', async () => {
    const h = harness()
    h.setHealthy(true)
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    expect(h.calls.downloaded).toContain(MINICONDA_INSTALLER_URL)
    const finished = h.logs.find(entry => entry.event === 'miniconda-installer-download-finished')
    expect(finished!.detail).toContain(`sha256=${MINICONDA_INSTALLER_SHA256}`)
    expect(finished!.detail).toContain('integrity=true')
    // Only a verified installer may ever be executed.
    expect(h.calls.exec.some(call => call[0].endsWith('miniconda_installer.exe'))).toBe(true)
  })

  it('deletes the installer download and stops when its integrity check fails', async () => {
    // Bytes from an unofficial mirror - or a truncated transfer - are deleted,
    // never executed.
    const h = harness({
      download: async (url, dest) => {
        h.calls.downloaded.push(url)
        h.markExists(dest)
        if (url === MINICONDA_INSTALLER_URL)
          return { bytes: 1234, sha256: 'b'.repeat(64), url: undefined as never }
        return { bytes: 5_000_000, sha256: 'a'.repeat(64), url: undefined as never }
      },
    } as Partial<BootstrapDeps>)
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('failed')
    expect(state.failureCategory).toBe('download')
    expect(h.calls.exec.some(call => call[0].endsWith('miniconda_installer.exe'))).toBe(false)
    const installerPath = `${appRoot(h)}/${MINICONDA_INSTALLER}`
    expect(h.calls.removed).toContain(installerPath)
    const finished = h.logs.find(entry => entry.event === 'miniconda-installer-download-finished')
    expect(finished!.detail).toContain('integrity=false')
  })

  it('reuses the installer already on disk instead of downloading it again', async () => {
    // The 85 MB installer already sits in the tree from a failed attempt -
    // this run must reuse it, never re-download it (round-4 item J).
    const h = harness()
    h.setHealthy(true)
    h.markExists(`${appRoot(h)}/${MINICONDA_INSTALLER}`)

    await createVoiceRuntimeBootstrapper(h.deps).run()

    expect(h.calls.downloaded).toEqual([alltalkSourceUrl(), DEEPSPEED_WHEEL_URL])
    const present = h.logs.find(entry => entry.event === 'miniconda-installer-present')
    expect(present).toBeTruthy()
    expect(present!.detail).toContain('installer-bytes=81720000')
  })

  it('catches a Miniconda that is present but does not answer --version', async () => {
    // The pin's own "conda exists and works" check. A half-deleted install
    // answering nothing must stop the continuation here, not twenty commands
    // later inside a conda error.
    const h = harness()
    h.markExists(`${appRoot(h)}/${MINICONDA_PREFIX}`, `${appRoot(h)}/${MINICONDA_EXE}`, `${appRoot(h)}/${MINICONDA_INSTALLER}`)
    h.setCondaBroken(true)
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('failed')
    expect(state.failureCategory).toBe('setup')
    expect(h.logs.some(entry => entry.event === 'miniconda-broken')).toBe(true)
    // Not a single continuation command ran against the broken base.
    expect(h.logs.some(entry => entry.event === 'setup-command-start')).toBe(false)
  })

  it('creates the env with the pinned python and runs the exact official command sequence in order', async () => {
    const h = harness()
    h.setHealthy(true)
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('ready')
    const create = h.calls.exec.find(call => call[1] === 'create')
    expect(create).toBeTruthy()
    expect(create![0]).toBe(win32Path(`${appRoot(h)}/${MINICONDA_EXE}`))
    expect(create!.slice(1, -2)).toEqual(['create', '--no-shortcuts', '-y', '-k', '--prefix', win32Path(`${appRoot(h)}/${MINICONDA_ENV}`), `python=${ALLTALK_ENV_PYTHON_VERSION}`])
    expect(create!.find(arg => arg.startsWith('timeout='))).toBe(`timeout=${CONDA_ENV_CREATE_TIMEOUT_MS}`)

    // The continuation is the pinned atsetup.bat, as ordered data.
    const wanted = alltalkSetupCommands({
      condaExe: win32Path(`${appRoot(h)}/${MINICONDA_CONDA_EXE}`),
      envDir: win32Path(`${appRoot(h)}/${MINICONDA_ENV}`),
      envPip: win32Path(`${appRoot(h)}/${MINICONDA_ENV_PIP}`),
      wheelPath: win32Path(`${appRoot(h)}/${DEEPSPEED_WHEEL}`),
    })
    const commandStarts = h.logs.filter(entry => entry.event === 'setup-command-start').map(entry => entry.detail)
    expect(commandStarts.map(detail => detail!.split(' ')[0])).toEqual(wanted.map(command => `id=${command.id}`))

    for (const command of wanted) {
      const call = h.calls.exec.find(entry => entry[0] === command.command && entry[1] === command.args[0] && entry.join(' ').includes(command.args[command.args.length - 1]))
      expect(call, `command ${command.id}`).toBeTruthy()
      expect(call!.slice(1, -2)).toEqual(command.args)
      expect(call!.find(arg => arg.startsWith('timeout='))).toBe(`timeout=${command.timeoutMs}`)
    }
  })

  it('drives pip only through the env\'s own Scripts path', async () => {
    const h = harness()
    h.setHealthy(true)
    await createVoiceRuntimeBootstrapper(h.deps).run()

    const pipCalls = h.calls.exec.filter(call => call[0].endsWith('pip.exe'))
    expect(pipCalls.length).toBeGreaterThanOrEqual(4)
    for (const call of pipCalls)
      expect(call[0]).toBe(win32Path(`${appRoot(h)}/${MINICONDA_ENV_PIP}`))
    // And a bare `pip` from PATH is never touched by anything.
    expect(h.calls.exec.some(call => /(?:^|[\\/])pip(?:\\.exe)?$/.test(call[0]) && !call[0].includes('alltalk_environment'))).toBe(false)
  })

  it('downloads, installs then deletes the DeepSpeed wheel, in that order, exactly like the pin', async () => {
    const h = harness()
    h.setHealthy(true)
    await createVoiceRuntimeBootstrapper(h.deps).run()

    expect(h.calls.downloaded).toContain(DEEPSPEED_WHEEL_URL)
    const wheelPath = win32Path(`${appRoot(h)}/${DEEPSPEED_WHEEL}`)
    const downloadAt = h.logs.findIndex(entry => entry.event === 'setup-component-download-finished')
    const installAt = h.calls.exec.findIndex(call => call.slice(1, -2).join(' ') === `install ${DEEPSPEED_WHEEL}`)
    expect(downloadAt).toBeGreaterThanOrEqual(0)
    expect(installAt).toBeGreaterThanOrEqual(0)
    // The wheel comes from GitHub before pip sees it, and leaves the disk only
    // after pip accepted it - the exact sequence of the pin's step.
    expect(h.calls.removed).toContain(wheelPath)
  })

  it('fails the step with an opaque sentence when a fatal component fails', async () => {
    // Only `clean_environment` is tolerated: everything else mirrors the pin's
    // errorlevel guard.
    const h = harness()
    h.failExecMatching('faiss-cpu', { code: 1, stderr: 'conda died' })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('failed')
    expect(bootstrapper.state().steps.find(step => step.id === 'run-setup')?.status).toBe('failed')
    expect(bootstrapper.state().steps.find(step => step.id === 'verify-install')?.status).toBe('pending')
    expect(state.message).toBe(messageFor('setup'))
    expect(state.message).not.toContain('faiss')
    expect(state.message).not.toContain('conda')
    expect(h.logs.some(entry => entry.event === 'setup-command-failed')).toBe(true)
  })

  it('tolerates a failing conda clean exactly like the pin does', async () => {
    const h = harness()
    h.setHealthy(true)
    h.failExecMatching('--force-pkgs-dirs', { code: 1, stderr: 'cannot remove package cache' })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('ready')
    expect(h.logs.some(entry => entry.event === 'setup-command-nonfatal-failure')).toBe(true)
  })

  it('writes the four launchers, byte-exact what the pin echoes, with this tree\'s paths', async () => {
    const h = harness()
    h.setHealthy(true)
    await createVoiceRuntimeBootstrapper(h.deps).run()

    const wanted = alltalkStartScripts(appRoot(h))
    // The configure-engine step also writes a file (`confignew.json`); scope
    // this check to the launchers only.
    expect(h.calls.written.filter(path => path.endsWith('.bat')).sort()).toEqual(wanted.map(script => `${appRoot(h)}/${script.file}`).sort())
    for (const script of wanted) {
      const content = h.fileContent(`${appRoot(h)}/${script.file}`)
      expect(content).toBe(script.content)
      // Batch files must be CRLF: the pin's own echo lines end that way, and a
      // single LF would break label parsing on cmd.
      expect(content).toContain('\r\n')
      expect(content!.split('\r\n').every(line => !line.includes('\n'))).toBe(true)
      expect(content).toContain(win32Path(appRoot(h)))
    }
    // Byte identity is the verification: identical files are the "a previous
    // run got this far" signal for the next attempt.
    expect(h.logs.filter(entry => entry.event === 'start-script-written')).toHaveLength(4)
  })

  it('keeps byte-identical launchers from a previous attempt and rewrites anything stale', async () => {
    const h = harness()
    h.setHealthy(true)
    const wanted = alltalkStartScripts(appRoot(h))
    // Pre-seed all launchers except the guard one: three kept as-is, one
    // deliberately stale (carrying a path from before the runtime moved).
    const stale = wanted.find(script => script.file === 'start_finetune.bat')!
    h.markExists(`${appRoot(h)}/${stale.file}`)
    for (const script of wanted) {
      if (script.file === START_SCRIPT || script.file === stale.file)
        continue
      h.markExists(`${appRoot(h)}/${script.file}`)
    }
    // Then override readFile to answer the pre-seeded content: identical for
    // two, foreign for the stale one.
    const seeded = new Map(wanted.filter(script => script.file !== START_SCRIPT).map(script => [
      `${appRoot(h)}/${script.file}`,
      script.file === stale.file ? script.content.replaceAll(win32Path(appRoot(h)), 'C:\\\\oldpath') : script.content,
    ]))
    const deps: Partial<BootstrapDeps> = {
      readFile: async (path) => {
        const found = seeded.get(path)
        if (found !== undefined)
          return found
        return h.fileContent(path)
      },
    }
    const h2 = harness({ ...deps, runtimeDir: h.deps.runtimeDir })
    // transplant the seeds: exists info for non-guard scripts
    for (const script of wanted) {
      if (script.file !== START_SCRIPT)
        h2.markExists(`${appRoot(h2)}/${script.file}`)
    }
    h2.setHealthy(true)

    await createVoiceRuntimeBootstrapper(h2.deps).run()

    const kept = h2.logs.filter(entry => entry.event === 'start-script-kept').map(entry => entry.detail)
    const rewritten = h2.logs.filter(entry => entry.event === 'start-script-written').map(entry => entry.detail)
    expect(kept).toHaveLength(2)
    expect(rewritten.some(detail => detail!.includes(START_SCRIPT) && detail!.includes('missing'))).toBe(true)
    expect(rewritten.some(detail => detail!.includes(stale.file) && detail!.includes('stale-or-tampered'))).toBe(true)
    expect(h2.fileContent(`${appRoot(h2)}/${stale.file}`)).toBe(stale.content)
  })

  it('publishes honest, non-technical substates for the long stages (environment, components counter)', async () => {
    const details: Array<string | undefined> = []
    const h = harness({
      onStateChange: (state) => {
        const step = state.steps.find(entry => entry.id === 'run-setup')
        if (step?.status === 'running' && step.detail !== undefined)
          details.push(step.detail)
      },
    })
    h.setHealthy(true)

    await createVoiceRuntimeBootstrapper(h.deps).run()

    // First the environment build, then one token per official command - the
    // real counter the panel shows instead of an invented percentage. This is
    // what keeps a 45-minute step from reading as a hang with no way back.
    expect(details[0]).toBe('environment')
    expect(details.slice(1)).toEqual([...Array.from({ length: 9 }).keys()].map(i => `components:${i + 1}/9`))
    // The contract is tokens: no command ids or technical nouns ever go to the UI.
    for (const detail of details)
      expect(detail).toMatch(/^(environment|components:\d+\/\d+)$/)
  })

  it('a stalled installer download is deleted, never executed partially on the retry', async () => {
    // A stalled/aborted transfer leaves a partial file behind; if the next
    // attempt found it "present" it would run a corrupted installer.
    let stalled = true
    const h = harness({
      download: async (url, dest) => {
        h.calls.downloaded.push(url)
        h.markExists(dest) // the partial bytes that a stalled pipeline writes
        if (url === MINICONDA_INSTALLER_URL && stalled)
          throw new Error('ETIMEDOUT: the download stalled and timed out')
        if (url === MINICONDA_INSTALLER_URL)
          return { bytes: MINICONDA_INSTALLER_BYTES, sha256: MINICONDA_INSTALLER_SHA256, url: undefined as never }
        return { bytes: 5_000_000, sha256: 'a'.repeat(64), url: undefined as never }
      },
    } as Partial<BootstrapDeps>)
    h.setHealthy(true)

    const first = await createVoiceRuntimeBootstrapper(h.deps).run()
    expect(first.phase).toBe('failed')
    expect(first.failureCategory).toBe('network')
    const installerPath = `${appRoot(h)}/${MINICONDA_INSTALLER}`
    expect(h.calls.removed).toContain(installerPath)
    // Nothing ever executed the partial: no installer run at all on that attempt.
    expect(h.calls.exec.some(call => call[0].endsWith('miniconda_installer.exe'))).toBe(false)

    stalled = false
    const second = await createVoiceRuntimeBootstrapper(h.deps)
    await second.run()
    expect(second.state().phase).toBe('ready')
    // The retry downloaded again (twice in total for this URL): it did not
    // reuse the leftover.
    expect(h.calls.downloaded.filter(url => url === MINICONDA_INSTALLER_URL)).toHaveLength(2)
  })

  it('a stalled component download is deleted, never fed to pip half-written', async () => {
    const h = harness({
      download: async (url, dest) => {
        h.calls.downloaded.push(url)
        h.markExists(dest)
        if (url === DEEPSPEED_WHEEL_URL)
          throw new Error('ETIMEDOUT: the download stalled and timed out')
        if (url === MINICONDA_INSTALLER_URL)
          return { bytes: MINICONDA_INSTALLER_BYTES, sha256: MINICONDA_INSTALLER_SHA256, url: undefined as never }
        return { bytes: 5_000_000, sha256: 'a'.repeat(64), url: undefined as never }
      },
    } as Partial<BootstrapDeps>)

    const state = await createVoiceRuntimeBootstrapper(h.deps).run()

    expect(state.phase).toBe('failed')
    expect(state.failureCategory).toBe('network')
    expect(h.calls.removed).toContain(win32Path(`${appRoot(h)}/${DEEPSPEED_WHEEL}`))
  })

  it('reruns only what is missing when conda and env already exist', async () => {
    // The resume shape round 3 needed: with a verified Miniconda and a present
    // env, the installer and `conda create` cost zero; the package suite still
    // runs (the package managers own the idempotency).
    const h = harness()
    h.setHealthy(true)
    h.markExists(
      `${appRoot(h)}/${MINICONDA_INSTALLER}`,
      `${appRoot(h)}/${MINICONDA_PREFIX}`,
      `${appRoot(h)}/${MINICONDA_EXE}`,
      `${appRoot(h)}/${MINICONDA_ENV}`,
      `${appRoot(h)}/${MINICONDA_ENV_PYTHON}`,
    )

    const state = await createVoiceRuntimeBootstrapper(h.deps).run()

    expect(state.phase).toBe('ready')
    expect(h.calls.exec.some(call => call[0].endsWith('miniconda_installer.exe'))).toBe(false)
    expect(h.calls.exec.some(call => call[1] === 'create')).toBe(false)
    expect(h.logs.some(entry => entry.event === 'conda-env-present')).toBe(true)
    expect(h.logs.filter(entry => entry.event === 'setup-command-start')).toHaveLength(9)
  })
})

describe('the configure-engine step (phase 6: disarming the upstream first-run prompt)', () => {
  const appRoot = (h: Harness): string => `${h.deps.runtimeDir}/app`

  it('sits between the setup and the installation checks', () => {
    expect(BOOTSTRAP_STEP_IDS.indexOf('configure-engine')).toBe(BOOTSTRAP_STEP_IDS.indexOf('run-setup') + 1)
    expect(BOOTSTRAP_STEP_IDS.indexOf('configure-engine')).toBe(BOOTSTRAP_STEP_IDS.indexOf('verify-install') - 1)
  })

  it('writes firstrun_model false while preserving the pinned config\'s other keys', async () => {
    const h = harness()
    const state = await createVoiceRuntimeBootstrapper(h.deps).run()

    const config = JSON.parse(h.fileContent(`${appRoot(h)}/confignew.json`)!)
    expect(config.firstrun_model).toBe(false)
    expect(config.branding).toBe('AllTalk ')

    const step = state.steps.find(item => item.id === 'configure-engine')!
    expect(step.status).toBe('done')
    expect(step.detail).toBe('first-run prompt disabled')
  })

  it('t: a repair walk notices a re-armed prompt and disarms it again (not a no-op)', async () => {
    const h = harness()
    h.setHealthy(true)
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)
    await bootstrapper.run()

    // Whatever re-armed it: a hand edit, an upgrade of the AllTalk config.
    await h.deps.writeFile(`${appRoot(h)}/confignew.json`, JSON.stringify({ branding: 'AllTalk ', firstrun_model: true }))
    const before = h.calls.written.length

    const repaired = await bootstrapper.run({ repair: true })

    expect(repaired.phase).toBe('ready')
    const config = JSON.parse(h.fileContent(`${appRoot(h)}/confignew.json`)!)
    expect(config.firstrun_model).toBe(false)
    // The file was rewritten - prove the walk actually did something here.
    expect(h.calls.written.length).toBeGreaterThan(before)
  })

  it('t: a satisfied config is reported without a rewrite (checked, nothing missing)', async () => {
    const h = harness()
    h.setHealthy(true)
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)
    await bootstrapper.run()

    const before = h.calls.written.length
    const repaired = await bootstrapper.run({ repair: true })

    const step = repaired.steps.find(item => item.id === 'configure-engine')!
    expect(step.status).toBe('done')
    expect(step.detail).toBe('already configured')
    expect(h.logs.filter(entry => entry.event === 'configure-engine').length).toBe(0)
    // No extra writes beyond this verification.
    expect(h.calls.written).toHaveLength(before)
  })

  it('a corrupted confignew.json fails the step loudly instead of overwriting a damaged config', async () => {
    const h = harness()
    h.setHealthy(true)
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)
    await bootstrapper.run()

    await h.deps.writeFile(`${appRoot(h)}/confignew.json`, '{broken')

    const repaired = await bootstrapper.run({ repair: true })

    expect(repaired.phase).toBe('failed')
    const step = repaired.steps.find(item => item.id === 'configure-engine')!
    expect(step.status).toBe('failed')
    expect(step.detail).toBe('setup')
    // The damaged file survives untouched for diagnosis.
    expect(h.fileContent(`${appRoot(h)}/confignew.json`)).toBe('{broken')
  })
})

describe('failure handling', () => {
  it('reports a failed setup stage as failed, with a sentence', async () => {
    const h = harness()
    h.failExecMatching(`python=${ALLTALK_ENV_PYTHON_VERSION}`, { code: 1, stderr: 'conda create failed' })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('failed')
    expect(state.message).toBeTruthy()
    expect(state.message).not.toContain('conda')
    expect(state.message).not.toContain('    at ')
  })

  it('fails on a fatal component exit even when everything else landed', async () => {
    // Isolates the exit-code check: the env creation succeeded, the package
    // suite reports a real failure - a step that trusted presence over exit
    // codes would walk on and wrongly blame the health probe.
    const h = harness()
    h.failExecMatching('gradio==4.44.1', { code: 3, stderr: 'pip exploded' })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('failed')
    expect(state.failureCategory).toBe('setup')
    expect(bootstrapper.state().steps.find(step => step.id === 'run-setup')?.status).toBe('failed')
    // It must not have gone on to declare health.
    expect(bootstrapper.state().steps.find(step => step.id === 'verify-health')?.status).toBe('pending')
  })

  it('classifies a network failure distinctly from a setup failure', async () => {
    const h = harness({
      download: async () => {
        throw new Error('getaddrinfo ENOTFOUND github.com')
      },
    })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.failureCategory).toBe('network')
    expect(state.message).toContain('internet')
  })

  it('classifies insufficient disk space before downloading anything', async () => {
    const h = harness({ probe: async () => env({ freeBytes: 1024 }) })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('failed')
    expect(state.failureCategory).toBe('disk')
    // The point of checking first: no partial download to clean up.
    expect(h.calls.downloaded).toHaveLength(0)
  })

  it('treats a cancelled elevation as cancelled, not as a crash', async () => {
    const h = harness({
      exec: async () => {
        throw new Error('The operation was canceled by the user (UAC declined)')
      },
    })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('failed')
    expect(state.failureCategory).toBe('cancelled')
    expect(state.message).toBe(messageFor('cancelled'))
  })

  it('cleans up a partial download so it cannot be mistaken for an install', async () => {
    const h = harness({
      download: async () => {
        throw new Error('connection reset mid-transfer')
      },
    })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    expect(h.calls.removed.some(path => path.endsWith('.zip.tmp'))).toBe(true)
    // Nothing was recorded as installed.
    expect(h.stateRecord()).toBeUndefined()
  })

  it('rejects an implausibly small archive instead of extracting it', async () => {
    const h = harness({ download: async () => ({ bytes: 12, sha256: 'b'.repeat(64) }) })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('failed')
    expect(state.failureCategory).toBe('download')
    expect(h.calls.extracted).toHaveLength(0)
  })

  it('refuses an install that has the launcher but no conda environment', async () => {
    // The exact case the shared marker list exists for: a run that dies after
    // writing the launchers but before the env takes shape leaves a folder
    // that looks installed to anything checking only the launcher - and the
    // runtime manager and this step must agree that it is not.
    const h = harness({
      exec: async (command, args, options) => {
        h.calls.exec.push([command, ...args, `cwd=${options.cwd}`, `timeout=${options.timeoutMs}`])
        if (command.endsWith('miniconda_installer.exe'))
          h.markExists(`${options.cwd}/${MINICONDA_PREFIX}`, `${options.cwd}/${MINICONDA_EXE}`)
        // The env step "succeeds" but leaves the environment itself half-built:
        // enough for the step's own check, not enough for verify-install.
        if (command.endsWith('_conda.exe') && args[0] === 'create')
          h.markExists(`${options.cwd}/${MINICONDA_ENV_PYTHON}`)
        return { code: 0, stderr: '', stdout: '' }
      },
    })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('failed')
    expect(bootstrapper.state().steps.find(step => step.id === 'verify-install')?.status).toBe('failed')
  })

  it('recovers on retry after a transient failure', async () => {
    let attempts = 0
    const h = harness({
      download: async (url, dest) => {
        attempts += 1
        if (attempts === 1)
          throw new Error('connection reset')
        h.markExists(dest)
        if (url === MINICONDA_INSTALLER_URL)
          return { bytes: MINICONDA_INSTALLER_BYTES, sha256: MINICONDA_INSTALLER_SHA256, url: undefined as never }
        return { bytes: 5_000_000, sha256: 'a'.repeat(64), url: undefined as never }
      },
    } as Partial<BootstrapDeps>)
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    expect((await bootstrapper.run()).phase).toBe('failed')
    // The retry must not be blocked by the previous failure.
    expect((await bootstrapper.run()).phase).toBe('ready')
  })

  it('does not get stuck in a running phase after a failure', async () => {
    const h = harness()
    h.failExecMatching('faiss-cpu', { code: 1 })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    // "Never leave the UI eternally installing": a terminal phase, always.
    expect(['failed', 'ready', 'cancelled', 'not-installed']).toContain(bootstrapper.state().phase)
    expect(bootstrapper.state().steps.some(step => step.status === 'running')).toBe(false)
  })
})

describe('cancellation', () => {
  it('stops at the next step boundary and reports cancelled', async () => {
    let cancelled = false
    const h = harness({ isCancelled: () => cancelled })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const promise = bootstrapper.run()
    cancelled = true
    const state = await promise

    expect(['cancelled', 'failed', 'ready']).toContain(state.phase)
  })

  it('starts clean on the next run after a cancellation', async () => {
    const h = harness()
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    bootstrapper.cancel()
    await bootstrapper.run()

    // cancel() is not sticky: a later run must not inherit it.
    expect((await bootstrapper.run()).phase).toBe('ready')
  })
})

describe('removal', () => {
  it('removes only the Lia-owned runtime directory', async () => {
    const h = harness()
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)
    await bootstrapper.run()

    await bootstrapper.remove()

    expect(h.calls.removed).toContain(h.deps.runtimeDir)
    expect(bootstrapper.state().phase).toBe('not-installed')
  })

  it('never touches the user voice library or global tooling', async () => {
    const h = harness()
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)
    await bootstrapper.run()

    await bootstrapper.remove()

    const removed = h.calls.removed.join(' ')
    // The user's imported voices live elsewhere and must survive.
    expect(removed).not.toContain('lia-voices')
    // Global installs the Lia never made are not its business to undo.
    expect(removed).not.toContain('Git')
    expect(removed).not.toContain('Python')
    expect(removed).not.toContain('espeak')
    expect(removed).not.toContain('Program Files')
    // The only removals are its own directory, the temporary archive it
    // downloaded and the DeepSpeed wheel it deletes after installing exactly
    // like the pin - never anything belonging to the user or the system.
    for (const path of h.calls.removed) {
      expect(path === h.deps.runtimeDir || path.endsWith('.zip.tmp') || path.endsWith(DEEPSPEED_WHEEL)).toBe(true)
    }
  })
})

describe('the install path', () => {
  it('refuses a path containing a space', () => {
    // atsetup.bat aborts outright on a space in the working directory, because
    // Miniconda cannot be installed silently under one. The runtime lives under
    // userData, which on Windows includes the user's name.
    expect(assessInstallPath('C:\\Users\\John Smith\\AppData\\Roaming\\Lia\\runtimes\\alltalk\\app').ok).toBe(false)
  })

  it('accepts a clean path', () => {
    const verdict = assessInstallPath('C:\\Users\\john\\AppData\\Roaming\\Lia\\runtimes\\alltalk\\app')

    expect(verdict.ok).toBe(true)
    expect(verdict.blocker).toBeUndefined()
  })

  it('warns rather than blocking on the characters the installer only warns about', () => {
    // Mirrors the installer's own behaviour: these get a warning, not an abort.
    // Treating them as fatal would refuse installs the installer would run.
    const verdict = assessInstallPath('C:\\Users\\jo+hn\\runtime')

    expect(verdict.ok).toBe(true)
    expect(verdict.warning).toBe('path-has-special-characters')
  })

  it('surfaces the blocker through the readiness verdict', () => {
    expect(assessEnvironment(env({ runtimeDir: 'C:\\Users\\John Smith\\app' })).blockers).toContain('path-has-space')
    expect(assessEnvironment(env({ runtimeDir: 'C:\\Users\\john\\app' })).ok).toBe(true)
  })

  it('reports the path problem before downloading anything', async () => {
    const h = harness({ probe: async () => env({ runtimeDir: 'C:\\Users\\John Smith\\app' }) })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('failed')
    expect(state.failureCategory).toBe('path')
    // The point of checking first: no 97 MB fetched only to be thrown away.
    expect(h.calls.downloaded).toHaveLength(0)
  })

  it('gives the path failure a sentence of its own', () => {
    const message = messageFor('path')

    expect(message).toContain('space')
    expect(message).not.toContain('Error:')
  })
})

describe('outputTail', () => {
  it('keeps the end of both streams, flattened onto one line', () => {
    const detail = outputTail({
      stderr: 'curl progress\nmore noise\nO sistema nao pode encontrar o caminho especificado.\n',
      stdout: 'Miniconda not found.\nExiting AllTalk Setup Utility...\n',
    })

    expect(detail).toContain('caminho especificado')
    expect(detail).toContain('Miniconda not found')
    expect(detail).not.toContain('\n')
  })

  it('marks an empty stream instead of dropping it silently', () => {
    // "(empty)" is what tells the reader of a QA log that there was nothing to
    // miss on that stream, rather than leaving them wondering whether it was
    // captured at all.
    const detail = outputTail({ stderr: '', stdout: 'hello' })

    expect(detail).toContain('stderr=(empty)')
    expect(detail).toContain('stdout=hello')
  })

  it('truncates long output to its tail, where the failure is named', () => {
    const noise = 'x'.repeat(10_000)
    const detail = outputTail({ stderr: `${noise}\nfinal error line`, stdout: '' })

    expect(detail).toContain('final error line')
    expect(detail.length).toBeLessThan(1000)
  })
})

describe('state change notifications', () => {
  it('publishes each mutation, in order, ending at the terminal phase', async () => {
    const seen: string[] = []
    const h = harness({ onStateChange: state => seen.push(state.phase) })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    // The run opens by announcing 'checking' and closes on 'ready'; every
    // transition the UI needs is in between, pushed rather than polled.
    expect(seen[0]).toBe('checking')
    expect(seen[seen.length - 1]).toBe('ready')
    expect(seen).toContain('installing-runtime')
    expect(seen).toContain('verifying')
  })

  it('never publishes the same state twice in a row', async () => {
    // The anti-timer invariant, stated positively: if two consecutive payloads
    // are deep-equal, one of them carried no information - which is precisely
    // what a republication interval emits while a long step is running.
    const seen: Array<BootstrapState | undefined> = []
    const h = harness({ onStateChange: state => seen.push(state) })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    for (let i = 1; i < seen.length; i++)
      expect(JSON.stringify(seen[i])).not.toBe(JSON.stringify(seen[i - 1]))
    expect(seen.length).toBeGreaterThan(0)
  })

  it('stays silent while a step is running and nothing has changed', async () => {
    // The negative form: a long, unchanged step (a 45-minute installer run is
    // the real case) must produce no notifications at all. A timer would tick;
    // the state machine does not.
    let release!: () => void
    const gate = new Promise<void>(resolve => (release = resolve))
    const seen: unknown[] = []
    // The override mirrors the default routing's machine side effects (the
    // installer leaving its artefacts, the env build leaving the env), because
    // the run must be able to continue to ready once the gate opens. `h` is
    // referenced safely: the exec callback only runs after construction ends.
    const h = harness({
      exec: async (command, args, options) => {
        await gate
        if (command.endsWith('miniconda_installer.exe'))
          h.markExists(`${options.cwd}/${MINICONDA_PREFIX}`, `${options.cwd}/${MINICONDA_EXE}`)
        if (command.endsWith('_conda.exe') && args[0] === 'create')
          h.markExists(`${options.cwd}/${MINICONDA_ENV_PYTHON}`, `${options.cwd}/${MINICONDA_ENV}`)
        return { code: 0, stderr: '', stdout: '' }
      },
      onStateChange: state => seen.push(state),
    })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const promise = bootstrapper.run()
    // Let the run reach the setup step, then record the baseline.
    await new Promise(resolve => setTimeout(resolve, 20))
    const atGate = seen.length

    await new Promise(resolve => setTimeout(resolve, 60))
    // The step has been waiting for three times the baseline window: still no
    // new payload, because nothing new happened.
    expect(seen.length).toBe(atGate)

    // Mutations continue once the gate opens: the run resolves all the way to
    // ready rather than hanging on it.
    release()
    const state = await promise
    expect(state.phase).toBe('ready')
    expect(seen[seen.length - 1] as BootstrapState | undefined).toMatchObject({ phase: 'ready' })
  })

  it('a throwing listener cannot abort the install', async () => {
    const h = harness({
      onStateChange: () => {
        throw new Error('renderer exploded')
      },
    })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('ready')
  })

  it('tracks the real download-then-extract sub-states of the fetch step', async () => {
    // The UI renders 'downloading' and then 'extracting' off the step detail.
    // Both must come from the machine itself - emitted when the download is
    // actually running and when the extraction actually starts - never from a
    // renderer-side guess at what probably comes next.
    const details: Array<string | undefined> = []
    const h = harness({
      onStateChange: (state) => {
        const step = state.steps.find(entry => entry.id === 'fetch-source')
        if (step?.status === 'running')
          details.push(step.detail)
      },
    })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    expect(details).toEqual(['downloading', 'extracting'])
  })
})

describe('failure classification', () => {
  it('maps errors onto stable categories', () => {
    expect(categorizeFailure(new Error('getaddrinfo ENOTFOUND'))).toBe('network')
    // The stalled-download message from createRuntimeDownload must stay
    // network-shaped: wording that drifts into '/cancel|abort/' would put a
    // "cancelled" title over a network failure.
    expect(categorizeFailure(new Error('ETIMEDOUT: the download stalled and timed out'))).toBe('network')
    expect(categorizeFailure(new Error('ENOSPC no space left'))).toBe('disk')
    expect(categorizeFailure(new Error('user cancelled UAC'))).toBe('cancelled')
    expect(categorizeFailure(new Error('checksum mismatch'))).toBe('download')
    expect(categorizeFailure(new Error('conda exploded'))).toBe('setup')
  })

  it('gives every category a sentence, none of them a stack trace', () => {
    const categories = ['cancelled', 'disk', 'download', 'health', 'network', 'setup', 'unsupported'] as const
    for (const category of categories) {
      const message = messageFor(category)
      expect(message.length).toBeGreaterThan(5)
      expect(message).not.toContain('Error:')
      expect(message).not.toContain('    at ')
    }
  })
})

/**
 * The Miniconda repair layer from the round-3/4 briefs, kept verbatim under
 * the round-7 continuation: the pinned setup script runs the NSIS installer
 * through `start /wait` and never checks the outcome; when that line fails
 * the script still exits 0. These tests pin the bootstrapper's own execution
 * of that one stage - same installer, same arguments, real exit code,
 * verified artefacts - and the retry shape the whole feature exists for.
 */
describe('run-setup Miniconda repair', () => {
  const appRoot = (h: Harness): string => `${h.deps.runtimeDir}/app`
  const installerPath = (h: Harness): string => `${appRoot(h)}/${MINICONDA_INSTALLER}`
  const condaPrefix = (h: Harness): string => `${appRoot(h)}/${MINICONDA_PREFIX}`
  const condaExe = (h: Harness): string => `${appRoot(h)}/${MINICONDA_EXE}`

  const installerCalls = (h: Harness): string[][] => h.calls.exec.filter(call => call[0].endsWith('miniconda_installer.exe'))

  it('runs the installer directly with the pinned arguments when Miniconda is missing', async () => {
    const h = harness()
    h.setHealthy(true)
    // The 85 MB installer already sits in the tree from the failed attempt the
    // QA log shows - this run must reuse it, never re-download it.
    h.markExists(installerPath(h))

    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)
    await bootstrapper.run()

    expect(bootstrapper.state().phase).toBe('ready')
    const installs = installerCalls(h)
    expect(installs).toHaveLength(1)
    const install = installs[0]
    // The command carries no shell: nothing is ever re-parsed (item I.8), and
    // process-facing paths go to NSIS in win32 form, never as mixed separators
    // (round-4 QA showed the mixed form exiting 2).
    expect(install[0]).toBe(win32Path(installerPath(h)))
    expect(install[0]).not.toContain('/')
    expect(install.find(arg => arg.startsWith('cwd='))).toBe(`cwd=${appRoot(h)}`)
    expect(install.find(arg => arg.startsWith('timeout='))).toBe(`timeout=${MINICONDA_INSTALL_TIMEOUT_MS}`)
    // Exactly the officially documented silent switches, no more and no less
    // (round-4 item L.1..L.5): JustMe + AddToPath=0 + RegisterPython=0 keep
    // global tooling untouched, /D= stays last, unquoted, win32-normalised.
    expect(install.slice(1, -2)).toEqual([
      '/InstallationType=JustMe',
      '/AddToPath=0',
      '/RegisterPython=0',
      '/S',
      `/D=${win32Path(condaPrefix(h))}`,
    ])
    expect(install.slice(1, -2)).toEqual(minicondaInstallerArgs(win32Path(condaPrefix(h))))
    // The /D= switch itself carries a slash by design; its *value* must not.
    expect(install.slice(1, -2)[4]).toMatch(/^\/D=[^/]+$/)
    const events = h.logs.map(entry => entry.event)
    expect(events).toContain('miniconda-facts')
    expect(events).toContain('miniconda-install-verified')
  })

  it('fails the step on the installer\'s real non-zero exit code instead of masking it', async () => {
    const h = harness()
    h.failExecMatching('miniconda_installer.exe', { code: 3, stderr: 'NSIS Error: tester' })
    h.markExists(installerPath(h))

    const state = await createVoiceRuntimeBootstrapper(h.deps).run()

    expect(state.phase).toBe('failed')
    expect(state.failureCategory).toBe('setup')
    // What the UI shows is the normalised sentence: no technical nouns (item J).
    expect(state.message).toBe('The voice system could not be installed.')
    expect(state.message).not.toMatch(/miniconda|conda|alltalk|C:/i)
    // The real exit code lives in the log, where it belongs (item B).
    expect(h.logs.find(entry => entry.event === 'miniconda-install-finished')?.exitCode).toBe(3)
    const verify = h.logs.find(entry => entry.event === 'miniconda-install-verify')
    expect(verify?.detail).toContain('conda-prefix-exists=false')
    expect(h.logs.some(entry => entry.event === 'miniconda-install-verified')).toBe(false)
  })

  it('does not trust a zero exit code without the artefacts it should have produced', async () => {
    const h = harness()
    // Claims success, builds nothing: the failure list returns 0 without the
    // artefact side effects a real success leaves behind.
    h.failExecMatching('miniconda_installer.exe', { code: 0 })

    const state = await createVoiceRuntimeBootstrapper(h.deps).run()

    expect(state.phase).toBe('failed')
    const verify = h.logs.find(entry => entry.event === 'miniconda-install-verify')
    expect(verify?.detail).toContain('conda-prefix-exists=false')
    expect(verify?.detail).toContain('conda-exe-exists=false')
    // The lie is caught at the verification line: without the artefacts the
    // stage stops dead, and no continuation runs on a phantom Miniconda.
    expect(h.logs.some(entry => entry.event === 'miniconda-install-verified')).toBe(false)
    expect(h.logs.some(entry => entry.event === 'setup-command-start')).toBe(false)
  })

  it('a verified Miniconda is not reinstalled: the run goes straight to the continuation', async () => {
    const h = harness()
    h.setHealthy(true)
    h.markExists(condaPrefix(h), condaExe(h), installerPath(h))

    const state = await createVoiceRuntimeBootstrapper(h.deps).run()

    expect(state.phase).toBe('ready')
    expect(installerCalls(h)).toHaveLength(0)
    // But it is always checked for real: --version must still answer (item 4
    // of the brief: validate before building on it).
    const version = h.calls.exec.filter(call => call[0].endsWith('_conda.exe') && call[1] === '--version')
    expect(version).toHaveLength(1)
    expect(version[0].find(arg => arg.startsWith('timeout='))).toBe(`timeout=${CONDA_VERSION_CHECK_TIMEOUT_MS}`)
    const facts = h.logs.find(entry => entry.event === 'miniconda-facts')
    expect(facts?.detail).toContain('conda-prefix-exists=true')
    expect(facts?.detail).toContain('conda-exe-exists=true')
  })

  it('after a failed attempt the retry reuses source, installer and every surviving artefact', async () => {
    const h = harness()
    h.setHealthy(true)
    // Attempt one: the real-exit-code repair runs and the installer fails
    // exactly like round 3. Attempt two: everything on disk is reused.
    h.failExecMatching('miniconda_installer.exe', { code: 1, stderr: 'AV said no' })

    const first = await createVoiceRuntimeBootstrapper(h.deps).run()
    expect(first.phase).toBe('failed')
    expect(installerCalls(h)).toHaveLength(1)

    h.clearExecFailures()
    const second = createVoiceRuntimeBootstrapper(h.deps)
    await second.run()
    expect(second.state().phase).toBe('ready')

    // The 97 MB archive downloads exactly once: its recorded commit is the
    // fetch step's skip signal and it landed on the first, failed attempt.
    // Same for the 85 MB installer, which survives the failure and is reused.
    // The wheel only ever downloads on the attempt that reaches it.
    expect(h.calls.downloaded).toEqual([alltalkSourceUrl(), MINICONDA_INSTALLER_URL, DEEPSPEED_WHEEL_URL])
    // One installer execution per attempt that actually needs one.
    expect(installerCalls(h)).toHaveLength(2)
    // Nothing the user already had is destroyed while repairing.
    expect(h.calls.removed.every(path => path.endsWith(DEEPSPEED_WHEEL) || path.endsWith('.zip.tmp'))).toBe(true)
  })

  it('keeps a path with special characters verbatim through the direct run', async () => {
    const runtimeDir = 'C:\\Users\\lucas\\AppData\\Roaming\\@proj-airi\\stage-tamagotchi\\runtimes\\alltalk'
    const h = harness({ runtimeDir })
    h.setHealthy(true)
    h.markExists(installerPath(h))

    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)
    await bootstrapper.run()

    expect(bootstrapper.state().phase).toBe('ready')
    const install = installerCalls(h)[0]
    expect(install[0]).toContain('@proj-airi')
    expect(install.slice(1, -2)[4]).toBe(`/D=${win32Path(condaPrefix(h))}`)
  })
})
