import assert from 'node:assert/strict'

import { once } from 'node:events'
import { createServer } from 'node:http'
import { it } from 'node:test'

import { ProviderRegistry, ProviderRuntime } from '../src/providers/index.ts'

it('executes native discovery and streamed chat against a real local HTTP fixture without an SDK', async () => {
  const observed: { path?: string, authorization?: string, body: string }[] = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request)
      body += chunk.toString()
    observed.push({ path: request.url, authorization: request.headers.authorization, body })
    if (request.url === '/v1/models') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: 'custom/Local:Q4' }] }))
      return
    }
    response.setHeader('content-type', 'text/event-stream')
    for (const content of ['Olá', ' ', 'Lia', '\n', '42'])
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  const registry = new ProviderRegistry()
  registry.register({ id: 'local-fixture', protocol: 'chat-completions', credentialRequired: true })
  const runtime = new ProviderRuntime(registry, { resolveCredential: () => 'synthetic-local-fixture-key' })
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const config = { providerId: 'local-fixture', baseUrl: `http://127.0.0.1:${address.port}/v1/` }
    assert.deepEqual(await runtime.discover(config), [{ id: 'custom/Local:Q4', label: 'custom/Local:Q4' }])
    const events = []
    for await (const event of runtime.stream(config, { model: 'custom/Local:Q4', messages: [{ role: 'user', content: 'synthetic test' }] }))
      events.push(event)
    assert.equal(events.filter(event => event.type === 'text').map(event => event.text).join(''), 'Olá Lia\n42')
    assert.equal(events.at(-1)?.type, 'done')
    assert.deepEqual(observed.map(item => item.path), ['/v1/models', '/v1/chat/completions'])
    assert.ok(observed.every(item => item.authorization === 'Bearer synthetic-local-fixture-key'))
    assert.equal(JSON.parse(observed[1].body).model, 'custom/Local:Q4')
    assert.equal(runtime.activeOperationCount, 0)
  }
  finally {
    runtime.dispose()
    server.closeAllConnections()
    if (server.listening) {
      server.close()
      await once(server, 'close')
    }
  }
})
