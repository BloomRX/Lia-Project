import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  readLiaProductConfig,
  readSetupCompletedConfig,
  SETUP_COMPLETED_DEFAULT,
  setupCompletionUpdate,
} from './config'

/**
 * The tolerant reader contract (Phase 7, architecture item 7): it reads the
 * user's canonical document as-is and never writes, heals or invents.
 */

describe('readLiaProductConfig', () => {
  it('a valid document maps into the snapshot exactly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lia-product-'))
    const file = join(dir, 'lia-product.json')
    await writeFile(file, JSON.stringify({
      persona: { activeCardId: 'lia-default' },
      preferences: { language: 'pt-BR' },
      provider: { chat: { fallbackEnabled: true, onboarded: true, preferred: { modelId: 'm1', providerId: 'openrouter' } } },
      schemaVersion: 1,
      voice: {
        runtime: { alltalk: { baseUrl: 'http://127.0.0.1:7851', installDir: '/rt', timeoutMs: 60_000 } },
        tts: { preferred: { providerId: 'cloud', voiceId: 'nova' } },
      },
    }))

    const read = await readLiaProductConfig(file)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.schemaVersion).toBe(1)
    expect(read.value.persona?.activeCardId).toBe('lia-default')
    expect(read.value.provider?.chat?.preferred).toEqual({ modelId: 'm1', providerId: 'openrouter' })
    expect(read.value.provider?.chat?.fallbackEnabled).toBe(true)
    expect(read.value.voice?.runtime?.alltalk).toEqual({ baseUrl: 'http://127.0.0.1:7851', installDir: '/rt', timeoutMs: 60_000, voicesDir: undefined })
    expect(read.value.voice?.tts?.preferred).toEqual({ modelId: undefined, providerId: 'cloud', voiceId: 'nova' })
    expect(read.value.preferences?.language).toBe('pt-BR')
  })

  it('a missing file is just missing', async () => {
    const read = await readLiaProductConfig(join(tmpdir(), 'definitely-not-there', 'lia-product.json'))
    expect(read.status).toBe('missing')
  })

  it('garbage content is invalid and the file is left untouched', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lia-product-'))
    const file = join(dir, 'lia-product.json')
    await writeFile(file, 'not-json{')
    const read = await readLiaProductConfig(file)
    expect(read.status).toBe('invalid')
  })

  it('a non-object json document is invalid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lia-product-'))
    const file = join(dir, 'lia-product.json')
    await writeFile(file, '[1,2,3]')
    const read = await readLiaProductConfig(file)
    expect(read.status).toBe('invalid')
  })
})

describe('first-run setup marker (Phase 7.9H-B3)', () => {
  async function readDoc(doc: Record<string, unknown>) {
    const dir = await mkdtemp(join(tmpdir(), 'lia-product-'))
    const file = join(dir, 'lia-product.json')
    await writeFile(file, JSON.stringify(doc))
    return await readLiaProductConfig(file)
  }

  it('a: missing setup.completed -> incomplete (the product default)', async () => {
    expect(SETUP_COMPLETED_DEFAULT).toBe(false)
    expect(readSetupCompletedConfig(undefined)).toBe(false)
    expect(readSetupCompletedConfig({})).toBe(false)

    const read = await readDoc({ schemaVersion: 1 })
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.setup).toBeUndefined()
    expect(readSetupCompletedConfig(read.value.setup)).toBe(false)
  })

  it('b: setup.completed=false -> incomplete', async () => {
    expect(readSetupCompletedConfig({ completed: false })).toBe(false)
    const read = await readDoc({ schemaVersion: 1, setup: { completed: false } })
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.setup?.completed).toBe(false)
    expect(readSetupCompletedConfig(read.value.setup)).toBe(false)
  })

  it('c: setup.completed=true -> complete', async () => {
    expect(readSetupCompletedConfig({ completed: true })).toBe(true)
    const read = await readDoc({ schemaVersion: 1, setup: { completed: true } })
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.setup?.completed).toBe(true)
    expect(readSetupCompletedConfig(read.value.setup)).toBe(true)
  })

  it('d: voice.enabled stays independent of the setup marker', async () => {
    // Every combination is its own fact: the two switches never alias.
    const read = await readDoc({
      schemaVersion: 1,
      setup: { completed: true },
      voice: { enabled: false },
    })
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(readSetupCompletedConfig(read.value.setup)).toBe(true)
    expect(read.value.voice?.enabled).toBe(false)

    const inverse = await readDoc({ schemaVersion: 1, voice: { enabled: true } })
    expect(inverse.status).toBe('ok')
    if (inverse.status !== 'ok')
      return
    expect(readSetupCompletedConfig(inverse.value.setup)).toBe(false)
    expect(inverse.value.voice?.enabled).toBe(true)
  })

  it('the completion update payload is exactly the canonical shape', () => {
    expect(setupCompletionUpdate(true)).toEqual({ setup: { completed: true } })
    expect(setupCompletionUpdate(false)).toEqual({ setup: { completed: false } })
  })

  it('non-boolean completed values never complete setup (tolerant reader)', () => {
    expect(readSetupCompletedConfig({ completed: 'true' })).toBe(false)
    expect(readSetupCompletedConfig({ completed: 1 })).toBe(false)
    expect(readSetupCompletedConfig({ completed: null })).toBe(false)
  })
})
