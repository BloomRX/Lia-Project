import type { PresenceConfig, PresenceDisplay } from '../../../../../../lia/core/src/presence'

import { defineInvokeEventa } from '@moeru/eventa'

export type { PresenceConfig } from '../../../../../../lia/core/src/presence'
export type PresenceAction = 'home' | 'set-home'
export interface PresenceSnapshot {
  config: PresenceConfig
  displays: PresenceDisplay[]
  active: boolean
  fullscreen: boolean
}
export type PresenceResult = { ok: true, state: PresenceSnapshot } | { ok: false, code: 'invalid' | 'storage' | 'unavailable' }
export const electronLiaPresenceGet = defineInvokeEventa<PresenceResult>('eventa:invoke:lia:presence:get')
export const electronLiaPresenceSet = defineInvokeEventa<PresenceResult, PresenceConfig>('eventa:invoke:lia:presence:set')
export const electronLiaPresenceAction = defineInvokeEventa<PresenceResult, { action: PresenceAction }>('eventa:invoke:lia:presence:action')
