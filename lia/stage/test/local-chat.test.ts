import type { TransportRecord, TransportSnapshot } from '../../core/src/transports/contracts.ts'

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createLocalChat } from '../src/main/local-chat.ts'

const record: TransportRecord = {
  id: 'local-chat',
  definitionId: 'local-chat',
  providerId: 'local-chat',
  type: 'http',
  protocol: 'chat-completions',
  baseUrl: 'http://example.invalid/v1',
  enabled: true,
  modelIds: ['test-model'],
  adapterOptions: { localOnly: true, allowUnauthenticated: true },
  metadata: {},
  credentialRef: { scope: 'local-chat', key: 'apiKey' },
}

function fixture(records: TransportRecord[], tombstones: string[] = []) {
  const snapshot: TransportSnapshot = { schemaVersion: 1, revision: 1, records, tombstones, migration: { version: 1, imported: [] } }
  return createLocalChat({
    async readProduct() {
      return { filePath: '', status: 'ok', value: { provider: { chat: { preferred: { providerId: 'local-chat', modelId: 'test-model' } } } } }
    },
    async readTransports() { return snapshot },
  })
}

test('refuses input other than bounded nonempty text', async () => {
  const send = fixture([])
  for (const input of [{ baseUrl: 'http://127.0.0.1' }, ' ', 'x'.repeat(8_001)])
    assert.deepEqual(await send(input, new AbortController().signal), { ok: false, code: 'invalid' })
})

test('refuses remote, disabled, unapproved model and tombstoned connections', async () => {
  const local = { ...record, baseUrl: 'http://127.0.0.1:1234/v1' }
  for (const send of [
    fixture([record]),
    fixture([{ ...local, enabled: false }]),
    fixture([{ ...local, modelIds: ['other'] }]),
    fixture([local], ['local-chat']),
  ])
    assert.deepEqual(await send('ola', new AbortController().signal), { ok: false, code: 'configuration' })
})

test('returns a public cancellation result when already aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  assert.deepEqual(await fixture([])('ola', controller.signal), { ok: false, code: 'cancelled' })
})
