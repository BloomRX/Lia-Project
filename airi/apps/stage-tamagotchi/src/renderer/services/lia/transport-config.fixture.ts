import type { TransportMutation, TransportSnapshot } from '../../../../../../../lia/core/src/transports/contracts'

import { getActivePinia } from 'pinia'

// Test-only IPC substitute. Real persistence/concurrency has separate Node and Electron gates.
const states = new WeakMap<object, TransportSnapshot>()
export function transportTestInvoke(id: string) {
  if (!id.startsWith('eventa:invoke:lia:transports:'))
    return undefined
  return async (mutation?: TransportMutation) => {
    const owner = getActivePinia()!
    const state = states.get(owner) ?? { schemaVersion: 1, revision: 0, records: [], tombstones: [], migration: { version: 1, imported: [] } }
    if (mutation) {
      if (mutation.expectedRevision !== state.revision)
        return { ok: false, code: 'conflict' }
      if (mutation.kind === 'put') {
        state.records = state.records.filter(record => record.id !== mutation.record.id)
        state.records.push(structuredClone(mutation.record))
      }
      if (mutation.kind === 'remove') {
        state.records = state.records.filter(record => record.id !== mutation.id)
        state.tombstones.push(mutation.id)
      }
      if (mutation.kind === 'migrate') {
        for (const record of mutation.records) {
          if (!state.records.some(current => current.id === record.id) && !state.tombstones.includes(record.id))
            state.records.push(structuredClone(record))
        }
      }
      state.revision++
    }
    states.set(owner, state)
    return { ok: true, snapshot: structuredClone(state) }
  }
}
