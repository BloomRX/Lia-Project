import type { LiaVoiceEngine } from './engines/types'

import { describe, expect, it, vi } from 'vitest'

import { LiaVoiceEngineError } from './engines/types'
import { createLiaVoiceService } from './voice-service'

function engine(id: string, options: { clones?: boolean, fail?: Error, delayMs?: number, audio?: ArrayBuffer } = {}): LiaVoiceEngine {
  return {
    id,
    capabilities: () => ({
      clonesVoice: options.clones ?? false,
      requiresNetwork: false,
      runsLocally: true,
      streams: false,
    }),
    health: async () => ({ ok: !options.fail, state: options.fail ? 'unavailable' : 'ready' }),
    start: async () => {},
    stop: async () => {},
    synthesize: async () => {
      if (options.delayMs)
        await new Promise(resolve => setTimeout(resolve, options.delayMs))
      if (options.fail)
        throw options.fail
      return {
        audio: options.audio ?? new Uint8Array([1, 2, 3]).buffer,
        audioDurationMs: 1000,
        channels: 1,
        engine: id,
        generationMs: 500,
        sampleRate: 24000,
      }
    },
  }
}

const logBuffer: Array<Record<string, string | number | boolean>> = []
const log = (record: Record<string, string | number | boolean>) => logBuffer.push(record)

describe('lia voice service', () => {
  it('routes to the preferred cloning engine first', async () => {
    const service = createLiaVoiceService({
      engines: [engine('fallback-b'), engine('primary-a', { clones: true })],
      fallback: () => ({ enabled: true }),
      log,
      preferredEngineId: () => 'primary-a',
    })
    const output = await service.synthesize({ referenceAudioPath: '/ref.wav', text: 'Oi' })
    expect(output.engine).toBe('primary-a')
  })

  it('falls back to the fallback engine ONLY when enabled (item 16/24: no silent switch)', async () => {
    const down = new LiaVoiceEngineError('primary-a', 'engine-unavailable', 'down')
    const disabled = createLiaVoiceService({
      engines: [engine('primary-a', { clones: true, fail: down }), engine('fallback-b')],
      fallback: () => ({ enabled: false }),
      log,
      preferredEngineId: () => 'primary-a',
    })
    await expect(disabled.synthesize({ referenceAudioPath: '/ref.wav', text: 'Oi' })).rejects.toThrow('down')

    const enabled = createLiaVoiceService({
      engines: [engine('primary-a', { clones: true, fail: down }), engine('fallback-b')],
      fallback: () => ({ enabled: true }),
      log,
      preferredEngineId: () => 'primary-a',
    })
    const output = await enabled.synthesize({ referenceAudioPath: '/ref.wav', text: 'Oi' })
    expect(output.engine).toBe('fallback-b')
  })

  it('a non-cloning engine never receives the reference audio (no masquerade)', async () => {
    const seen: LiaVoiceEngine[] = []
    const spy = engine('fallback-b')
    const down = new LiaVoiceEngineError('primary-a', 'engine-unavailable', 'down')
    const original = spy.synthesize
    spy.synthesize = async (input) => {
      seen.push(input as never)
      expect(input.referenceAudioPath).toBeUndefined()
      expect(input.referenceText).toBeUndefined()
      return original(input)
    }
    const service = createLiaVoiceService({
      engines: [engine('primary-a', { clones: true, fail: down }), spy],
      fallback: () => ({ enabled: true }),
      log,
      preferredEngineId: () => 'primary-a',
    })
    await service.synthesize({ referenceAudioPath: '/secret.wav', referenceText: 'segredo', text: 'Oi' })
    expect(seen).toHaveLength(1)
  })

  it('serializes ALL synthesis through one FIFO (true engine serialization, kept)', async () => {
    const started: string[] = []
    const completed: string[] = []
    const slow = engine('primary-a', { clones: true, delayMs: 30 })
    const original = slow.synthesize
    slow.synthesize = async (input) => {
      started.push(input.text)
      const result = await original(input)
      completed.push(input.text)
      return result
    }
    const service = createLiaVoiceService({
      engines: [slow],
      fallback: () => ({ enabled: false }),
      log,
      preferredEngineId: () => 'primary-a',
    })
    await Promise.all([
      service.synthesize({ text: 'um' }),
      service.synthesize({ text: 'dois' }),
    ])
    expect(started.indexOf('dois')).toBeGreaterThan(completed.indexOf('um'))
  })

  it('emits one metadata-only metrics record per synthesis with RTF (item 14)', async () => {
    logBuffer.length = 0
    const service = createLiaVoiceService({
      engines: [engine('primary-a', { clones: true })],
      fallback: () => ({ enabled: false }),
      log,
      preferredEngineId: () => 'primary-a',
    })
    await service.synthesize({ text: 'Oi Lucas, agora minha voz está funcionando.' })
    const record = logBuffer.find(entry => entry.event === 'lia.voice.synthesize')
    expect(record).toBeDefined()
    expect(record?.engine).toBe('primary-a')
    expect(Number(record?.textLength)).toBe(43)
    expect(Number(record?.rtf)).toBeCloseTo(0.5, 5)
    expect(Number(record?.queueWaitMs)).toBeGreaterThanOrEqual(0)
    // No text, no audio.
    for (const value of Object.values(record ?? {}))
      expect(String(value)).not.toContain('Lucas')
  })

  it('capability truth: available when any usable engine exists (item 17)', async () => {
    const up = createLiaVoiceService({
      engines: [engine('primary-a', { clones: true })],
      fallback: () => ({ enabled: false }),
      log,
      preferredEngineId: () => 'primary-a',
    })
    expect((await up.state()).available).toBe(true)

    const down = new LiaVoiceEngineError('primary-a', 'engine-unavailable', 'down')
    const onlyFallback = createLiaVoiceService({
      engines: [engine('primary-a', { clones: true, fail: down }), engine('fallback-b')],
      fallback: () => ({ enabled: true }),
      log,
      preferredEngineId: () => 'primary-a',
    })
    const state = await onlyFallback.state()
    expect(state.available).toBe(true)
    expect(state.primary?.ok).toBe(false)
    expect(state.fallback?.ok).toBe(true)

    const fallbackOff = createLiaVoiceService({
      engines: [engine('primary-a', { clones: true, fail: down }), engine('fallback-b')],
      fallback: () => ({ enabled: false }),
      log,
      preferredEngineId: () => 'primary-a',
    })
    expect((await fallbackOff.state()).available).toBe(false)
  })

  it('input-invalid never falls through to a second engine (our bug does not leak)', async () => {
    const invalid = new LiaVoiceEngineError('primary-a', 'input-invalid', 'bad input')
    const second = vi.fn()
    const spy = engine('fallback-b')
    spy.synthesize = second as never
    const service = createLiaVoiceService({
      engines: [engine('primary-a', { clones: true, fail: invalid }), spy],
      fallback: () => ({ enabled: true }),
      log,
      preferredEngineId: () => 'primary-a',
    })
    await expect(service.synthesize({ text: ' ' })).rejects.toThrow('bad input')
    expect(second).not.toHaveBeenCalled()
  })
})

describe('stock engines on builds without a cloning engine (Phase 7.9C)', () => {
  it('the registered stock engine answers on its own - the fallback toggle has nothing to gate', async () => {
    const service = createLiaVoiceService({
      engines: [engine('kokoro')],
      fallback: () => ({ enabled: false }),
      log,
      preferredEngineId: () => undefined,
    })
    const output = await service.synthesize({ text: 'Oi, tudo bem?' })
    expect(output.engine).toBe('kokoro')

    const state = await service.state()
    expect(state.available).toBe(true)
    expect(state.fallback?.ok).toBe(true)
    // The toggle FACT is still reported verbatim; it just does not apply.
    expect(state.fallback?.enabled).toBe(false)
  })

  it('reference stripping still protects a stock engine on stock-only builds', async () => {
    const spy = engine('kokoro')
    const received: unknown[] = []
    spy.synthesize = (async (input: unknown) => {
      received.push(input)
      return { audio: new Uint8Array([9]).buffer, engine: 'kokoro' }
    }) as never
    const service = createLiaVoiceService({
      engines: [spy],
      fallback: () => ({ enabled: false }),
      log,
      preferredEngineId: () => undefined,
    })
    await service.synthesize({ referenceAudioPath: '/ref.wav', referenceText: 'ref', text: 'Oi' })
    expect(received).toHaveLength(1)
    expect((received[0] as { referenceAudioPath?: string }).referenceAudioPath).toBeUndefined()
    expect((received[0] as { referenceText?: string }).referenceText).toBeUndefined()
  })

  it('with a cloning engine alongside, stock engines stay the gated tail (old rules unchanged)', async () => {
    const down = new LiaVoiceEngineError('primary-a', 'engine-unavailable', 'down')
    const gated = createLiaVoiceService({
      engines: [engine('primary-a', { clones: true, fail: down }), engine('kokoro')],
      fallback: () => ({ enabled: false }),
      log,
      preferredEngineId: () => 'primary-a',
    })
    // Primary down + fallback disallowed: the stock engine must NOT answer.
    await expect(gated.synthesize({ referenceAudioPath: '/ref.wav', text: 'Oi' })).rejects.toThrow('down')
    const state = await gated.state()
    expect(state.available).toBe(false)
    expect(state.fallback?.note).toBe('fallback disabled by configuration')

    const allowed = createLiaVoiceService({
      engines: [engine('primary-a', { clones: true, fail: down }), engine('kokoro')],
      fallback: () => ({ enabled: true }),
      log,
      preferredEngineId: () => 'primary-a',
    })
    const output = await allowed.synthesize({ referenceAudioPath: '/ref.wav', text: 'Oi' })
    expect(output.engine).toBe('kokoro')
  })
})

describe('7.9F selected-engine gate (configured-but-unbuildable = honest unavailable, never silent fallback)', () => {
  const unknownSelection = () => ({ source: 'configured' as const, unknownConfiguredId: 'alltalk-server' })

  it('the ROUTE is empty: no engine is even ASKED to synthesize', async () => {
    const called: string[] = []
    const healthy = engine('kokoro')
    const spy = {
      ...healthy,
      synthesize: async (input: never) => {
        called.push('kokoro')
        return healthy.synthesize(input)
      },
    } as unknown as LiaVoiceEngine
    const service = createLiaVoiceService({
      engines: [spy],
      fallback: () => ({ enabled: true }),
      preferredEngineId: () => undefined,
      selection: unknownSelection,
    })
    // Synthesis must fail honestly instead of landing on the healthy engine.
    await expect(service.synthesize({ text: 'oi' })).rejects.toThrow()
    expect(called).toEqual([])
  })

  it('state() is honestly UNAVAILABLE and names the pinned id (no health probe of other engines)', async () => {
    let probed = false
    const spy = {
      ...engine('kokoro'),
      health: async () => {
        probed = true
        return { ok: true, state: 'ready' }
      },
    } as unknown as LiaVoiceEngine
    const service = createLiaVoiceService({
      engines: [spy],
      fallback: () => ({ enabled: true }),
      preferredEngineId: () => undefined,
      selection: unknownSelection,
    })
    const state = await service.state()
    expect(state.available).toBe(false)
    expect(state.primary).toMatchObject({ id: 'alltalk-server', ok: false, state: 'unavailable' })
    expect(probed).toBe(false)
  })

  it('a RESOLVED selection keeps the historical route intact (regression shield)', async () => {
    const service = createLiaVoiceService({
      engines: [engine('kokoro')],
      fallback: () => ({ enabled: true }),
      preferredEngineId: () => 'kokoro',
      selection: () => ({ engineId: 'kokoro', source: 'configured' as const }),
    })
    const output = await service.synthesize({ text: 'oi' })
    expect(output.engine).toBe('kokoro')
  })

  it('callers WITHOUT the selection dep behave exactly as before (backward compatibility)', async () => {
    const service = createLiaVoiceService({
      engines: [engine('kokoro')],
      fallback: () => ({ enabled: true }),
      preferredEngineId: () => undefined,
    })
    const output = await service.synthesize({ text: 'oi' })
    expect(output.engine).toBe('kokoro')
  })
})

describe('7.9F authoritative selection - the ONE selected TTS engine, or nothing (two-engine proofs)', () => {
  interface ProbeEngine {
    engine: LiaVoiceEngine
    calls: { health: number, start: number, synthesize: number }
  }

  function probeEngine(id: string, options: { clones?: boolean, healthy?: boolean, synthFailsWith?: Error } = {}): ProbeEngine {
    const calls = { health: 0, start: 0, synthesize: 0 }
    return {
      calls,
      engine: {
        id,
        capabilities: () => ({ clonesVoice: options.clones ?? false, requiresNetwork: false, runsLocally: true, streams: false }),
        health: async () => {
          calls.health += 1
          return options.healthy ?? true
            ? { ok: true, state: 'ready' }
            : { ok: false, state: 'unavailable' }
        },
        start: async () => {
          calls.start += 1
        },
        stop: async () => undefined,
        synthesize: async () => {
          calls.synthesize += 1
          if (options.synthFailsWith)
            throw options.synthFailsWith
          return {
            audio: new Uint8Array([1, 2, 3]).buffer,
            audioDurationMs: 1000,
            channels: 1,
            engine: id,
            generationMs: 500,
            sampleRate: 24000,
          }
        },
      },
    }
  }

  function selectedService(a: ProbeEngine, b: ProbeEngine, selectedId: string) {
    return createLiaVoiceService({
      engines: [a.engine, b.engine],
      fallback: () => ({ enabled: true }), // toggle ON on purpose: selection overrides it anyway
      preferredEngineId: () => selectedId,
      selection: () => ({ engineId: selectedId, source: 'configured' as const }),
    })
  }

  it('a - selected A healthy: ONLY A is health-probed and synthesized; B is never touched', async () => {
    const a = probeEngine('engine-a')
    const b = probeEngine('engine-b')
    const service = selectedService(a, b, 'engine-a')

    const state = await service.state()
    expect(state.available).toBe(true)
    expect(state.primary).toMatchObject({ id: 'engine-a', ok: true })
    const output = await service.synthesize({ text: 'oi' })
    expect(output.engine).toBe('engine-a')

    expect(a.calls).toEqual({ health: 1, start: 0, synthesize: 1 })
    expect(b.calls).toEqual({ health: 0, start: 0, synthesize: 0 })
  })

  it('b - selected A unhealthy while B healthy: honestly unavailable; B gets ZERO probes/calls', async () => {
    const a = probeEngine('engine-a', { healthy: false })
    const b = probeEngine('engine-b')
    const service = selectedService(a, b, 'engine-a')

    const state = await service.state()
    expect(state.available).toBe(false)
    expect(state.primary).toMatchObject({ id: 'engine-a', ok: false, state: 'unavailable' })
    expect(state.fallback).toBeUndefined() // no fallback column in the product model

    expect(a.calls.health).toBe(1)
    expect(b.calls).toEqual({ health: 0, start: 0, synthesize: 0 })
  })

  it('c - selected A healthy but SYNTH fails while B healthy: failure surfaces from A; B never synthesizes', async () => {
    const synthError = new LiaVoiceEngineError('engine-a', 'engine-error', 'boom')
    const a = probeEngine('engine-a', { synthFailsWith: synthError })
    const b = probeEngine('engine-b')
    const service = selectedService(a, b, 'engine-a')

    await expect(service.synthesize({ text: 'oi' })).rejects.toBe(synthError)
    expect(a.calls.synthesize).toBe(1)
    expect(b.calls).toEqual({ health: 0, start: 0, synthesize: 0 })
  })

  it('d - selection resolves NO engine (unknown configured id or no default): route empty, zero engines queried', async () => {
    const a = probeEngine('engine-a')
    const b = probeEngine('engine-b')
    const unknown = createLiaVoiceService({
      engines: [a.engine, b.engine],
      fallback: () => ({ enabled: true }),
      preferredEngineId: () => 'missing-engine',
      selection: () => ({ source: 'configured' as const, unknownConfiguredId: 'missing-engine' }),
    })
    await expect(unknown.synthesize({ text: 'oi' })).rejects.toThrow()
    const noDefault = createLiaVoiceService({
      engines: [a.engine, b.engine],
      fallback: () => ({ enabled: true }),
      preferredEngineId: () => undefined,
      selection: () => ({ source: 'none' as const }),
    })
    expect((await noDefault.state()).available).toBe(false)
    await expect(noDefault.synthesize({ text: 'oi' })).rejects.toThrow()

    expect(a.calls).toEqual({ health: 0, start: 0, synthesize: 0 })
    expect(b.calls).toEqual({ health: 0, start: 0, synthesize: 0 })
  })

  it('e - selection dep ABSENT: legacy 7.8C cloning sweep still falls to the next engine', async () => {
    // The legacy sweep only exists for CLONING engines: non-cloning engines
    // throw on first failure in both models (pinned by synthesizeOne).
    const a = probeEngine('engine-a', { clones: true, synthFailsWith: new LiaVoiceEngineError('engine-a', 'engine-error', 'boom') })
    const b = probeEngine('engine-b', { clones: true })
    const legacy = createLiaVoiceService({
      engines: [a.engine, b.engine],
      fallback: () => ({ enabled: true }),
      preferredEngineId: () => 'engine-a',
    })
    const output = await legacy.synthesize({ text: 'oi' })
    expect(output.engine).toBe('engine-b')
    expect(a.calls.synthesize).toBe(1)
    expect(b.calls.synthesize).toBe(1)
  })
})
