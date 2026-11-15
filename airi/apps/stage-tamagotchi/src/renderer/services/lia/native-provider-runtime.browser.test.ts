import { afterEach, describe, expect, it, vi } from 'vitest'

import { createNativeProviderRuntime, NATIVE_CHAT_PROVIDER_ID } from './native-provider-runtime'

afterEach(() => vi.unstubAllGlobals())

describe('native provider Web Platform execution', () => {
  it('uses real Chromium Headers/Response/Streams and preserves UTF-8 SSE bytes', async () => {
    const wire = `data: ${JSON.stringify({ choices: [{ delta: { content: 'Olá Lia\n42' } }] })}\r\n\r\ndata: [DONE]\r\n\r\n`
    const network = vi.fn<typeof globalThis.fetch>(async () => new Response(wire, { headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', network)
    const native = createNativeProviderRuntime({ readConfig: () => ({ baseUrl: 'https://service.invalid/v1/' }), resolveCredential: async () => 'SYNTHETIC_BROWSER_KEY' })
    try {
      const provider = await native.getChatProvider(NATIVE_CHAT_PROVIDER_ID)
      const result = await provider!.chat('custom/browser:Q4').fetch(new URL('https://ignored.invalid'), {
        method: 'POST',
        body: JSON.stringify({ model: 'custom/browser:Q4', messages: [{ role: 'user', content: 'synthetic' }], stream: true }),
      })
      expect(await result.text()).toBe(wire)
      expect(String(network.mock.calls[0][0])).toBe('https://service.invalid/v1/chat/completions')
      expect(new Headers(network.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer SYNTHETIC_BROWSER_KEY')
    }
    finally {
      native.dispose()
    }
  })

  it('rejects an SSE error envelope before it reaches the consumer', async () => {
    vi.stubGlobal('fetch', async () => new Response('data: {"error":{"message":"SYNTHETIC_BROWSER_KEY"}}\n\n', { headers: { 'content-type': 'text/event-stream' } }))
    const native = createNativeProviderRuntime({ readConfig: () => ({ baseUrl: 'https://service.invalid/v1/' }), resolveCredential: async () => 'SYNTHETIC_BROWSER_KEY' })
    try {
      const provider = await native.getChatProvider(NATIVE_CHAT_PROVIDER_ID)
      const result = await provider!.chat('custom/browser:Q4').fetch(new URL('https://ignored.invalid'), {
        method: 'POST',
        body: JSON.stringify({ model: 'custom/browser:Q4', messages: [{ role: 'user', content: 'synthetic' }], stream: true }),
      })
      const reader = result.body!.getReader()
      try {
        await expect(reader.read()).rejects.toMatchObject({ code: 'protocol' })
      }
      finally {
        reader.releaseLock()
      }
    }
    finally {
      native.dispose()
    }
  })
})
