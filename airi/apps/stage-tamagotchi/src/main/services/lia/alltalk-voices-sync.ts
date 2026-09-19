import type { AllTalkSyncDeps, AllTalkSyncService as CoreSyncService } from '@lia/core/alltalk/voices-sync'

import type { LiaAllTalkSyncResult } from '../../../shared/eventa'

import { createAllTalkSyncService as createCoreAllTalkSyncService } from '@lia/core/alltalk/voices-sync'

export {
  ALLTALK_AUDIO_EXTENSIONS,
  describeManagedFilename,
  MANAGED_VOICE_PREFIX,
  managedVoiceFilename,
  referenceFileOf,
  SYNC_METADATA,
} from '@lia/core/alltalk/voices-sync'

/**
 * Migration shim (Phase 7.5): the implementation lives in Lia Core at
 * `@lia/core/alltalk/voices-sync` - the LAUNCHER prepares voices before the
 * runtime starts, so the logic could no longer live only inside the stage.
 * This shim caps the core result type into the eventa contract the IPC
 * layers already speak; every existing import path and test keeps compiling
 * against the same API. Do not grow new code here.
 */
export interface AllTalkSyncService extends Omit<CoreSyncService, 'ensureProfileAvailableToAllTalk'> {
  ensureProfileAvailableToAllTalk: (profileId: string) => Promise<LiaAllTalkSyncResult>
}

export function createAllTalkSyncService(deps: AllTalkSyncDeps): AllTalkSyncService {
  return createCoreAllTalkSyncService(deps) as AllTalkSyncService
}
