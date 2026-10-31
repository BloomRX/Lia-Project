import type { TransportMutation, TransportSnapshot } from '../../../../../../../lia/core/src/transports/contracts'

import { EventEmitter } from 'node:events'

import { getActivePinia } from 'pinia'

import { createLiaTransportExecutionService } from '../../../main/services/lia/transport-execution-service'

// Test-only IPC substitute. Real persistence/concurrency has separate Node and Electron gates.
const states = new WeakMap<object, TransportSnapshot>()
type VaultResolver = (payload: { scope: string, key: string }) => Promise<string | undefined>
const vaultResolvers = new WeakMap<object, VaultResolver>()
const executions = new WeakMap<object, ReturnType<typeof createLiaTransportExecutionService>>()
const owners = new WeakMap<object, EventEmitter & { id: number, isDestroyed: () => boolean }>()
const emptySnapshot = (): TransportSnapshot => ({ schemaVersion: 1, revision: 0, records: [], tombstones: [], migration: { version: 1, imported: [] } })

export function setTransportTestVaultResolver(owner: object, resolver: VaultResolver) {
  vaultResolvers.set(owner, resolver)
}

function executionFor(owner: object) {
  let service = executions.get(owner)
  if (!service) {
    const emitter = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false })
    owners.set(owner, emitter)
    service = createLiaTransportExecutionService({
      repository: { read: async () => structuredClone(states.get(owner) ?? emptySnapshot()) },
      vault: { getSecret: (scope: string, key: string) => vaultResolvers.get(owner)?.({ scope, key }) } as Parameters<typeof createLiaTransportExecutionService>[0]['vault'],
      fetch: (...args) => globalThis.fetch(...args),
    })
    executions.set(owner, service)
  }
  return { service, owner: owners.get(owner)! }
}

export function transportTestInvoke(id: string) {
  if (id.startsWith('eventa:invoke:lia:transport:')) {
    return async (payload: never) => {
      const execution = executionFor(getActivePinia()!)
      if (id === 'eventa:invoke:lia:transport:start-receive')
        return execution.service.start(execution.owner, payload)
      if (id === 'eventa:invoke:lia:transport:pull-receive')
        return execution.service.pull(execution.owner, payload)
      if (id === 'eventa:invoke:lia:transport:cancel-receive')
        return execution.service.cancel(execution.owner, payload)
      throw new Error(`Unexpected execution invoke: ${id}`)
    }
  }
  if (!id.startsWith('eventa:invoke:lia:transports:'))
    return undefined
  return async (mutation?: TransportMutation) => {
    const owner = getActivePinia()!
    const state = states.get(owner) ?? emptySnapshot()
    if (mutation) {
      if (mutation.expectedRevision !== state.revision)
        return { ok: false, code: 'conflict' }
      state.protectedCredentialScopes = [...new Set([...(state.protectedCredentialScopes ?? []), ...state.records.map(record => record.providerId)])]
      if (mutation.kind === 'put') {
        state.records = state.records.filter(record => record.id !== mutation.record.id)
        state.records.push(structuredClone(mutation.record))
        state.tombstones = state.tombstones.filter(id => id !== mutation.record.id)
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
      state.protectedCredentialScopes = [...new Set([...state.protectedCredentialScopes, ...state.records.map(record => record.providerId)])]
      executions.get(owner)?.invalidate(state)
    }
    states.set(owner, state)
    return { ok: true, snapshot: structuredClone(state) }
  }
}
