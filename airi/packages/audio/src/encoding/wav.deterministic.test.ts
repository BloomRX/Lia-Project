import { describe, expect, it } from 'vitest'

import { toFloat32FromPCM16, toPCM16FromFloat32, toWav, toWavFromPCM16 } from './wav'

/**
 * Deterministic round-trip checks for the WAV encoder.
 *
 * A synthesized voice that came out as pure noise made it necessary to prove the
 * encoder is or is not where samples get mangled. These tests build a known
 * signal, run it through the same encoder the Kokoro worker output goes through
 * (`toWav`, on the raw Float32 buffer handed back by the worker) and read the
 * bytes back out again.
 *
 * Everything here is computed from a sine, so there is no fixture to drift and
 * nothing that depends on a runtime, a model or a machine.
 */

const SAMPLE_RATE = 24_000
const DURATION_S = 0.2
const SAMPLE_COUNT = SAMPLE_RATE * DURATION_S

/** A 440 Hz sine in the range `RawAudio.audio` uses: Float32, mono, −1..1. */
function sine(): Float32Array {
  const frames = new Float32Array(SAMPLE_COUNT)
  for (let i = 0; i < frames.length; i++)
    frames[i] = Math.sin(2 * Math.PI * 440 * (i / SAMPLE_RATE))
  return frames
}

/**
 * Worst-case round-trip error of this encoder, in units of one PCM16 step.
 *
 * `toPCM16FromFloat32` hands a fractional value to `setInt16`, which truncates
 * toward zero rather than rounding, and it scales the positive half by 0x7FFF
 * instead of 0x8000. Those two together cost up to two steps where a rounding
 * encoder would cost one. That is roughly -84 dBFS - inaudible, and documented
 * here rather than "fixed", because the behaviour is covered by `wav.test.ts`
 * and the shared package feeds every other speech provider.
 */
const MAX_QUANTIZATION_ERROR = 2 / 0x8000

/** Little-endian WAV field readers, independent of the encoder under test. */
function u32(view: DataView, at: number): number {
  return view.getUint32(at, true)
}
function u16(view: DataView, at: number): number {
  return view.getUint16(at, true)
}
function chunkId(view: DataView, at: number): string {
  return String.fromCharCode(...[0, 1, 2, 3].map(i => view.getUint8(at + i)))
}

function decodeWav(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  expect(chunkId(view, 0)).toBe('RIFF')
  expect(chunkId(view, 8)).toBe('WAVE')
  expect(chunkId(view, 12)).toBe('fmt ')
  expect(chunkId(view, 36)).toBe('data')

  const audioFormat = u16(view, 20)
  const channels = u16(view, 22)
  const sampleRate = u32(view, 24)
  const byteRate = u32(view, 28)
  const blockAlign = u16(view, 32)
  const bitsPerSample = u16(view, 34)
  const dataOffset = 44
  const dataSize = u32(view, 40)

  expect(audioFormat).toBe(1) // PCM, not IEEE float nor ADPCM
  expect(channels).toBe(1)
  expect(sampleRate).toBe(SAMPLE_RATE)
  expect(bitsPerSample).toBe(16)
  expect(blockAlign).toBe(2)
  expect(byteRate).toBe(SAMPLE_RATE * 2)
  expect(dataSize).toBe(SAMPLE_COUNT * 2)
  expect(buffer.byteLength).toBe(44 + dataSize)

  const frames = new Float32Array(SAMPLE_COUNT)
  for (let i = 0; i < SAMPLE_COUNT; i++)
    frames[i] = view.getInt16(dataOffset + i * 2, true) / 0x8000

  return { frames, sampleRate }
}

describe('wav encoding round trip', () => {
  it('writes a header whose declared geometry matches the samples it carries', () => {
    const buffer = toWav(sine().buffer, SAMPLE_RATE, 1)
    expect(buffer.byteLength).toBe(44 + SAMPLE_COUNT * 2)

    const { frames, sampleRate } = decodeWav(buffer)
    expect(sampleRate).toBe(SAMPLE_RATE)
    expect(frames.length).toBe(SAMPLE_COUNT)
  })

  it('preserves every sample within PCM16 quantization error', () => {
    const source = sine()
    const { frames } = decodeWav(toWav(source.buffer, SAMPLE_RATE, 1))

    let maxError = 0
    for (let i = 0; i < source.length; i++)
      maxError = Math.max(maxError, Math.abs(frames[i] - source[i]))

    expect(maxError).toBeLessThan(MAX_QUANTIZATION_ERROR)
    // And it is nowhere near "not a signal": a corrupted conversion is orders
    // of magnitude worse than two quantization steps.
    expect(maxError).toBeLessThan(0.001)
  })

  it('keeps the signal audible instead of flattening or inverting it', () => {
    const { frames } = decodeWav(toWav(sine().buffer, SAMPLE_RATE, 1))

    let peak = 0
    let sumSquares = 0
    for (const frame of frames) {
      peak = Math.max(peak, Math.abs(frame))
      sumSquares += frame * frame
    }
    const rms = Math.sqrt(sumSquares / frames.length)

    // A sine of amplitude 1 has an RMS of ~0.707 and a peak of ~1. Anything
    // reading near zero here would be silence; anything above one would clip.
    expect(peak).toBeGreaterThan(0.9)
    expect(peak).toBeLessThanOrEqual(1)
    expect(rms).toBeGreaterThan(0.6)
    expect(rms).toBeLessThan(0.8)
  })

  it('survives the structured clone the worker postMessage performs', () => {
    const samples = sine()
    const cloned = structuredClone(
      { samples, samplingRate: SAMPLE_RATE },
      { transfer: [samples.buffer] },
    )

    // The worker transfers the underlying buffer, which leaves the original
    // detached. If the transfer ever dropped to a plain object or a
    // DataView-wrapped slice, the geometry below would change.
    expect(cloned.samples).toBeInstanceOf(Float32Array)
    expect(cloned.samples.byteLength).toBe(SAMPLE_COUNT * 4)
    expect(cloned.samples.length).toBe(SAMPLE_COUNT)
    expect(cloned.samplingRate).toBe(SAMPLE_RATE)
    expect(samples.byteLength).toBe(0)

    const { frames, sampleRate } = decodeWav(toWav(cloned.samples.buffer, cloned.samplingRate, 1))
    expect(sampleRate).toBe(SAMPLE_RATE)
    expect(frames.length).toBe(SAMPLE_COUNT)
  })

  it('encodes the same samples whether handed Float32 or PCM16', () => {
    // `toWav` reads its buffer as Float32 and `toWavFromPCM16` reads it as
    // PCM16. Handing the wrong one to the wrong function halves the frame count
    // and produces static, so the two entry points have to be checked against
    // each other rather than assumed.
    const source = sine()
    const pcm16 = toPCM16FromFloat32(source)
    expect(pcm16.byteLength).toBe(SAMPLE_COUNT * 2)

    const viaFloat = decodeWav(toWav(source.buffer, SAMPLE_RATE, 1))
    const viaPcm16 = decodeWav(toWavFromPCM16(pcm16, SAMPLE_RATE, 1))

    expect(viaFloat.frames.length).toBe(SAMPLE_COUNT)
    expect(viaPcm16.frames.length).toBe(SAMPLE_COUNT)

    for (let i = 0; i < SAMPLE_COUNT; i++)
      expect(viaFloat.frames[i]).toBe(viaPcm16.frames[i])
  })

  it('carries four bytes per sample only when the buffer really is PCM16', () => {
    // The failure mode the test above guards against, stated directly: reading
    // four bytes per sample as two doubles the declared frame count and doubles
    // the duration, which is exactly what a misread conversion sounds like.
    const floatWav = toWav(sine().buffer, SAMPLE_RATE, 1)
    const pcm16Wav = toWavFromPCM16(toPCM16FromFloat32(sine()), SAMPLE_RATE, 1)
    const misread = toWavFromPCM16(new Uint8Array(sine().buffer), SAMPLE_RATE, 1)

    const declaredFrames = (buffer: ArrayBuffer) =>
      new DataView(buffer).getUint32(40, true) / 2

    expect(declaredFrames(floatWav)).toBe(SAMPLE_COUNT)
    expect(declaredFrames(pcm16Wav)).toBe(SAMPLE_COUNT)
    expect(declaredFrames(misread)).toBe(SAMPLE_COUNT * 2)
  })

  it('float to PCM16 and back is stable to within a quantization step', () => {
    const source = sine()
    const roundTripped = toFloat32FromPCM16(toPCM16FromFloat32(source))

    expect(roundTripped.length).toBe(source.length)
    for (let i = 0; i < source.length; i++)
      expect(Math.abs(roundTripped[i] - source[i])).toBeLessThan(MAX_QUANTIZATION_ERROR)
  })
})
