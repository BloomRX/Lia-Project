/*
 * Phase 7.9C bridge contract: the Lia Voice IPC surface with a stock engine
 * (Kokoro) registered at the host seam.
 *
 * The module-graph mocking mirrors `./voice-config.test.ts`: the real
 * bridge body + the REAL lia-core Voice Service (serialization, routing,
 * metrics) run; only the IPC transport, the lifecycle hook registry and the
 * engine itself are replaced. The engine here is a faked LiaVoiceEngine -
 * the real Kokoro adapter's behavior is pinned by the lia-core engine
 * tests; this file pins the BRIDGE's obligations to it.
 */
import type { LiaVoiceEngine, LiaVoiceSynthesisInput } from '@lia/core/voice/engines/types'
import type { MainContext } from '@moeru/eventa/adapters/electron/main'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LiaVoiceEngineError } from '@lia/core/voice/engines/types'

const statusChannel = { id: 'eventa:invoke:lia:voice:status' }
const synthesizeChannel = { id: 'eventa:invoke:lia:voice:synthesize' }
const engineConfigGetChannel = { id: 'eventa:invoke:lia:voice:engine-config:get' }
const engineConfigSetChannel = { id: 'eventa:invoke:lia:voice:engine-config:set' }

type InvokeHandler = (...args: never[]) => unknown

interface EngineCalls {
  healths: number
  inputs: LiaVoiceSynthesisInput[]
  stops: number
}

function fakeKokoroEngine(calls: EngineCalls): LiaVoiceEngine {
  return {
    id: 'kokoro',
    capabilities: () => ({ clonesVoice: false, requiresNetwork: false, runsLocally: true, streams: false }),
    health: async () => {
      calls.healths += 1
      return { device: 'cpu', modelLoaded: true, ok: true, state: 'ready' }
    },
    start: async () => {},
    stop: async () => {
      calls.stops += 1
    },
    synthesize: async (input: LiaVoiceSynthesisInput) => {
      calls.inputs.push(input)
      if (!input.text.trim())
        throw new LiaVoiceEngineError('kokoro', 'input-invalid', 'empty synthesis input')
      return {
        audio: new Uint8Array([1, 2, 3, 4]).buffer,
        audioDurationMs: 1200,
        channels: 1,
        engine: 'kokoro',
        generationMs: 500,
        sampleRate: 24000,
      }
    },
  }
}

function mockEnv() {
  vi.resetModules()

  const handlers = new Map<unknown, InvokeHandler>()
  const beforeQuitHooks: Array<() => Promise<void> | void> = []

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
    onAppBeforeQuit: (hook: () => Promise<void> | void) => {
      beforeQuitHooks.push(hook)
    },
  }))

  return { beforeQuitHooks, handlers }
}

const EMPTY_STORE = {
  get: async () => undefined,
  list: async () => [],
  resolveFile: () => null,
} as never

async function loadBridge(engines: LiaVoiceEngine[]) {
  const env = mockEnv()
  const { registerLiaVoiceBridge } = await import('./lia-voice-service')
  const productConfig = (() => {
    let doc: Record<string, unknown> | undefined
    return {
      get: () => doc as never,
      update: (value: Record<string, unknown>) => {
        doc = value
      },
    }
  })()
  registerLiaVoiceBridge({
    context: {} as MainContext,
    engines,
    liaProductConfig: productConfig,
    store: EMPTY_STORE,
  })
  return env
}

describe('lia voice bridge with a stock engine registered (Phase 7.9C)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('status reports the healthy engine by id (engine fact, never persona text)', async () => {
    const calls: EngineCalls = { healths: 0, inputs: [], stops: 0 }
    const env = await loadBridge([fakeKokoroEngine(calls)])
    const status = await env.handlers.get(statusChannel)!({} as never) as { state: string, engine?: string }
    expect(status).toEqual({ engine: 'kokoro', state: 'ready' })
  })

  it('synthesize WITHOUT a profile reaches the engine default voice (reference never set)', async () => {
    const calls: EngineCalls = { healths: 0, inputs: [], stops: 0 }
    const env = await loadBridge([fakeKokoroEngine(calls)])
    const result = await env.handlers.get(synthesizeChannel)!({ language: 'pt-BR', text: 'Oi, tudo bem?' } as never) as { audio: ArrayBuffer, engine: string }
    expect(result.engine).toBe('kokoro')
    expect(new Uint8Array(result.audio)).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(calls.inputs).toHaveLength(1)
    expect(calls.inputs[0]!.text).toBe('Oi, tudo bem?')
    expect(calls.inputs[0]!.language).toBe('pt-BR')
    expect(calls.inputs[0]!.profileId).toBeUndefined()
    expect(calls.inputs[0]!.referenceAudioPath).toBeUndefined()
    expect(calls.inputs[0]!.referenceText).toBeUndefined()
  })

  it('synthesize WITH a profile keeps the library contract (unknown profile is a clean error)', async () => {
    const calls: EngineCalls = { healths: 0, inputs: [], stops: 0 }
    const env = await loadBridge([fakeKokoroEngine(calls)])
    await expect(env.handlers.get(synthesizeChannel)!({ profileId: 'gone', text: 'Oi' } as never))
      .rejects.toThrow('no longer exists')
    expect(calls.inputs).toEqual([])
  })

  it('empty text surfaces as input-invalid through the bridge (engine taxonomy preserved)', async () => {
    const calls: EngineCalls = { healths: 0, inputs: [], stops: 0 }
    const env = await loadBridge([fakeKokoroEngine(calls)])
    await expect(env.handlers.get(synthesizeChannel)!({ text: '   ' } as never))
      .rejects.toMatchObject({ kind: 'input-invalid' })
  })

  it('the before-quit lifecycle hook stops every registered engine (idempotent host release)', async () => {
    const calls: EngineCalls = { healths: 0, inputs: [], stops: 0 }
    const env = await loadBridge([fakeKokoroEngine(calls)])
    expect(env.beforeQuitHooks).toHaveLength(1)
    await env.beforeQuitHooks[0]!()
    expect(calls.stops).toBe(1)
  })

  it('the bridge registers no engine itself: the empty default stays honestly unavailable', async () => {
    const env = await loadBridge([])
    const status = await env.handlers.get(statusChannel)!({} as never) as { state: string, engine?: string }
    expect(status.state).toBe('unavailable')
    expect(status.engine).toBeUndefined()
  })
})
