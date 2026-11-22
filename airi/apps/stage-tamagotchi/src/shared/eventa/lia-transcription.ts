import type { LiaTranscriptionRunOutcome, LiaTranscriptionRunRequest } from '@lia/contracts/transcription'

import { defineInvokeEventa } from '@moeru/eventa'

export type { LiaTranscriptionRunFailure, LiaTranscriptionRunOutcome, LiaTranscriptionRunRequest, LiaTranscriptionRunResult } from '@lia/contracts/transcription'

export const electronLiaTranscriptionRun = defineInvokeEventa<LiaTranscriptionRunOutcome, LiaTranscriptionRunRequest>(
  'eventa:invoke:lia:transcription:run',
)

export const electronLiaTranscriptionCancel = defineInvokeEventa<{ ok: boolean }, { requestId: string }>(
  'eventa:invoke:lia:transcription:cancel',
)
