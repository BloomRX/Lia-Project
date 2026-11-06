import type { ChatRequest, ProviderErrorCode } from '../../../../../../lia/core/src/providers/contracts'

import { defineInvokeEventa } from '@moeru/eventa'

export interface LiaTransportStartRequest {
  providerId: string
  expectedBaseUrl?: string
  operation: 'chat' | 'models'
  body?: ChatRequest
  /**
   * An endpoint that is not persisted yet — the "test this address" path.
   *
   * It carries a LOCATION and never a credential. Until Corte B this object also
   * accepted `apiKey`, which meant the first contact with an unsaved provider
   * put the secret on the execution payload: the renderer had to hold the key to
   * test it, so testing a key required the very exposure the cut removes.
   *
   * The credential now has one channel — `secrets:set`, which writes to the
   * vault and reports success — and execution reads it there. A provider is
   * therefore configured (key stored, record persisted) before it is executed;
   * see `prepareNativeExecution` in the renderer store.
   */
  draft?: { baseUrl: string }
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
