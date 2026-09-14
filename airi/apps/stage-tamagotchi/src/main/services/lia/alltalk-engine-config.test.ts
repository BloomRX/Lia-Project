import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ALLTALK_ENGINES_CONFIG_PATH,
  CUSTOM_VOICE_MODEL_FILES,
  markAlltalkFirstRunDone,
  readCustomVoiceEngineStatus,
  setAlltalkFirstRunPending,
} from './alltalk-engine-config'

/**
 * The engine-state reader against a real temp dir, because everything it says
 * is about files: a wrong answer here is a wrong "custom voice ready/still
 * to do" in the UI. The write helpers are checked for the two properties a
 * config editor must have: preservation of strangers' keys and refusal to
 * destroy an unreadable file.
 */

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lia-engine-config-'))
})

afterEach(async () => {
  await rm(root, { force: true, recursive: true })
})

async function writeConfig(content: unknown): Promise<void> {
  const body = typeof content === 'string' ? content : JSON.stringify(content)
  await writeFile(join(root, 'confignew.json'), body)
}

async function writeEngines(content: unknown): Promise<void> {
  await mkdir(join(root, 'system', 'tts_engines'), { recursive: true })
  const body = typeof content === 'string' ? content : JSON.stringify(content)
  await writeFile(join(root, ALLTALK_ENGINES_CONFIG_PATH), body)
}

async function writeModelFiles(...skip: string[]): Promise<void> {
  const dir = join(root, 'models', 'xtts', 'xttsv2_2.0.3')
  await mkdir(dir, { recursive: true })
  for (const file of CUSTOM_VOICE_MODEL_FILES) {
    if (!skip.includes(file))
      await writeFile(join(dir, file), `stub-${file}`)
  }
}

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

describe('readCustomVoiceEngineStatus', () => {
  it('reports an empty install as first-run pending and never ready', async () => {
    const status = await readCustomVoiceEngineStatus(fs(), root)

    expect(status.firstRunPending).toBe(true)
    expect(status.ready).toBe(false)
    expect(status.modelComplete).toBe(false)
    expect(status.engine).toBeUndefined()
    expect(status.missingModelFiles).toHaveLength(CUSTOM_VOICE_MODEL_FILES.length)
  })

  it('reads the piper default the pin ships with, exactly as QA met it', async () => {
    await writeConfig({ branding: 'AllTalk ', firstrun_model: true })
    await writeEngines({ engine_loaded: 'piper', engines_available: [{ name: 'piper', selected_model: 'piper' }], selected_model: 'piper' })

    const status = await readCustomVoiceEngineStatus(fs(), root)

    expect(status.engine).toBe('piper')
    expect(status.firstRunPending).toBe(true)
    expect(status.ready).toBe(false)
  })

  it('is ready only when engine, model files and first-run flag all agree', async () => {
    await writeConfig({ firstrun_model: false })
    await writeEngines({ engine_loaded: 'xtts' })
    await writeModelFiles()

    const status = await readCustomVoiceEngineStatus(fs(), root)

    expect(status.engine).toBe('xtts')
    expect(status.modelComplete).toBe(true)
    expect(status.missingModelFiles).toHaveLength(0)
    expect(status.firstRunPending).toBe(false)
    expect(status.ready).toBe(true)
  })

  it('a partial model download is reported, never called ready', async () => {
    await writeConfig({ firstrun_model: false })
    await writeEngines({ engine_loaded: 'xtts' })
    await writeModelFiles('model.pth', 'dvae.pth')

    const status = await readCustomVoiceEngineStatus(fs(), root)

    expect(status.modelComplete).toBe(false)
    expect(status.missingModelFiles).toEqual(['model.pth', 'dvae.pth'])
    expect(status.ready).toBe(false)
  })

  it('an xtts selection with first-run still pending is not ready (the prompt would still appear)', async () => {
    await writeConfig({ firstrun_model: true })
    await writeEngines({ engine_loaded: 'xtts' })
    await writeModelFiles()

    const status = await readCustomVoiceEngineStatus(fs(), root)

    expect(status.engine).toBe('xtts')
    expect(status.ready).toBe(false)
  })

  it('unreadable confignew.json becomes a parseError, not a crash', async () => {
    await writeConfig('{ not json')
    await writeEngines({ engine_loaded: 'xtts' })
    await writeModelFiles()

    const status = await readCustomVoiceEngineStatus(fs(), root)

    expect(status.parseError).toBe('confignew.json')
    expect(status.ready).toBe(false)
  })

  it('unreadable tts_engines.json becomes a parseError, not a crash', async () => {
    await writeConfig({ firstrun_model: false })
    await writeEngines('{ broken')

    const status = await readCustomVoiceEngineStatus(fs(), root)

    expect(status.parseError).toBe('tts_engines.json')
    expect(status.ready).toBe(false)
  })
})

describe('setAlltalkFirstRunPending / markAlltalkFirstRunDone', () => {
  it('flips the flag while preserving every other key the pin has', async () => {
    await writeConfig({ api_def: { api_port_number: 7851 }, branding: 'AllTalk ', firstrun_model: true, gradio_interface: true })

    const changed = await markAlltalkFirstRunDone(fs(), root)

    expect(changed).toBe(true)
    const written = JSON.parse(await readFile(join(root, 'confignew.json'), 'utf8'))
    expect(written.firstrun_model).toBe(false)
    expect(written.branding).toBe('AllTalk ')
    expect(written.api_def.api_port_number).toBe(7851)
    expect(written.gradio_interface).toBe(true)
  })

  it('is a quiet no-op when the flag already matches', async () => {
    await writeConfig({ firstrun_model: false })

    const changed = await markAlltalkFirstRunDone(fs(), root)

    expect(changed).toBe(false)
  })

  it('can arm the first run again - the prepare flow needs the upstream CLI to act', async () => {
    await writeConfig({ firstrun_model: false })

    const changed = await setAlltalkFirstRunPending(fs(), root, true)

    expect(changed).toBe(true)
    const written = JSON.parse(await readFile(join(root, 'confignew.json'), 'utf8'))
    expect(written.firstrun_model).toBe(true)
  })

  it('throws on a missing file rather than inventing a config from scratch', async () => {
    await expect(markAlltalkFirstRunDone(fs(), root)).rejects.toThrow('confignew.json')
  })

  it('throws on unreadable JSON and leaves the file byte-identical', async () => {
    await writeConfig('{broken')

    await expect(markAlltalkFirstRunDone(fs(), root)).rejects.toThrow()
    expect(await readFile(join(root, 'confignew.json'), 'utf8')).toBe('{broken')
  })

  it('rejects a config that is not an object', async () => {
    await writeConfig('["firstrun_model", true]')

    await expect(markAlltalkFirstRunDone(fs(), root)).rejects.toThrow('unexpected shape')
  })
})
