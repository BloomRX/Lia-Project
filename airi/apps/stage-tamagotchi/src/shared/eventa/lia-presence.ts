import type { PresenceAction, PresenceConfig, PresenceResult } from '@lia/contracts/presence'

import { defineInvokeEventa } from '@moeru/eventa'

export type { PresenceAction, PresenceConfig, PresenceResult, PresenceSnapshot } from '@lia/contracts/presence'
export const electronLiaPresenceGet = defineInvokeEventa<PresenceResult>('eventa:invoke:lia:presence:get')
export const electronLiaPresenceSet = defineInvokeEventa<PresenceResult, PresenceConfig>('eventa:invoke:lia:presence:set')
export const electronLiaPresenceAction = defineInvokeEventa<PresenceResult, { action: PresenceAction }>('eventa:invoke:lia:presence:action')
