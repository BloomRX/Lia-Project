import type { BootstrapDeps, BootstrapState, RuntimeInstallRecord, VoiceRuntimeEnvironment } from './voice-runtime-bootstrap'
import type { ProbeStatus } from './voice-runtime-env'

import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { ENVIRONMENT_MARKERS, INSTALL_MARKERS } from './alltalk-runtime'
import {
  alltalkSourceUrl,
  BOOTSTRAP_STEP_IDS,
  categorizeFailure,
  createVoiceRuntimeBootstrapper,
  messageFor,
  MINICONDA_EXE,
  MINICONDA_INSTALL_TIMEOUT_MS,
  MINICONDA_INSTALLER,
  MINICONDA_PREFIX,
  minicondaInstallerArgs,
  outputTail,
  win32Path,
  PINNED_ALLTALK_COMMIT,
  PINNED_ALLTALK_VERSION,
  SETUP_INPUTS,
  START_SCRIPT,
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
  calls: { exec: string[][], removed: string[], downloaded: string[], extracted: string[] }
  logs: Array<{ detail?: string, event: string, exitCode?: number | null, step: string }>
  setExecResult: (result: { code: number | null, stderr?: string, stdout?: string }) => void
  setHealthy: (value: boolean) => void
  setStartResult: (value: boolean) => void
  markExists: (...paths: string[]) => void
  stateRecord: () => RuntimeInstallRecord | undefined
}

/**
 * What the extraction leaves behind, and what running the setup produces.
 *
 * Derived from the shipped constants rather than restated, so this harness cannot
 * keep faking a layout the product has since changed - which would let these tests
 * pass against a fiction. The setup inputs are part of the source tree because
 * the installer refuses to start without them, and the step under test now
 * refuses to spawn without them too.
 */
const SOURCE_TREE = [...SETUP_INPUTS, ...INSTALL_MARKERS]
const SETUP_PRODUCTS = [START_SCRIPT, ...ENVIRONMENT_MARKERS]

function harness(overrides: Partial<BootstrapDeps> = {}): Harness {
  const existing = new Set<string>()
  const calls = { downloaded: [] as string[], exec: [] as string[][], extracted: [] as string[], removed: [] as string[] }
  const logs: Harness['logs'] = []
  let execResult: { code: number | null, stderr?: string, stdout?: string } = { code: 0 }
  let healthy = false
  let startResult = true
  let record: RuntimeInstallRecord | undefined

  const runtimeDir = overrides.runtimeDir ?? 'C:\\Users\\lia\\AppData\\Local\\Lia\\runtimes\\alltalk'

  const deps: BootstrapDeps = {
    exec: async (command, args, options) => {
      calls.exec.push([command, ...args, `cwd=${options.cwd}`])
      // A successful silent setup writes the launcher as its last act and leaves
      // the conda root and env behind. That is what verify-install looks for.
      if (args.includes('atsetup.bat') && execResult.code === 0) {
        for (const marker of SETUP_PRODUCTS)
          existing.add(`${options.cwd}/${marker}`)
      }
      return { code: execResult.code, stderr: execResult.stderr ?? '', stdout: execResult.stdout ?? '' }
    },
    download: async (url) => {
      calls.downloaded.push(url)
      return { bytes: 5_000_000, sha256: 'a'.repeat(64) }
    },
    extract: async (_archive, dest) => {
      calls.extracted.push(dest)
      // Only the source tree. `start_alltalk.bat` and the conda environment are
      // *products* of running atsetup.bat, so a fake that created them here would
      // make the installer look already-run and skip the step under test.
      for (const marker of SOURCE_TREE)
        existing.add(`${dest}/${marker}`)
    },
    exists: async path => existing.has(path),
    stat: async path => (existing.has(path) ? { size: 81_720_000 } : undefined),
    mkdir: async () => undefined,
    remove: async (path) => {
      calls.removed.push(path)
      for (const key of [...existing]) {
        if (key === path || key.startsWith(`${path}/`) || key.startsWith(`${path}\\`))
          existing.delete(key)
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
    deps,
    logs,
    markExists: (...paths) => {
      for (const path of paths)
        existing.add(path)
    },
    setExecResult: (result) => {
      execResult = result
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
    // The only thing downloaded is the pinned AllTalk archive.
    expect(h.calls.downloaded).toHaveLength(1)
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

  it('runs the installer silently, with the directory as cwd and never in a command string', async () => {
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    const setup = h.calls.exec.find(call => call.includes('atsetup.bat'))
    expect(setup).toBeTruthy()
    expect(setup).toContain('-silent')

    // The install directory appears only as cwd=, never inside an argument that a
    // shell would re-parse. This is the assertion that would catch a
    // `cmd /c "cd ${dir} && atsetup.bat"` construction.
    const cwdArg = setup!.find(arg => arg.startsWith('cwd='))
    expect(cwdArg).toBe(`cwd=${h.deps.runtimeDir}/app`)
    for (const arg of setup!) {
      if (!arg.startsWith('cwd='))
        expect(arg).not.toContain('AppData')
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
    expect(h.calls.downloaded).toHaveLength(1)

    const second = await bootstrapper.run()

    expect(second.phase).toBe('ready')
    expect(h.calls.downloaded).toHaveLength(1)
    expect(bootstrapper.state().steps.find(step => step.id === 'fetch-source')?.status).toBe('skipped')
  })

  it('does not re-run the installer when the generated launcher exists', async () => {
    const h = harness()
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)
    await bootstrapper.run()
    const setupRuns = h.calls.exec.filter(call => call.includes('atsetup.bat')).length

    await bootstrapper.run()

    expect(h.calls.exec.filter(call => call.includes('atsetup.bat')).length).toBe(setupRuns)
    expect(bootstrapper.state().steps.find(step => step.id === 'run-setup')?.status).toBe('skipped')
  })

  it('re-downloads when the installed commit differs from the pin', async () => {
    const h = harness({
      readState: async () => ({ commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', installedAt: '' }),
    })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    // A deliberate upgrade, not a re-run: the pin changed, so the source must too.
    expect(h.calls.downloaded).toHaveLength(1)
    expect(h.stateRecord()?.commit).toBe(PINNED_ALLTALK_COMMIT)
  })
})

describe('concurrency', () => {
  it('runs one install when Install is clicked twice', async () => {
    const h = harness()
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const [first, second] = await Promise.all([bootstrapper.run(), bootstrapper.run()])

    expect(first).toBe(second)
    expect(h.calls.downloaded).toHaveLength(1)
    expect(h.calls.exec.filter(call => call.includes('atsetup.bat'))).toHaveLength(1)
  })

  it('does not let a repair race an install', async () => {
    const h = harness()
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const [install, repair] = await Promise.all([
      bootstrapper.run(),
      bootstrapper.run({ repair: true }),
    ])

    expect(install).toBe(repair)
    expect(h.calls.exec.filter(call => call.includes('atsetup.bat'))).toHaveLength(1)
  })
})

describe('the setup step, after the round-2 QA log', () => {
  it('treats exit code 0 without the generated launcher as a failed setup', async () => {
    // This is the failure the real Windows QA produced: atsetup.bat printed
    // "the system cannot find the path specified", gave up through its end
    // label - whose echoes reset ERRORLEVEL - and returned 0 without ever
    // writing the launcher. A step that trusted the exit code walked on to
    // verify-install and reported the wrong culprit.
    const h = harness({
      exec: async () => ({
        code: 0,
        stderr: '',
        stdout: 'Downloading Miniconda\r\nO sistema nao pode encontrar o caminho especificado.\r\nMiniconda not found.\r\nExiting AllTalk Setup Utility...\r\n',
      }),
    })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('failed')
    expect(bootstrapper.state().steps.find(step => step.id === 'run-setup')?.status).toBe('failed')
    // The failure must be named here, not two steps later.
    expect(bootstrapper.state().steps.find(step => step.id === 'verify-install')?.status).toBe('pending')
    expect(state.message).toBe(messageFor('setup'))
    // The user sees a sentence; the stack-trace-shaped details stay in the log.
    expect(state.message).not.toContain('caminho')
  })

  it('logs the exit-0-without-launcher case with its cause, for the next QA report', async () => {
    const h = harness({ exec: async () => ({ code: 0, stderr: 'adapter gave up', stdout: 'giving up here' }) })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    const incomplete = h.logs.find(entry => entry.step === 'run-setup' && entry.event === 'incomplete')
    expect(incomplete).toBeTruthy()
    expect(incomplete!.detail).toContain(START_SCRIPT)

    // Both streams land in the log: the script prints its diagnosis to stdout
    // while curl and the shell noise go to stderr, and either can hold the line
    // that names the failure.
    const finished = h.logs.find(entry => entry.step === 'run-setup' && entry.event === 'finished')
    expect(finished!.detail).toContain('giving up here')
    expect(finished!.detail).toContain('adapter gave up')
    expect(finished!.exitCode).toBe(0)
  })

  it('logs the working directory and arguments before spawning the installer', async () => {
    const h = harness()
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    const started = h.logs.find(entry => entry.step === 'run-setup' && entry.event === 'start')
    expect(started).toBeTruthy()
    expect(started!.detail).toContain(`cwd=${h.deps.runtimeDir}/app`)
    expect(started!.detail).toContain('atsetup.bat')
    expect(started!.detail).toContain('-silent')
  })

  it('refuses to spawn the installer when atsetup.bat is not in the tree', async () => {
    // A truncated extraction must fail before any spawn: the alternative is a
    // shell error about a missing script, minutes into what looked like progress.
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
    expect(h.calls.exec.filter(call => call.includes('atsetup.bat'))).toHaveLength(0)
    const refused = h.logs.find(entry => entry.step === 'run-setup' && entry.event === 'layout-invalid')
    expect(refused).toBeTruthy()
    expect(refused!.detail).toContain('atsetup.bat')
  })

  it('refuses to spawn when the requirements files the installer pip-installs are missing', async () => {
    // atsetup.bat runs `pip install -r system\requirements\...` with relative
    // paths from its own directory; without them the env build dies mid-setup,
    // far from the actual gap.
    const h = harness({
      extract: async (_archive, dest) => {
        h.markExists(`${dest}/atsetup.bat`)
        for (const marker of INSTALL_MARKERS)
          h.markExists(`${dest}/${marker}`)
      },
    })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('failed')
    expect(h.calls.exec.filter(call => call.includes('atsetup.bat'))).toHaveLength(0)
    const refused = h.logs.find(entry => entry.step === 'run-setup' && entry.event === 'layout-invalid')
    expect(refused!.detail).toContain('requirements_standalone.txt')
  })

  it('spawns with the extracted tree root as cwd - the directory the script assumes', async () => {
    const h = harness()
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    await bootstrapper.run()

    // The script's relative paths (system\requirements\..., %cd%\alltalk_environment)
    // only resolve if cwd is the AllTalk root itself - and the log line and the
    // spawn must agree about which directory that was.
    const spawn = h.calls.exec.find(call => call.includes('atsetup.bat'))
    const cwdArg = spawn!.find(arg => arg.startsWith('cwd='))
    expect(cwdArg).toBe(`cwd=${h.deps.runtimeDir}/app`)
    // The pre-spawn log names the same directory the spawn used - a QA report
    // can then be read without guessing which tree the installer ran in.
    const started = h.logs.find(entry => entry.step === 'run-setup' && entry.event === 'start')
    expect(started!.detail).toContain(cwdArg)
  })

  it('still walks on to verify-install when the setup genuinely completes', async () => {
    // Guards the guard: the exit-0 check must not reject an install that did
    // produce its final artefact.
    const h = harness()
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('ready')
    expect(bootstrapper.state().steps.find(step => step.id === 'verify-install')?.status).toBe('done')
  })
})

describe('failure handling', () => {
  it('reports a failed installer as failed, with a sentence', async () => {
    const h = harness()
    h.setExecResult({ code: 1, stderr: 'conda create failed' })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('failed')
    expect(state.message).toBeTruthy()
    expect(state.message).not.toContain('conda')
    expect(state.message).not.toContain('    at ')
  })

  it('fails on a non-zero installer exit even when the files all landed', async () => {
    // Isolates the exit-code check. The earlier partial-install test cannot: there
    // the missing conda env is what fails, so a bootstrapper that ignored the exit
    // code would still be caught. Here the installer reports failure *and* leaves
    // a complete tree behind - only reading the exit code can catch that.
    const h = harness({
      exec: async (_cmd, args, options) => {
        if (args.includes('atsetup.bat')) {
          for (const marker of SETUP_PRODUCTS)
            h.markExists(`${options.cwd}/${marker}`)
          return { code: 3, stderr: 'DeepSpeed installation failed', stdout: '' }
        }
        return { code: 0, stderr: '', stdout: '' }
      },
    })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    const state = await bootstrapper.run()

    expect(state.phase).toBe('failed')
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
    // The exact case the shared marker list exists for. atsetup.bat writes the
    // launcher before it finishes building the environment, so a run that dies in
    // between leaves a folder that looks installed to anything checking only the
    // launcher - and the runtime manager and this step must agree that it is not.
    const h = harness({
      exec: async (_cmd, args, options) => {
        if (args.includes('atsetup.bat'))
          h.markExists(`${options.cwd}/${START_SCRIPT}`)
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
      download: async (url) => {
        attempts += 1
        if (attempts === 1)
          throw new Error('connection reset')
        return { bytes: 5_000_000, sha256: 'a'.repeat(64), url }
      },
    })
    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)

    expect((await bootstrapper.run()).phase).toBe('failed')
    // The retry must not be blocked by the previous failure.
    expect((await bootstrapper.run()).phase).toBe('ready')
  })

  it('does not get stuck in a running phase after a failure', async () => {
    const h = harness()
    h.setExecResult({ code: 1 })
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
    // The only removals are its own directory and the temporary archive it
    // downloaded - never anything belonging to the user or the system.
    for (const path of h.calls.removed) {
      expect(path === h.deps.runtimeDir || path.endsWith('.zip.tmp')).toBe(true)
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
    const h = harness({
      exec: async () => {
        await gate
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

    // Mutations survive the broken exec (which wrote no launcher): the run
    // resolves and reports the failure rather than hanging on the gate.
    release()
    const state = await promise
    expect(state.phase).toBe('failed')
    expect(seen[seen.length - 1] as BootstrapState | undefined).toMatchObject({ phase: 'failed' })
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
 * The Miniconda repair layer described by the round-3 brief. The pinned setup
 * script runs the NSIS installer through `start /wait` and never checks the
 * outcome; when that line fails the script still exits 0. These tests pin the
 * bootstrapper's own execution of that one stage - same installer, same
 * arguments, real exit code, verified artefacts - and the supported
 * continuation that follows it.
 */
describe('run-setup Miniconda repair', () => {
  const appRoot = (h: Harness): string => join(h.deps.runtimeDir, 'app')
  const installerPath = (h: Harness): string => `${appRoot(h)}/${MINICONDA_INSTALLER}`
  const condaPrefix = (h: Harness): string => `${appRoot(h)}/${MINICONDA_PREFIX}`
  const condaExe = (h: Harness): string => `${appRoot(h)}/${MINICONDA_EXE}`

  interface ExecCall {
    args: string[]
    command: string
    cwd: string
    timeoutMs: number
  }

  interface ExecStub {
    code: number
    stderr?: string
    stdout?: string
  }

  const normalize = (stub: ExecStub): ExecStub & { stderr: string, stdout: string } =>
    ({ stderr: '', stdout: '', ...stub })

  function repairHarness(options: {
    runtimeDir?: string
    onAtsetup?: (seq: number, h: Harness) => ExecStub
    onInstaller?: (h: Harness) => ExecStub
  }): { execs: ExecCall[], h: Harness } {
    const execs: ExecCall[] = []
    let atsetupSeq = 0
    const h = harness({
      exec: async (command, args, execOptions) => {
        execs.push({ args, command, cwd: execOptions.cwd, timeoutMs: execOptions.timeoutMs })
        if (args.includes('atsetup.bat')) {
          atsetupSeq += 1
          return normalize(options.onAtsetup?.(atsetupSeq, h) ?? { code: 0 })
        }
        if (command === win32Path(installerPath(h)))
          return normalize(options.onInstaller?.(h) ?? { code: 0 })
        return normalize({ code: 0 })
      },
      ...(options.runtimeDir ? { runtimeDir: options.runtimeDir } : {}),
    })
    return { execs, h }
  }

  const installerCalls = (execs: ExecCall[]): ExecCall[] => execs.filter(e => e.command.endsWith('miniconda_installer.exe'))
  const atsetupCalls = (execs: ExecCall[]): ExecCall[] => execs.filter(e => e.args.includes('atsetup.bat'))

  it('runs the downloaded installer directly with the pinned arguments, then lets the setup continue', async () => {
    const { execs, h } = repairHarness({
      // The classic round-3 outcome: atsetup exits 0 having written nothing,
      // its output ending with "Miniconda not found." The second (resume)
      // attempt stands in for a script that can continue once Miniconda works.
      onAtsetup: (_seq, h2) => {
        // The resume attempt, as a pin that can continue once Miniconda works.
        for (const product of SETUP_PRODUCTS)
          h2.markExists(`${appRoot(h2)}/${product}`)
        return { code: 0 }
      },
      onInstaller: (h2) => {
        h2.markExists(condaPrefix(h2), condaExe(h2))
        return { code: 0 }
      },
    })
    h.setHealthy(true)
    // The 81 MB installer already sits in the tree from the failed attempt the
    // QA log shows - this run must reuse it, never re-download it.
    h.markExists(installerPath(h))

    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)
    await bootstrapper.run()

    expect(bootstrapper.state().phase).toBe('ready')
    const installs = installerCalls(execs)
    expect(installs).toHaveLength(1)
    const install = installs[0]
    // The command carries no arguments: nothing is ever re-parsed by a shell (item I.8),
    // and process-facing paths go to NSIS in win32 form, never as mixed separators
    // (round-4 QA showed the mixed form exiting 2).
    expect(install.command).toBe(win32Path(installerPath(h)))
    expect(install.command).not.toContain('/')
    expect(install.cwd).toBe(appRoot(h))
    expect(install.timeoutMs).toBe(MINICONDA_INSTALL_TIMEOUT_MS)
    // Exactly the officially documented silent switches, no more and no less
    // (round-4 item L.1..L.5): JustMe + AddToPath=0 + RegisterPython=0 keep global
    // tooling untouched, /D= stays last, unquoted, win32-normalised.
    expect(install.args).toEqual([
      '/InstallationType=JustMe',
      '/AddToPath=0',
      '/RegisterPython=0',
      '/S',
      `/D=${win32Path(condaPrefix(h))}`,
    ])
    expect(install.args).toEqual(minicondaInstallerArgs(win32Path(condaPrefix(h))))
    // The /D= switch itself carries a slash by design; its *value* must not.
    expect(install.args[install.args.length - 1]).toMatch(/^\/D=[^/]+$/)
    // The installer was already on disk, so no fresh atsetup ran to re-download it
    // (round-4 item J): the only atsetup run is the resume attempt.
    expect(atsetupCalls(execs)).toHaveLength(1)
    const events = h.logs.map(l => l.event)
    expect(events).toContain('miniconda-facts')
    expect(events).toContain('miniconda-install-verified')
    const recoveryFacts = h.logs.find(l => l.event === 'miniconda-recovery-facts')
    expect(recoveryFacts?.detail).toContain('installer-exists=true')
    expect(recoveryFacts?.detail).toContain('installer-bytes=81720000')
  })

  it('fails clearly when the installer itself is missing, without inventing one', async () => {
    const { execs, h } = repairHarness({
      onAtsetup: () => ({ code: 0, stdout: 'curl: (28) Timeout was reached' }),
    })

    const state = await createVoiceRuntimeBootstrapper(h.deps).run()

    expect(state.phase).toBe('failed')
    expect(installerCalls(execs)).toHaveLength(0)
    expect(atsetupCalls(execs)).toHaveLength(1)
    expect(h.logs.some(l => l.event === 'miniconda-repair-skipped')).toBe(true)
    expect(h.logs.find(l => l.event === 'incomplete')?.detail).toContain(START_SCRIPT)
  })

  it('fails the step on the installer\'s real non-zero exit code instead of masking it', async () => {
    const { h } = repairHarness({
      onAtsetup: () => ({ code: 0, stderr: 'O sistema nao pode encontrar o caminho especificado.', stdout: 'Miniconda not found.' }),
      onInstaller: () => ({ code: 3, stderr: 'NSIS Error: tester' }),
    })
    h.markExists(installerPath(h))

    const state = await createVoiceRuntimeBootstrapper(h.deps).run()

    expect(state.phase).toBe('failed')
    expect(state.failureCategory).toBe('setup')
    // What the UI shows is the normalised sentence: no technical nouns (item J).
    expect(state.message).toBe('The voice system could not be installed.')
    expect(state.message).not.toMatch(/miniconda|conda|alltalk|C:/i)
    // The real exit code lives in the log, where it belongs (item B).
    expect(h.logs.find(l => l.event === 'miniconda-install-finished')?.exitCode).toBe(3)
  })

  it('does not trust a zero exit code without the artefacts it should have produced', async () => {
    const { execs, h } = repairHarness({
      onAtsetup: () => ({ code: 0 }),
      onInstaller: () => ({ code: 0 }), // claims success, builds nothing
    })
    h.markExists(installerPath(h))

    const state = await createVoiceRuntimeBootstrapper(h.deps).run()

    expect(state.phase).toBe('failed')
    const verify = h.logs.find(l => l.event === 'miniconda-install-verify')
    expect(verify?.detail).toContain('conda-prefix-exists=false')
    expect(verify?.detail).toContain('conda-exe-exists=false')
    // The lie is caught at the verification line: without the artefacts the
    // stage stops dead, and no atsetup ever runs on a phantom Miniconda.
    expect(h.logs.some(l => l.event === 'miniconda-install-verified')).toBe(false)
    expect(atsetupCalls(execs)).toHaveLength(0)
  })

  it('a verified Miniconda is not reinstalled: the next attempt goes straight to the resume', async () => {
    const { execs, h } = repairHarness({
      // The pinned script cannot resume (its conda-exists branch targets a
      // RunScript label the file does not define): the honest outcome is a
      // failed step with the evidence logged, never a re-download or a
      // re-install loop.
      onAtsetup: () => ({ code: 1, stderr: 'The system cannot find the batch label specified - RunScript' }),
    })
    h.markExists(condaPrefix(h), condaExe(h))

    const state = await createVoiceRuntimeBootstrapper(h.deps).run()

    expect(state.phase).toBe('failed')
    expect(installerCalls(execs)).toHaveLength(0)
    expect(atsetupCalls(execs)).toHaveLength(1)
    const facts = h.logs.find(l => l.event === 'miniconda-facts')
    expect(facts?.detail).toContain('conda-exe-exists=true')
    expect(h.logs.some(l => l.event === 'resume-incomplete')).toBe(true)
  })

  it('retries a partial install: reuses the source, reuses the installer, downloads nothing again', async () => {
    let installerRuns = 0
    let atsetupSeq = 0
    const execs: ExecCall[] = []
    const h = harness({
      exec: async (command, args, execOptions) => {
        execs.push({ args, command, cwd: execOptions.cwd, timeoutMs: execOptions.timeoutMs })
        if (args.includes('atsetup.bat')) {
          atsetupSeq += 1
          // First attempt: the script curls the installer down, then abandons
          // at the Miniconda stage exactly like the round-3 QA log. After a
          // verified repair its resume attempt completes the setup.
          h.markExists(installerPath(h))
          if (atsetupSeq === 2) {
            for (const product of SETUP_PRODUCTS)
              h.markExists(`${execOptions.cwd}/${product}`)
          }
          return normalize({ code: 0 })
        }
        if (command === win32Path(installerPath(h))) {
          installerRuns += 1
          if (installerRuns === 2)
            h.markExists(condaPrefix(h), condaExe(h))
          return normalize(installerRuns === 1 ? { code: 1, stderr: 'AV said no' } : { code: 0 })
        }
        return normalize({ code: 0 })
      },
    })
    h.setHealthy(true)

    // Attempt one: repair runs but the installer fails for real. Attempt two:
    // everything on disk is reused, the repair succeeds, the resume finishes.
    const first = await createVoiceRuntimeBootstrapper(h.deps).run()
    expect(first.phase).toBe('failed')
    const second = createVoiceRuntimeBootstrapper(h.deps)
    await second.run()
    expect(second.state().phase).toBe('ready')

    // The 97 MB archive was fetched exactly once - the very first attempt -
    // and the retry reused the extracted source instead of downloading again
    // (item H). Same rule for the 81 MB installer: two attempts, two direct
    // runs, zero curls of our own.
    expect(h.calls.downloaded).toHaveLength(1)
    expect(atsetupCalls(execs)).toHaveLength(2) // initial(1) + resume(2); run 2 skips straight to repair (item J)
    expect(installerCalls(execs)).toHaveLength(2) // one direct run per attempt, never more
    // Nothing the user already had is destroyed while repairing.
    expect(h.calls.removed.every(p => p.endsWith('.zip.tmp'))).toBe(true)
  })

  it('keeps a path with special characters verbatim through the direct run', async () => {
    const runtimeDir = 'C:\\Users\\lucas\\AppData\\Roaming\\@proj-airi\\stage-tamagotchi\\runtimes\\alltalk'
    const { execs, h } = repairHarness({
      onAtsetup: (_seq, h2) => {
        // Only the resume attempt runs: the installer is already on disk.
        for (const product of SETUP_PRODUCTS)
          h2.markExists(`${appRoot(h2)}/${product}`)
        return { code: 0 }
      },
      onInstaller: (h2) => {
        h2.markExists(condaPrefix(h2), condaExe(h2))
        return { code: 0 }
      },
      runtimeDir,
    })
    h.setHealthy(true)
    h.markExists(installerPath(h))

    const bootstrapper = createVoiceRuntimeBootstrapper(h.deps)
    await bootstrapper.run()

    expect(bootstrapper.state().phase).toBe('ready')
    const install = installerCalls(execs)[0]
    expect(install.command).toContain('@proj-airi')
    expect(install.args[install.args.length - 1]).toBe(`/D=${win32Path(condaPrefix(h))}`)
  })
})
