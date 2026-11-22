import type { LiaVoiceEngineCapabilities } from './types'

/**
 * Phase 7.9C: the declarative registry of the engine ADAPTERS this build
 * actually ships.
 *
 * This is the seam's own registry - static facts about adapters - kept
 * separate from `voices/profiles.ts`' `VOICE_ENGINES`, which declares
 * IMPORTABLE profile shapes (file roles/extensions for personas the user
 * imports). A stock-voice engine like Kokoro ships its voices WITH the
 * engine and has no importable profile shape, so it registers HERE and
 * nowhere else: declaring it in the profile registry would dangle an
 * import path that cannot accept any files.
 *
 * Backend discipline (validated on the real device, Phase 7.9B):
 * only backends with a measured, working run are EVER listed in
 * `backends` - the RX 580 initialized DirectML and then failed during
 * inference, so `cpu` is the only entry. An accelerated provider earns
 * its entry in a later phase AFTER a QA run on the target hardware.
 */

export type VoiceEngineBackend = 'cpu'

export interface LiaVoiceEngineAdapterDeclaration {
  id: string
  label: string
  /** Backends this build can actually drive - measured facts, never promises. */
  backends: readonly VoiceEngineBackend[]
  /** What `auto` resolves to for this engine today. */
  defaultBackend: VoiceEngineBackend
  /** Engine-shipped default voice id, when the engine carries stock voices. */
  defaultVoiceId?: string
  capabilities: LiaVoiceEngineCapabilities
}

/** The first real modular engine of the transitional product: Kokoro on CPU. */
export const KOKORO_ENGINE_ADAPTER: LiaVoiceEngineAdapterDeclaration = {
  id: 'kokoro',
  label: 'Kokoro',
  backends: ['cpu'],
  defaultBackend: 'cpu',
  defaultVoiceId: 'pf_dora',
  capabilities: {
    clonesVoice: false,
    requiresNetwork: false,
    runsLocally: true,
    streams: false,
  },
}

export const VOICE_ENGINE_ADAPTERS: readonly LiaVoiceEngineAdapterDeclaration[] = [
  KOKORO_ENGINE_ADAPTER,
]

/** Adapter lookup by exact id; empty ids defer, unknown ids defer. */
export function findVoiceEngineAdapter(id: string): LiaVoiceEngineAdapterDeclaration | undefined {
  const needle = String(id).trim()
  if (!needle)
    return undefined
  return VOICE_ENGINE_ADAPTERS.find(adapter => adapter.id === needle)
}

export interface VoiceEngineBackendResolution {
  /** Set only when the request could be honored by this build. */
  backend?: VoiceEngineBackend
  engineId: string
  /** The echoed request (`auto` when absent/blank). */
  requested: string
  reason?: 'unknown-engine' | 'backend-not-declared'
}

/**
 * Resolves the backend an operator (or the default `auto`) asked an engine
 * to use. `auto` resolves to the engine's declared default - for Kokoro
 * that is `cpu`, the only backend this build declares.
 */
export function resolveVoiceEngineBackend(engineId: string, requested?: string): VoiceEngineBackendResolution {
  const adapter = findVoiceEngineAdapter(engineId)
  const want = (requested ?? '').trim()
  if (!adapter)
    return { engineId: String(engineId).trim(), requested: want || 'auto', reason: 'unknown-engine' }
  if (!want || want === 'auto')
    return { backend: adapter.defaultBackend, engineId: adapter.id, requested: 'auto' }
  if ((adapter.backends as readonly string[]).includes(want))
    return { backend: want as VoiceEngineBackend, engineId: adapter.id, requested: want }
  return { engineId: adapter.id, requested: want, reason: 'backend-not-declared' }
}

/** The backends actually advertisable for an engine; undefined defers on unknown ids. */
export function listVoiceEngineBackends(engineId: string): readonly VoiceEngineBackend[] | undefined {
  return findVoiceEngineAdapter(String(engineId).trim())?.backends
}

// ---------------------------------------------------------------------------
// Phase 7.9F: canonical SELECTED-ENGINE resolution + product descriptors.
// ---------------------------------------------------------------------------

/**
 * The default engine the transitional product selects when the operator
 * never configured one (legacy/fresh documents). Stable engine id, never a
 * provider/backend name.
 */
export const LIA_DEFAULT_VOICE_ENGINE_ID = 'kokoro'

/**
 * Which engine the product should use and WHY. `engineId` is absent when no
 * usable selection exists:
 * - `source: 'configured'` + absent engineId ALWAYS pairs with
 *   `unknownConfiguredId` - the operator pinned an engine this build cannot
 *   construct. That is honest voice-unavailable, NEVER a silent switch to
 *   another engine (item: unknown must not fallback).
 * - `source: 'default'` means a legacy/fresh document resolved to the
 *   product default engine.
 * - `source: 'none'` means not even the default exists (future builds).
 */
export interface LiaVoiceEngineSelection {
  engineId?: string
  source: 'configured' | 'default' | 'none'
  unknownConfiguredId?: string
}

/**
 * Resolves the ONE selected engine id from product truth + this build's
 * engine set. Engine ids only - providers/backends stay invisible to this
 * layer (and to the renderer, which never resolves selection itself).
 */
export function resolveVoiceEngineSelection(input: {
  preferred?: string
  availableEngineIds: readonly string[]
  defaultEngineId?: string
}): LiaVoiceEngineSelection {
  const preferred = input.preferred?.trim()
  if (preferred) {
    if (input.availableEngineIds.includes(preferred))
      return { engineId: preferred, source: 'configured' }
    return { source: 'configured', unknownConfiguredId: preferred }
  }
  const defaultEngineId = input.defaultEngineId ?? LIA_DEFAULT_VOICE_ENGINE_ID
  if (input.availableEngineIds.includes(defaultEngineId))
    return { engineId: defaultEngineId, source: 'default' }
  return { source: 'none' }
}

/**
 * The product-facing descriptor for a NORMAL UI: id, a localized-name
 * handle, and honest installed/selectable facts. No provider, backend,
 * Python or runtime jargon crosses this surface - `nameKey` lets the UI
 * localize while `name` is the English fallback (today the adapter label,
 * which is already product language: "Kokoro").
 */
export interface LiaVoiceEngineDescriptor {
  id: string
  nameKey: string
  name: string
  installed: boolean
  selectable: boolean
  selected: boolean
}

export function describeVoiceEngineOptions(input: {
  installed?: (adapterId: string) => boolean
  selection: LiaVoiceEngineSelection
}): LiaVoiceEngineDescriptor[] {
  return VOICE_ENGINE_ADAPTERS.map((adapter) => {
    const installed = input.installed?.(adapter.id) ?? false
    return {
      id: adapter.id,
      installed,
      name: adapter.label,
      nameKey: `lia.voice.engines.${adapter.id}.name`,
      selectable: installed,
      selected: input.selection.engineId === adapter.id,
    }
  })
}
