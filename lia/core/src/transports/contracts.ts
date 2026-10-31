export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue }

/** Serializable metadata only. Credentials belong to the vault, never this document. */
export interface TransportRecord {
  id: string
  providerId: string
  definitionId: string
  type: 'http'
  protocol: 'chat-completions'
  baseUrl: string
  adapterOptions: Record<string, JSONValue>
  modelIds: string[]
  enabled: boolean
  metadata: { label?: string }
  credentialRef: { scope: string, key: 'apiKey' }
}

export interface TransportSnapshot {
  schemaVersion: 1
  revision: number
  records: TransportRecord[]
  tombstones: string[]
  /** Persistent protection survives removal even when transport ID differs from provider ID. */
  protectedCredentialScopes?: string[]
  /** Older removals may not retain the provider-to-transport association. Fail closed. */
  credentialProtectionIncomplete?: boolean
  migration: { version: 1, imported: string[] }
}

export type TransportMutation
  = | { kind: 'put', expectedRevision: number, record: TransportRecord }
    | { kind: 'remove', expectedRevision: number, id: string }
    | { kind: 'migrate', expectedRevision: number, records: TransportRecord[] }

export type TransportResult
  = | { ok: true, snapshot: TransportSnapshot }
    | { ok: false, code: 'conflict' | 'invalid' | 'storage' }
