import type { LiaTranscriptionRunRequest } from '@lia/contracts/transcription'
import type { TransportRecord } from '@lia/contracts/transports'

import {
  parseTranscriptionResponse as parseResponse,
  prepareTranscriptionRequest as prepareRequest,
} from '@lia/contracts/transcription/transport'

import { isCuratedChatProvider } from '../../../shared/lia/provider-catalog'

export { isNativeRecordingTranscriptionProvider, isTranscriptionLoopback, resolveTranscriptionDestination } from '@lia/contracts/transcription/transport'

export const prepareTranscriptionRequest = (record: TransportRecord, request: LiaTranscriptionRunRequest, credential: string | undefined) =>
  prepareRequest(record, request, credential, isCuratedChatProvider)

export const parseTranscriptionResponse = (providerId: string, json: unknown) =>
  parseResponse(providerId, json, isCuratedChatProvider)
