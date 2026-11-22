import type { TransportRecord, TransportSnapshot } from '../../core/src/transports/contracts.ts'

import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
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

test('carries completed turns and keeps history out of a different model', async () => {
  const requests: { model: string, messages: { role: string, content: string }[] }[] = []
  const server = createServer(async (request, response) => {
    const chunks: Uint8Array[] = []
    for await (const chunk of request)
      chunks.push(chunk)
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    response.end(JSON.stringify({ choices: [{ message: { content: 'Resposta' } }] }))
  })
  server.listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    let modelId = 'test-model'
    const local = { ...record, baseUrl: `http://127.0.0.1:${address.port}/v1`, modelIds: ['test-model', 'new-model'] }
    const send = createLocalChat({
      async readProduct() {
        return { filePath: '', status: 'ok', value: { provider: { chat: { preferred: { providerId: 'local-chat', modelId } } } } }
      },
      async readTransports() {
        return { schemaVersion: 1, revision: 1, records: [local], tombstones: [], migration: { version: 1, imported: [] } }
      },
    })
    const submit = (text: string) => send(text, new AbortController().signal)
    assert.equal((await submit('Primeira')).ok, true)
    assert.equal((await submit('Segunda')).ok, true)
    assert.deepEqual(requests[1]!.messages, [
      { role: 'user', content: 'Primeira' },
      { role: 'assistant', content: 'Resposta' },
      { role: 'user', content: 'Segunda' },
    ])
    modelId = 'new-model'
    assert.equal((await submit('Novo modelo')).ok, true)
    assert.equal(requests[2]!.model, 'new-model')
    assert.deepEqual(requests[2]!.messages, [{ role: 'user', content: 'Novo modelo' }])
  }
  finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
