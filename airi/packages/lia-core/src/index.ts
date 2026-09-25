/**
 * Lia Core - the product boundary that made the Lia independent of AIRI
 * (Phase 7). Product logic lives here; the Electron launcher
 * (`apps/lia-app`) and the AIRI stage adapter are hosts of this core, never
 * vice-versa.
 */

export { groqBrainDescriptors } from './brain/adapters/groq'
export type { LiaBrainDescriptorSet } from './brain/adapters/groq'
export {
  eligibleBrainEngines,
  eligibleBrainModels,
  satisfiesBrainCapabilities,
} from './brain/capabilities'
export type { LiaBrainCapability, LiaBrainCapabilityRequirement } from './brain/capabilities'
export { createProductionBrainCatalog } from './brain/catalog'
export type { LiaBrainCatalog } from './brain/catalog'
export { brainRequirementForChatTurn } from './brain/chat-requirement'
export type { LiaChatTurnBrainFacts } from './brain/chat-requirement'
export { decideBrainRoute } from './brain/decision'
export type { LiaBrainRoutingDecision, LiaBrainRoutingDecisionInput } from './brain/decision'
export { createBrainEngineRegistry, modelsForEngine } from './brain/engine-registry'
export type { LiaBrainEngineRegistrationResult, LiaBrainEngineRegistry } from './brain/engine-registry'
export { resolvePreferredBrainSelection } from './brain/resolver'
export type { LiaBrainPreferredResolution, LiaBrainPreferredResolutionInput } from './brain/resolver'
export { eligibleBrainModelRoutes } from './brain/routes'
export type { LiaBrainModelRoute } from './brain/routes'
export { decideBrainRouteFromProductState } from './brain/runtime'
export type { LiaBrainRuntimeContext } from './brain/runtime'
export { selectBrainRouteByPolicy } from './brain/selection'
export type {
  LiaBrainAutomaticSelection,
  LiaBrainAutomaticSelectionPolicy,
  LiaBrainRouteRef,
} from './brain/selection'
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
  brainRoutingModeUpdate,
  brainSelectionUpdate,
  isBrainRoutingMode,
  readBrainRoutingMode,
  readLiaProductConfig,
  readPreferredBrainEngineId,
  readPreferredBrainModelId,
} from './product/config'

export type {
  LiaBrainRoutingMode,
  LiaProductBrainSelection,
  LiaProductConfigRead,
  LiaProductConfigSnapshot,
} from './product/config'
export { ciphertextToBase64, createLiaSecretVault } from './secrets/vault'
export type { LiaSecretVault } from './secrets/vault'
export { createLiaVoiceProfileStore } from './voices/profiles'
