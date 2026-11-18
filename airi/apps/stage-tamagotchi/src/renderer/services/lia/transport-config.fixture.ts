import type { TransportMutation, TransportSnapshot } from '@lia/contracts/transports'

import type { LiaTransportCredentialSave } from '../../../shared/eventa/lia-transport-credentials'

import { EventEmitter } from 'node:events'

import { bindCredential, credentialForDestination } from '@lia/contracts/credentials/destination'
import { getActivePinia } from 'pinia'

import { createLiaTransportExecutionService } from '../../../main/services/lia/transport-execution-service'

// Test-only IPC substitute. Real persistence/concurrency has separate Node and Electron gates.
const states = new WeakMap<object, TransportSnapshot>()
type VaultResolver = (payload: { scope: string, key: string }) => Promise<string | undefined>
const vaultResolvers = new WeakMap<object, VaultResolver>()
const chatKeys = new WeakMap<object, Map<string, string>>()
const chatWrites = new WeakMap<object, (input: LiaTransportCredentialSave) => Promise<boolean>>()
const executions = new WeakMap<object, ReturnType<typeof createLiaTransportExecutionService>>()
const owners = new WeakMap<object, EventEmitter & { id: number, isDestroyed: () => boolean }>()
const emptySnapshot = (): TransportSnapshot => ({ schemaVersion: 1, revision: 0, records: [], tombstones: [], migration: { version: 1, imported: [] } })
/** Test-only: a main process that must refuse every write, for one owner. */
const writeFailures = new WeakMap<object, 'conflict' | 'storage'>()

/**
 * Makes the fake main reject every transport mutation, the way a real one does
 * when the disk is unavailable or another window keeps winning the CAS.
 *
 * Exists so a test can prove the renderer stops BEFORE executing a provider
 * whose endpoint could not be persisted — the ordering Corte B requires.
 */
export function setTransportTestWriteFailure(owner: object, code: 'conflict' | 'storage' | undefined) {
  if (code)
    writeFailures.set(owner, code)
  else
    writeFailures.delete(owner)
}

export function setTransportTestVaultResolver(owner: object, resolver: VaultResolver) {
  vaultResolvers.set(owner, resolver)
}

export function setTransportTestChatWriter(owner: object, writer: (input: LiaTransportCredentialSave) => Promise<boolean>) {
  chatWrites.set(owner, writer)
}

/** A new renderer can attach to the same fake Main without re-entering credentials. */
export function reconnectTransportTestMain(previousRenderer: object, nextRenderer: object) {
  const snapshot = states.get(previousRenderer)
  if (snapshot)
    states.set(nextRenderer, structuredClone(snapshot))
  const saved = chatKeys.get(previousRenderer)
  if (saved)
    chatKeys.set(nextRenderer, new Map(saved))
}

/** Simulates a key previously saved for a known address, independent of later record edits. */
export function setTransportTestChatVaultResolver(owner: object, resolver: VaultResolver, address: string | ((scope: string) => string)) {
  setTransportTestVaultResolver(owner, async (payload) => {
    const value = await resolver(payload)
    return value ? bindCredential(payload.scope, new URL(typeof address === 'string' ? address : address(payload.scope)), value, 'chat') : undefined
  })
}

function executionFor(owner: object) {
  let service = executions.get(owner)
  if (!service) {
    const emitter = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false })
    owners.set(owner, emitter)
    service = createLiaTransportExecutionService({
      repository: { read: async () => structuredClone(states.get(owner) ?? emptySnapshot()) },
      vault: { getSecret: async (scope: string, key: string) => {
        const value = await vaultResolvers.get(owner)?.({ scope, key })
        return chatKeys.get(owner)?.get(scope) ?? value
      } } as unknown as Parameters<typeof createLiaTransportExecutionService>[0]['vault'],
      fetch: (...args) => globalThis.fetch(...args),
    })
    executions.set(owner, service)
  }
  return { service, owner: owners.get(owner)! }
}

export function transportTestInvoke(id: string) {
  if (id.startsWith('eventa:invoke:lia:chat-credential:')) {
    return async (payload: { providerId: string, revision?: number, expectedBaseUrl?: string, apiKey?: string }) => {
      const owner = getActivePinia()!
      const state = states.get(owner)
      const record = state?.records.find(record => record.providerId === payload.providerId)
      if (!record?.enabled || record.protocol !== 'chat-completions')
        return false
      const base = new URL(record.baseUrl)
      if (id.endsWith(':has-receive')) {
        const value = chatKeys.get(owner)?.get(payload.providerId) ?? await vaultResolvers.get(owner)?.({ scope: payload.providerId, key: 'apiKey' })
        return !!credentialForDestination(value, payload.providerId, base, 'chat')
      }
      if (payload.revision !== state?.revision || payload.expectedBaseUrl !== record.baseUrl || !payload.apiKey)
        return false
      const writer = chatWrites.get(owner)
      if (writer && !await writer({ providerId: payload.providerId, revision: payload.revision!, expectedBaseUrl: payload.expectedBaseUrl, apiKey: payload.apiKey }))
        return false
      const keys = chatKeys.get(owner) ?? new Map<string, string>()
      keys.set(payload.providerId, bindCredential(payload.providerId, base, payload.apiKey, 'chat'))
      chatKeys.set(owner, keys)
      return true
    }
  }
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
    const forced = writeFailures.get(owner)
    if (mutation && forced)
      return { ok: false, code: forced }
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
