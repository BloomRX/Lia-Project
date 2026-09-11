import type { ObservedRequest } from './real-chat-observer'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildReport,
  extractErrorMessage,
  formatReport,
  installRealChatObserver,
  isCandidateRequest,
  isChatEndpoint,
  providerIdFromHost,
  readAuthorizationLength,
  readModelFromBody,
  readReasoningEffortFromBody,
  readToolCountFromBody,
  sanitizeResponseMessage,
} from './real-chat-observer'

/**
 * Tests for the temporary read-only chat observer.
 *
 * The two properties that matter most are asserted here explicitly: the
 * observer must reproduce the real 401 faithfully, and it must never leak the
 * credential it is measuring.
 */

function makeRequest(overrides: Partial<ObservedRequest> = {}): ObservedRequest {
  return {
    index: 1,
    providerId: 'groq',
    modelId: 'openai/gpt-oss-120b',
    reasoningEffort: null,
    toolCount: null,
    isChatRequest: true,
    endpoint: 'https://api.openai.com/v1/chat/completions',
    host: 'api.openai.com',
    path: '/v1/chat/completions',
    method: 'POST',
    hasAuthorizationHeader: true,
    authorizationHeaderLength: 63,
    requestStarted: true,
    responseStatus: 401,
    responseOk: false,
    rawHttpErrorMessage: 'Missing bearer authentication in header',
    failed: false,
    failureKind: null,
    ...overrides,
  }
}

describe('real chat observer helpers', () => {
  it('maps known hosts to provider ids and falls back to the host', () => {
    expect(providerIdFromHost('api.groq.com')).toBe('groq')
    expect(providerIdFromHost('api.openai.com')).toBe('openai')
    expect(providerIdFromHost('openrouter.ai')).toBe('openrouter-ai')
    expect(providerIdFromHost('llm.example.test')).toBe('llm.example.test')
  })

  it('skips local traffic but keeps versioned API calls', () => {
    expect(isCandidateRequest('http://localhost:5173/@vite/client')).toBe(false)
    expect(isCandidateRequest('http://127.0.0.1:5173/src/main.ts')).toBe(false)
    expect(isCandidateRequest('https://api.openai.com/v1/chat/completions')).toBe(true)
    expect(isCandidateRequest('https://api.groq.com/openai/v1/models')).toBe(true)
    expect(isCandidateRequest('not-a-url')).toBe(false)
  })

  it('redacts bearer tokens and key-shaped values from a server message', () => {
    expect(sanitizeResponseMessage('Invalid key Bearer sk-abc123def456ghi789'))
      .toBe('Invalid key Bearer [REDACTED]')
    expect(sanitizeResponseMessage('key sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX rejected')).toContain('[REDACTED')
    expect(sanitizeResponseMessage('')).toBeNull()
    expect(sanitizeResponseMessage(42)).toBeNull()
  })

  it('does not redact the actual 401 wording, which mentions the word bearer', () => {
    // Regression: a greedy Bearer pattern ate "bearer authentication" and
    // destroyed the exact message this diagnostic exists to capture.
    expect(sanitizeResponseMessage('Missing bearer authentication in header'))
      .toBe('Missing bearer authentication in header')
    expect(sanitizeResponseMessage('Invalid Bearer token supplied'))
      .toBe('Invalid Bearer token supplied')
  })

  it('extracts only the error message and code from a failed body', () => {
    const body = JSON.stringify({ error: { message: 'Missing bearer authentication in header', code: 'invalid_api_key' } })
    expect(extractErrorMessage(body)).toBe('Missing bearer authentication in header code=invalid_api_key')
    expect(extractErrorMessage('plain text failure')).toBe('plain text failure')
    expect(extractErrorMessage('{}')).toBeNull()
  })

  it('reads the Authorization length from every fetch header shape', () => {
    const headers = new Headers({ Authorization: 'Bearer fake-token-value' })
    expect(readAuthorizationLength(headers)).toBe('Bearer fake-token-value'.length)
    expect(readAuthorizationLength({ Authorization: 'Bearer abc' })).toBe('Bearer abc'.length)
    expect(readAuthorizationLength([['Authorization', 'Bearer abc']])).toBe('Bearer abc'.length)
    expect(readAuthorizationLength(undefined)).toBe(0)
    expect(readAuthorizationLength({ 'Content-Type': 'application/json' })).toBe(0)
  })

  it('counts the tools on an outgoing request', () => {
    expect(readToolCountFromBody(JSON.stringify({ model: 'm', tools: [{}, {}, {}] }))).toBe(3)
    expect(readToolCountFromBody(JSON.stringify({ model: 'm', tools: [] }))).toBe(0)
    // No tools key at all must stay distinguishable from an empty tool list.
    expect(readToolCountFromBody(JSON.stringify({ model: 'm' }))).toBeNull()
    expect(readToolCountFromBody('{not json')).toBeNull()
  })

  it('tells a chat completion apart from a models probe', () => {
    expect(isChatEndpoint('/openai/v1/chat/completions')).toBe(true)
    expect(isChatEndpoint('/v1/chat/completions')).toBe(true)
    expect(isChatEndpoint('/openai/v1/models')).toBe(false)
    expect(isChatEndpoint('/v1/embeddings')).toBe(false)
  })

  it('reads the wire reasoning_effort out of an outgoing body', () => {
    expect(readReasoningEffortFromBody(JSON.stringify({ model: 'm', reasoning_effort: 'medium' }))).toBe('medium')
    expect(readReasoningEffortFromBody(JSON.stringify({ model: 'm', reasoning_effort: 'none' }))).toBe('none')
    // Omitted must stay distinguishable from an empty value.
    expect(readReasoningEffortFromBody(JSON.stringify({ model: 'm' }))).toBeNull()
    expect(readReasoningEffortFromBody('{not json')).toBeNull()
    expect(readReasoningEffortFromBody(undefined)).toBeNull()
  })

  it('reads only the model field out of an outgoing body', () => {
    expect(readModelFromBody(JSON.stringify({ model: 'openai/gpt-oss-120b', messages: [] })))
      .toBe('openai/gpt-oss-120b')
    expect(readModelFromBody('{not json')).toBeNull()
    expect(readModelFromBody(undefined)).toBeNull()
  })

  it('reports FAIL and names the first 401 endpoint', () => {
    const report = buildReport(
      [
        makeRequest({ index: 1, method: 'GET', endpoint: 'https://api.openai.com/v1/models', responseStatus: 200, responseOk: true }),
        makeRequest({ index: 2 }),
      ],
      { provider: 'groq', model: 'openai/gpt-oss-120b' },
    )

    expect(report.status).toBe('FAIL')
    expect(report.requestCount).toBe(2)
    expect(report.first401Endpoint).toBe('POST https://api.openai.com/v1/chat/completions')
    expect(report.instanceCredential).toBe(true)
  })

  it('reports a received assistant response when the chat call returned 2xx', () => {
    // Hypothesis B: no HTTP error at all, so the text the user read came out of
    // the reply rather than out of a rejected request.
    const report = buildReport([makeRequest({ responseStatus: 200, responseOk: true })], { provider: null, model: null })
    expect(report.status).toBe('PASS')
    expect(report.assistantResponseReceived).toBe(true)
    expect(formatReport(report)).toContain('ASSISTANT_RESPONSE_RECEIVED=true')
  })

  it('does not claim an assistant response for a failed chat call', () => {
    const report = buildReport([makeRequest({ responseStatus: 401, responseOk: false })], { provider: null, model: null })
    expect(report.assistantResponseReceived).toBe(false)
    expect(formatReport(report)).toContain('ASSISTANT_RESPONSE_RECEIVED=false')
  })

  it('does not count a successful models probe as an assistant response', () => {
    const report = buildReport(
      [makeRequest({ isChatRequest: false, path: '/openai/v1/models', responseStatus: 200, responseOk: true })],
      { provider: null, model: null },
    )
    expect(report.status).toBe('PASS')
    expect(report.assistantResponseReceived).toBe(false)
  })

  it('reports the tool count and chat flag per request', () => {
    const report = buildReport(
      [makeRequest({ toolCount: 2, responseStatus: 200, responseOk: true })],
      { provider: null, model: null },
    )
    const text = formatReport(report)
    expect(text).toContain('REQUEST_1_TOOLCOUNT=2')
    expect(text).toContain('REQUEST_1_IS_CHAT=true')
  })

  it('reports FAIL when no request was observed at all', () => {
    const report = buildReport([], { provider: null, model: null })
    expect(report.status).toBe('FAIL')
    expect(report.requestCount).toBe(0)
    expect(report.first401Endpoint).toBeNull()
  })

  it('emits every required key in the report block', () => {
    const text = formatReport(buildReport([makeRequest()], { provider: 'groq', model: 'openai/gpt-oss-120b' }))

    for (const key of [
      'REAL_CHAT_STATUS=',
      'PROVIDER=',
      'MODEL=',
      'INSTANCE_CREDENTIAL=',
      'REQUEST_COUNT=',
      'REQUEST_1_ENDPOINT=',
      'REQUEST_1_AUTH=',
      'REQUEST_1_STATUS=',
      'FIRST_401_ENDPOINT=',
    ])
      expect(text).toContain(key)
  })
})

describe('installRealChatObserver', () => {
  let info: ReturnType<typeof vi.fn>

  beforeEach(() => {
    info = vi.fn()
    vi.stubGlobal('console', { info, warn: vi.fn(), error: vi.fn() })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function makeWindow(fetchImpl: typeof globalThis.fetch) {
    const store = new Map<string, string>([['settings/consciousness/active-provider', 'groq']])
    return {
      fetch: fetchImpl,
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
    } as unknown as Window
  }

  it('still prints the block when the chat call succeeds, and reports the tools sent', async () => {
    // The case the observer used to stay silent about: a 200 means there was no
    // HTTP error at all, so the block has to appear in order to say so.
    const originalFetch = vi.fn(async () => new Response('data: []\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }))
    const logs: string[] = []
    const info = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      logs.push(String(args[0]))
    })
    const win = makeWindow(originalFetch as unknown as typeof globalThis.fetch)

    const handles = installRealChatObserver(win)
    await win.fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer gsk-FAKE-OBSERVER-TOKEN-0000000000' },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: 'Oi Lia' }],
        tools: [{ type: 'function', function: { name: 'a' } }, { type: 'function', function: { name: 'b' } }],
      }),
    })

    const record = handles.requests[0]
    expect(record.responseStatus).toBe(200)
    expect(record.isChatRequest).toBe(true)
    expect(record.toolCount).toBe(2)
    expect(record.reasoningEffort).toBeNull()

    const report = handles.report()
    expect(logs.some(line => line.includes('LIA REAL CHAT DIAGNOSTIC'))).toBe(true)
    expect(report).toContain('REAL_CHAT_STATUS=PASS')
    expect(report).toContain('ASSISTANT_RESPONSE_RECEIVED=true')
    expect(report).toContain('REQUEST_1_TOOLCOUNT=2')
    expect(report).toContain('REQUEST_1_IS_CHAT=true')
    expect(report).toContain('REQUEST_1_REASONING_EFFORT=omitted')
    // A successful body must never be read, let alone printed.
    expect(originalFetch).toHaveBeenCalledOnce()
    expect(report).not.toContain('Oi Lia')

    info.mockRestore()
  })

  it('prints the block for a real 400 carrying a provider error message', async () => {
    const originalFetch = vi.fn(async () => new Response(
      JSON.stringify({ error: { message: '`reasoning_effort` must be one of `low`, `medium`, or `high`', code: 'invalid_request_error' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ))
    const win = makeWindow(originalFetch as unknown as typeof globalThis.fetch)

    const handles = installRealChatObserver(win)
    await win.fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer gsk-FAKE-OBSERVER-TOKEN-0000000000' },
      body: JSON.stringify({ model: 'openai/gpt-oss-120b', reasoning_effort: 'none' }),
    })

    const record = handles.requests[0]
    expect(record.responseStatus).toBe(400)
    expect(record.reasoningEffort).toBe('none')
    expect(record.rawHttpErrorMessage).toContain('must be one of')

    const report = handles.report()
    expect(report).toContain('REQUEST_1_STATUS=400')
    expect(report).toContain('REQUEST_1_REASONING_EFFORT=none')
    expect(report).toContain('ASSISTANT_RESPONSE_RECEIVED=false')
    expect(report).toContain('REQUEST_1_RAW_HTTP_ERROR_MESSAGE=')
  })

  it('captures the real 401 exactly as the app would produce it', async () => {
    const secret = 'Bearer gsk-REAL-LOOKING-SECRET-VALUE-1234567890'
    const upstream = vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'Missing bearer authentication in header' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ))
    const win = makeWindow(upstream as unknown as typeof globalThis.fetch)

    const handles = installRealChatObserver(win)
    const response = await win.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai/gpt-oss-120b', reasoning_effort: 'medium', messages: [{ role: 'user', content: 'Oi Lia' }] }),
    })

    expect(response.status).toBe(401)
    expect(upstream).toHaveBeenCalledTimes(1)

    const record = handles.requests[0]
    expect(record.providerId).toBe('openai')
    expect(record.modelId).toBe('openai/gpt-oss-120b')
    expect(record.reasoningEffort).toBe('medium')
    expect(record.method).toBe('POST')
    expect(record.endpoint).toBe('https://api.openai.com/v1/chat/completions')
    expect(record.hasAuthorizationHeader).toBe(true)
    expect(record.authorizationHeaderLength).toBe(secret.length)
    expect(record.requestStarted).toBe(true)
    expect(record.responseStatus).toBe(401)
    expect(record.rawHttpErrorMessage).toContain('Missing bearer authentication in header')

    const report = handles.report()
    expect(report).toContain('REAL_CHAT_STATUS=FAIL')
    expect(report).toContain('FIRST_401_ENDPOINT=POST https://api.openai.com/v1/chat/completions')
    expect(report).toContain('REQUEST_COUNT=1')
    expect(report).toContain('REQUEST_1_REASONING_EFFORT=medium')

    // The credential itself must never reach the console or the report.
    expect(report).not.toContain(secret)
    expect(report).not.toContain('gsk-REAL-LOOKING')
    for (const call of info.mock.calls)
      expect(String(call[0])).not.toContain(secret)
  })

  it('records more than one call before the error and keeps their order', async () => {
    let call = 0
    const upstream = vi.fn(async () => {
      call += 1
      return call === 1
        ? new Response('[]', { status: 200 })
        : new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 401 })
    })
    const win = makeWindow(upstream as unknown as typeof globalThis.fetch)
    const handles = installRealChatObserver(win)

    await win.fetch('https://api.openai.com/v1/models', { method: 'GET' })
    await win.fetch('https://api.openai.com/v1/chat/completions', { method: 'POST' })

    expect(handles.requests.map(request => request.responseStatus)).toEqual([200, 401])
    expect(handles.report()).toContain('REQUEST_COUNT=2')
    expect(handles.report()).toContain('FIRST_401_ENDPOINT=POST https://api.openai.com/v1/chat/completions')
  })

  it('leaves unrelated traffic completely alone', async () => {
    const upstream = vi.fn(async () => new Response('ok', { status: 200 }))
    const win = makeWindow(upstream as unknown as typeof globalThis.fetch)
    const handles = installRealChatObserver(win)

    await win.fetch('http://localhost:5173/@vite/client')
    expect(handles.requests).toHaveLength(0)
  })

  it('does not swallow a transport failure and still reports it', async () => {
    const upstream = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const win = makeWindow(upstream as unknown as typeof globalThis.fetch)
    const handles = installRealChatObserver(win)

    await expect(win.fetch('https://api.groq.com/openai/v1/models')).rejects.toThrow('fetch failed')
    expect(handles.requests[0].failed).toBe(true)
    expect(handles.requests[0].failureKind).toBe('TypeError')
    expect(handles.report()).toContain('REAL_CHAT_STATUS=FAIL')
  })

  it('installs only once across repeated calls (HMR safe)', async () => {
    const upstream = vi.fn(async () => new Response('ok', { status: 200 }))
    const win = makeWindow(upstream as unknown as typeof globalThis.fetch)

    const first = installRealChatObserver(win)
    const second = installRealChatObserver(win)
    expect(second).toBe(first)
  })

  it('returns the original response body untouched for successful calls', async () => {
    const upstream = vi.fn(async () => new Response('streamed-reply', { status: 200 }))
    const win = makeWindow(upstream as unknown as typeof globalThis.fetch)
    installRealChatObserver(win)

    const response = await win.fetch('https://api.openai.com/v1/chat/completions', { method: 'POST' })
    expect(await response.text()).toBe('streamed-reply')
  })
})
