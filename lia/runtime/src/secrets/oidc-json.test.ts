import { describe, expect, it } from 'vitest'

import { readOidcJson } from './oidc-json'

describe('Main OIDC response decoder', () => {
  it('decodes JSON split across a multibyte UTF-8 character', async () => {
    const bytes = new TextEncoder().encode('{"subject":"João"}')
    const split = bytes.indexOf(0xC3) + 1
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, split))
        controller.enqueue(bytes.slice(split))
        controller.close()
      },
    })
    await expect(readOidcJson(new Response(body), AbortSignal.timeout(1_000))).resolves.toEqual({ subject: 'João' })
    expect(body.locked).toBe(false)
  })

  it('cancels and unlocks an oversized body', async () => {
    let cancelled = false
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(96 * 1024 + 1)) },
      cancel() { cancelled = true },
    })
    await expect(readOidcJson(new Response(body), AbortSignal.timeout(1_000))).rejects.toThrow('OIDC response exceeded the size limit')
    expect(cancelled).toBe(true)
    expect(body.locked).toBe(false)
  })

  it('aborts a pending read and releases the reader', async () => {
    const operation = new AbortController()
    let cancelled = false
    const body = new ReadableStream({ cancel() { cancelled = true } })
    const result = readOidcJson(new Response(body), operation.signal)
    operation.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelled).toBe(true)
    expect(body.locked).toBe(false)
  })

  it('does not include an invalid response body in the error', async () => {
    const response = new Response('OIDC_PRIVATE_SENTINEL')
    const result = readOidcJson(response, AbortSignal.timeout(1_000))
    await expect(result).rejects.toThrow(/^OIDC response was not valid JSON$/)
    expect(response.body?.locked).toBe(false)
  })
})
