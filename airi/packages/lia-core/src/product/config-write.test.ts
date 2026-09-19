import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readLiaProductConfig, updateLiaProductConfig } from './config'

/**
 * The writer contract (Phase 7.1, tests G/H/I/J + the secret firewall):
 * edits land in the CANONICAL file as deep-merge patches, unknown fields
 * survive, and nothing secret-shaped ever gets written.
 */

async function freshConfig(contents?: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lia-product-write-'))
  const file = join(dir, 'lia-product.json')
  if (contents)
    await writeFile(file, JSON.stringify(contents, null, 2))
  return file
}

describe('updateLiaProductConfig', () => {
  it('g. an IA change persists beside everything that was already there', async () => {
    const file = await freshConfig({
      persona: { activeCardId: 'lia-default' },
      provider: { chat: { fallbackEnabled: true, onboarded: false, preferred: { providerId: 'old-one' } } },
      schemaVersion: 1,
    })

    const result = await updateLiaProductConfig(file, {
      provider: { chat: { preferred: { modelId: 'm-new', providerId: 'openrouter' } } },
    })

    expect(result.status).toBe('ok')
    const read = await readLiaProductConfig(file)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.provider?.chat?.preferred).toEqual({ modelId: 'm-new', providerId: 'openrouter' })
    // Merged, never rewritten: the neighbor flags and other domains stay.
    expect(read.value.provider?.chat?.fallbackEnabled).toBe(true)
    expect(read.value.provider?.chat?.onboarded).toBe(false)
    expect(read.value.persona?.activeCardId).toBe('lia-default')
  })

  it('h. a personality change persists', async () => {
    const file = await freshConfig({ persona: { activeCardId: 'lia-default' }, schemaVersion: 1 })
    await updateLiaProductConfig(file, { persona: { activeCardId: 'lia-adventurous' } })
    const read = await readLiaProductConfig(file)
    if (read.status !== 'ok')
      throw new Error('read failed')
    expect(read.value.persona?.activeCardId).toBe('lia-adventurous')
  })

  it('i. a voice selection persists and replaces the previous one ATOMICALLY', async () => {
    const file = await freshConfig({
      schemaVersion: 1,
      voice: { tts: { preferred: { providerId: 'cloud-voice', voiceId: 'nova' } } },
    })
    await updateLiaProductConfig(file, {
      voice: { tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'profile-2' } } },
    })
    const read = await readLiaProductConfig(file)
    if (read.status !== 'ok')
      throw new Error('read failed')
    expect(read.value.voice?.tts?.preferred).toEqual({ modelId: undefined, providerId: 'custom-local-voice', voiceId: 'profile-2' })
  })

  it('j. an appearance (language) change persists', async () => {
    const file = await freshConfig({ preferences: { language: 'en' }, schemaVersion: 1 })
    await updateLiaProductConfig(file, { preferences: { language: 'pt-BR' } })
    const read = await readLiaProductConfig(file)
    if (read.status !== 'ok')
      throw new Error('read failed')
    expect(read.value.preferences?.language).toBe('pt-BR')
  })

  it('unknown fields from other editors survive a launcher write', async () => {
    const file = await freshConfig({ customExtra: { nested: [1, 2, 3] }, schemaVersion: 1 })
    await updateLiaProductConfig(file, { persona: { activeCardId: 'x' } })
    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(raw.customExtra).toEqual({ nested: [1, 2, 3] })
    expect(raw.schemaVersion).toBe(1)
  })

  it('a missing file is created with schemaVersion 1', async () => {
    const file = await freshConfig()
    const result = await updateLiaProductConfig(file, { persona: { activeCardId: 'first-run' } })
    expect(result.status).toBe('ok')
    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(raw.schemaVersion).toBe(1)
  })

  it('l-adjacent: a secret-shaped field anywhere in the patch VETOES the write', async () => {
    const file = await freshConfig({ schemaVersion: 1 })
    const result = await updateLiaProductConfig(file, {
      provider: { chat: { preferred: { providerId: 'openrouter' } } },
      // @ts-expect-error deliberate hostile payload for the firewall test
      sneaky: { apiKey: 'sk-no-no-no' },
    } as never)
    expect(result.status).toBe('secret-forbidden')
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ schemaVersion: 1 })
  })

  it('an unreadable source document is never healed by a writer', async () => {
    const file = await freshConfig()
    await writeFile(file, '{broken json')
    const result = await updateLiaProductConfig(file, { persona: { activeCardId: 'x' } })
    expect(result.status).toBe('invalid-source')
    expect(await readFile(file, 'utf8')).toBe('{broken json')
  })
})
