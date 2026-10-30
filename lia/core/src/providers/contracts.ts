/** JSON transport values; no SDK, renderer or upstream types cross this boundary. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface ProviderCapabilities {
  text: boolean
  streaming: boolean
  modelDiscovery: boolean
}

export interface ProviderDefinition {
  id: string
  protocol: 'chat-completions'
  credentialRequired?: boolean
  capabilities?: Partial<ProviderCapabilities>
}

/** References and metadata only. The credential is resolved for each operation. */
export interface ProviderConfig {
  providerId: string
  baseUrl: string
  credentialRequired?: boolean
  timeoutMs?: number
}

export interface ChatRequest {
  model: string
  messages: JsonValue[]
  stream?: boolean
  [key: string]: JsonValue | undefined
}

export interface ChatResponse {
  text: string
}

export type ChatStreamEvent = { type: 'text', text: string } | { type: 'done' }

export interface ProviderModel {
  id: string
  label: string
}

export interface OperationOptions {
  signal?: AbortSignal
}

export interface ProviderRuntimeOptions {
  fetch?: typeof globalThis.fetch
  resolveCredential?: (providerId: string) => Promise<string | undefined> | string | undefined
}

export type ProviderErrorCode = 'unknown-provider' | 'configuration' | 'credentials' | 'http' | 'network' | 'timeout' | 'cancelled' | 'protocol' | 'empty' | 'unsupported'

/** Deliberately excludes raw causes, server bodies, request URLs and credentials. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode
  readonly status?: number

  constructor(code: ProviderErrorCode, status?: number) {
    super(`Provider operation failed: ${code}${status === undefined ? '' : ` (${status})`}`)
    this.name = 'ProviderError'
    this.code = code
    this.status = status
  }
}
