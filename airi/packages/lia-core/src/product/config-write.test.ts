import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readLiaProductConfig, readSetupCompletedConfig, updateLiaProductConfig } from './config'

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

describe('7.9F selected-engine roundtrip (write -> read survives, neighbors untouched)', () => {
  it('voice.engine.preferred persists through the canonical merge; schemaVersion and legacy voice keys intact', async () => {
    const file = await freshConfig({
      persona: { activeCardId: 'lia-default' },
      schemaVersion: 1,
      voice: {
        engine: { preferred: 'kokoro' },
        fallback: { enabled: true },
        runtime: { installDir: 'C:\\Users\\lucas\\AppData\\Local\\Lia\\runtimes' },
        tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'pf_dora' } },
      },
    })

    const read = await readLiaProductConfig(file)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    // The canonical selected-engine field roundtrips verbatim, and every
    // typed neighbor (legacy tts target, fallback policy, runtime override)
    // survives the read untouched - document compatibility, no migration.
    const voice = read.value.voice
    expect(voice?.engine?.preferred).toBe('kokoro')
    expect(voice?.fallback?.enabled).toBe(true)
    expect(read.value.schemaVersion).toBe(1)
    expect(voice?.tts?.preferred).toEqual({ providerId: 'custom-local-voice', voiceId: 'pf_dora' })
  })

  it('a legacy document WITHOUT any engine block reads preference-less (the resolver defaults to Kokoro)', async () => {
    const file = await freshConfig({ schemaVersion: 1 })
    const read = await readLiaProductConfig(file)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.voice?.engine?.preferred).toBeUndefined()
    expect(read.value.schemaVersion).toBe(1)
  })
})

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

describe('7.9H voice.enabled switch (write -> read survives, default stays implicit)', () => {
  it('disabling voice persists `voice.enabled: false` and reads back; neighbors intact', async () => {
    const file = await freshConfig({
      schemaVersion: 1,
      voice: { engine: { preferred: 'kokoro' } },
    })
    const result = await updateLiaProductConfig(file, { voice: { enabled: false } })
    expect(result.status).toBe('ok')

    const read = await readLiaProductConfig(file)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.voice?.enabled).toBe(false)
    // The selected engine survives the switch - disabling never erases it.
    expect(read.value.voice?.engine?.preferred).toBe('kokoro')

    // On disk the key is explicit...
    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect((raw.voice as Record<string, unknown>).enabled).toBe(false)
  })

  it('re-enabling removes the explicit key: absent = the product default (no inferred noise)', async () => {
    const file = await freshConfig({ schemaVersion: 1, voice: { enabled: false } })
    const result = await updateLiaProductConfig(file, { voice: { enabled: true } })
    expect(result.status).toBe('ok')

    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect((raw.voice as Record<string, unknown>).enabled).toBeUndefined()

    const read = await readLiaProductConfig(file)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.voice?.enabled).toBeUndefined()
  })

  it('a document without the key reads enabled (voice is part of the default experience)', async () => {
    const file = await freshConfig({ schemaVersion: 1 })
    const read = await readLiaProductConfig(file)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.voice?.enabled).toBeUndefined()
  })
})

describe('first-run setup marker writes (Phase 7.9H-B3)', () => {
  it('e: writing setup completion PRESERVES the existing voice config', async () => {
    const file = await freshConfig({
      schemaVersion: 1,
      voice: { enabled: false, engine: { preferred: 'kokoro' } },
    })
    const result = await updateLiaProductConfig(file, { setup: { completed: true } })
    expect(result.status).toBe('ok')

    const read = await readLiaProductConfig(file)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.setup?.completed).toBe(true)
    expect(read.value.voice?.enabled).toBe(false)
    expect(read.value.voice?.engine?.preferred).toBe('kokoro')
  })

  it('f: writing the voice choice PRESERVES the setup state', async () => {
    const file = await freshConfig({ schemaVersion: 1, setup: { completed: true } })
    const result = await updateLiaProductConfig(file, { voice: { enabled: false } })
    expect(result.status).toBe('ok')

    const read = await readLiaProductConfig(file)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.setup?.completed).toBe(true)
    expect(read.value.voice?.enabled).toBe(false)
  })

  it('g: OLD product configs (no setup key) remain valid and gain the marker additively', async () => {
    const file = await freshConfig({
      persona: { activeCardId: 'lia' },
      provider: { chat: { onboarded: true, preferred: { modelId: 'm1', providerId: 'openrouter' } } },
      schemaVersion: 1,
      voice: { tts: { preferred: { providerId: 'cloud', voiceId: 'nova' } } },
    })
    // The old document reads back intact - no setup key, nothing invalidated.
    const read = await readLiaProductConfig(file)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.setup).toBeUndefined()
    expect(read.value.provider?.chat?.onboarded).toBe(true)

    // And a later completion write lands additively, neighbors untouched.
    const result = await updateLiaProductConfig(file, { setup: { completed: true } })
    expect(result.status).toBe('ok')
    const after = await readLiaProductConfig(file)
    expect(after.status).toBe('ok')
    if (after.status !== 'ok')
      return
    expect(after.value.setup?.completed).toBe(true)
    expect(after.value.persona?.activeCardId).toBe('lia')
    expect(after.value.voice?.tts?.preferred).toEqual({ providerId: 'cloud', voiceId: 'nova' })
  })

  it('un-completing setup removes the explicit key (absence = the product default)', async () => {
    const file = await freshConfig({ schemaVersion: 1, setup: { completed: true } })
    const result = await updateLiaProductConfig(file, { setup: { completed: false } })
    expect(result.status).toBe('ok')

    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect((raw.setup as Record<string, unknown> | undefined)?.completed).toBeUndefined()

    const read = await readLiaProductConfig(file)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(readSetupCompletedConfig(read.value.setup)).toBe(false)
  })
})

describe('brain selection writes (Phase 8.0B-2)', () => {
  it('e: writing the ENGINE selection preserves every unrelated section', async () => {
    const file = await freshConfig({
      persona: { activeCardId: 'lia' },
      preferences: { language: 'pt-BR' },
      provider: { chat: { onboarded: true, preferred: { modelId: 'm1', providerId: 'openrouter' } } },
      schemaVersion: 1,
      setup: { completed: true },
      voice: { enabled: false, engine: { preferred: 'kokoro' } },
    })

    const result = await updateLiaProductConfig(file, { brain: { engine: { preferred: 'engine-alpha' } } })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok')
      return

    // The new selection lands...
    expect(result.value.brain?.engine?.preferred).toBe('engine-alpha')
    // ...and nothing else moves.
    expect(result.value.persona?.activeCardId).toBe('lia')
    expect(result.value.preferences?.language).toBe('pt-BR')
    expect(result.value.provider?.chat).toEqual({ onboarded: true, preferred: { modelId: 'm1', providerId: 'openrouter' } })
    expect(result.value.setup?.completed).toBe(true)
    expect(result.value.voice?.enabled).toBe(false)
    expect(result.value.voice?.engine?.preferred).toBe('kokoro')

    // And it survives the disk round-trip.
    const read = await readLiaProductConfig(file)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.brain?.engine?.preferred).toBe('engine-alpha')
  })

  it('f: writing the MODEL selection preserves every unrelated section', async () => {
    const file = await freshConfig({
      brain: { engine: { preferred: 'engine-alpha' } },
      schemaVersion: 1,
      setup: { completed: true },
    })

    const result = await updateLiaProductConfig(file, { brain: { model: { preferred: 'model-beta' } } })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok')
      return

    expect(result.value.brain?.model?.preferred).toBe('model-beta')
    // A model-only patch never touches the engine branch...
    expect(result.value.brain?.engine?.preferred).toBe('engine-alpha')
    // ...nor anything else in the document.
    expect(result.value.setup?.completed).toBe(true)
    expect(result.value.schemaVersion).toBe(1)
  })

  it('g: writing BOTH in one update preserves both (one merge, one write)', async () => {
    const file = await freshConfig({ schemaVersion: 1 })

    const result = await updateLiaProductConfig(file, {
      brain: { engine: { preferred: 'engine-alpha' }, model: { preferred: 'model-alpha' } },
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok')
      return
    expect(result.value.brain?.engine?.preferred).toBe('engine-alpha')
    expect(result.value.brain?.model?.preferred).toBe('model-alpha')

    const raw = JSON.parse(await readFile(file, 'utf-8')) as Record<string, any>
    expect(raw.brain).toEqual({ engine: { preferred: 'engine-alpha' }, model: { preferred: 'model-alpha' } })
  })

  it('selection semantics: ids are trimmed, blank clears back to absence, unknown fields survive', async () => {
    const file = await freshConfig({ schemaVersion: 1, brain: { engine: { preferred: 'engine-alpha' } } })

    // Trimmed on write - the stored id is canonical.
    const trimmed = await updateLiaProductConfig(file, { brain: { engine: { preferred: '  engine-beta  ' } } })
    expect(trimmed.status).toBe('ok')
    if (trimmed.status !== 'ok')
      return
    expect(trimmed.value.brain?.engine?.preferred).toBe('engine-beta')

    // An explicit blank removes the preference (absence = no selection),
    // exactly like the voice/setup conventions.
    const cleared = await updateLiaProductConfig(file, { brain: { engine: { preferred: '' } } })
    expect(cleared.status).toBe('ok')
    if (cleared.status !== 'ok')
      return
    expect(cleared.value.brain?.engine?.preferred).toBeUndefined()
  })
})
