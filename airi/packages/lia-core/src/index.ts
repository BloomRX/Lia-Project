/**
 * Lia Core - the product boundary that made the Lia independent of AIRI
 * (Phase 7). Product logic lives here; the Electron launcher
 * (`apps/lia-app`) and the AIRI stage adapter are hosts of this core, never
 * vice-versa.
 */

export { createBrainEngineRegistry, modelsForEngine } from './brain/engine-registry'
export type { LiaBrainEngineRegistrationResult, LiaBrainEngineRegistry } from './brain/engine-registry'
export type {
  LiaBrainCapabilities,
  LiaBrainEngineAvailability,
  LiaBrainEngineDescriptor,
  LiaBrainModelDescriptor,
} from './brain/types'
export { buildLiaBridgeConfig, LIA_STAGE_ENV, stageEnvFor } from './bridge/lia-config'
export type { BuildLiaBridgeConfigInput, LiaBridgeConfig } from './bridge/lia-config'
export { liaProductPaths, liaUserDataCandidates } from './paths/product-paths'
export type { LiaProductPaths } from './paths/product-paths'
export {
  brainSelectionUpdate,
  readLiaProductConfig,
  readPreferredBrainEngineId,
  readPreferredBrainModelId,
} from './product/config'

export type { LiaProductBrainSelection, LiaProductConfigRead, LiaProductConfigSnapshot } from './product/config'
export { ciphertextToBase64, createLiaSecretVault } from './secrets/vault'
export type { LiaSecretVault } from './secrets/vault'
export { createLiaVoiceProfileStore } from './voices/profiles'
