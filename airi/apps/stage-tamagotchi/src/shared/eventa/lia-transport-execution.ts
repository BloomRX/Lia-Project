import type { ChatRequest, ProviderErrorCode } from '../../../../../../lia/core/src/providers/contracts'

import { defineInvokeEventa } from '@moeru/eventa'

export interface LiaTransportStartRequest {
  providerId: string
  expectedBaseUrl?: string
  operation: 'chat' | 'models'
  body?: ChatRequest
  draft?: { baseUrl: string, apiKey?: string }
}

export interface LiaTransportExecutionFailure { ok: false, code: ProviderErrorCode, status?: number }
export type LiaTransportStartResult = { ok: true, id: string } | LiaTransportExecutionFailure
export type LiaTransportPullResult = { ok: true, status?: number, contentType?: string, done?: boolean, bytes?: number[] } | LiaTransportExecutionFailure
export type TransportStartRequest = LiaTransportStartRequest
export type TransportStartResult = LiaTransportStartResult
export type TransportPullResult = LiaTransportPullResult

export const electronLiaTransportStart = defineInvokeEventa<LiaTransportStartResult, LiaTransportStartRequest>('eventa:invoke:lia:transport:start')
export const electronLiaTransportPull = defineInvokeEventa<LiaTransportPullResult, { id: string, action: 'head' | 'read' }>('eventa:invoke:lia:transport:pull')
export const electronLiaTransportCancel = defineInvokeEventa<boolean, { id: string }>('eventa:invoke:lia:transport:cancel')
