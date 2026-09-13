/**
 * Metadata-only audio diagnostics.
 *
 * These exist because "the preview is pure noise" is not actionable on its own:
 * the same symptom comes out of a wrong sample rate, a Float32 buffer read as
 * PCM16, an unsupported inference backend, or a silent buffer, and each one is
 * fixed somewhere different. What tells them apart is the geometry and the
 * amplitude of the samples, so that is what gets logged - never the samples
 * themselves, never any credential.
 *
 * Gated on build mode only. There is deliberately no localStorage or query
 * switch that could turn this on in a production build.
 */

/** True in a dev build, false everywhere else. */
export function audioDiagnosticsEnabled(): boolean {
  const meta = import.meta as unknown as { env?: { DEV?: boolean } }
  return meta.env?.DEV === true
}

/** Shape of the metadata an audio probe reports. */
export interface AudioProbeMetadata {
  /** Declared sample rate in Hz. */
  sampleRate: number
  /** Number of samples, i.e. frames for a mono buffer. */
  frames: number
  /** Duration derived from the two above, in milliseconds. */
  durationMs: number
  bytes: number
  /** Constructor name, to catch a buffer that is not the type it claims. */
  ctor: string
  min: number
  max: number
  /** Root mean square. Speech sits around 0.05-0.3; noise and clipping do not. */
  rms: number
  /** Count of NaN/Infinity samples. Anything above zero means broken inference. */
  nonFinite: number
}

/**
 * Describes a Float32 PCM buffer without copying or exposing it.
 *
 * Cheap enough to leave permanently wired in behind the build-mode gate: one
 * pass over the samples, no allocation.
 */
export function describeFloat32Audio(
  samples: ArrayLike<number>,
  sampleRate: number,
): AudioProbeMetadata {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sumSquares = 0
  let nonFinite = 0

  for (let i = 0; i < samples.length; i++) {
    const value = samples[i]
    if (!Number.isFinite(value)) {
      nonFinite++
      continue
    }
    if (value < min)
      min = value
    if (value > max)
      max = value
    sumSquares += value * value
  }

  const finite = samples.length - nonFinite
  if (finite === 0) {
    min = 0
    max = 0
  }

  return {
    sampleRate,
    frames: samples.length,
    durationMs: sampleRate > 0 ? Math.round((samples.length / sampleRate) * 1000) : 0,
    bytes: samples.length * Float32Array.BYTES_PER_ELEMENT,
    ctor: (samples as { constructor?: { name?: string } }).constructor?.name ?? 'unknown',
    min: round(min),
    max: round(max),
    rms: round(Math.sqrt(sumSquares / Math.max(1, finite))),
    nonFinite,
  }
}

/**
 * Reads the geometry out of a WAV header. Returns null rather than throwing for
 * anything that is not a RIFF/WAVE buffer, so a probe can never be the thing
 * that breaks synthesis.
 */
export function describeWavBuffer(
  buffer: ArrayBufferLike,
): { byteLength: number, channels: number, dataSize: number, bitsPerSample: number, sampleRate: number } | null {
  if (buffer.byteLength < 44)
    return null

  const view = new DataView(buffer as ArrayBuffer)
  const riff = String.fromCharCode(...[0, 1, 2, 3].map(i => view.getUint8(i)))
  const wave = String.fromCharCode(...[8, 9, 10, 11].map(i => view.getUint8(i)))
  if (riff !== 'RIFF' || wave !== 'WAVE')
    return null

  return {
    byteLength: buffer.byteLength,
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    dataSize: view.getUint32(40, true),
  }
}

/**
 * Logs one diagnostic line, or does nothing at all outside a dev build.
 *
 * `tag` is a stable prefix so a QA log can be grepped for exactly the lines that
 * matter - `[LIA-KOKORO-AUDIO]`, `[LIA-VOICE-RUNTIME]`.
 */
export function logAudioDiagnostics(tag: string, payload: Record<string, unknown>): void {
  if (!audioDiagnosticsEnabled())
    return

  console.info(`[${tag}]`, payload)
}

function round(value: number, digits = 6): number {
  if (!Number.isFinite(value))
    return value
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
