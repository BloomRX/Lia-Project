/**
 * Phase 7.8, item 1: the Lia-owned voice-engine abstraction.
 *
 * The Stage and the renderer never name an engine, a runtime or a device.
 * They ask the Lia Voice Service for speech; the service routes to an
 * engine through THIS contract. Every engine - local heavy, lightweight
 * remote, or anything a host decides to register - implements the same
 * surface, so engines compare fairly and swap without UI or orchestrator
 * changes.
 */

/**
 * What one engine can do. Static, declarative facts - used by the service
 * for routing/fallback decisions, never shown to the persona.
 */
export interface LiaVoiceEngineCapabilities {
  /** Voice cloning from a user reference audio. */
  clonesVoice: boolean
  /** Runs fully on the user's machine (no network dependency). */
  runsLocally: boolean
  /** Requires network/service availability. */
  requiresNetwork: boolean
  /** True streaming audio output (not chunked responses). */
  streams: boolean
}

/** Model/server health, engine-reported, metadata-only. */
export interface LiaVoiceEngineHealth {
  ok: boolean
  /** Concise machine label for diagnostics, e.g. `starting`, `ready`. */
  state: 'unknown' | 'starting' | 'ready' | 'error' | 'unavailable'
  /** Free-form safe note (no paths beyond install roots, no audio, no text). */
  note?: string
  /** Measured execution device, engine-reported when known. */
  device?: 'cpu' | 'cuda' | 'other' | 'unknown'
  deviceName?: string
  torchVersion?: string
  cudaVersion?: string
  /** For resident engines: has the model been loaded into memory. */
  modelLoaded?: boolean
}

export interface LiaVoiceSynthesisInput {
  /** Normalized text-for-speech (the stage-ui normalizer already ran). */
  text: string
  /** Canonical profile id, when the voice is a cloned Lia voice. */
  profileId?: string
  /** Canonical reference WAV path (profiles stay engine-independent). */
  referenceAudioPath?: string
  /** Exact transcript of the reference, when the user provided one. */
  referenceText?: string
  /** BCP-47 tag resolved for this profile/request, e.g. `pt-BR`. */
  language?: string
}

export interface LiaVoiceSynthesisOutput {
  audio: ArrayBuffer
  /** Engine that produced it - diagnostics metadata, never persona text. */
  engine: string
  /** Engine-reported synthesis time when measurable (inference only). */
  generationMs?: number
  /** Generated audio duration, engine-reported when measurable. */
  audioDurationMs?: number
  sampleRate?: number
  channels?: number
}

export interface LiaVoiceEngine {
  id: string
  capabilities(): LiaVoiceEngineCapabilities
  /** Idempotent. Brings the engine to a synthesize-ready state. */
  start(): Promise<void>
  health(): Promise<LiaVoiceEngineHealth>
  synthesize(input: LiaVoiceSynthesisInput): Promise<LiaVoiceSynthesisOutput>
  /** Idempotent. Releases the model/process; safe to call twice. */
  stop(): Promise<void>
}

/** Failure taxonomy: the service uses it for fallback decisions. */
export type LiaVoiceFailureKind
  = 'engine-unavailable'
    | 'engine-starting'
    | 'engine-error'
    | 'input-invalid'
    | 'cancelled'

export class LiaVoiceEngineError extends Error {
  readonly kind: LiaVoiceFailureKind
  readonly engine: string

  constructor(engine: string, kind: LiaVoiceFailureKind, message: string) {
    super(message)
    this.name = 'LiaVoiceEngineError'
    this.engine = engine
    this.kind = kind
  }
}
