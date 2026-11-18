import { defineInvokeEventa } from '@moeru/eventa'

export interface LiaTransportCredentialSave {
  providerId: string
  revision: number
  expectedBaseUrl: string
  apiKey: string
}

export const electronLiaTranscriptionCredentialHas = defineInvokeEventa<boolean, { providerId: string }>('eventa:invoke:lia:transcription-credential:has')
export const electronLiaTranscriptionCredentialSave = defineInvokeEventa<boolean, LiaTransportCredentialSave>('eventa:invoke:lia:transcription-credential:save')
export const electronLiaChatCredentialHas = defineInvokeEventa<boolean, { providerId: string }>('eventa:invoke:lia:chat-credential:has')
export const electronLiaChatCredentialSave = defineInvokeEventa<boolean, LiaTransportCredentialSave>('eventa:invoke:lia:chat-credential:save')
