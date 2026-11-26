import type { TransportRecord, TransportSnapshot } from '../../core/src/transports/contracts.ts'

import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'

import { createProductionBrainCatalog } from '@lia/core'

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

test('clock permission is opt-in and unknown tool calls cannot trigger a follow-up', async () => {
  const local = { ...record, baseUrl: 'http://127.0.0.1:1234/v1' }
  const requests: { tools?: { function: { name: string } }[] }[] = []
  const send = createStageChat({
    async fetch(_url, input) {
      requests.push(JSON.parse(String(input?.body)))
      return Response.json({ choices: [{ message: {
        content: null, tool_calls: [{ id: 'invalid_tool', type: 'function', function: { name: 'other', arguments: '{}' } }],
      } }] })
    },
    async readProduct() {
      return { filePath: '', status: 'ok', value: { provider: { chat: { preferred: { providerId: 'local-chat', modelId: 'test-model' } } } } }
    },
    async readTransports() {
      return { schemaVersion: 1, revision: 1, records: [local], tombstones: [], migration: { version: 1, imported: [] } }
    },
  })
  assert.deepEqual(await send('Oi', new AbortController().signal), { ok: false, code: 'unavailable' })
  assert.equal(requests[0]?.tools, undefined)
  assert.deepEqual(await send('Que horas são?', new AbortController().signal, undefined, true), { ok: false, code: 'unavailable' })
  assert.equal(requests[1]?.tools?.[0]?.function.name, 'lia_local_time')
  assert.equal(requests.length, 2)
})

test('suggests or requests confirmation without dispatching a model or capability', async () => {
  const send = fixture([{ ...record, baseUrl: 'http://127.0.0.1:1234/v1' }])
  const signal = new AbortController().signal
  assert.deepEqual(await send('Hora?', signal, undefined, { capability: 'local-clock', mode: 'suggest' }),
    { ok: false, code: 'capability-suggested', capability: 'local-clock' })
  assert.deepEqual(await send('Hora?', signal, undefined, { capability: 'local-clock', mode: 'request' }),
    { ok: false, code: 'confirmation-required', capability: 'local-clock' })
  assert.deepEqual(await send('Hora?', signal, undefined, { capability: 'hub-tool', mode: 'request' }),
    { ok: false, code: 'invalid' })
  assert.deepEqual(await send('Hora?', signal, undefined, { capability: 'local-clock', mode: 'request', confirmed: true }),
    { ok: false, code: 'invalid' })
})

test('does not dispatch or recall private context if the local route changes during confirmation', async () => {
  const local = { ...record, baseUrl: 'http://127.0.0.1:1234/v1' }
  let requests = 0
  let recalls = 0
  const send = createStageChat({
    async fetch() { requests++; return new Response() },
    async recallMemory() { recalls++; return { ok: true, value: 'Privado' } },
    async readProduct() {
      return { filePath: '', status: 'ok', value: { provider: { chat: { preferred: { providerId: 'local-chat', modelId: 'test-model' } } } } }
    },
    async readTransports() {
      return { schemaVersion: 1, revision: 1, records: [local], tombstones: [], migration: { version: 1, imported: [] } }
    },
  })
  const signal = new AbortController().signal
  const intent = { capability: 'local-clock', mode: 'request' }
  const result = await send('Hora?', signal, undefined, intent, async () => {
    local.baseUrl = 'http://127.0.0.1:4321/v1'
    return true
  })
  assert.deepEqual(result, { ok: false, code: 'configuration' })
  assert.equal(requests, 0)
  assert.equal(recalls, 0)
})

test('does not send a clock result after the local transport is removed', async () => {
  const local = { ...record, baseUrl: 'http://127.0.0.1:1234/v1' }
  let requests = 0
  const send = createStageChat({
    async fetch() {
      requests++
      return Response.json({ choices: [{ message: {
        content: null, tool_calls: [{ id: 'clock', type: 'function', function: { name: 'lia_local_time', arguments: '{}' } }],
      } }] })
    },
    async readProduct() {
      return { filePath: '', status: 'ok', value: { provider: { chat: { preferred: { providerId: 'local-chat', modelId: 'test-model' } } } } }
    },
    async readTransports() {
      return { schemaVersion: 1, revision: 1 + requests, records: [local], tombstones: requests ? [local.id] : [], migration: { version: 1, imported: [] } }
    },
  })
  assert.deepEqual(await send('Que horas são?', new AbortController().signal, undefined, true), { ok: false, code: 'configuration' })
  assert.equal(requests, 1)
})

test('rejects a selected personality card that is not available in the native Stage', async () => {
  const send = createStageChat({
    async readProduct() {
      return { filePath: '', status: 'ok', value: { persona: { activeCardId: 'custom-card' } } }
    },
    async readTransports() { return assert.fail('Transport must not be resolved for an unavailable card') },
  })
  assert.deepEqual(await send('Olá', new AbortController().signal), { ok: false, code: 'persona-unavailable' })
})

test('never reads a private imported personality when a remote provider is selected', async () => {
  const send = createStageChat({
    async readProduct() {
      return { filePath: '', status: 'ok', value: { persona: { activeCardId: `card-${'a'.repeat(64)}` }, provider: { chat: { preferred: { providerId: 'groq', modelId: 'test-model' } } } } }
    },
    async readPersona() { return assert.fail('Private card must not be loaded for remote chat') },
    async readTransports() { return assert.fail('Remote route must not be prepared for a private card') },
  })
  assert.deepEqual(await send('Olá', new AbortController().signal), { ok: false, code: 'persona-unavailable' })
})

test('a route change during preparation does not send the draft to the old or new destination', async () => {
  const local = { ...record, baseUrl: 'http://127.0.0.1:1234/v1' }
  for (const change of ['tombstone', 'endpoint', 'model'] as const) {
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    let changed = false
    let requests = 0
    const send = createStageChat({
      async fetch() {
        requests++
        return Response.json({ choices: [{ message: { content: 'Resposta' } }] })
      },
      async readProduct() {
        const modelId = changed && change === 'model' ? 'new-model' : 'test-model'
        return { filePath: '', status: 'ok', value: { provider: { chat: { preferred: { providerId: 'local-chat', modelId } } } } }
      },
      async readTransports() {
        const baseUrl = changed && change === 'endpoint' ? 'http://127.0.0.1:1235/v1' : local.baseUrl
        return {
          schemaVersion: 1, revision: changed ? 2 : 1,
          records: [{ ...local, baseUrl, modelIds: ['test-model', 'new-model'] }],
          tombstones: changed && change === 'tombstone' ? [local.id] : [],
          migration: { version: 1, imported: [] },
        }
      },
      async recallMemory() {
        entered.resolve()
        await resume.promise
        return { ok: true, value: 'Memória pessoal' }
      },
    })
    const pending = send('Rascunho', new AbortController().signal)
    await entered.promise
    changed = true
    resume.resolve()
    assert.deepEqual(await pending, { ok: false, code: 'configuration' }, change)
    assert.equal(requests, 0, change)
  }
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
  let status = 200
  const requests: Array<{ model: string, messages: Array<{ content: unknown }> }> = []
  const send = createStageChat({
    async fetch(target, init) {
      calls++
      assert.equal(String(target), 'https://api.groq.com/openai/v1/chat/completions')
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${token}`)
      assert.equal(init?.redirect, 'error')
      requests.push(JSON.parse(String(init?.body)))
      return Response.json({ choices: [{ message: { content: reply } }] }, { status })
    },
    readCredential: () => secret,
    async recallMemory() {
      assert.fail('Remote chat must never read the memory store')
    },
    async readProduct() {
      return { filePath: '', status: 'ok', value: { brain: { mode: 'automatic' }, provider: { chat: { preferred: { providerId: 'groq', modelId: 'test-model' } } } } }
    },
    async readTransports() {
      return { schemaVersion: 1, revision: 1, records: [groq], tombstones: [], migration: { version: 1, imported: [] } }
    },
  })
  assert.deepEqual(await send('Hora?', new AbortController().signal, undefined, { capability: 'local-clock', mode: 'request' }),
    { ok: false, code: 'tool-unavailable' })
  const submit = () => send('oi', new AbortController().signal)
  assert.deepEqual(await submit(), { ok: true, text: 'Resposta' })
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  assert.deepEqual(await send('Imagem', new AbortController().signal, png), { ok: true, text: 'Resposta' })
  const vision = createProductionBrainCatalog().models.find(model => model.capabilities.imageInput)
  assert.ok(vision)
  assert.equal(requests[1]?.model, vision.id)
  assert.deepEqual(requests[1]?.messages.at(-1)?.content, [
    { type: 'text', text: 'Imagem' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
  ])
  assert.deepEqual(await send('Inválida', new AbortController().signal, new Uint8Array(8)), { ok: false, code: 'image-invalid' })
  reply = token
  assert.deepEqual(await submit(), { ok: false, code: 'unavailable' })
  status = 401
  assert.deepEqual(await submit(), { ok: false, code: 'credentials' })
  status = 429
  assert.deepEqual(await submit(), { ok: false, code: 'rate-limit' })
  secret = bindCredential('groq', url, token, 'speech')
  assert.deepEqual(await submit(), { ok: false, code: 'configuration' })
  secret = bindCredential('groq', new URL('https://other.invalid'), token, 'chat')
  assert.deepEqual(await submit(), { ok: false, code: 'configuration' })
  groq.baseUrl = 'http://127.0.0.1/v1'
  assert.deepEqual(await submit(), { ok: false, code: 'configuration' })
  assert.equal(requests[2]?.model, 'test-model')
  assert.match(String(requests[0]?.messages[0]?.content), /^Você é Lia, a companheira digital pessoal deste aplicativo\./)
  assert.equal(requests[0]?.messages[0]?.content, requests[1]?.messages[0]?.content)
  assert.match(String(requests[0]?.messages[0]?.content), /Preset: tsundere/)
  assert.doesNotMatch(String(requests[0]?.messages[0]?.content), /Dirija-se ao usuário pelo nome/)
  assert.ok(!JSON.stringify(requests[2]).includes('base64'))
  assert.equal(calls, 5)
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
    assert.equal(requests[1]!.messages[0]?.role, 'system')
    assert.match(requests[1]!.messages[0]!.content, /Idioma: responda sempre em pt-BR/)
    assert.deepEqual(requests[1]!.messages.slice(1), [
      { role: 'user', content: 'Primeira' },
      { role: 'assistant', content: 'Resposta' },
      { role: 'user', content: 'Segunda' },
    ])
    modelId = 'new-model'
    assert.equal((await submit('Novo modelo')).ok, true)
    assert.equal(requests[2]!.model, 'new-model')
    assert.match(requests[2]!.messages[0]!.content, /^Você é Lia, a companheira digital pessoal deste aplicativo\./)
    assert.equal(requests[2]!.messages[0]!.content, requests[0]!.messages[0]!.content)
    assert.deepEqual(requests[2]!.messages.slice(1), [{ role: 'user', content: 'Novo modelo' }])
    useMemory = true
    assert.equal((await submit('Com memória')).ok, true)
    assert.match(requests[3]!.messages[0]!.content, /Contexto pessoal de teste$/)
    assert.equal(requests[3]!.messages.filter(message => message.role === 'system').length, 1)
    useMemory = false
    assert.equal((await submit('Sem memória')).ok, true)
    assert.doesNotMatch(requests[4]!.messages[0]!.content, /Contexto pessoal de teste/)
    assert.deepEqual(requests[4]!.messages.slice(1).map(message => message.content), ['Novo modelo', 'Resposta', 'Sem memória'])
  }
  finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
