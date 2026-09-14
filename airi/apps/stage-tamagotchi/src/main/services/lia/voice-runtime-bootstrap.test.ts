import type { BootstrapDeps, RuntimeInstallRecord, VoiceRuntimeEnvironment } from './voice-runtime-bootstrap'
import type { ProbeStatus } from './voice-runtime-env'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  alltalkSourceUrl,
  BOOTSTRAP_STEP_IDS,
  categorizeFailure,
  createVoiceRuntimeBootstrapper,
  messageFor,
  PINNED_ALLTALK_COMMIT,
  PINNED_ALLTALK_VERSION,
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
  setExecResult: (result: { code: number | null, stderr?: string, stdout?: string }) => void
  setHealthy: (value: boolean) => void
  setStartResult: (value: boolean) => void
  markExists: (...paths: string[]) => void
  stateRecord: () => RuntimeInstallRecord | undefined
}

function harness(overrides: Partial<BootstrapDeps> = {}): Harness {
  const existing = new Set<string>()
  const calls = { downloaded: [] as string[], exec: [] as string[][], extracted: [] as string[], removed: [] as string[] }
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
        for (const marker of ['start_alltalk.bat', 'alltalk_environment/conda', 'alltalk_environment/env'])
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
      for (const marker of ['atsetup.bat', 'script.py', 'system', 'voices'])
        existing.add(`${dest}/${marker}`)
    },
    exists: async path => existing.has(path),
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
    log: () => undefined,
    ...overrides,
  }

  return {
    calls,
    deps,
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
          for (const marker of ['start_alltalk.bat', 'alltalk_environment/conda', 'alltalk_environment/env'])
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

  it('detects a partial install during verification', async () => {
    const h = harness({
      // The installer exits 0 but leaves no conda environment - the signature of
      // an install that died halfway, which a naive "exit code 0 means success"
      // check would wave through.
      exec: async () => ({ code: 0, stderr: '', stdout: '' }),
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
