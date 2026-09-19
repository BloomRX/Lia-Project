import { describe, expect, it } from 'vitest'

import {
  AllTalkGenerationError,
  categorizeAllTalkFailure,
  createAllTalkClient,
  isTerminalVoiceSetupCategory,
} from './client'

/**
 * Phase 7.5, items 2/3 + tests G/J: the generation failure keeps the
 * backend's real reason in a bounded snippet, categorizes so a retry policy
 * can tell setup failures apart from transient ones, and - on the success
 * path - still hands the audio bytes across the two-hop contract.
 */

function fakeFetch(routes: Record<string, { body: string, status: number, contentType?: string }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    const key = Object.keys(routes).find(route => url.includes(route))
    if (!key)
      throw new Error(`unstubbed request: ${url}`)
    const route = routes[key]
    return new Response(route.body, {
      headers: { 'content-type': route.contentType ?? 'application/json' },
      status: route.status,
    })
  }) as unknown as typeof fetch
}

describe('categorizeAllTalkFailure', () => {
  it('names a missing reference voice body as voice-not-found (terminal setup)', () => {
    const category = categorizeAllTalkFailure(500, '{"detail": "Voice file not found: lia-abc.wav"}')
    expect(category).toBe('voice-not-found')
    expect(isTerminalVoiceSetupCategory(category)).toBe(true)
  })

  it('names an engine that never loaded as engine-unavailable (terminal setup)', () => {
    const category = categorizeAllTalkFailure(500, 'TTS engine not loaded: xtts model missing')
    expect(category).toBe('engine-unavailable')
    expect(isTerminalVoiceSetupCategory(category)).toBe(true)
  })

  it('names backend-reported generation failures as generation-failed (NOT terminal)', () => {
    const category = categorizeAllTalkFailure(200, 'generate-failure')
    expect(category).toBe('generation-failed')
    expect(isTerminalVoiceSetupCategory(category)).toBe(false)
    expect(categorizeAllTalkFailure(502, '')).toBe('generation-failed')
  })

  it('stays unknown for ambiguous non-failures', () => {
    expect(categorizeAllTalkFailure(400, '{"detail": "bad speed"}')).toBe('unknown')
  })
})

describe('the generation error keeps the reason (G)', () => {
  it('a 500 response surfaces status, endpoint and a bounded body snippet - never a swallowed "failed (500)"', async () => {
    const longBody = `{"detail": "Voice file not found: ${'x'.repeat(3000)}"}`
    const client = createAllTalkClient({ baseUrl: 'http://alltalk.test', timeoutMs: 5000 }, fakeFetch({
      '/api/tts-generate': { body: longBody, status: 500 },
    }))

    const caught = await client.synthesize({
      characterVoiceGen: 'lia-80202d55-24e8-4edf-a665-fa8236af2c5e.wav',
      language: 'pt',
      text: 'qualquer texto',
    }).catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(AllTalkGenerationError)
    const failure = caught as AllTalkGenerationError
    expect(failure.status).toBe(500)
    expect(failure.endpoint).toBe('/api/tts-generate')
    expect(failure.category).toBe('voice-not-found')
    expect(failure.bodySnippet).toBeTruthy()
    // Bounded: no full traceback, no megabyte payloads.
    expect(failure.bodySnippet!.length).toBeLessThanOrEqual(600)
    expect(failure.message).toContain('[category=voice-not-found]')
  })

  it('a body snippet with whitespace collapse stays single-line', async () => {
    const client = createAllTalkClient({ baseUrl: 'http://alltalk.test', timeoutMs: 5000 }, fakeFetch({
      '/api/tts-generate': { body: 'engine not\n  loaded:\n   model missing', status: 500 },
    }))
    const failure = await client.synthesize({
      characterVoiceGen: 'lia.wav',
      language: 'pt',
      text: 'oi',
    }).catch((error: unknown) => error) as AllTalkGenerationError
    expect(failure.category).toBe('engine-unavailable')
    expect(failure.bodySnippet).not.toMatch(/\n/)
  })
})

describe('the success path still works (J)', () => {
  it('one POST answered with the contract, one GET, audio bytes out', async () => {
    const seenUrls: string[] = []
    const f = (async (input: string | URL | Request) => {
      const url = String(input)
      seenUrls.push(url)
      if (url.includes('/api/tts-generate'))
        return new Response(JSON.stringify({ output_file_path: 'C:\\x', output_file_url: '/outputs/abc.wav', status: 'generate-success' }), { status: 200 })
      return new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 })
    }) as unknown as typeof fetch

    const client = createAllTalkClient({ baseUrl: 'http://alltalk.test', timeoutMs: 5000 }, f)
    const audio = await client.synthesize({
      characterVoiceGen: 'lia-80202d55-24e8-4edf-a665-fa8236af2c5e.wav',
      language: 'pt',
      text: 'oi',
    })
    expect(new Uint8Array(audio)).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(seenUrls).toHaveLength(2)
    expect(seenUrls[0]).toContain('/api/tts-generate')
    expect(seenUrls[1]).toContain('/outputs/abc.wav')
  })
})
