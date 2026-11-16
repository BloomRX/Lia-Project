import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStreamingTtsPipeline } from '../../../speech/streaming-pipeline'
import { streamingSynthesize } from '../../../speech/streaming-session'
import { OFFICIAL_TRANSCRIPTION_PROVIDER_ID, providerOfficialSpeech, providerOfficialSpeechStreaming, providerOfficialTranscription } from './index'
import { withCredentials } from './shared'

interface OfficialSpeechOptions {
  speed?: number
  extraBody?: {
    airi_analytics?: {
      source: string
      voice_type: string
    }
    voice_pack?: {
      pitch?: number
    }
  }
}

describe('official speech provider', () => {
  /**
   * @example
   * provider.speech('microsoft/v1', { speed: 1.2 })
   */
  it('keeps speech extra options on the generated request config', async () => {
    const provider = await providerOfficialSpeech.createProvider({}) as SpeechProviderWithExtraOptions<string, OfficialSpeechOptions>

    const request = provider.speech('microsoft/v1', {
      speed: 1.2,
      extraBody: {
        voice_pack: {
          pitch: 20,
        },
      },
    })

    expect(request.model).toBe('microsoft/v1')
    expect(request.speed).toBe(1.2)
    expect(request.extraBody).toEqual({
      voice_pack: {
        pitch: 20,
      },
    })
    expect(request.fetch).toBeTypeOf('function')
  })

  /**
   * @example
   * provider.speech('volcengine/seed-tts-2.0', { extraBody: { airi_analytics: { source: 'manual_preview', voice_type: 'official_selected' } } })
   */
  it('keeps streaming speech preview analytics on the generated request config', async () => {
    const provider = await providerOfficialSpeechStreaming.createProvider({}) as SpeechProviderWithExtraOptions<string, OfficialSpeechOptions>

    const request = provider.speech('volcengine/seed-tts-2.0', {
      extraBody: {
        airi_analytics: {
          source: 'manual_preview',
          voice_type: 'official_selected',
        },
      },
    })

    expect(request.model).toBe('volcengine/seed-tts-2.0')
    expect(request.extraBody).toEqual({
      airi_analytics: {
        source: 'manual_preview',
        voice_type: 'official_selected',
      },
    })
    expect(request.fetch).toBeTypeOf('function')
  })
})

describe('official transcription provider', () => {
  /**
   * @example
   * provider.transcription('auto')
   */
  it('builds an authenticated streaming transcription request for the server audio surface', async () => {
    const provider = await providerOfficialTranscription.createProvider({}) as {
      transcription: (model: string) => {
        baseURL: URL
        fetch?: typeof fetch
        model: string
      }
    }

    const request = provider.transcription('auto')

    expect(OFFICIAL_TRANSCRIPTION_PROVIDER_ID).toBe('official-provider-transcription')
    expect(request.model).toBe('auto')
    expect(request.baseURL.pathname).toBe('/api/v1/audio/transcriptions/stream')
    expect(request.fetch).toBeTypeOf('function')
  })

  /**
   * @example
   * providerOfficialTranscription.extraMethods.listModels()
   */
  it('lists the auto realtime model without calling a provider credential flow', async () => {
    const provider = await providerOfficialTranscription.createProvider({})
    const models = await providerOfficialTranscription.extraMethods?.listModels?.({}, provider)

    expect(models).toEqual([
      {
        id: 'auto',
        name: 'Auto',
        provider: OFFICIAL_TRANSCRIPTION_PROVIDER_ID,
        description: 'Realtime transcription routed by AIRI',
      },
    ])
  })
})

describe('official providers with desktop OIDC disabled', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects account-dependent requests before network access', async () => {
    vi.stubGlobal('window', { liaOidcEnabled: false })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const request = withCredentials()

    expect((await request('https://fixture.invalid/api/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: 'Bearer synthetic-legacy-token' },
    })).status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects both socket speech paths before opening a socket even when passed a token', async () => {
    vi.stubGlobal('window', { liaOidcEnabled: false })
    const socket = vi.fn()
    vi.stubGlobal('WebSocket', socket)
    const credentials = { model: 'test-model', voice: 'test-voice', token: 'synthetic-legacy-token' }
    const onError = vi.fn()
    const onDone = vi.fn()

    await expect(streamingSynthesize({ ...credentials, input: 'test' })).rejects.toThrow('not authenticated')
    createStreamingTtsPipeline({ ...credentials, audioContext: {} as AudioContext, onError, onDone })
    await Promise.resolve()

    expect(onError).toHaveBeenCalledOnce()
    expect(onDone).toHaveBeenCalledOnce()
    expect(socket).not.toHaveBeenCalled()
  })

  it('keeps the public voice catalogs anonymous and rejects redirects', async () => {
    vi.stubGlobal('window', { liaOidcEnabled: false })
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ models: [], voices: [] }))
    vi.stubGlobal('fetch', fetch)
    for (const definition of [providerOfficialSpeech, providerOfficialSpeechStreaming]) {
      const provider = await definition.createProvider({})
      await expect(definition.extraMethods?.listModels?.({}, provider)).resolves.toEqual([])
      await expect(definition.extraMethods?.listVoices?.({}, provider, 'auto')).resolves.toEqual([])
    }

    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/api/v1/audio/models',
      '/api/v1/audio/voices',
      '/api/v1/audio/models/streaming',
      '/api/v1/audio/voices/streaming',
    ])
    for (const [, init] of fetch.mock.calls) {
      expect(init).toEqual({
        credentials: 'omit',
        headers: { Accept: 'application/json' },
        redirect: 'error',
      })
    }
  })
})
