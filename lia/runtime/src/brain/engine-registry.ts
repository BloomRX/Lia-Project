import type { LiaBrainEngineDescriptor, LiaBrainModelDescriptor } from './types'

/**
 * Phase 8.0B-1: the Brain Engine Registry - analogous in spirit to the
 * voice engine registry, but for conversation brains.
 *
 * Pure and in-memory by design: no network, no filesystem, no vendor SDK,
 * no model loading. Registering an engine is a declarative statement of
 * fact; resolving one is a lookup. Duplicate ids are rejected
 * deterministically (first registration wins, later attempts never replace
 * it), and every read returns a copy the caller cannot mutate the registry
 * through. No vendor-specific behavior lives here - a later phase wires
 * real engines as descriptors, exactly like voice adapters.
 */

/** Deterministic registration outcome. */
export type LiaBrainEngineRegistrationResult
  = | { status: 'registered' }
    | { reason: 'duplicate-engine-id' | 'invalid-engine-id', status: 'rejected' }

export interface LiaBrainEngineRegistry {
  /** Registered engines in stable insertion order (a fresh copy). */
  list: () => readonly LiaBrainEngineDescriptor[]
  /**
   * Registers a descriptor. Rejected - never overwritten, never throwing -
   * when the id is blank or already registered.
   */
  register: (descriptor: LiaBrainEngineDescriptor) => LiaBrainEngineRegistrationResult
  /** Exact-id lookup; blank/unknown ids resolve to undefined. */
  resolve: (engineId: string) => LiaBrainEngineDescriptor | undefined
}

/** Defensive copy - callers can never mutate registry state after the fact. */
function cloneDescriptor(descriptor: LiaBrainEngineDescriptor, canonicalId: string): LiaBrainEngineDescriptor {
  return {
    availability: descriptor.availability,
    capabilities: { ...descriptor.capabilities },
    id: canonicalId,
    modelIds: [...descriptor.modelIds],
    name: descriptor.name,
  }
}

export function createBrainEngineRegistry(): LiaBrainEngineRegistry {
  const engines = new Map<string, LiaBrainEngineDescriptor>()

  return {
    list() {
      return [...engines.values()].map(descriptor => cloneDescriptor(descriptor, descriptor.id))
    },

    register(descriptor) {
      const id = String(descriptor?.id ?? '').trim()
      if (!id)
        return { reason: 'invalid-engine-id', status: 'rejected' }
      if (engines.has(id))
        return { reason: 'duplicate-engine-id', status: 'rejected' }
      engines.set(id, cloneDescriptor(descriptor, id))
      return { status: 'registered' }
    },

    resolve(engineId) {
      const needle = String(engineId ?? '').trim()
      if (!needle)
        return undefined
      const descriptor = engines.get(needle)
      return descriptor ? cloneDescriptor(descriptor, descriptor.id) : undefined
    },
  }
}

/**
 * The models one engine serves - a pure filter over separately-described
 * models. The association is the descriptor's own `engineId`; the registry
 * stays engine-centric and never owns model state.
 */
export function modelsForEngine(
  models: readonly LiaBrainModelDescriptor[],
  engineId: string,
): readonly LiaBrainModelDescriptor[] {
  const needle = String(engineId ?? '').trim()
  if (!needle)
    return []
  return models.filter(model => model.engineId === needle)
}
