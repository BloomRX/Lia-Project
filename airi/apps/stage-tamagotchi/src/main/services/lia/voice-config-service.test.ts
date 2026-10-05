import type { LiaProductConfig } from '../../configs/lia'

import { readFileSync } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Phase 8.0D-10B-4D4C4-SHELL-B1: the READ-ONLY managed Hearing facts bridge.
 *
 * Same mocking approach as `voice-config.test.ts` - `@moeru/eventa` is stubbed so
 * `defineInvokeHandler` *captures* the handler registered per channel, and the
 * tests call those captured handlers. The real `registerLiaVoiceConfigBridge`
 * body runs (including its nested `registerLiaHearingConfigBridge` call); only
 * the IPC transport is replaced. Persistence is the real
 * `createLiaProductConfig()` over an in-memory disk, so the valibot schema and
 * the `lia-product.json` path are exercised for real.
 */

const voiceConfigGetChannel = { id: 'eventa:invoke:lia:voice:config:get' }
const voiceConfigSetChannel = { id: 'eventa:invoke:lia:voice:config:set' }
const hearingConfigGetChannel = { id: 'eventa:invoke:lia:hearing:config:get' }

interface FsMocks {
  userData: string
  existsSync: () => boolean
  readFileSync: () => string
}

type InvokeHandler = (...args: never[]) => unknown

function missingFileMocks(userData: string): FsMocks {
  return { userData, existsSync: () => false, readFileSync: () => '' }
}

function existingFileMocks(userData: string, raw: string): FsMocks {
  return { userData, existsSync: () => true, readFileSync: () => raw }
}

/** Installs every module-graph mock a load of the bridge needs. */
function mockEnv(fs: FsMocks) {
  vi.resetModules()

  const handlers = new Map<unknown, InvokeHandler>()

  const copyFile = vi.fn(async () => {})
  const mkdir = vi.fn(async () => {})
  const rename = vi.fn(async () => {})
  const writeFile = vi.fn(async () => {})

  vi.doMock('electron', () => ({
    app: { getPath: vi.fn(() => fs.userData) },
  }))
  // Unwrap the 250ms save throttle so updates flush synchronously in tests.
  vi.doMock('es-toolkit', () => ({
    throttle: (handler: (...args: unknown[]) => unknown) => handler,
  }))
  vi.doMock('node:fs', () => ({
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
  }))
  vi.doMock('node:fs/promises', () => ({ copyFile, mkdir, rename, writeFile }))

  vi.doMock('@moeru/eventa', () => ({
    defineInvokeHandler: (_context: unknown, channel: unknown, handler: InvokeHandler) => {
      handlers.set(channel, handler)
    },
  }))
  vi.doMock('../../../shared/eventa', () => ({
    electronLiaHearingConfigGet: hearingConfigGetChannel,
    electronLiaVoiceConfigGet: voiceConfigGetChannel,
    electronLiaVoiceConfigSet: voiceConfigSetChannel,
  }))

  return { handlers, writeFile }
}

function bridgeApi(handlers: Map<unknown, InvokeHandler>, writeFile: ReturnType<typeof vi.fn>) {
  return {
    getTts: () => {
      const handler = handlers.get(voiceConfigGetChannel)
      expect(handler, 'TTS Get handler registered').toBeDefined()
      return handler!()
    },
    getHearing: () => {
      const handler = handlers.get(hearingConfigGetChannel)
      expect(handler, 'Hearing Get handler registered').toBeDefined()
      return handler!() as Record<string, unknown>
    },
    setTts: (payload: unknown) => {
      const handler = handlers.get(voiceConfigSetChannel)
      expect(handler, 'TTS Set handler registered').toBeDefined()
      return handler!(payload as never)
    },
    /** The JSON body of the last flush, parsed. */
    writtenDoc: async () => {
      await vi.waitFor(() => {
        expect(writeFile).toHaveBeenCalled()
      })
      return JSON.parse(String(writeFile.mock.calls.at(-1)![1])) as Record<string, unknown>
    },
  }
}

/** Loads the bridge wired to the REAL product config over an in-memory disk. */
async function loadBridge(fs: FsMocks) {
  const env = mockEnv(fs)

  const lia = await import('../../configs/lia')
  const { registerLiaVoiceConfigBridge } = await import('./voice-config-service')

  const productConfig = lia.createLiaProductConfig()
  registerLiaVoiceConfigBridge({
    // The bridge only forwards the context to `defineInvokeHandler`, which the
    // stub above ignores - nothing in the bridge reads it.
    context: {} as Parameters<typeof registerLiaVoiceConfigBridge>[0]['context'],
    liaProductConfig: productConfig,
  })

  return { ...bridgeApi(env.handlers, env.writeFile), handlers: env.handlers }
}

/** Voice ON with the canonical Lia-managed STT target, plus a TTS selection. */
function sttDoc(voice: Record<string, unknown> = {}) {
  return {
    persona: { activeCardId: 'lia' },
    preferences: { language: 'pt-BR' },
    provider: { chat: { preferred: { providerId: 'groq' } } },
    schemaVersion: 1,
    voice: {
      stt: { preferred: { modelId: 'whisper-large-v3-turbo', providerId: 'lia-groq-transcription' } },
      tts: { fallback: [], preferred: { providerId: 'lia-voice-kokoro', voiceId: 'pt-BR-joao-gamma' } },
      ...voice,
    },
  }
}

/**
 * Source guards must look at CODE, not prose: the contract's doc comment
 * explains what does NOT exist, and those words would otherwise trip the
 * negative assertions below.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('lia managed hearing config bridge (Phase 8.0D SHELL-B1)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('registers the read-only hearing channel alongside the tts channels', async () => {
    const { handlers } = await loadBridge(missingFileMocks('/tmp/u'))

    // Exactly three channels: tts get, tts set, hearing get. Nothing more.
    expect(handlers.size).toBe(3)
    expect(handlers.has(hearingConfigGetChannel)).toBe(true)
    expect(handlers.has(voiceConfigGetChannel)).toBe(true)
    expect(handlers.has(voiceConfigSetChannel)).toBe(true)
  })

  it('the getter returns the enabled state and the canonical stt target', async () => {
    const bridge = await loadBridge(existingFileMocks('/tmp/u', JSON.stringify(sttDoc())))

    expect(bridge.getHearing()).toEqual({
      preferred: { modelId: 'whisper-large-v3-turbo', providerId: 'lia-groq-transcription' },
    })
    // `enabled` is a tri-state: absent means enabled, so the key is omitted
    // rather than invented as a boolean.
    expect('enabled' in bridge.getHearing()).toBe(false)
  })

  it('an explicit voice.enabled=false is forwarded as false, not dropped', async () => {
    const bridge = await loadBridge(existingFileMocks('/tmp/u', JSON.stringify(sttDoc({ enabled: false }))))

    expect(bridge.getHearing()).toEqual({
      enabled: false,
      preferred: { modelId: 'whisper-large-v3-turbo', providerId: 'lia-groq-transcription' },
    })
  })

  it('an absent stt target stays absent - the bridge invents no default', async () => {
    const doc = sttDoc()
    delete (doc.voice as Record<string, unknown>).stt
    const bridge = await loadBridge(existingFileMocks('/tmp/u', JSON.stringify(doc)))

    const config = bridge.getHearing()
    // No preferred key at all: never Web Speech, never a guessed provider.
    expect('preferred' in config).toBe(false)
  })

  it('a document with no voice section at all yields an empty hearing config', async () => {
    const bridge = await loadBridge(missingFileMocks('/tmp/u'))

    expect(bridge.getHearing()).toEqual({})
  })

  it('the getter forwards only reference metadata - never a secret or a base url', async () => {
    // A hand-edited or corrupted document could carry junk inside the target.
    const doc = sttDoc({
      stt: {
        preferred: {
          apiKey: 'gsk-not-a-real-key',
          baseUrl: 'https://api.groq.com/openai/v1/',
          modelId: 'whisper-large-v3-turbo',
          providerId: 'lia-groq-transcription',
          token: 'bearer-not-a-real-token',
        },
      },
    })
    const bridge = await loadBridge(existingFileMocks('/tmp/u', JSON.stringify(doc)))

    expect(bridge.getHearing()).toEqual({
      preferred: { modelId: 'whisper-large-v3-turbo', providerId: 'lia-groq-transcription' },
    })
    const serialized = JSON.stringify(bridge.getHearing())
    expect(serialized).not.toContain('gsk-not-a-real-key')
    expect(serialized).not.toContain('bearer-not-a-real-token')
    expect(serialized).not.toContain('api.groq.com')
    expect(serialized).not.toContain('apiKey')
  })

  it('a target without a usable provider id is not forwarded', async () => {
    const bridge = await loadBridge(existingFileMocks('/tmp/u', JSON.stringify(sttDoc({
      stt: { preferred: { modelId: 'whisper-large-v3-turbo' } },
    }))))

    expect('preferred' in bridge.getHearing()).toBe(false)
  })

  it('the existing tts get/set surface is unchanged', async () => {
    const bridge = await loadBridge(existingFileMocks('/tmp/u', JSON.stringify(sttDoc())))

    expect(bridge.getTts()).toEqual({
      tts: { fallback: [], preferred: { providerId: 'lia-voice-kokoro', voiceId: 'pt-BR-joao-gamma' } },
    })

    bridge.setTts({
      tts: {
        fallback: [{ providerId: 'voicevox' }],
        preferred: { modelId: 'kokoro-82M-v1.0', providerId: 'lia-voice-kokoro', voiceId: 'pt-BR-fabiana-gamma' },
      },
    })

    const written = await bridge.writtenDoc()
    expect((written.voice as Record<string, unknown>).tts).toEqual({
      fallback: [{ providerId: 'voicevox' }],
      preferred: { modelId: 'kokoro-82M-v1.0', providerId: 'lia-voice-kokoro', voiceId: 'pt-BR-fabiana-gamma' },
    })
  })

  it('a tts write preserves the stt selection it has no surface for', async () => {
    const bridge = await loadBridge(existingFileMocks('/tmp/u', JSON.stringify(sttDoc())))

    bridge.setTts({ tts: { preferred: { providerId: 'lia-voice-kokoro', voiceId: 'pt-BR-fabiana-gamma' } } })

    const written = await bridge.writtenDoc()
    expect((written.voice as Record<string, unknown>).stt).toEqual({
      preferred: { modelId: 'whisper-large-v3-turbo', providerId: 'lia-groq-transcription' },
    })
    // ...and the switch is preserved too.
    const afterTts = bridge.getHearing()
    expect(afterTts.preferred).toEqual({
      modelId: 'whisper-large-v3-turbo',
      providerId: 'lia-groq-transcription',
    })
  })

  it('the hearing bridge never writes the document', async () => {
    const env = mockEnv(existingFileMocks('/tmp/u', JSON.stringify(sttDoc())))
    const lia = await import('../../configs/lia')
    const { registerLiaHearingConfigBridge } = await import('./voice-config-service')
    const productConfig = lia.createLiaProductConfig()

    registerLiaHearingConfigBridge({
      context: {} as Parameters<typeof registerLiaHearingConfigBridge>[0]['context'],
      liaProductConfig: productConfig,
    })

    const handler = env.handlers.get(hearingConfigGetChannel)
    expect(handler, 'Hearing Get handler registered').toBeDefined()
    handler!()
    handler!()

    // Read-only: registering and calling the getter flushes nothing to disk.
    expect(env.writeFile).not.toHaveBeenCalled()
    // And the standalone hearing bridge registers nothing but its own getter.
    expect(env.handlers.size).toBe(1)
  })

  it('the renderer has no stt setter through the new surface', async () => {
    // Structural proof, at two levels. (Uses the statically imported real
    // `node:fs` - the dynamic one is the in-memory disk stub.)

    // 1. The shared contract exports exactly one hearing symbol: the getter.
    //    Comments are stripped first, because the contract's own doc comment
    //    legitimately SPELLS OUT the setter that deliberately does not exist.
    const contract = stripComments(readFileSync(
      new URL('../../../shared/eventa/index.ts', import.meta.url),
      'utf-8',
    ))
    const hearingSymbols = [...new Set(contract.match(/electronLiaHearingConfig\w*/g) ?? [])].sort()
    expect(hearingSymbols).toEqual(['electronLiaHearingConfigGet'])
    expect(contract).not.toContain('eventa:invoke:lia:hearing:config:set')

    // 2. The bridge registers exactly the three channels, one of them hearing.
    const { handlers } = await loadBridge(missingFileMocks('/tmp/u'))
    const hearingChannels = [...handlers.keys()].filter(
      key => String((key as { id?: string }).id ?? '').includes('hearing'),
    )
    expect(hearingChannels).toEqual([hearingConfigGetChannel])
  })
})

/**
 * The hearing bridge must be registered from inside the voice bridge: the voice
 * bridge is the only Lia config bridge the main process wires, and this file is
 * outside the change budget, so the nesting is what guarantees the STT read
 * surface always exists in a managed Stage.
 */
describe('hearing bridge registration point (Phase 8.0D SHELL-B1)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('registering the voice bridge alone also registers the hearing getter', async () => {
    const { handlers } = await loadBridge(missingFileMocks('/tmp/u'))

    expect(handlers.get(hearingConfigGetChannel)).toBeDefined()
  })

  it('the product config type carries the stt selection the bridge reads', async () => {
    // Compile-time coupling: this assertion only typechecks if `voice.stt` is
    // part of the Stage's own config type, so the bridge cannot silently drift
    // to reading a field the schema never validated.
    const config: LiaProductConfig = {
      persona: { activeCardId: 'lia' },
      preferences: { language: 'pt-BR' },
      provider: { chat: { fallback: [], preferred: { providerId: 'groq' } } },
      schemaVersion: 1,
      voice: { stt: { preferred: { modelId: 'whisper-large-v3-turbo', providerId: 'lia-groq-transcription' } } },
    }
    expect(config.voice?.stt?.preferred?.providerId).toBe('lia-groq-transcription')
  })
})
