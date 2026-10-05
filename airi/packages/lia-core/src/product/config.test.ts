import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  brainRoutingModeUpdate,
  brainSelectionUpdate,
  isBrainRoutingMode,
  readBrainRoutingMode,
  readLiaProductConfig,
  readPreferredBrainEngineId,
  readPreferredBrainModelId,
  readSetupCompletedConfig,
  SETUP_COMPLETED_DEFAULT,
  setupCompletionUpdate,
  updateLiaProductConfig,
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

describe('brain selection preference (Phase 8.0B-2)', () => {
  async function readDoc(doc: Record<string, unknown>) {
    const dir = await mkdtemp(join(tmpdir(), 'lia-product-'))
    const file = join(dir, 'lia-product.json')
    await writeFile(file, JSON.stringify(doc))
    return await readLiaProductConfig(file)
  }

  it('a: old configs without any brain key remain valid - no silent default', async () => {
    const read = await readDoc({
      persona: { activeCardId: 'lia' },
      provider: { chat: { onboarded: true, preferred: { modelId: 'm1', providerId: 'openrouter' } } },
      schemaVersion: 1,
    })
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.brain).toBeUndefined()
    expect(readPreferredBrainEngineId(read.value)).toBeUndefined()
    expect(readPreferredBrainModelId(read.value)).toBeUndefined()
    // ...and every pre-existing section is untouched.
    expect(read.value.provider?.chat?.preferred).toEqual({ modelId: 'm1', providerId: 'openrouter' })
    expect(read.value.persona?.activeCardId).toBe('lia')
  })

  it('b: the preferred engine id reads back exactly (opaque id, no interpretation)', () => {
    expect(readPreferredBrainEngineId({ brain: { engine: { preferred: 'engine-alpha' } } })).toBe('engine-alpha')
    expect(readPreferredBrainEngineId({ brain: {} })).toBeUndefined()
    expect(readPreferredBrainEngineId(undefined)).toBeUndefined()
    // Blank is never a selection.
    expect(readPreferredBrainEngineId({ brain: { engine: { preferred: '   ' } } })).toBeUndefined()
  })

  it('c: the preferred model id reads back exactly', async () => {
    expect(readPreferredBrainModelId({ brain: { model: { preferred: 'model-alpha' } } })).toBe('model-alpha')
    expect(readPreferredBrainModelId({ brain: {} })).toBeUndefined()

    const read = await readDoc({ schemaVersion: 1, brain: { model: { preferred: 'model-alpha' } } })
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(readPreferredBrainModelId(read.value)).toBe('model-alpha')
  })

  it('d: engine and model preferences are independent dimensions', async () => {
    // Engine only.
    const engineOnly = await readDoc({ schemaVersion: 1, brain: { engine: { preferred: 'engine-alpha' } } })
    expect(engineOnly.status).toBe('ok')
    if (engineOnly.status !== 'ok')
      return
    expect(readPreferredBrainEngineId(engineOnly.value)).toBe('engine-alpha')
    expect(readPreferredBrainModelId(engineOnly.value)).toBeUndefined()

    // Model only.
    const modelOnly = await readDoc({ schemaVersion: 1, brain: { model: { preferred: 'model-beta' } } })
    expect(modelOnly.status).toBe('ok')
    if (modelOnly.status !== 'ok')
      return
    expect(readPreferredBrainEngineId(modelOnly.value)).toBeUndefined()
    expect(readPreferredBrainModelId(modelOnly.value)).toBe('model-beta')

    // The reader keeps them as separate branches - no cross-fill.
    expect(modelOnly.value.brain?.engine).toBeUndefined()
    expect(engineOnly.value.brain?.model).toBeUndefined()
  })

  it('non-string preferred values never become a selection (tolerant reader)', async () => {
    const read = await readDoc({ schemaVersion: 1, brain: { engine: { preferred: 42 }, model: { preferred: null } } })
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.brain).toBeUndefined()
    expect(readPreferredBrainEngineId(read.value)).toBeUndefined()
    expect(readPreferredBrainModelId(read.value)).toBeUndefined()
  })

  it('the canonical brain-selection update payload is exactly the expected shape', () => {
    expect(brainSelectionUpdate({ engineId: 'engine-alpha' })).toEqual({
      brain: { engine: { preferred: 'engine-alpha' } },
    })
    expect(brainSelectionUpdate({ modelId: 'model-alpha' })).toEqual({
      brain: { model: { preferred: 'model-alpha' } },
    })
    expect(brainSelectionUpdate({ engineId: 'engine-alpha', modelId: 'model-alpha' })).toEqual({
      brain: { engine: { preferred: 'engine-alpha' }, model: { preferred: 'model-alpha' } },
    })
    // Omitted ids stay out of the patch.
    expect(brainSelectionUpdate({})).toEqual({ brain: {} })
  })
})

describe('brain selection stays out of the current chat path (8.0B-2)', () => {
  it('j: the provider/chat bridge never reads the brain preference yet', async () => {
    const { readFileSync } = await import('node:fs')
    const bridgeSource = readFileSync(new URL('../bridge/lia-config.ts', import.meta.url), 'utf-8')
    // The chat provider pipeline keeps its own provider/model fields - the
    // brain preference is persistent state ONLY until a later wiring phase.
    expect(bridgeSource).not.toMatch(/brain/i)
  })
})

describe('brain routing mode preference (Phase 8.0C-3A)', () => {
  async function readDoc(doc: Record<string, unknown>) {
    const dir = await mkdtemp(join(tmpdir(), 'lia-product-'))
    const file = join(dir, 'lia-product.json')
    await writeFile(file, JSON.stringify(doc))
    return await readLiaProductConfig(file)
  }

  it('a: old configs without brain.mode remain valid', async () => {
    // Pre-8.0C document: brain selection exists, mode never existed.
    const read = await readDoc({
      brain: { engine: { preferred: 'engine-alpha' }, model: { preferred: 'model-alpha' } },
      schemaVersion: 1,
    })
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(readBrainRoutingMode(read.value)).toBeUndefined()
    // ...and the pre-existing selections survive intact.
    expect(readPreferredBrainEngineId(read.value)).toBe('engine-alpha')
    expect(readPreferredBrainModelId(read.value)).toBe('model-alpha')

    // A document with no brain section at all is equally valid.
    const ancient = await readDoc({ schemaVersion: 1 })
    expect(ancient.status).toBe('ok')
    if (ancient.status !== 'ok')
      return
    expect(readBrainRoutingMode(ancient.value)).toBeUndefined()
  })

  it('b: missing mode reads as undefined - never silently automatic', async () => {
    expect(readBrainRoutingMode(undefined)).toBeUndefined()
    expect(readBrainRoutingMode({})).toBeUndefined()
    expect(readBrainRoutingMode({ brain: {} })).toBeUndefined()
    expect(readBrainRoutingMode({ brain: { engine: { preferred: 'engine-alpha' } } })).toBeUndefined()
    // The three canonical modes are the ONLY values this reader returns.
    for (const mode of ['automatic', 'disabled', 'manual'] as const) {
      expect(isBrainRoutingMode(mode)).toBe(true)
      expect(readBrainRoutingMode({ brain: { mode } })).toBe(mode)
    }
  })

  it('c/d/e: automatic, manual and disabled all round-trip through the reader', async () => {
    for (const mode of ['automatic', 'disabled', 'manual'] as const) {
      const read = await readDoc({ brain: { mode }, schemaVersion: 1 })
      expect(read.status).toBe('ok')
      if (read.status !== 'ok')
        return
      expect(read.value.brain?.mode).toBe(mode)
      expect(readBrainRoutingMode(read.value)).toBe(mode)
    }
  })

  it('j: invalid arbitrary mode values never become canonical state', async () => {
    for (const bogus of ['auto', 'MANUAL', 'on', 'off', 1, true, null, {}, ['manual']]) {
      const read = await readDoc({ brain: { mode: bogus }, schemaVersion: 1 })
      expect(read.status, String(bogus)).toBe('ok')
      if (read.status !== 'ok')
        return
      expect(readBrainRoutingMode(read.value), String(bogus)).toBeUndefined()
      // With nothing else stored, the whole brain section stays absent.
      expect(read.value.brain, String(bogus)).toBeUndefined()
      expect(isBrainRoutingMode(bogus)).toBe(false)
    }
  })

  it('the routing-mode update payload is exactly the canonical shape', () => {
    expect(brainRoutingModeUpdate('automatic')).toEqual({ brain: { mode: 'automatic' } })
    expect(brainRoutingModeUpdate('manual')).toEqual({ brain: { mode: 'manual' } })
    expect(brainRoutingModeUpdate('disabled')).toEqual({ brain: { mode: 'disabled' } })
  })

  it('k: the generic config layer carries no vendor-specific routing rules', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./config.ts', import.meta.url), 'utf-8')
    const vendors = /groq|qwen|openai|anthropic|gemini|claude|\bgpt\b|mistral|ollama|deepseek/i
    expect(source).not.toMatch(vendors)
  })

  it('l: the current chat/provider path stays untouched by the routing mode', async () => {
    const { readFileSync } = await import('node:fs')
    const bridgeSource = readFileSync(new URL('../bridge/lia-config.ts', import.meta.url), 'utf-8')
    // The chat bridge still knows nothing about Brain routing at all.
    expect(bridgeSource).not.toMatch(/brain|routing/i)
  })
})

/**
 * Phase 8.0D-10B-4D4C4-SHELL-B1: the canonical STT target becomes writable.
 *
 * `voice.stt.preferred` is metadata only - a provider id and an optional model
 * id. It carries no credential, no baseUrl and no runtime object, exactly like
 * its `voice.tts.preferred` sibling, and it must survive every other write the
 * Launcher performs.
 *
 * The target's identity is asserted as literal strings on purpose: this generic
 * config layer names no vendor (see test "k" above), so the literals here are the
 * oracle rather than a re-export of the production constant.
 */
describe('canonical STT target (Phase 8.0D SHELL-B1)', () => {
  const STT_PROVIDER_ID = 'lia-groq-transcription'
  const STT_MODEL_ID = 'whisper-large-v3-turbo'

  /** A realistic pre-B1 document: voice fully configured, no STT selection. */
  function seedDoc(voice: Record<string, unknown> = {}) {
    return {
      brain: { engine: { preferred: 'lia-brain' }, mode: 'managed', model: { preferred: 'llama-3.3-70b-versatile' } },
      persona: { activeCardId: 'lia-default' },
      preferences: { language: 'pt-BR' },
      provider: { activeChatProviderId: 'groq', chat: { preferred: { providerId: 'groq' } } },
      schemaVersion: 1,
      setup: { completed: true },
      voice: {
        engine: { preferred: 'lia-voice-kokoro' },
        fallback: { enabled: true, engineId: 'speech-noop' },
        runtime: { installDir: '/opt/alltalk' },
        tts: {
          enabled: true,
          preferred: { modelId: 'kokoro-82M-v1.0', providerId: 'lia-voice-kokoro', voiceId: 'pt-BR-joao-gamma' },
        },
        ...voice,
      },
    }
  }

  async function withDoc(doc: Record<string, unknown>) {
    const dir = await mkdtemp(join(tmpdir(), 'lia-product-stt-'))
    const filePath = join(dir, 'lia-product.json')
    await writeFile(filePath, `${JSON.stringify(doc, null, 2)}\n`)
    return { filePath, raw: () => readFile(filePath, 'utf8') }
  }

  /** The Launcher's default write, spelled exactly as the host spells it. */
  function sttDefaultUpdate() {
    return { voice: { stt: { preferred: { modelId: STT_MODEL_ID, providerId: STT_PROVIDER_ID } } } }
  }

  it('a: the launcher writes the Lia Groq target into an existing document', async () => {
    const { filePath } = await withDoc(seedDoc())

    const write = await updateLiaProductConfig(filePath, sttDefaultUpdate())

    expect(write.status).toBe('ok')
    const read = await readLiaProductConfig(filePath)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.voice?.stt?.preferred).toEqual({
      modelId: STT_MODEL_ID,
      providerId: STT_PROVIDER_ID,
    })
  })

  it('b: the persisted target exposes exactly the intended identity and no runtime metadata', async () => {
    const { filePath, raw } = await withDoc(seedDoc())
    await updateLiaProductConfig(filePath, sttDefaultUpdate())

    const persisted = await raw()
    expect(JSON.parse(persisted).voice.stt.preferred).toEqual({
      modelId: 'whisper-large-v3-turbo',
      providerId: 'lia-groq-transcription',
    })
    // The derived base URL and any credential are runtime concerns and are never
    // persisted into the canonical document.
    expect(persisted).not.toContain('baseUrl')
    expect(persisted).not.toContain('api.groq.com')
    expect(persisted).not.toContain('apiKey')
  })

  it('c: a TTS write after the STT write preserves the STT selection', async () => {
    const { filePath } = await withDoc(seedDoc())
    await updateLiaProductConfig(filePath, sttDefaultUpdate())

    const write = await updateLiaProductConfig(filePath, {
      voice: { tts: { preferred: { modelId: 'kokoro-82M-v1.0', providerId: 'lia-voice-kokoro', voiceId: 'pt-BR-fabiana-gamma' } } },
    })

    expect(write.status).toBe('ok')
    const read = await readLiaProductConfig(filePath)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.voice?.stt?.preferred?.providerId).toBe(STT_PROVIDER_ID)
    expect(read.value.voice?.stt?.preferred?.modelId).toBe(STT_MODEL_ID)
    // ...and the TTS write did land.
    expect(read.value.voice?.tts?.preferred?.voiceId).toBe('pt-BR-fabiana-gamma')
  })

  it('d: a voice.enabled=false write preserves the STT selection', async () => {
    const { filePath } = await withDoc(seedDoc())
    await updateLiaProductConfig(filePath, sttDefaultUpdate())

    const write = await updateLiaProductConfig(filePath, { voice: { enabled: false } })

    expect(write.status).toBe('ok')
    const read = await readLiaProductConfig(filePath)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.voice?.enabled).toBe(false)
    expect(read.value.voice?.stt?.preferred?.providerId).toBe(STT_PROVIDER_ID)
    expect(read.value.voice?.stt?.preferred?.modelId).toBe(STT_MODEL_ID)
  })

  it('e: engine, fallback and runtime voice facts survive the STT write untouched', async () => {
    const { filePath, raw } = await withDoc(seedDoc())
    const before = JSON.parse(await raw())

    await updateLiaProductConfig(filePath, sttDefaultUpdate())

    const after = JSON.parse(await raw())
    expect(after.voice.engine).toEqual(before.voice.engine)
    expect(after.voice.fallback).toEqual(before.voice.fallback)
    expect(after.voice.runtime).toEqual(before.voice.runtime)
    // The voice subtree is otherwise identical: STT is purely additive.
    expect(Object.keys(after.voice).sort()).toEqual([...Object.keys(before.voice), 'stt'].sort())
  })

  it('f: chat provider, persona, preferences, brain and setup survive the STT write', async () => {
    const { filePath, raw } = await withDoc(seedDoc())
    const before = JSON.parse(await raw())

    await updateLiaProductConfig(filePath, sttDefaultUpdate())

    const after = JSON.parse(await raw())
    expect(after.provider).toEqual(before.provider)
    expect(after.persona).toEqual(before.persona)
    expect(after.preferences).toEqual(before.preferences)
    expect(after.brain).toEqual(before.brain)
    expect(after.setup).toEqual(before.setup)
    expect(after.schemaVersion).toBe(1)
  })

  it('g: unknown and legacy raw fields are preserved', async () => {
    // The tolerant writer merges onto the RAW document, so a field this schema
    // does not model - including an older nested voice shape - round-trips.
    const legacyShape = { engine: { preferred: { id: 'lia-voice-kokoro' } }, fallback: { activeId: 'speech-noop', mode: 'runtime' } }
    const { filePath, raw } = await withDoc({
      ...seedDoc(),
      futureSection: { nested: { flag: true, list: [1, 2, 3] } },
      voice: { ...seedDoc().voice, legacyShape },
    })

    await updateLiaProductConfig(filePath, sttDefaultUpdate())

    const after = JSON.parse(await raw())
    expect(after.futureSection).toEqual({ nested: { flag: true, list: [1, 2, 3] } })
    expect(after.voice.legacyShape).toEqual(legacyShape)
    expect(after.voice.stt.preferred.providerId).toBe(STT_PROVIDER_ID)
  })

  it('h: a secret-like STT payload is vetoed and the document is left unchanged', async () => {
    const { filePath, raw } = await withDoc(seedDoc())
    const before = await raw()

    const write = await updateLiaProductConfig(filePath, {
      voice: { stt: { preferred: { apiKey: 'gsk-not-a-real-key', providerId: STT_PROVIDER_ID } } },
    } as never)

    expect(write.status).toBe('secret-forbidden')
    // Not corrupted, not healed, not partially written.
    expect(await raw()).toBe(before)
    const read = await readLiaProductConfig(filePath)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.voice?.stt).toBeUndefined()
    expect(await raw()).not.toContain('gsk-not-a-real-key')
  })

  it('i: an old STT-less document stays valid, and absence stays absence', async () => {
    const { filePath } = await withDoc(seedDoc())

    const read = await readLiaProductConfig(filePath)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    // Absent, never an invented default - and specifically never Web Speech.
    expect(read.value.voice?.stt).toBeUndefined()

    // An unrelated write never materialises a selection either.
    await updateLiaProductConfig(filePath, { preferences: { language: 'pt-BR' } })
    const after = await readLiaProductConfig(filePath)
    expect(after.status).toBe('ok')
    if (after.status !== 'ok')
      return
    expect(after.value.voice?.stt).toBeUndefined()
  })

  it('j: an explicit null clears a previous selection back to the product default', async () => {
    const { filePath } = await withDoc(seedDoc())
    await updateLiaProductConfig(filePath, sttDefaultUpdate())

    await updateLiaProductConfig(filePath, { voice: { stt: { preferred: null } } })

    const read = await readLiaProductConfig(filePath)
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    expect(read.value.voice?.stt?.preferred).toBeUndefined()
    // The sibling TTS selection is untouched by the clear.
    expect(read.value.voice?.tts?.preferred?.voiceId).toBe('pt-BR-joao-gamma')
  })
})
