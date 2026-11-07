import { defineInvokeEventa } from '@moeru/eventa'

export interface LiaSpeechConfig {
  baseUrl: string
  hasKey: boolean
  revision: number
}

export type LiaSpeechConfigResult
  = | { ok: true, config: LiaSpeechConfig }
    | { ok: false, code: 'invalid' | 'credentials' | 'conflict' | 'storage' }

export interface LiaSpeechConfigSaveInput {
  providerId: string
  baseUrl: string
  revision: number
  apiKey?: string
}

export const electronLiaSpeechConfigGet = defineInvokeEventa<LiaSpeechConfigResult, { providerId: string }>('eventa:invoke:lia:speech-config:get')
export const electronLiaSpeechConfigSave = defineInvokeEventa<LiaSpeechConfigResult, LiaSpeechConfigSaveInput>('eventa:invoke:lia:speech-config:save')
