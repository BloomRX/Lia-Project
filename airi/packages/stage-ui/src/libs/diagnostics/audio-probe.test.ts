import { afterEach, describe, expect, it, vi } from 'vitest'

import { audioDiagnosticsEnabled, describeFloat32Audio, describeWavBuffer, logAudioDiagnostics } from './audio-probe'

/**
 * The audio probes only ever describe a buffer, never copy it, so their own
 * output has to be trustworthy: a wrong RMS is worse than no RMS, because it
 * would send whoever is chasing a noise bug down the wrong path.
 */
describe('describeFloat32Audio', () => {
  it('reports the geometry a speech buffer would have', () => {
    // A 0.2 s mono buffer at 24 kHz, i.e. the shape Kokoro produces.
    const frames = 4800
    const samples = new Float32Array(frames)
    for (let i = 0; i < frames; i++)
      samples[i] = Math.sin(2 * Math.PI * 440 * (i / 24_000))

    const meta = describeFloat32Audio(samples, 24_000)

    expect(meta.frames).toBe(frames)
    expect(meta.sampleRate).toBe(24_000)
    expect(meta.durationMs).toBe(200)
    expect(meta.bytes).toBe(frames * 4)
    expect(meta.ctor).toBe('Float32Array')
    expect(meta.nonFinite).toBe(0)
    // A unit sine: peak ~1, RMS ~0.707.
    expect(meta.min).toBeLessThan(-0.99)
    expect(meta.max).toBeGreaterThan(0.99)
    expect(meta.rms).toBeGreaterThan(0.7)
    expect(meta.rms).toBeLessThan(0.72)
  })

  it('reads silence as silence', () => {
    const meta = describeFloat32Audio(new Float32Array(1000), 24_000)

    expect(meta.min).toBe(0)
    expect(meta.max).toBe(0)
    expect(meta.rms).toBe(0)
    expect(meta.nonFinite).toBe(0)
  })

  it('counts non-finite samples instead of letting them poison the statistics', () => {
    // A broken inference backend is exactly what produces this. If NaN reached
    // min/max/RMS it would report NaN and say nothing useful.
    const samples = new Float32Array([0.5, Number.NaN, -0.25, Number.POSITIVE_INFINITY, 0.25])
    const meta = describeFloat32Audio(samples, 24_000)

    expect(meta.nonFinite).toBe(2)
    expect(meta.min).toBe(-0.25)
    expect(meta.max).toBe(0.5)
    // RMS over the three finite samples only.
    expect(meta.rms).toBeCloseTo(Math.sqrt((0.25 + 0.0625 + 0.0625) / 3), 5)
  })

  it('reports the constructor so a mis-typed buffer cannot pass for a Float32Array', () => {
    const asFloat64 = describeFloat32Audio(new Float64Array([0.1, 0.2]), 24_000)
    expect(asFloat64.ctor).toBe('Float64Array')
    expect(asFloat64.bytes).toBe(8)

    const asArray = describeFloat32Audio([0.1, 0.2], 24_000)
    expect(asArray.ctor).toBe('Array')
  })
})

describe('describeWavBuffer', () => {
  it('reads the geometry back out of a header the encoder wrote', () => {
    const dataSize = 9600
    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)
    const put = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
    put(0, 'RIFF')
    put(8, 'WAVE')
    view.setUint16(22, 1, true) // channels
    view.setUint32(24, 24_000, true) // sample rate
    view.setUint16(34, 16, true) // bits per sample
    view.setUint32(40, dataSize, true) // data size

    expect(describeWavBuffer(buffer)).toEqual({
      byteLength: 44 + dataSize,
      channels: 1,
      sampleRate: 24_000,
      bitsPerSample: 16,
      dataSize,
    })
  })

  it('returns null rather than throwing for something that is not a WAV', () => {
    expect(describeWavBuffer(new ArrayBuffer(10))).toBeNull()

    const notWav = new ArrayBuffer(64)
    new DataView(notWav).setUint8(0, 0x4F) // 'O', as in an Ogg stream
    expect(describeWavBuffer(notWav)).toBeNull()
  })
})

describe('the build-mode gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('follows build mode and nothing else', () => {
    // Vitest runs as a dev build, so `import.meta.env.DEV` is true here - which
    // is also why the probes stay available to a QA session started through
    // DevTamagotchi.bat. There is no localStorage or query switch that could
    // reopen this in a production build.
    vi.stubEnv('DEV', true)
    expect(audioDiagnosticsEnabled()).toBe(true)

    vi.stubEnv('DEV', false)
    expect(audioDiagnosticsEnabled()).toBe(false)
  })

  it('logs the tagged line when the gate is open', () => {
    vi.stubEnv('DEV', true)
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})

    logAudioDiagnostics('LIA-KOKORO-AUDIO', { stage: 'worker-output', rms: 0.1 })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]?.[0]).toBe('[LIA-KOKORO-AUDIO]')
    expect(spy.mock.calls[0]?.[1]).toMatchObject({ stage: 'worker-output', rms: 0.1 })
    spy.mockRestore()
  })

  it('logs nothing at all when the gate is closed', () => {
    vi.stubEnv('DEV', false)
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})

    logAudioDiagnostics('LIA-KOKORO-AUDIO', { stage: 'worker-output', rms: 0.1 })

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
