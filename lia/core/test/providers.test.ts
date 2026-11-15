import type { ChatRequest, ProviderRuntimeOptions } from '../src/providers/index.ts'

import assert from 'node:assert/strict'

import { describe, it } from 'node:test'

import { ProviderError, ProviderRegistry, ProviderRuntime } from '../src/providers/index.ts'

const KEY = 'SYNTHETIC_PRIVATE_SENTINEL'
const config = { providerId: 'service', baseUrl: 'https://service.invalid/v1/', credentialRequired: true }
const request: ChatRequest = { model: 'custom/Meu-modelo:Q4', messages: [{ role: 'user', content: 'synthetic prompt' }] }

function setup(fetch: NonNullable<ProviderRuntimeOptions['fetch']>, resolveCredential: ProviderRuntimeOptions['resolveCredential'] = () => KEY) {
  const registry = new ProviderRegistry()
  registry.register({ id: config.providerId, protocol: 'chat-completions' })
  return { registry, runtime: new ProviderRuntime(registry, { fetch, resolveCredential }) }
}

function json(text = 'OK'): Response {
  return Response.json({ choices: [{ message: { role: 'assistant', content: text } }] })
}

async function errorCode(task: Promise<unknown>, code: string, status?: number) {
  await assert.rejects(task, (error: unknown) => {
    assert.ok(error instanceof ProviderError)
    assert.equal(error.code, code)
    assert.equal(error.status, status)
    if (status !== undefined)
      assert.ok(error.message.includes(String(status)))
    assert.ok(!String(error).includes(KEY))
    assert.ok(!JSON.stringify(error).includes(KEY))
    assert.equal(error.cause, undefined)
    return true
  })
}

describe('Lia provider definitions and instances', () => {
  it('registers definitions without a model allowlist and rejects duplicates/unknown IDs', () => {
    const registry = new ProviderRegistry()
    registry.register({ id: 'local-service', protocol: 'chat-completions', credentialRequired: false })
    assert.equal(registry.has('local-service'), true)
    assert.deepEqual(registry.list().map(item => item.id), ['local-service'])
    assert.equal(registry.get('local-service').capabilities.streaming, true)
    assert.throws(() => registry.register({ id: 'local-service', protocol: 'chat-completions' }), { code: 'configuration' })
    assert.throws(() => registry.get('unknown'), { code: 'unknown-provider' })
  })

  it('caches by effective config, excludes credentials, replaces configuration and disposes', () => {
    const { runtime } = setup(async () => json())
    const first = runtime.getInstance(config)
    assert.strictEqual(runtime.getInstance({ ...config, baseUrl: 'https://service.invalid/v1' }), first)
    assert.equal(runtime.instanceCount, 1)
    assert.notStrictEqual(runtime.getInstance({ ...config, baseUrl: 'https://changed.invalid/v1/' }), first)
    assert.equal(runtime.instanceCount, 1)
    assert.ok(!JSON.stringify(first).includes(KEY))
    runtime.dispose('service')
    assert.equal(runtime.instanceCount, 0)
    assert.notStrictEqual(runtime.getInstance(config), first)
    runtime.dispose()
    assert.equal(runtime.instanceCount, 0)
  })

  it('rejects invalid addresses and timeout settings without starting a request', () => {
    const { runtime } = setup(async () => {
      throw new Error('unexpected fetch')
    })
    for (const baseUrl of ['', 'not url', 'file:///secret', 'https://user:secret@service.invalid', 'https://service.invalid/?key=secret'])
      assert.throws(() => runtime.getInstance({ ...config, baseUrl }), { code: 'configuration' })
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 300001])
      assert.throws(() => runtime.getInstance({ ...config, timeoutMs }), { code: 'configuration' })
  })

  it('does not downgrade a definition that requires credentials', async () => {
    const { runtime, registry } = setup(async () => {
      throw new Error('unexpected fetch')
    }, () => undefined)
    registry.register({ id: 'secure', protocol: 'chat-completions', credentialRequired: true })
    await errorCode(runtime.chat({ ...config, providerId: 'secure', credentialRequired: false }, request), 'credentials')
  })
})

describe('Lia native chat transport', () => {
  it('executes a custom model at the custom endpoint with transient authentication and preserves extra wire fields', async () => {
    let called = 0
    const { runtime } = setup(async (input, init) => {
      called++
      assert.equal(String(input), 'https://service.invalid/v1/chat/completions')
      assert.equal(init?.method, 'POST')
      assert.equal(init?.redirect, 'error')
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${KEY}`)
      const payload = JSON.parse(String(init?.body))
      assert.equal(payload.model, request.model)
      assert.equal(payload.temperature, 0.5)
      assert.deepEqual(payload.tools, [{ type: 'function', function: { name: 'synthetic-tool', parameters: { type: 'object' } } }])
      return json('  Meu texto\ncom espaços.  ')
    })
    assert.deepEqual(await runtime.chat(config, { ...request, temperature: 0.5, tools: [{ type: 'function', function: { name: 'synthetic-tool', parameters: { type: 'object' } } }] }), { text: '  Meu texto\ncom espaços.  ' })
    assert.equal(called, 1)
    assert.equal(runtime.activeOperationCount, 0)
  })

  it('uses fresh credentials on every execution despite the instance cache', async () => {
    let credential = 'first-synthetic'
    const observed: Array<string | null> = []
    const { runtime } = setup(async (_input, init) => {
      observed.push(new Headers(init?.headers).get('authorization'))
      return json()
    }, () => credential)
    await runtime.chat(config, request)
    credential = 'second-synthetic'
    await runtime.chat(config, request)
    assert.deepEqual(observed, ['Bearer first-synthetic', 'Bearer second-synthetic'])
    assert.equal(runtime.instanceCount, 1)
  })

  it('changes models without changing instance identity or normalizing custom IDs', async () => {
    const models: string[] = []
    const { runtime } = setup(async (_input, init) => {
      models.push(JSON.parse(String(init?.body)).model)
      return json()
    })
    const instance = runtime.getInstance(config)
    await runtime.chat(config, request)
    await runtime.chat(config, { ...request, model: 'custom/Other:Q8' })
    assert.deepEqual(models, [request.model, 'custom/Other:Q8'])
    assert.strictEqual(runtime.getInstance(config), instance)
  })

  it('permits a keyless service and optional discovery', async () => {
    const { runtime, registry } = setup(async (_input, init) => {
      assert.equal(new Headers(init?.headers).has('authorization'), false)
      return json()
    }, () => undefined)
    registry.register({ id: 'keyless', protocol: 'chat-completions', capabilities: { modelDiscovery: false } })
    assert.deepEqual(await runtime.chat({ ...config, providerId: 'keyless', credentialRequired: false }, request), { text: 'OK' })
    await errorCode(runtime.discover({ ...config, providerId: 'keyless', credentialRequired: false }), 'unsupported')
  })

  it('rejects missing credentials and unknown providers', async () => {
    const { runtime } = setup(async () => {
      throw new Error('unexpected fetch')
    }, () => undefined)
    await errorCode(runtime.chat(config, request), 'credentials')
    await errorCode(runtime.chat({ ...config, providerId: 'unknown' }, request), 'unknown-provider')
    assert.equal(runtime.activeOperationCount, 0)
  })

  it('rejects empty/invalid model requests before dispatching', async () => {
    const { runtime } = setup(async () => {
      throw new Error('unexpected fetch')
    })
    await errorCode(runtime.chat(config, { ...request, model: '  ' }), 'configuration')
    await errorCode(runtime.chat(config, { ...request, messages: [] }), 'configuration')
    await errorCode(runtime.chat(config, { ...request, messages: [{ role: 'invented', content: 'x' }] }), 'configuration')
    await errorCode(runtime.chat(config, { ...request, temperature: Number.NaN }), 'configuration')
  })

  it('does not approve empty, invalid or malformed successful responses', async () => {
    for (const response of [json(''), json('  '), Response.json({ choices: [] })]) {
      const { runtime } = setup(async () => response)
      await errorCode(runtime.chat(config, request), 'empty')
    }
    const { runtime } = setup(async () => new Response('malformed'))
    await errorCode(runtime.chat(config, request), 'protocol')
  })

  it('sanitizes authentication errors, HTTP errors, resolver and transport exceptions', async () => {
    for (const status of [401, 403, 404, 429, 500]) {
      const { runtime } = setup(async () => new Response(KEY, { status }))
      await errorCode(runtime.chat(config, request), status === 401 || status === 403 ? 'credentials' : 'http', status)
      assert.equal(runtime.activeOperationCount, 0)
    }
    const network = setup(async () => {
      throw new Error(KEY)
    }).runtime
    await errorCode(network.chat(config, request), 'network')
    const vault = setup(async () => json(), () => {
      throw new Error(KEY)
    }).runtime
    await errorCode(vault.chat(config, request), 'network')
  })

  it('retains HTTP classification when cancelling the upstream error body fails', async () => {
    const { runtime } = setup(async () => new Response(new ReadableStream({
      cancel() {
        throw new Error(KEY)
      },
    }), { status: 404 }))
    await errorCode(runtime.chat(config, request), 'http', 404)
  })

  it('bounds cleanup of an HTTP error while preserving its known status', async () => {
    const { runtime } = setup(async () => new Response(new ReadableStream({
      cancel() {
        return new Promise<void>(() => {})
      },
    }), { status: 404 }))
    await errorCode(runtime.chat({ ...config, timeoutMs: 10 }, request), 'http', 404)
    assert.equal(runtime.activeOperationCount, 0)
  })

  it('discovers models independently of the custom model being selected', async () => {
    const { runtime } = setup(async (input) => {
      assert.equal(String(input), 'https://service.invalid/v1/models')
      return Response.json({ data: [{ id: 'custom/new', name: 'New' }, { id: 'custom/new' }, { id: '' }, {}] })
    })
    assert.deepEqual(await runtime.discover(config), [{ id: 'custom/new', label: 'New' }])
    assert.equal(runtime.activeOperationCount, 0)
  })

  it('rejects a malformed discovery body without exposing it', async () => {
    const { runtime } = setup(async () => Response.json({ error: KEY }))
    await errorCode(runtime.discover(config), 'protocol')
    assert.equal(runtime.activeOperationCount, 0)
  })
})

function sseResponse(parts: string[], hang = false): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const part of parts)
        controller.enqueue(encoder.encode(part))
      if (!hang)
        controller.close()
    },
  }), { headers: { 'content-type': 'text/event-stream' } })
}

function delta(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
}

/** Diagnostic bound only: a broken cleanup must fail instead of hanging this suite. */
async function settleCleanup<T>(task: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Cleanup remained pending beyond the operation deadline')), 150)
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

describe('Lia streaming, cancellation and lifetime', () => {
  it('streams exact spaces/newlines and a terminal event across arbitrary network boundaries', async () => {
    const wire = `${delta('Olá') + delta(' ') + delta('mundo\n')}data: [DONE]\n\n`
    const { runtime } = setup(async () => sseResponse([...wire]))
    const events = []
    for await (const event of runtime.stream(config, request))
      events.push(event)
    assert.deepEqual(events, [{ type: 'text', text: 'Olá' }, { type: 'text', text: ' ' }, { type: 'text', text: 'mundo\n' }, { type: 'done' }])
    assert.equal(runtime.activeOperationCount, 0)
  })

  it('decodes UTF-8 codepoints split between byte chunks', async () => {
    const bytes = new TextEncoder().encode(`${delta('Lia 🦊')}data: [DONE]\n\n`)
    const { runtime } = setup(async () => new Response(new ReadableStream({
      start(controller) {
        for (const byte of bytes)
          controller.enqueue(new Uint8Array([byte]))
        controller.close()
      },
    }), { headers: { 'content-type': 'text/event-stream' } }))
    let text = ''
    for await (const event of runtime.stream(config, request)) {
      if (event.type === 'text')
        text += event.text
    }
    assert.equal(text, 'Lia 🦊')
  })

  it('accepts CRLF event boundaries and ignores comment heartbeats', async () => {
    const wire = `: heartbeat\r\n\r\n${(`${delta('Lia')}data: [DONE]\n\n`).replace(/\n/g, '\r\n')}`
    const { runtime } = setup(async () => sseResponse([...wire]))
    const events = []
    for await (const event of runtime.stream(config, request))
      events.push(event)
    assert.deepEqual(events, [{ type: 'text', text: 'Lia' }, { type: 'done' }])
  })

  it('rejects empty/malformed/truncated streaming responses instead of approving a transport 200', async () => {
    for (const [wire, code] of [['data: [DONE]\n\n', 'empty'], ['data: not-json\n\n', 'protocol'], [delta('partial'), 'protocol']]) {
      const { runtime } = setup(async () => sseResponse([wire]))
      const consume = async () => {
        for await (const _event of runtime.stream(config, request)) { /* consume */ }
      }
      await errorCode(consume(), code)
      assert.equal(runtime.activeOperationCount, 0)
    }
  })

  it('guards raw SDK consumption against secret-bearing SSE error envelopes and wrong MIME', async () => {
    for (const wire of [
      `data: ${JSON.stringify({ error: { message: KEY } })}\n\n`,
      `event: error\ndata: ${JSON.stringify({ message: KEY })}\n\n`,
      `data: ${JSON.stringify({ error: { message: KEY } })}`,
    ]) {
      const { runtime } = setup(async () => sseResponse([...wire]))
      const response = await runtime.dispatch(config, { ...request, stream: true })
      await errorCode(response.text(), 'protocol')
      assert.equal(runtime.activeOperationCount, 0)
    }
    const { runtime } = setup(async () => Response.json({ error: { message: KEY } }))
    await errorCode(runtime.dispatch(config, { ...request, stream: true }), 'protocol')
  })

  it('preserves ordinary raw frames byte-for-byte and bounds an unterminated SSE event', async () => {
    const wire = `: heartbeat\r\n\r\n${delta('  Lia\n🦊  ').replace(/\n/g, '\r\n')}data: [DONE]\r\n\r\n`
    const { runtime } = setup(async () => sseResponse([...wire]))
    const response = await runtime.dispatch(config, { ...request, stream: true })
    assert.equal(await response.text(), wire)
    const oversized = setup(async () => sseResponse([`data: ${'x'.repeat(1024 * 1024 + 1)}`])).runtime
    const overflow = await oversized.dispatch(config, { ...request, stream: true })
    await errorCode(overflow.text(), 'protocol')
  })

  it('honors caller cancellation without exposing a caller-provided reason', async () => {
    const { runtime } = setup(async () => new Promise<Response>(() => {}))
    const controller = new AbortController()
    const pending = runtime.chat(config, request, { signal: controller.signal })
    controller.abort(KEY)
    await errorCode(pending, 'cancelled')
    assert.equal(runtime.activeOperationCount, 0)
  })

  it('does not resolve a credential or start a request when already cancelled', async () => {
    let credentialReads = 0
    let requests = 0
    const { runtime } = setup(async () => {
      requests++
      return json()
    }, () => {
      credentialReads++
      return KEY
    })
    const controller = new AbortController()
    controller.abort(KEY)
    await errorCode(runtime.chat(config, request, { signal: controller.signal }), 'cancelled')
    assert.equal(credentialReads, 0)
    assert.equal(requests, 0)
  })

  it('times out hung fetch and hung response bodies', async () => {
    const noFetch = setup(async () => new Promise<Response>(() => {})).runtime
    await errorCode(noFetch.chat({ ...config, timeoutMs: 10 }, request), 'timeout')
    assert.equal(noFetch.activeOperationCount, 0)
    const body = setup(async () => sseResponse([], true)).runtime
    await errorCode(body.chat({ ...config, timeoutMs: 10 }, request), 'timeout')
    assert.equal(body.activeOperationCount, 0)
  })

  it('times out a stalled credential resolution before contacting the service', async () => {
    let requests = 0
    const { runtime } = setup(async () => {
      requests++
      return json()
    }, () => new Promise<string>(() => {}))
    await errorCode(runtime.chat({ ...config, timeoutMs: 10 }, request), 'timeout')
    assert.equal(requests, 0)
    assert.equal(runtime.activeOperationCount, 0)
  })

  it('disposal cancels active streaming and removes the instance', async () => {
    const { runtime } = setup(async () => sseResponse([delta('first')], true))
    const stream = runtime.stream(config, request)
    assert.deepEqual(await stream.next(), { done: false, value: { type: 'text', text: 'first' } })
    const next = stream.next()
    runtime.dispose('service')
    await errorCode(next, 'cancelled')
    assert.equal(runtime.instanceCount, 0)
    assert.equal(runtime.activeOperationCount, 0)
  })

  it('replacing config aborts the old instance while changing model reuses it', async () => {
    const { runtime } = setup(async () => sseResponse([], true))
    const pending = runtime.chat(config, request)
    await new Promise(resolve => setImmediate(resolve))
    runtime.getInstance({ ...config, baseUrl: 'https://different.invalid/' })
    await errorCode(pending, 'cancelled')
    const same = runtime.getInstance(config)
    assert.strictEqual(runtime.getInstance(config), same)
    runtime.dispose()
  })

  it('an early stream consumer return releases the raw response body', async () => {
    const { runtime } = setup(async () => sseResponse([delta('first')], true))
    const stream = runtime.stream(config, request)
    await stream.next()
    await stream.return(undefined)
    assert.equal(runtime.activeOperationCount, 0)
  })
  it('keeps the operation deadline while upstream body cancellation is pending', async () => {
    let cancelled = false
    const source = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
        return new Promise<void>(() => {})
      },
    })
    const { runtime } = setup(async () => new Response(source))
    const response = await runtime.dispatch({ ...config, timeoutMs: 10 }, request)
    const cancellation = response.body!.cancel()
    assert.equal(runtime.activeOperationCount, 1)
    await errorCode(settleCleanup(cancellation), 'timeout')
    assert.equal(cancelled, true)
    assert.equal(runtime.activeOperationCount, 0)
    assert.equal(source.locked, false)
  })

  it('disposal settles an already pending body cancellation', async () => {
    const source = new ReadableStream<Uint8Array>({
      cancel: () => new Promise<void>(() => {}),
    })
    const { runtime } = setup(async () => new Response(source))
    const response = await runtime.dispatch(config, request)
    const cancellation = response.body!.cancel()
    runtime.dispose(config.providerId)
    await errorCode(settleCleanup(cancellation), 'cancelled')
    assert.equal(runtime.activeOperationCount, 0)
    assert.equal(source.locked, false)
  })

  it('bounds an early normalized stream return when the source cancellation stalls', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(delta('first')))
      },
      cancel: () => new Promise<void>(() => {}),
    })
    const { runtime } = setup(async () => new Response(source, { headers: { 'content-type': 'text/event-stream' } }))
    const stream = runtime.stream({ ...config, timeoutMs: 10 }, request)
    assert.deepEqual(await stream.next(), { done: false, value: { type: 'text', text: 'first' } })
    await errorCode(settleCleanup(stream.return(undefined)), 'timeout')
    assert.equal(runtime.activeOperationCount, 0)
    assert.equal(source.locked, false)
  })

  it('reports a safe cleanup failure and releases the upstream reader', async () => {
    const source = new ReadableStream<Uint8Array>({
      cancel() {
        throw new Error(KEY)
      },
    })
    const { runtime } = setup(async () => new Response(source))
    const response = await runtime.dispatch(config, request)
    await errorCode(settleCleanup(response.body!.cancel()), 'network')
    assert.equal(runtime.activeOperationCount, 0)
    assert.equal(source.locked, false)
  })

  it('releases the upstream reader after timeout even if cancelling the source stalls', async () => {
    const source = new ReadableStream<Uint8Array>({
      cancel: () => new Promise<void>(() => {}),
    })
    const { runtime } = setup(async () => new Response(source))
    const response = await runtime.dispatch({ ...config, timeoutMs: 10 }, request)
    await errorCode(settleCleanup(response.text()), 'timeout')
    assert.equal(runtime.activeOperationCount, 0)
    assert.equal(source.locked, false)
  })

  it('releases the upstream reader after an SSE protocol failure without leaking cancellation errors', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: KEY })}\n\n`))
      },
      cancel() {
        throw new Error(KEY)
      },
    })
    const { runtime } = setup(async () => new Response(source, { headers: { 'content-type': 'text/event-stream' } }))
    const response = await runtime.dispatch(config, { ...request, stream: true })
    await errorCode(response.text(), 'protocol')
    assert.equal(runtime.activeOperationCount, 0)
    assert.equal(source.locked, false)
  })
})
