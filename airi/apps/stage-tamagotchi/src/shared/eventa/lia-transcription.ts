import type { ProviderErrorCode } from '../../../../../../lia/core/src/providers/contracts'

import { defineInvokeEventa } from '@moeru/eventa'

/**
 * Transcription executed by the main process.
 *
 * The Lia's speech-to-text runs on Groq, which is one of the curated chat
 * providers. Until this cut the renderer built an audio client from the vault
 * key, so the same credential the chat path had just been denied had to stay
 * readable for transcription — the one exception left in
 * `canRendererReadLegacySecret`.
 *
 * This request carries audio and options and nothing else:
 *
 *  - NO `baseUrl`: the endpoint is the provider's persisted transport record, so
 *    a compromised renderer cannot aim the stored credential at a new host. It
 *    must be configured first, exactly like chat (Corte B, Fase 1).
 *  - NO `apiKey`: the key is read from the vault in main.
 *
 * `bytes` is the audio itself. It is not a secret, and it is bounded on both
 * sides of the boundary.
 */
export interface LiaTranscriptionRunRequest {
  /** A curated provider id whose transport record authorizes the endpoint. */
  providerId: string
  model: string
  fileName: string
  mimeType: string
  /** Raw audio. The pipeline's File bytes, unchanged. */
  bytes: Uint8Array
  responseFormat?: 'json' | 'verbose_json'
  language?: string
  prompt?: string
  temperature?: number
}

/** The subset of an OpenAI-compatible transcription response the pipeline reads. */
export interface LiaTranscriptionRunResult {
  ok: true
  status: number
  text: string
  /** `verbose_json` segments, when the provider returned them. */
  segments?: Array<{ text?: string, start?: number, end?: number, [key: string]: unknown }>
  language?: string
}

export interface LiaTranscriptionRunFailure {
  ok: false
  code: ProviderErrorCode
  status?: number
}

export type LiaTranscriptionRunOutcome = LiaTranscriptionRunResult | LiaTranscriptionRunFailure

export const electronLiaTranscriptionRun = defineInvokeEventa<LiaTranscriptionRunOutcome, LiaTranscriptionRunRequest>(
  'eventa:invoke:lia:transcription:run',
)
