import type { RuntimeSecretStore } from '../src/runtime/credentials.ts'

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ControlError } from '../src/runtime/control.ts'
import { createCredentialHandler } from '../src/runtime/credentials.ts'

function createStore(initial: Record<string, string> = {}) {
  const secrets = new Map(Object.entries(initial))
  let revision = 0
  const nextRevision = () => `r${++revision}`
  const store: RuntimeSecretStore = {
    async changeSecret(scope, key, value, options) {
      if (options.signal?.aborted)
        throw new Error('aborted')
      if ((store.secretRevision?.(scope, key) ?? '') !== options.expectedRevision)
        return undefined
      if (value === undefined)
        secrets.delete(`${scope}/${key}`)
      else
        secrets.set(`${scope}/${key}`, value)
      return { revision: nextRevision() }
    },
    getSecret: (scope, key) => secrets.get(`${scope}/${key}`),
    hasSecret: (scope, key) => secrets.has(`${scope}/${key}`),
    async deleteSecret(scope, key) {
      secrets.delete(`${scope}/${key}`)
      return true
    },
    secretRevision: (scope, key) => `rev-${secrets.get(`${scope}/${key}`) ?? ''}`,
    async setSecret(scope, key, value) {
      secrets.set(`${scope}/${key}`, value)
      return true
    },
  }
  return { secrets, store }
}

const handler = (store: RuntimeSecretStore) => createCredentialHandler(store)

describe('credenciais servidas pelo Runtime', () => {
  it('lê um segredo existente', async () => {
    const { store } = createStore({ 'groq/apiKey': 'sk-1' })
    const value = await handler(store)({ command: 'credentials.get', id: '1', payload: { key: 'apiKey', scope: 'groq' } }, new AbortController().signal)
    assert.equal(value, 'sk-1')
  })

  it('devolve undefined para segredo ausente, sem lançar', async () => {
    const { store } = createStore()
    const value = await handler(store)({ command: 'credentials.get', id: '1', payload: { key: 'apiKey', scope: 'groq' } }, new AbortController().signal)
    assert.equal(value, undefined)
  })

  it('grava usando a revisão atual e devolve a nova', async () => {
    const { secrets, store } = createStore({ 'groq/apiKey': 'sk-1' })
    const revision = await handler(store)({
      command: 'credentials.set',
      id: '1',
      payload: { expectedRevision: 'rev-sk-1', key: 'apiKey', scope: 'groq', value: 'sk-2' },
    }, new AbortController().signal)
    assert.equal(typeof revision, 'string')
    assert.equal(secrets.get('groq/apiKey'), 'sk-2')
  })

  it('recusa escrita com revisão desatualizada', async () => {
    const { secrets, store } = createStore({ 'groq/apiKey': 'sk-1' })
    await assert.rejects(
      handler(store)({
        command: 'credentials.set',
        id: '1',
        payload: { expectedRevision: 'rev-antiga', key: 'apiKey', scope: 'groq', value: 'sk-2' },
      }, new AbortController().signal),
      (error: unknown) => error instanceof ControlError && error.code === 'denied',
    )
    assert.equal(secrets.get('groq/apiKey'), 'sk-1')
  })

  it('fecha por padrão quando o chamador não autoriza o escopo', async () => {
    const { store } = createStore({ 'groq/apiKey': 'sk-1' })
    const guarded = createCredentialHandler(store, { isAllowed: () => false })
    await assert.rejects(
      guarded({ command: 'credentials.get', id: '1', payload: { key: 'apiKey', scope: 'groq' } }, new AbortController().signal),
      (error: unknown) => error instanceof ControlError && error.code === 'denied',
    )
  })

  it('cancelamento antes da execução não toca o cofre', async () => {
    const { store } = createStore({ 'groq/apiKey': 'sk-1' })
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      handler(store)({ command: 'credentials.get', id: '1', payload: { key: 'apiKey', scope: 'groq' } }, controller.signal),
      (error: unknown) => error instanceof ControlError && error.code === 'timeout',
    )
  })
})
