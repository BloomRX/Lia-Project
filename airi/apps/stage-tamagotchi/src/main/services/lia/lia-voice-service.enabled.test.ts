/*
 * Phase 7.9H-B1: the Stage honors the product-level voice switch.
 *
 * `voice.enabled = false` must silence spoken output at the ONE central
 * speech-output gate (this bridge), without touching runtime management:
 *
 *   A. startup greeting does not synthesize (the greeting's ready-wait
 *      reads `status`; disabled -> honestly unavailable -> its existing
 *      `voice-unavailable` outcome, latch untouched, nothing plays);
 *   B. normal replies do not synthesize (the pipeline's ONLY route to an
 *      engine is `synthesize`; disabled -> silent WAV, engine untouched);
 *   C. text stays fully available (the bridge registers cleanly, the
 *      capability probe answers "no voice" - the persona goes text-only -
 *      and no path throws);
 *   D. `voice.enabled: true` keeps the existing speech behavior;
 *   E. ABSENT `voice.enabled` stays backward-compatible (enabled);
 *   F. toggling back to enabled resumes speech through the SAME engine
 *      instance - zero reinstall, zero extra engine starts while off.
 *
 * Same module-graph contract as `lia-voice-service.kokoro.test.ts`: real
 * bridge body + real lia-core Voice Service; only the IPC transport, the
 * lifecycle hook registry and the engine are faked.
 */
import type { LiaVoiceEngine, LiaVoiceSynthesisInput } from '@lia/core/voice/engines/types'
import type { MainContext } from '@moeru/eventa/adapters/electron/main'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const statusChannel = { id: 'eventa:invoke:lia:voice:status' }
const synthesizeChannel = { id: 'eventa:invoke:lia:voice:synthesize' }
const engineConfigGetChannel = { id: 'eventa:invoke:lia:voice:engine-config:get' }
const engineConfigSetChannel = { id: 'eventa:invoke:lia:voice:engine-config:set' }

type InvokeHandler = (...args: never[]) => unknown

interface EngineCalls {
  healths: number
  inputs: LiaVoiceSynthesisInput[]
  starts: number
}

function fakeKokoroEngine(calls: EngineCalls): LiaVoiceEngine {
  return {
    id: 'kokoro',
    capabilities: () => ({ clonesVoice: false, requiresNetwork: false, runsLocally: true, streams: false }),
    health: async () => {
      calls.healths += 1
      return { device: 'cpu', modelLoaded: true, ok: true, state: 'ready' }
    },
    start: async () => {
      calls.starts += 1
    },
    stop: async () => {},
    synthesize: async (input: LiaVoiceSynthesisInput) => {
      calls.inputs.push(input)
      return {
        audio: new Uint8Array([9, 8, 7, 6]).buffer,
        audioDurationMs: 900,
        channels: 1,
        engine: 'kokoro',
        generationMs: 300,
        sampleRate: 24000,
      }
    },
  }
}

function mockEnv() {
  vi.resetModules()

  const handlers = new Map<unknown, InvokeHandler>()

  vi.doMock('@moeru/eventa', () => ({
    defineInvokeHandler: (_context: unknown, channel: unknown, handler: InvokeHandler) => {
      handlers.set(channel, handler)
    },
  }))

  vi.doMock('../../../shared/eventa', () => ({
    electronLiaVoiceEngineConfigGet: engineConfigGetChannel,
    electronLiaVoiceEngineConfigSet: engineConfigSetChannel,
    electronLiaVoiceStatus: statusChannel,
    electronLiaVoiceSynthesize: synthesizeChannel,
  }))

  vi.doMock('../../libs/bootkit/lifecycle', () => ({
    onAppBeforeQuit: () => {},
  }))

  return { handlers }
}

const EMPTY_STORE = {
  get: async () => undefined,
  list: async () => [],
  resolveFile: () => null,
} as never

/**
 * The Stage's in-memory product-config seam (same shape the real
 * `createConfig` store exposes). Seeded per test; `update` is the live
 * toggle seam (what the re-enable test flips).
 */
function productConfig(seed?: Record<string, unknown>) {
  let doc: Record<string, unknown> | undefined = seed
  return {
    get: () => doc as never,
    update: (value: Record<string, unknown>) => {
      doc = value
    },
  }
}

async function loadBridge(engines: LiaVoiceEngine[], config: ReturnType<typeof productConfig>) {
  const env = mockEnv()
  const { registerLiaVoiceBridge } = await import('./lia-voice-service')
  const bridge = registerLiaVoiceBridge({
    context: {} as MainContext,
    engines,
    liaProductConfig: config,
    store: EMPTY_STORE,
  })
  return { ...env, bridge }
}

/** Asserts a byte-faithful minimal silent WAV (RIFF/WAVE PCM, zero samples). */
function expectSilentWav(audio: ArrayBuffer) {
  const view = new DataView(audio)
  const label = (offset: number, length: number) =>
    Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join('')
  expect(label(0, 4)).toBe('RIFF')
  expect(label(8, 4)).toBe('WAVE')
  expect(label(12, 4)).toBe('fmt ')
  expect(view.getUint16(20, true)).toBe(1) // PCM
  expect(view.getUint16(22, true)).toBe(1) // mono
  expect(label(36, 4)).toBe('data')
  const dataSize = view.getUint32(40, true)
  expect(dataSize).toBeGreaterThan(0)
  const samples = new Uint8Array(audio, 44, dataSize)
  expect(samples.every(byte => byte === 0)).toBe(true)
}

describe('lia voice bridge honors voice.enabled (Phase 7.9H-B1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('a: disabled -> status is honestly unavailable, so the greeting ready-wait ends without synthesis', async () => {
    const calls: EngineCalls = { healths: 0, inputs: [], starts: 0 }
    const config = productConfig({ schemaVersion: 1, voice: { enabled: false } })
    const env = await loadBridge([fakeKokoroEngine(calls)], config)

    // The renderer greeting's ONLY readiness fact is this invoke; it breaks
    // out of the ready-wait on anything but `ready` (its honest
    // `voice-unavailable` outcome - nothing synthesized, latch unclaimed).
    const status = await env.handlers.get(statusChannel)!({} as never) as { note?: string, state: string }
    expect(status.state).toBe('unavailable')
    expect(status.note).toBe('voice-disabled')
    expect(calls.healths).toBe(0) // not even probed while off
  })

  it('b: disabled -> a normal reply synthesizes nothing (silent WAV, engine untouched)', async () => {
    const calls: EngineCalls = { healths: 0, inputs: [], starts: 0 }
    const config = productConfig({ schemaVersion: 1, voice: { enabled: false } })
    const env = await loadBridge([fakeKokoroEngine(calls)], config)

    const result = await env.handlers.get(synthesizeChannel)!({ language: 'pt-BR', text: 'Oi, tudo bem?' } as never) as { audio: ArrayBuffer, engine: string }
    expect(result.engine).toBe('none')
    expectSilentWav(result.audio)
    expect(calls.inputs).toEqual([]) // zero synthesis
    expect(calls.starts).toBe(0) // not even lazily started
  })

  it('c: disabled -> text stays fully available: bridge registers cleanly and the capability probe answers no-voice', async () => {
    const calls: EngineCalls = { healths: 0, inputs: [], starts: 0 }
    const config = productConfig({ schemaVersion: 1, voice: { enabled: false } })
    const env = await loadBridge([fakeKokoroEngine(calls)], config)

    // The capability truth the persona reads: voice unavailable -> the
    // persona goes text-only. Nothing throws, nothing is uninstalled.
    expect(await env.bridge.voiceAvailable()).toBe(false)
    expect(env.handlers.has(statusChannel)).toBe(true)
    expect(env.handlers.has(synthesizeChannel)).toBe(true)
    expect(calls.healths).toBe(0)
    expect(calls.inputs).toEqual([])
  })

  it('d: enabled=true -> the existing speech behavior remains (status ready, synthesis reaches the engine)', async () => {
    const calls: EngineCalls = { healths: 0, inputs: [], starts: 0 }
    const config = productConfig({ schemaVersion: 1, voice: { enabled: true } })
    const env = await loadBridge([fakeKokoroEngine(calls)], config)

    const status = await env.handlers.get(statusChannel)!({} as never) as { engine?: string, state: string }
    expect(status).toEqual({ engine: 'kokoro', state: 'ready' })

    const result = await env.handlers.get(synthesizeChannel)!({ text: 'Oi!' } as never) as { audio: ArrayBuffer, engine: string }
    expect(result.engine).toBe('kokoro')
    expect(new Uint8Array(result.audio)).toEqual(new Uint8Array([9, 8, 7, 6]))
    expect(calls.inputs).toHaveLength(1)
  })

  it('e: ABSENT voice.enabled stays backward-compatible (voice is part of the default experience)', async () => {
    const calls: EngineCalls = { healths: 0, inputs: [], starts: 0 }
    // A pre-7.9H document: no `enabled` key anywhere.
    const config = productConfig({ schemaVersion: 1, voice: {} })
    const env = await loadBridge([fakeKokoroEngine(calls)], config)

    const status = await env.handlers.get(statusChannel)!({} as never) as { state: string }
    expect(status.state).toBe('ready')
    await env.handlers.get(synthesizeChannel)!({ text: 'Oi!' } as never)
    expect(calls.inputs).toHaveLength(1)

    // And the extreme case - no product config loaded at all.
    const bareCalls: EngineCalls = { healths: 0, inputs: [], starts: 0 }
    const bare = await loadBridge([fakeKokoroEngine(bareCalls)], productConfig())
    expect(((await bare.handlers.get(statusChannel)!({} as never)) as { state: string }).state).toBe('ready')
  })

  it('f: toggling back to enabled resumes speech through the same engine - no reinstall, no extra starts', async () => {
    const calls: EngineCalls = { healths: 0, inputs: [], starts: 0 }
    const engine = fakeKokoroEngine(calls)
    const config = productConfig({ schemaVersion: 1, voice: { enabled: false } })
    const env = await loadBridge([engine], config)

    // Off: nothing happens, the engine is never even started.
    await env.handlers.get(synthesizeChannel)!({ text: 'Oi!' } as never)
    expect(calls.inputs).toEqual([])
    expect(calls.starts).toBe(0)

    // The live toggle (the config store's update seam).
    config.update({ schemaVersion: 1, voice: { enabled: true } })

    // Speech resumes through the SAME registered engine instance: the
    // synthesis below reaches it directly - there is no install/reinstall
    // verb on this path at all, and no extra start happened while off.
    const status = await env.handlers.get(statusChannel)!({} as never) as { state: string }
    expect(status.state).toBe('ready')
    const result = await env.handlers.get(synthesizeChannel)!({ text: 'Voltei!' } as never) as { engine: string }
    expect(result.engine).toBe('kokoro')
    expect(calls.inputs).toHaveLength(1)
    expect(calls.inputs[0]!.text).toBe('Voltei!')
    expect(await env.bridge.voiceAvailable()).toBe(true)
  })
})
