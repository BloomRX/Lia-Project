import { describe, expect, it, vi } from 'vitest'

import { CURATED_CHAT_PROVIDER_IDS } from '../../../shared/lia/provider-catalog'
import { liaProviderHeaders, withLiaProviderHeaders } from './provider-request-headers'

/**
 * The Lia must not put another product's name on the wire.
 *
 * Until Corte B these headers came from the shared AIRI provider definition, so
 * every Lia request to OpenRouter announced `X-OpenRouter-Title: Project AIRI`
 * and `HTTP-Referer: https://airi.moeru.ai/`. These tests pin the replacement:
 * a neutral title, no referer, and — the part that matters most — no
 * `Authorization` ever set from this table.
 */
describe('lia-owned provider request headers', () => {
  it('identifies the app as Lia on OpenRouter and claims no referer', () => {
    const headers = liaProviderHeaders('openrouter-ai')
    expect(headers).toEqual({ 'X-OpenRouter-Title': 'Lia' })
    expect(Object.keys(headers).map(name => name.toLowerCase())).not.toContain('http-referer')
    expect(JSON.stringify(headers)).not.toMatch(/airi|moeru/i)
  })

  it('keeps the header the Anthropic definition always sent, and adds nothing else', () => {
    expect(liaProviderHeaders('anthropic')).toEqual({ 'anthropic-dangerous-direct-browser-access': 'true' })
    for (const id of CURATED_CHAT_PROVIDER_IDS.filter(id => id !== 'openrouter-ai' && id !== 'anthropic'))
      expect(liaProviderHeaders(id)).toEqual({})
    expect(liaProviderHeaders('not-a-provider')).toEqual({})
  })

  it('never sets a credential or transport header, whatever the table says', async () => {
    const seen: Headers[] = []
    const fetch = vi.fn(async (_input: any, init?: RequestInit) => {
      seen.push(new Headers(init?.headers))
      return new Response('{}')
    }) as unknown as typeof globalThis.fetch

    await withLiaProviderHeaders(fetch, 'openrouter-ai')('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer SYNTHETIC', 'Content-Type': 'application/json' },
    })

    const headers = seen[0]
    expect(headers.get('Authorization')).toBe('Bearer SYNTHETIC')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('X-OpenRouter-Title')).toBe('Lia')
  })

  it('does not let the table override a header the runtime already set', async () => {
    const seen: Headers[] = []
    const fetch = vi.fn(async (_input: any, init?: RequestInit) => {
      seen.push(new Headers(init?.headers))
      return new Response('{}')
    }) as unknown as typeof globalThis.fetch

    await withLiaProviderHeaders(fetch, 'openrouter-ai')('https://openrouter.ai/api/v1/chat/completions', {
      headers: { 'X-OpenRouter-Title': 'Set by caller' },
    })
    expect(seen[0].get('X-OpenRouter-Title')).toBe('Set by caller')
  })

  it('returns the very same fetch when it has nothing to add, so the hot path is untouched', () => {
    const fetch = (() => {}) as unknown as typeof globalThis.fetch
    expect(withLiaProviderHeaders(fetch, 'openai')).toBe(fetch)
  })

  it('forwards the body and abort signal unchanged', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(async () => new Response('{}')) as unknown as typeof globalThis.fetch
    await withLiaProviderHeaders(fetch, 'openrouter-ai')('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: '{"model":"free-model"}',
      signal: controller.signal,
    })
    const init = (fetch as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls[0][1]
    expect(init.body).toBe('{"model":"free-model"}')
    expect(init.signal).toBe(controller.signal)
    expect(init.method).toBe('POST')
  })
})
