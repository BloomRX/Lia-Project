/**
 * Lia Core - the product boundary that made the Lia independent of AIRI
 * (Phase 7). Product logic lives here; the Electron launcher
 * (`apps/lia-app`) and the AIRI stage adapter are hosts of this core, never
 * vice-versa.
 */

export { buildLiaBridgeConfig, LIA_STAGE_ENV, stageEnvFor } from './bridge/lia-config'
export type { BuildLiaBridgeConfigInput, LiaBridgeConfig } from './bridge/lia-config'
export { liaProductPaths, liaUserDataCandidates } from './paths/product-paths'
export type { LiaProductPaths } from './paths/product-paths'
export { readLiaProductConfig } from './product/config'

export type { LiaProductConfigRead, LiaProductConfigSnapshot } from './product/config'
export { ciphertextToBase64, createLiaSecretVault } from './secrets/vault'
export type { LiaSecretVault } from './secrets/vault'
export { createLiaVoiceProfileStore } from './voices/profiles'
