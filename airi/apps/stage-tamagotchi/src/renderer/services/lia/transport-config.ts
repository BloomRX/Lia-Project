import type { TransportMutation, TransportRecord, TransportResult, TransportSnapshot } from '../../../../../../../lia/core/src/transports/contracts'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'

import { electronLiaTransportsGet, electronLiaTransportsMutate } from '../../../shared/eventa/lia-transports'

export function isNativeTransportDefinition(id: string) {
  return id === 'openai-compatible' || id === 'lm-studio'
}

/** Main owns persistence and revision. This closure is a read cache, never Pinia/storage. */
export function createLiaTransportClient() {
  let snapshot: TransportSnapshot | undefined
  async function refresh() {
    const result = await useElectronEventaInvoke(electronLiaTransportsGet)()
    if (!result?.ok)
      throw new Error('Transport configuration unavailable')
    snapshot = result.snapshot
    return snapshot
  }
  async function mutate(change: Omit<Extract<TransportMutation, { kind: 'put' }>, 'expectedRevision'> | Omit<Extract<TransportMutation, { kind: 'remove' }>, 'expectedRevision'> | Omit<Extract<TransportMutation, { kind: 'migrate' }>, 'expectedRevision'>) {
    if (!snapshot)
      await refresh()
    const result: TransportResult = await useElectronEventaInvoke(electronLiaTransportsMutate)({ ...change, expectedRevision: snapshot!.revision })
    if (!result?.ok)
      throw new Error('Transport configuration could not be saved')
    snapshot = result.snapshot
    return snapshot
  }
  const get = (providerId: string) => {
    const records = snapshot?.records.filter(record => record.providerId === providerId) ?? []
    if (records.length > 1)
      throw new Error('Ambiguous transport selection')
    return records[0]
  }
  return {
    refresh,
    get,
    hasRemoved: (id: string) => snapshot?.tombstones.includes(id) === true,
    put: (record: TransportRecord) => mutate({ kind: 'put', record }),
    remove: (id: string) => mutate({ kind: 'remove', id }),
    migrate: (records: TransportRecord[]) => mutate({ kind: 'migrate', records }),
  }
}

/** Decode the two unversioned local shapes. Unknown protocols remain untouched. */
export function legacyTransportCandidates(configured: unknown, credentials: unknown): Array<{ id: string, definitionId: string, config: Record<string, unknown> }> {
  const candidates = new Map<string, { id: string, definitionId: string, config: Record<string, unknown> }>()
  if (credentials && typeof credentials === 'object' && !Array.isArray(credentials)) {
    for (const [id, config] of Object.entries(credentials)) {
      if (config && typeof config === 'object' && !Array.isArray(config) && isNativeTransportDefinition(id))
        candidates.set(id, { id, definitionId: id, config })
    }
  }
  if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
    for (const [id, value] of Object.entries(configured)) {
      if (!value || typeof value !== 'object')
        continue
      const record = value as Record<string, unknown>
      if (typeof record.definitionId === 'string' && isNativeTransportDefinition(record.definitionId) && record.config && typeof record.config === 'object' && !Array.isArray(record.config))
        candidates.set(id, { id, definitionId: record.definitionId, config: record.config as Record<string, unknown> })
    }
  }
  return [...candidates.values()]
}

export function toTransportRecord(id: string, definitionId: string, config: Record<string, unknown>, modelIds: string[] = []): TransportRecord {
  const { apiKey: _key, baseUrl, ...adapterOptions } = config
  // The main validates JSON, URL, sensitive fields and identity before writing.
  return {
    id,
    providerId: id,
    definitionId,
    type: 'http',
    protocol: 'chat-completions',
    baseUrl: typeof baseUrl === 'string' ? baseUrl : '',
    adapterOptions: adapterOptions as TransportRecord['adapterOptions'],
    modelIds,
    enabled: true,
    metadata: {},
    credentialRef: { scope: id, key: 'apiKey' },
  }
}
