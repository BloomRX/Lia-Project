/**
 * Phase 7.8C: the engine-neutral product voice configuration surface.
 *
 * Canonical truth:
 *   voice.engine.preferred   = <engine id string>; absent means none selected
 *   voice.fallback           = { enabled?, engineId? }
 *   voice.runtime.installDir = optional managed-runtime home override
 *
 * An engine's OWN runtime needs (environment, model files, device choice)
 * stay on the engine's side entirely; the product document only ever names
 * the selected engine, the fallback policy, and - optionally - where
 * managed voice runtimes live. Per-engine fields are designed when that
 * engine lands, never ahead of it.
 *
 * Legacy `voice.runtime.alltalk.*` keys remain READABLE for backward
 * document compatibility but drive NO runtime behavior (deprecated/ignored);
 * they are never written by new code. Deleting the on-disk tree stays out
 * of scope (no destructive migration).
 */

export interface LiaVoiceEngineConfig {
  /** Selected engine id; undefined means none selected yet. */
  preferred?: string
}

export interface LiaVoiceFallbackConfig {
  /** A non-preferred engine MAY answer only when true. */
  enabled: boolean
  /** Explicit fallback engine id when the operator pinned one. */
  engineId?: string
}

export interface LiaVoiceRuntimeSelection {
  /** Engine-neutral managed-runtime home override. */
  installDir?: string
}

export const VOICE_FALLBACK_DEFAULT_ENABLED = true

// ---------------------------------------------------------------------------
// Readers: tolerate any document version; the legacy alltalk block is inert
// by contract and never consulted here.
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

export function readVoiceEngineConfig(voice: unknown): LiaVoiceEngineConfig {
  const engine = asRecord(asRecord(voice).engine)
  const preferred = typeof engine.preferred === 'string' && engine.preferred.trim()
    ? engine.preferred.trim()
    : undefined
  return { preferred }
}

export function readVoiceFallbackConfig(voice: unknown): LiaVoiceFallbackConfig {
  const fallback = asRecord(asRecord(voice).fallback)
  return {
    // Present-but-empty object means "operator chose the defaults".
    enabled: typeof fallback.enabled === 'boolean' ? fallback.enabled : VOICE_FALLBACK_DEFAULT_ENABLED,
    ...(typeof fallback.engineId === 'string' && fallback.engineId.trim() ? { engineId: fallback.engineId.trim() } : {}),
  }
}

export function readVoiceRuntimeSelection(voice: unknown): LiaVoiceRuntimeSelection {
  const runtime = asRecord(asRecord(voice).runtime)
  const installDir = typeof runtime.installDir === 'string' && runtime.installDir.trim()
    ? runtime.installDir.trim()
    : undefined
  return { ...(installDir ? { installDir } : {}) }
}

// ---------------------------------------------------------------------------
// Writer: produces the merged VOICE section with the new keys set and the
// legacy keys PRESERVED-AS-IS (read compat, never destructively erased) -
// but only keys we own are modified; deprecated ones are left frozen in the
// document.
// ---------------------------------------------------------------------------

export function writeVoiceConfig(
  existingVoice: unknown,
  update: {
    engine?: { preferred?: string }
    fallback?: Partial<LiaVoiceFallbackConfig>
    runtime?: LiaVoiceRuntimeSelection
  },
): Record<string, unknown> {
  const voice = { ...asRecord(existingVoice) }

  if (update.engine?.preferred !== undefined) {
    const engine = { ...asRecord(voice.engine) }
    if (update.engine.preferred.trim())
      engine.preferred = update.engine.preferred.trim()
    else
      delete engine.preferred
    voice.engine = engine
  }

  if (update.fallback !== undefined) {
    const fallback = { ...asRecord(voice.fallback) }
    const patch = update.fallback
    if (patch.enabled !== undefined)
      fallback.enabled = patch.enabled
    if (patch.engineId !== undefined) {
      if (patch.engineId.trim())
        fallback.engineId = patch.engineId.trim()
      else
        delete fallback.engineId
    }
    voice.fallback = fallback
  }

  if (update.runtime !== undefined) {
    const runtime = { ...asRecord(voice.runtime) }
    const patch = update.runtime
    if (patch.installDir !== undefined) {
      if (patch.installDir.trim())
        runtime.installDir = patch.installDir.trim()
      else
        delete runtime.installDir
    }
    voice.runtime = runtime
  }

  return voice
}
