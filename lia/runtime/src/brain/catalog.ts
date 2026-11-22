import type { LiaBrainDescriptorSet } from './adapters/groq'
import type { LiaBrainEngineRegistry } from './engine-registry'
import type { LiaBrainEngineDescriptor, LiaBrainModelDescriptor } from './types'

import { groqBrainDescriptors } from './adapters/groq'
import { createBrainEngineRegistry } from './engine-registry'

/**
 * Phase 8.0D-3: the canonical production Brain catalog.
 *
 * The generic Brain modules describe WHAT a brain engine is; a provider
 * adapter describes one concrete shipped engine; this module is the single
 * place that knows WHICH adapters ship in this build, and it composes them
 * into a populated Brain Engine Registry plus the matching model
 * descriptors.
 *
 * Dependency direction is one-way and deliberate:
 *
 *   catalog -> adapters/<engine> -> generic descriptor types
 *
 * The generic routing modules never learn about any concrete engine, so
 * adding or swapping an engine is a change here and in its adapter, and
 * nowhere else.
 *
 * This module composes descriptors and nothing else: it reads no files,
 * starts nothing, holds no keys and performs no I/O. The catalog says which
 * engines and models exist; callers decide how - and whether - to use them.
 * Each factory call returns its own fresh ownership boundary, so there is
 * no shared mutable state between callers.
 */

/** The production catalog: one populated registry plus its descriptor sets. */
export interface LiaBrainCatalog {
  /** The populated canonical registry (its own fresh instance). */
  registry: LiaBrainEngineRegistry
  /** The engines registered in `registry`, in registration order. */
  engines: readonly LiaBrainEngineDescriptor[]
  /** Every production model descriptor, in adapter order. */
  models: readonly LiaBrainModelDescriptor[]
}

/**
 * The production adapter list - the ONE place that decides which engines
 * ship. Adapters remain the source of truth for their own descriptors;
 * nothing about them is restated here.
 */
function productionAdapterSets(): readonly LiaBrainDescriptorSet[] {
  return [groqBrainDescriptors()]
}

function catalogError(detail: string): Error {
  return new Error(`[lia:brain-catalog] ${detail}`)
}

/**
 * Composes descriptor sets into a populated catalog.
 *
 * Algorithm:
 * 1. create a fresh registry;
 * 2. register every engine of every set, in order;
 * 3. collect every model descriptor, in order;
 * 4. check each model against the registry: its `engineId` must be a
 *    registered engine AND that engine must declare the model id.
 *
 * A refused registration (blank or duplicate engine id) and a broken model
 * association both fail construction with an explicit error - a production
 * engine is never dropped silently and no association is ever repaired or
 * invented. Repeated calls are independent.
 */
export function composeBrainCatalog(descriptorSets: readonly LiaBrainDescriptorSet[]): LiaBrainCatalog {
  const registry = createBrainEngineRegistry()
  const models: LiaBrainModelDescriptor[] = []

  for (const set of descriptorSets) {
    for (const engine of set.engines) {
      const outcome = registry.register(engine)
      if (outcome.status === 'rejected')
        throw catalogError(`engine '${engine.id}' was refused (${outcome.reason})`)
    }
    models.push(...set.models)
  }

  for (const model of models) {
    const engine = registry.resolve(model.engineId)
    if (engine === undefined)
      throw catalogError(`model '${model.id}' names engine '${model.engineId}', which is not registered`)
    if (!engine.modelIds.includes(model.id))
      throw catalogError(`engine '${engine.id}' does not declare model '${model.id}'`)
  }

  return { engines: registry.list(), models, registry }
}

/**
 * Builds the production Brain catalog for this build: the shipped adapter
 * sets composed into a fresh registry. Exactly the adapters listed above
 * appear - one engine, one model today.
 */
export function createProductionBrainCatalog(): LiaBrainCatalog {
  return composeBrainCatalog(productionAdapterSets())
}
