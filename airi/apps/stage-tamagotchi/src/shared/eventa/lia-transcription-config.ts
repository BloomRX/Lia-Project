import { defineInvokeEventa } from '@moeru/eventa'

export interface LiaTranscriptionCredentialSave {
  providerId: string
  revision: number
  expectedBaseUrl: string
  apiKey: string
}

export const electronLiaTranscriptionCredentialHas = defineInvokeEventa<boolean, { providerId: string }>('eventa:invoke:lia:transcription-credential:has')
export const electronLiaTranscriptionCredentialSave = defineInvokeEventa<boolean, LiaTranscriptionCredentialSave>('eventa:invoke:lia:transcription-credential:save')
