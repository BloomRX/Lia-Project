import { describe, expect, it, vi } from 'vitest'

import type { LiaVoiceEngine } from './engines/types'

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
