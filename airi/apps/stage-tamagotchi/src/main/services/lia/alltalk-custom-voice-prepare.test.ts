import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CUSTOM_VOICE_PREPARE_LOG_PREFIX,
  CUSTOM_VOICE_PREPARE_TIMEOUT_MS,
  firstrunCommandFor,
  prepareCustomVoiceEngine,
  summarizeExecFailure,
} from './alltalk-custom-voice-prepare'
import { ALLTALK_ENGINES_CONFIG_PATH, CUSTOM_VOICE_MODEL_FILES } from './alltalk-engine-config'

/**
 * The prepare flow is where the QA's two complaints meet: "the first start
 * chose Piper after a timeout" and "a prepare that does not verify can claim
 * success on a failed download". These tests drive the flow against a real
 * temp dir with a stubbed `exec` whose side-effect mimics the upstream CLI, so
 * the verification read-back is exercised exactly as the operator sees it.
 */

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lia-voice-prepare-'))
})

afterEach(async () => {
  await rm(root, { force: true, recursive: true })
})

function fs() {
  return {
    readFile: async (path: string) => {
      try {
        return await readFile(path, 'utf8')
      }
      catch {
        return undefined
      }
    },
    listFiles: async (dir: string) => {
      try {
        return await readdir(dir)
      }
      catch {
        return undefined
      }
    },
    writeFile: async (path: string, content: string) => {
      await writeFile(path, content)
    },
  }
}

async function writeConfig(flag: boolean): Promise<void> {
  await writeFile(join(root, 'confignew.json'), JSON.stringify({ firstrun_model: flag, gradio_interface: true }))
}

async function writeEngines(engine: string): Promise<void> {
  await mkdir(join(root, 'system', 'tts_engines'), { recursive: true })
  await writeFile(join(root, ALLTALK_ENGINES_CONFIG_PATH), JSON.stringify({ engine_loaded: engine, selected_model: engine }))
}

async function writeModelFiles(...skip: string[]): Promise<void> {
  const dir = join(root, 'models', 'xtts', 'xttsv2_2.0.3')
  await mkdir(dir, { recursive: true })
  for (const file of CUSTOM_VOICE_MODEL_FILES) {
    if (!skip.includes(file))
      await writeFile(join(dir, file), `stub-${file}`)
  }
}

interface ExecCall {
  args: string[]
  command: string
  options: { cwd: string, timeoutMs: number }
}

/** The upstream CLI, simulated honestly: only what it would actually write. */
function upstreamLikeExec(sideEffect: 'none' | 'piperTimeout' | 'xttsComplete', result: { code: number | null, stderr: string, stdout: string }) {
  const calls: ExecCall[] = []
  const exec = async (command: string, args: string[], options: { cwd: string, timeoutMs: number }) => {
    calls.push({ args, command, options })
    if (sideEffect === 'xttsComplete') {
      await writeEngines('xtts')
      await writeModelFiles()
      await writeConfig(false)
    }
    if (sideEffect === 'piperTimeout') {
      // What the 60-second timeout did on the QA machine: engine stays piper,
      // first-run flag goes down.
      await writeEngines('piper')
      await writeConfig(false)
    }
    return result
  }
  return { calls, exec }
}

function makeDeps(overrides: {
  exec?: (command: string, args: string[], options: { cwd: string, timeoutMs: number }) => Promise<{ code: number | null, stderr: string, stdout: string }>
  isCancelled?: () => boolean
} = {}) {
  const logs: Array<{ event: string, detail?: string }> = []
  const states: Array<{ phase: string, detail?: string }> = []
  const { exec } = upstreamLikeExec('none', { code: 0, stderr: '', stdout: '' })
  const deps = {
    appDir: root,
    exec: overrides.exec ?? exec,
    isCancelled: overrides.isCancelled,
    log: (entry: { event: string, detail?: string }) => logs.push(entry),
    onStateChange: (state: { phase: string, detail?: string }) => states.push(state),
    ...fs(),
  }
  return { deps, logs, states }
}

describe('prepareCustomVoiceEngine', () => {
  it('does nothing when the engine is already prepared - no download, no exec', async () => {
    await writeConfig(false)
    await writeEngines('xtts')
    await writeModelFiles()

    const execSpy: { calls: number, exec: () => Promise<{ code: number, stderr: string, stdout: string }> } = {
      calls: 0,
      exec: async () => {
        execSpy.calls += 1
        return { code: 0, stderr: '', stdout: '' }
      },
    }
    const { deps, logs, states } = makeDeps({ exec: execSpy.exec })

    const result = await prepareCustomVoiceEngine(deps)

    expect(result).toEqual({ changed: false, ok: true })
    expect(execSpy.calls).toBe(0)
    expect(logs.map(entry => entry.event)).toContain('prepare.skipped-already-ready')
    expect(states[states.length - 1].phase).toBe('ready')
  })

  it('arms the first-run flag, runs the upstream CLI, and verifies by reading the config', async () => {
    await writeConfig(false)
    await writeEngines('piper')

    const { calls, exec } = upstreamLikeExec('xttsComplete', { code: 0, stderr: '', stdout: 'download complete' })
    const { deps, logs, states } = makeDeps({ exec })

    const result = await prepareCustomVoiceEngine(deps)

    expect(result).toEqual({ changed: true, ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toEqual([join('system', 'config', 'firstrun.py'), '--tts_model', 'xtts'])
    expect(calls[0].options.cwd).toBe(root)
    expect(calls[0].options.timeoutMs).toBe(CUSTOM_VOICE_PREPARE_TIMEOUT_MS)

    const phases = states.map(state => state.phase)
    expect(phases).toContain('enabling-first-run')
    expect(phases).toContain('downloading')
    expect(phases).toContain('verifying')
    expect(phases[phases.length - 1]).toBe('ready')
    expect(logs.map(entry => entry.event)).toEqual(
      expect.arrayContaining(['prepare.requested', 'prepare.download-started', 'prepare.finished']),
    )
  })

  it('t: refuses to celebrate when the run leaves piper in place (the QA failure shape)', async () => {
    await writeConfig(true)
    await writeEngines('piper')

    const { exec } = upstreamLikeExec('piperTimeout', { code: 0, stderr: '', stdout: 'No input received. Proceeding with the default model (piper).' })
    const { deps, logs, states } = makeDeps({ exec })

    const result = await prepareCustomVoiceEngine(deps)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('engineNotCustom')
      expect(result.message).toContain('piper')
      expect(result.message).not.toContain('success')
    }
    expect(logs.map(entry => entry.event)).toContain('prepare.engine-mismatch')
    expect(states[states.length - 1].phase).toBe('error')
  })

  it('t: an exit-0 run that never applied the config is an error, not silence', async () => {
    await writeConfig(false)
    await writeEngines('piper')

    const { exec } = upstreamLikeExec('none', { code: 0, stderr: '', stdout: 'nothing happened' })
    const { deps } = makeDeps({ exec })

    const result = await prepareCustomVoiceEngine(deps)

    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error).toBe('engineNotCustom')
  })

  it('t: xtts selected without all model files is "incomplete", never ready', async () => {
    await writeConfig(false)
    await writeEngines('piper')

    const exec = async () => {
      await writeEngines('xtts')
      await writeModelFiles('model.pth')
      await writeConfig(false)
      return { code: 1, stderr: '', stdout: 'Exhausted all retries for model download.' }
    }
    // Deliberate: a non-zero code reports first; the file check runs when the
    // code is clean but content is not.
    const { deps: failingDeps } = makeDeps({ exec })
    const failed = await prepareCustomVoiceEngine(failingDeps)
    expect(failed.ok).toBe(false)
    if (!failed.ok)
      expect(failed.error).toBe('execFailed')

    const completeExec = async () => {
      await writeEngines('xtts')
      await writeModelFiles('model.pth')
      await writeConfig(false)
      return { code: 0, stderr: '', stdout: '' }
    }
    const { deps } = makeDeps({ exec: completeExec })
    const result = await prepareCustomVoiceEngine(deps)

    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error).toBe('modelIncomplete')
  })

  it('a non-zero exit is reported with a clean, ANSI-free summary', async () => {
    await writeConfig(false)
    await writeEngines('piper')

    const { exec } = upstreamLikeExec('none', {
      code: 1,
      stderr: '',
      stdout: '[91mExhausted all retries for https://download.example/model.pth[0m',
    })
    const { deps, logs } = makeDeps({ exec })

    const result = await prepareCustomVoiceEngine(deps)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('execFailed')
      expect(result.message).not.toContain('[')
      expect(result.message).toContain('Exhausted all retries')
    }
    expect(logs.some(entry => entry.event === 'prepare.download-failed')).toBe(true)
  })

  it('a missing confignew.json is a configuration error, not a crash', async () => {
    await writeEngines('piper')

    const { deps } = makeDeps()

    const result = await prepareCustomVoiceEngine(deps)

    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error).toBe('configNotApplied')
  })

  it('honours cancellation between phases without starting the download', async () => {
    await writeConfig(false)
    await writeEngines('piper')

    const execSpy: { calls: number, exec: () => Promise<{ code: number, stderr: string, stdout: string }> } = {
      calls: 0,
      exec: async () => {
        execSpy.calls += 1
        return { code: 0, stderr: '', stdout: '' }
      },
    }
    const { deps, logs, states } = makeDeps({ exec: execSpy.exec, isCancelled: () => true })

    const result = await prepareCustomVoiceEngine(deps)

    expect(result.ok).toBe(false)
    expect(execSpy.calls).toBe(0)
    expect(logs.map(entry => entry.event)).toContain('prepare.cancelled')
    expect(states[states.length - 1].phase).toBe('cancelled')
  })

  it('u: logs carry no absolute paths and no URLs', async () => {
    await writeConfig(false)
    await writeEngines('piper')

    const { exec } = upstreamLikeExec('xttsComplete', { code: 0, stderr: '', stdout: '' })
    const { deps, logs } = makeDeps({ exec })

    await prepareCustomVoiceEngine(deps)

    expect(logs.length).toBeGreaterThan(0)
    for (const entry of logs) {
      const body = `${entry.event} ${entry.detail ?? ''}`
      expect(body).not.toContain(root)
      expect(body).not.toContain('http')
    }
  })
})

describe('firstrunCommandFor', () => {
  it('uses the managed conda env python on Windows, with an argument array', () => {
    const { args, command } = firstrunCommandFor('win32', 'C:\\Apps\\alltalk')

    expect(command).toBe(join('C:\\Apps\\alltalk', 'alltalk_environment', 'env', 'python.exe'))
    expect(args).toEqual([join('system', 'config', 'firstrun.py'), '--tts_model', 'xtts'])
  })

  it('uses python3 outside Windows', () => {
    const { args, command } = firstrunCommandFor('linux', '/opt/alltalk')

    expect(command).toBe('python3')
    expect(args).toEqual([join('system', 'config', 'firstrun.py'), '--tts_model', 'xtts'])
  })
})

describe('summarizeExecFailure', () => {
  it('strips ANSI colours and truncates overlong lines', () => {
    const summary = summarizeExecFailure(`[91m${'error '.repeat(60)}[0m`, '')

    expect(summary).toBeDefined()
    expect(summary).not.toContain('[')
    expect(summary!.length).toBeLessThanOrEqual(200)
  })

  it('returns undefined when nothing looks like an error', () => {
    expect(summarizeExecFailure('all good', '')).toBeUndefined()
  })
})

describe('log prefix', () => {
  it('is the identifier the brief asked for', () => {
    expect(CUSTOM_VOICE_PREPARE_LOG_PREFIX).toBe('[LIA-VOICE-RUNTIME]')
  })
})
