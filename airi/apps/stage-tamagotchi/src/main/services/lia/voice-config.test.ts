import type { LiaProductConfig } from '../../configs/lia'

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The bridge imports `@moeru/eventa` (`defineInvokeHandler`) and the shared
 * channel definitions at module load, while the product config it writes to
 * pulls `electron` / `es-toolkit` / node fs. Each test therefore rebuilds the
 * module graph with the same mocking approach as `../../configs/lia.test.ts`,
 * plus two additions:
 *
 *  - `@moeru/eventa` is stubbed so `defineInvokeHandler` *captures* the handler
 *    registered for each channel; the tests then call those captured handlers.
 *    The real `registerLiaVoiceConfigBridge` body (normalization + domain
 *    write) is what runs — only the IPC transport is replaced.
 *  - the shared channel module is stubbed with opaque tokens standing in for the
 *    two invoke eventa, which is how the captured handlers are looked up.
 *
 * Persistence is the real `createLiaProductConfig()` over an in-memory disk, so
 * the valibot schema and the `lia-product.json` path are exercised for real.
 */

const voiceConfigGetChannel = { id: 'eventa:invoke:lia:voice:config:get' }
const voiceConfigSetChannel = { id: 'eventa:invoke:lia:voice:config:set' }

interface FsMocks {
  userData: string
  existsSync: () => boolean
  readFileSync: () => string
}

type InvokeHandler = (...args: never[]) => unknown

interface ConfigStub {
  get: () => LiaProductConfig | undefined
  update: (value: LiaProductConfig) => void
}

function missingFileMocks(userData: string): FsMocks {
  return { userData, existsSync: () => false, readFileSync: () => '' }
}

function existingFileMocks(userData: string, raw: string): FsMocks {
  return { userData, existsSync: () => true, readFileSync: () => raw }
}

/** Installs every module-graph mock a load of the bridge needs. */
function mockEnv(fs: FsMocks) {
  // Each load gets a fresh module graph, so the `@moeru/eventa` stub below is
  // the one the bridge actually imports (a cached graph would keep registering
  // into the previous load's handler map) and `persistence`'s module-level
  // config map starts empty — a second load therefore really re-reads the disk.
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
    electronLiaVoiceConfigGet: voiceConfigGetChannel,
    electronLiaVoiceConfigSet: voiceConfigSetChannel,
  }))

  return { handlers, writeFile, copyFile, mkdir, rename }
}

function bridgeApi(handlers: Map<unknown, InvokeHandler>, writeFile: ReturnType<typeof vi.fn>) {
  return {
    get: () => {
      const handler = handlers.get(voiceConfigGetChannel)
      expect(handler, 'Get handler registered').toBeDefined()
      return handler!()
    },
    set: (payload: unknown) => {
      const handler = handlers.get(voiceConfigSetChannel)
      expect(handler, 'Set handler registered').toBeDefined()
      return handler!(payload as never)
    },
    /** Every path this bridge flushed to disk. */
    writtenPaths: () => writeFile.mock.calls.map(call => String(call[0])),
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
    // stub above ignores — nothing in the bridge reads it.
    context: {} as Parameters<typeof registerLiaVoiceConfigBridge>[0]['context'],
    liaProductConfig: productConfig,
  })

  return { ...bridgeApi(env.handlers, env.writeFile), handlers: env.handlers, productConfig }
}

/** Loads the bridge against an injected config handle (no persistence). */
async function loadBridgeWithStub(fs: FsMocks, liaProductConfig: ConfigStub) {
  const env = mockEnv(fs)

  const { registerLiaVoiceConfigBridge } = await import('./voice-config-service')
  registerLiaVoiceConfigBridge({
    context: {} as Parameters<typeof registerLiaVoiceConfigBridge>[0]['context'],
    liaProductConfig,
  })

  return { ...bridgeApi(env.handlers, env.writeFile), handlers: env.handlers, writeFile: env.writeFile }
}

const seededDoc = {
  schemaVersion: 1,
  persona: { activeCardId: 'lia' },
  provider: {
    chat: {
      strategy: 'manual',
      preferred: { providerId: 'openai', modelId: 'gpt-5.5' },
      fallback: [{ providerId: 'groq' }],
      fallbackEnabled: true,
      onboarded: true,
    },
  },
  voice: {},
  preferences: { language: 'pt-BR' },
}

const chosenTts = {
  preferred: { providerId: 'openai-compatible-audio-speech', modelId: 'tts-1', voiceId: 'alloy' },
  fallback: [
    { providerId: 'kokoro-local', modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX', voiceId: 'af_sky' },
    { providerId: 'voicevox' },
  ],
}

describe('lia voice (tts) config bridge', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('registers both invoke handlers for the voice channels', async () => {
    const bridge = await loadBridge(missingFileMocks('/tmp/u'))
    expect(bridge.handlers.has(voiceConfigGetChannel)).toBe(true)
    expect(bridge.handlers.has(voiceConfigSetChannel)).toBe(true)
  })

  it('returns { tts: {} } from Get when there is no config file, and writes nothing', async () => {
    const bridge = await loadBridge(missingFileMocks('/tmp/u'))
    expect(bridge.get()).toEqual({ tts: {} })
    // A read never persists anything.
    expect(bridge.writtenPaths()).toEqual([])
  })

  it('returns { tts: {} } from Get when the config handle reports no document at all', async () => {
    const update = vi.fn()
    const bridge = await loadBridgeWithStub(missingFileMocks('/tmp/u'), { get: () => undefined, update })
    expect(bridge.get()).toEqual({ tts: {} })

    // A write with no existing document starts from the product defaults.
    bridge.set({ tts: { preferred: { providerId: 'kokoro-local' } } })
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).toEqual({
      schemaVersion: 1,
      persona: { activeCardId: 'lia' },
      provider: {},
      voice: { tts: { preferred: { providerId: 'kokoro-local' }, fallback: [] } },
      preferences: {},
    })
  })

  it('round-trips providerId / modelId / voiceId for preferred and fallback', async () => {
    const bridge = await loadBridge(missingFileMocks('/tmp/u'))

    bridge.set({ tts: chosenTts })
    expect(bridge.get()).toEqual({ tts: chosenTts })

    // The flushed document carries the same targets…
    const doc = await bridge.writtenDoc()
    expect(doc.voice).toEqual({ tts: chosenTts })

    // …and a fresh config instance reading it back from disk returns them.
    const reopened = await loadBridge(existingFileMocks('/tmp/u', JSON.stringify(doc)))
    expect(reopened.get()).toEqual({ tts: chosenTts })
  })

  it('writes only the voice domain on Set, preserving persona / provider / preferences', async () => {
    const bridge = await loadBridge(existingFileMocks('/tmp/u', JSON.stringify(seededDoc)))

    bridge.set({ tts: { preferred: { providerId: 'kokoro-local', voiceId: 'af_sky' } } })

    const current = bridge.productConfig.get()
    expect(current?.persona).toEqual({ activeCardId: 'lia' })
    expect(current?.provider?.chat?.preferred).toEqual({ providerId: 'openai', modelId: 'gpt-5.5' })
    expect(current?.provider?.chat?.fallbackEnabled).toBe(true)
    expect(current?.provider?.chat?.onboarded).toBe(true)
    expect(current?.preferences).toEqual({ language: 'pt-BR' })
    expect(current?.voice?.tts?.preferred).toEqual({ providerId: 'kokoro-local', voiceId: 'af_sky' })

    const doc = await bridge.writtenDoc()
    expect(doc.persona).toEqual({ activeCardId: 'lia' })
    expect(doc.preferences).toEqual({ language: 'pt-BR' })
    expect(doc.provider).toEqual(seededDoc.provider)
    // `fallback` is materialized as [] on write (schema default, see service).
    expect(doc.voice).toEqual({ tts: { preferred: { providerId: 'kokoro-local', voiceId: 'af_sky' }, fallback: [] } })
  })

  it('keeps voice.stt untouched — the bridge only owns the tts slice', async () => {
    const bridge = await loadBridge(existingFileMocks('/tmp/u', JSON.stringify({
      schemaVersion: 1,
      persona: {},
      provider: {},
      voice: { stt: { preferred: { providerId: 'groq', modelId: 'whisper-large-v3' } } },
      preferences: {},
    })))

    bridge.set({ tts: { preferred: { providerId: 'voicevox' } } })

    expect(bridge.productConfig.get()?.voice?.stt).toEqual({
      preferred: { providerId: 'groq', modelId: 'whisper-large-v3' },
    })
    expect(bridge.productConfig.get()?.voice?.tts).toEqual({ preferred: { providerId: 'voicevox' }, fallback: [] })
  })

  it('keeps schemaVersion at 1 across writes', async () => {
    const bridge = await loadBridge(existingFileMocks('/tmp/u', JSON.stringify(seededDoc)))
    expect(bridge.productConfig.get()?.schemaVersion).toBe(1)

    bridge.set({ tts: { preferred: { providerId: 'kokoro-local' } } })
    expect(bridge.productConfig.get()?.schemaVersion).toBe(1)

    const doc = await bridge.writtenDoc()
    expect(doc.schemaVersion).toBe(1)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'kokoro-local'],
    ['a number', 42],
    ['an array', [{ providerId: 'voicevox' }]],
    ['an empty object', {}],
    ['a tts that is not an object', { tts: 'kokoro-local' }],
    ['a null tts', { tts: null }],
    ['a tts with no known field', { tts: { voice: 'alloy' } }],
  ])('treats an invalid Set payload (%s) as a no-op', async (_label, payload) => {
    const bridge = await loadBridge(existingFileMocks('/tmp/u', JSON.stringify({
      ...seededDoc,
      voice: { tts: { preferred: { providerId: 'kokoro-local', voiceId: 'af_sky' } } },
    })))

    bridge.set(payload)

    // Nothing was persisted and the previous TTS choice is intact. `fallback`
    // is `optional(array(...), [])` in the product schema, so the document read
    // back from disk always carries the empty-list default.
    expect(bridge.writtenPaths()).toEqual([])
    expect(bridge.get()).toEqual({
      tts: { preferred: { providerId: 'kokoro-local', voiceId: 'af_sky' }, fallback: [] },
    })
  })

  it('drops unknown/credential-shaped fields so no secret can reach lia-product.json', async () => {
    const bridge = await loadBridge(missingFileMocks('/tmp/u'))

    bridge.set({
      tts: {
        preferred: {
          providerId: 'openai-compatible-audio-speech',
          voiceId: 'alloy',
          apiKey: 'sk-super-secret-123',
          baseUrl: 'https://example.com/v1',
        },
        fallback: [
          { providerId: 'elevenlabs', apiKey: 'bearer-AAAA' },
          'not-an-object',
          null,
          { modelId: 'orphan-without-provider' },
        ],
      },
    })

    const doc = await bridge.writtenDoc()
    const raw = JSON.stringify(doc)
    expect(raw).not.toContain('sk-super-secret-123')
    expect(raw).not.toContain('bearer-AAAA')
    expect(raw).not.toContain('https://example.com/v1')
    expect(doc.voice).toEqual({
      tts: {
        preferred: { providerId: 'openai-compatible-audio-speech', voiceId: 'alloy' },
        fallback: [{ providerId: 'elevenlabs' }],
      },
    })
  })

  it('a credential-only payload is rejected outright and persists nothing', async () => {
    const bridge = await loadBridge(missingFileMocks('/tmp/u'))

    bridge.set({ tts: { apiKey: 'sk-super-secret-123' } })

    expect(bridge.writtenPaths()).toEqual([])
    expect(bridge.get()).toEqual({ tts: {} })
  })

  it('writes only lia-product.json, never lia-main-window.json', async () => {
    const bridge = await loadBridge(missingFileMocks('/tmp/u'))

    const productPath = bridge.productConfig.getDiagnostics()?.path
    expect(productPath).toMatch(/lia-product\.json$/)
    expect(productPath).not.toMatch(/lia-main-window\.json$/)

    bridge.set({ tts: { preferred: { providerId: 'kokoro-local' }, fallback: [{ providerId: 'voicevox' }] } })

    await vi.waitFor(() => {
      expect(bridge.writtenPaths().length).toBeGreaterThan(0)
    })
    for (const path of bridge.writtenPaths()) {
      expect(path).toMatch(/lia-product\.json/)
      expect(path).not.toContain('lia-main-window.json')
    }
  })

  it('exposes no secret channel and never persists a credential-shaped key', async () => {
    const bridge = await loadBridge(missingFileMocks('/tmp/u'))

    bridge.set({ tts: { preferred: { providerId: 'openai', modelId: 'tts-1', voiceId: 'alloy' } } })

    const doc = await bridge.writtenDoc()
    // Secrets stay in the Phase 4C vault; this bridge registers no vault channel.
    expect(bridge.handlers.has('eventa:invoke:lia:secret:set')).toBe(false)
    expect(JSON.stringify(doc)).not.toMatch(/apiKey|api_key|token|secret|authorization/i)
  })
})
