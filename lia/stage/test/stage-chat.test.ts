import type { TransportRecord, TransportSnapshot } from '../../core/src/transports/contracts.ts'

import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'

import { bindCredential } from '../../core/src/credentials/destination.ts'
import { createStageChat } from '../src/main/stage-chat.ts'

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
  return createStageChat({
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

test('uses a bound chat credential only for the configured HTTPS origin', async () => {
  const url = new URL('https://api.groq.com/openai/v1')
  const token = 'stage-synthetic-token'
  const groq = {
    ...record,
    id: 'custom-name',
    providerId: 'groq',
    definitionId: 'groq',
    baseUrl: url.href,
    credentialRef: { scope: 'groq', key: 'apiKey' as const },
  }
  let secret = bindCredential('groq', url, token, 'chat')
  let calls = 0
  let reply = 'Resposta'
  const send = createStageChat({
    async fetch(target, init) {
      calls++
      assert.equal(String(target), 'https://api.groq.com/openai/v1/chat/completions')
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${token}`)
      assert.equal(init?.redirect, 'error')
      return Response.json({ choices: [{ message: { content: reply } }] })
    },
    readCredential: () => secret,
    async recallMemory() {
      assert.fail('Remote chat must never read the memory store')
    },
    async readProduct() {
      return { filePath: '', status: 'ok', value: { provider: { chat: { preferred: { providerId: 'groq', modelId: 'test-model' } } } } }
    },
    async readTransports() {
      return { schemaVersion: 1, revision: 1, records: [groq], tombstones: [], migration: { version: 1, imported: [] } }
    },
  })
  const submit = () => send('oi', new AbortController().signal)
  assert.deepEqual(await submit(), { ok: true, text: 'Resposta' })
  reply = token
  assert.deepEqual(await submit(), { ok: false, code: 'unavailable' })
  secret = bindCredential('groq', url, token, 'speech')
  assert.deepEqual(await submit(), { ok: false, code: 'configuration' })
  secret = bindCredential('groq', new URL('https://other.invalid'), token, 'chat')
  assert.deepEqual(await submit(), { ok: false, code: 'configuration' })
  groq.baseUrl = 'http://127.0.0.1/v1'
  assert.deepEqual(await submit(), { ok: false, code: 'configuration' })
  assert.equal(calls, 2)
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
    let useMemory = false
    const local = { ...record, baseUrl: `http://127.0.0.1:${address.port}/v1`, modelIds: ['test-model', 'new-model'] }
    const send = createStageChat({
      async recallMemory() {
        return { ok: true, value: useMemory ? 'Contexto pessoal de teste' : '' }
      },
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
    useMemory = true
    assert.equal((await submit('Com memória')).ok, true)
    assert.deepEqual(requests[3]!.messages[0], { role: 'system', content: 'Contexto pessoal de teste' })
    useMemory = false
    assert.equal((await submit('Sem memória')).ok, true)
    assert.deepEqual(requests[4]!.messages.map(message => message.content), ['Novo modelo', 'Resposta', 'Sem memória'])
  }
  finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
