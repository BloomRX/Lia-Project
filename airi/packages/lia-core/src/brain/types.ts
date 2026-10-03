/**
 * Phase 8.0B-1: the generic Brain Engine domain model.
 *
 * A "brain engine" is whatever host can serve Lia's conversation models -
 * local runtimes, remote services, anything a later phase decides to plug
 * in. This layer declares ONLY the neutral vocabulary (ids, names,
 * availability, capabilities); it never names a vendor, never resolves a
 * key, never loads anything. Engines compare fairly and swap without UI or
 * orchestrator changes - the same discipline the voice engine contract
 * applies to speech.
 */

/**
 * What one brain engine/model can do. Static, declarative flags - every
 * dimension is independent (an engine that hears audio is not assumed to
 * speak it; image input never implies video input). Used later for routing
 * decisions, never shown to the persona.
 */
export interface LiaBrainCapabilities {
  /** Accepts audio input (speech-to-text on the brain side). */
  audioInput: boolean
  /** Produces audio output directly from the brain. */
  audioOutput: boolean
  /** Accepts image input. */
  imageInput: boolean
  /** Interactive/low-latency streaming sessions. */
  realtime: boolean
  /** Extended/deliberate reasoning mode. */
  reasoning: boolean
  /** Accepts text input. */
  textInput: boolean
  /** Produces text output. */
  textOutput: boolean
  /** Can invoke tools/function calls. */
  toolCalling: boolean
  /** Accepts video input. */
  videoInput: boolean
}

/**
 * Availability/configuration state of an engine in THIS build - honest and
 * product-facing: ready to be selected, known but needing configuration,
 * or not usable here.
 */
export type LiaBrainEngineAvailability
  = | 'available'
    | 'configurationRequired'
    | 'unavailable'

/**
 * One brain engine as the product sees it. Ids are stable and opaque
 * (never vendor marketing names); model ids are the stable identifiers
 * reachable through this engine.
 */
export interface LiaBrainEngineDescriptor {
  availability: LiaBrainEngineAvailability
  capabilities: LiaBrainCapabilities
  /** Stable engine id - unique inside the registry. */
  id: string
  /** Stable model ids served by this engine (may be empty). */
  modelIds: readonly string[]
  /** User-facing engine name. */
  name: string
}

/**
 * One model, described SEPARATELY from its engine: the association rides
 * `engineId`, so models can be listed/filtered/compared without touching
 * engine state.
 */
export interface LiaBrainModelDescriptor {
  capabilities: LiaBrainCapabilities
  /** The engine that serves this model. */
  engineId: string
  /** Stable model id. */
  id: string
  /**
   * Optional metadata for FUTURE routing (context size, quality hints...).
   * Opaque in this phase - the registry never reads it.
   */
  metadata?: Record<string, unknown>
  /** User-facing model name. */
  name: string
}
