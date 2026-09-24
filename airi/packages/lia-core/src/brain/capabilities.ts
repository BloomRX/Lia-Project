import type {
  LiaBrainCapabilities,
  LiaBrainEngineDescriptor,
  LiaBrainModelDescriptor,
} from './types'

/**
 * Phase 8.0C-1: capability ELIGIBILITY - the smallest pure matching layer
 * for Lia Brain. It answers exactly one question:
 *
 *   "Can this engine/model satisfy these required capabilities?"
 *
 * Nothing more. This layer never decides which candidate is better, which
 * one runs, or how user configuration interacts with eligibility - that
 * belongs to a later resolver. Pure by construction: no network, no
 * filesystem, no config reads, no IPC, no logging, and it never owns or
 * modifies the registry (it only consumes descriptors).
 */

/**
 * The canonical capability keys, derived from the interface itself - the
 * nine fields of `LiaBrainCapabilities` stay the single source of truth,
 * so a new capability can never drift into a second hand-maintained list.
 */
export type LiaBrainCapability = keyof LiaBrainCapabilities

/**
 * A task's capability demand, minimally. Semantics:
 * - EVERY capability listed in `required` must be `true`;
 * - capabilities NOT listed never constrain eligibility;
 * - an empty `required` matches everything.
 * Every listed capability counts equally; the list's order carries no
 * meaning of its own.
 */
export interface LiaBrainCapabilityRequirement {
  readonly required: readonly LiaBrainCapability[]
}

/**
 * Whether one capability set satisfies one requirement. Every required
 * capability must be explicitly `true`; anything else (missing, falsy) is
 * an honest "no". Inputs are read, never written.
 */
export function satisfiesBrainCapabilities(
  capabilities: LiaBrainCapabilities,
  requirement: LiaBrainCapabilityRequirement,
): boolean {
  const required = requirement.required
  for (const capability of required) {
    if (capabilities[capability] !== true)
      return false
  }
  return true
}

/**
 * The models whose OWN capability descriptor satisfies the requirement, in
 * the original order. A model's capabilities are taken from its own
 * descriptor only - never inferred from its engine - and composition
 * semantics belong to a later resolver. Input array is never mutated.
 */
export function eligibleBrainModels(
  models: readonly LiaBrainModelDescriptor[],
  requirement: LiaBrainCapabilityRequirement,
): readonly LiaBrainModelDescriptor[] {
  return models.filter(model => satisfiesBrainCapabilities(model.capabilities, requirement))
}

/**
 * The engines whose OWN capability descriptor satisfies the requirement, in
 * the original order. Engine eligibility is independent from the models it
 * serves - no inference either way. Input array is never mutated.
 */
export function eligibleBrainEngines(
  engines: readonly LiaBrainEngineDescriptor[],
  requirement: LiaBrainCapabilityRequirement,
): readonly LiaBrainEngineDescriptor[] {
  return engines.filter(engine => satisfiesBrainCapabilities(engine.capabilities, requirement))
}
