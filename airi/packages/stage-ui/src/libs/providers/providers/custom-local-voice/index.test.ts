import type { CustomVoiceTransport } from './index'

import { Buffer } from 'node:buffer'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDefinedProvider } from '../registry'
import {
  CUSTOM_LOCAL_VOICE_PROVIDER_ID,
  CustomVoiceUnavailableError,
  getCustomVoiceTransport,
  providerCustomLocalVoice,
  setCustomVoiceTransport,
} from './index'

/**
 * The provider half of a custom voice.
 *
 * What matters here is the boundary: the provider receives a Lia *profile id*
 * and returns audio. It must never learn a filename, a path or which backend is
 * loaded - those stay with the host, which is what keeps `stage-ui` free of
 * desktop assumptions and the desktop free of provider internals.
 */

/** A minimal non-empty WAV-ish payload with its own backing store. */
function wavBytes(): ArrayBuffer {
  const bytes = new Uint8Array(36)
  bytes.set([0x52, 0x49, 0x46, 0x46]) // 'RIFF'
  bytes.fill(1, 4)
  // Not `Buffer.concat(...).buffer`: a Node Buffer's backing store is a slice of
  // a shared pool, so handing it over would leak neighbouring bytes.
  return bytes.buffer as ArrayBuffer
}

function fakeTransport(overrides: Partial<CustomVoiceTransport> = {}): CustomVoiceTransport {
  return {
    synthesize: vi.fn(async () => wavBytes()),
    listProfiles: vi.fn(async () => [
      { id: 'profile-a', name: 'Lia pessoal', language: 'pt-BR' },
      { id: 'profile-b', name: 'Outra voz' },
    ]),
    ...overrides,
  }
}

/** Drives the provider the way the speech runtime does: through `speech().fetch`. */
async function callSpeech(input: string, voice: string): Promise<Response> {
  const definition = getDefinedProvider(CUSTOM_LOCAL_VOICE_PROVIDER_ID)
  if (!definition)
    throw new Error('provider not registered')
  const instance = await definition.createProvider({ voiceId: '' } as never)
  const speech = instance.speech?.({ voiceId: '' } as never)
  const speechFetch = (speech as { fetch?: typeof fetch } | undefined)?.fetch
  if (!speechFetch)
    throw new Error('provider exposes no speech fetch')

  return speechFetch('http://custom-local-voice/v1/audio/speech', {
    method: 'POST',
    body: JSON.stringify({ input, voice, model: 'custom-voice' }),
  })
}

beforeEach(() => {
  setCustomVoiceTransport(fakeTransport())
})

afterEach(() => {
  setCustomVoiceTransport(undefined)
})

describe('registration', () => {
  it('is in the provider registry, because it can now synthesize', () => {
    // Registering it earlier would have put a silent entry in the picker.
    // Compared by id, not identity: `defineProvider` stores the definition it
    // was given, which is a different object from the one it returns.
    const registered = getDefinedProvider(CUSTOM_LOCAL_VOICE_PROVIDER_ID)
    expect(registered?.id).toBe(CUSTOM_LOCAL_VOICE_PROVIDER_ID)
    expect(registered?.id).toBe(providerCustomLocalVoice.id)
  })

  it('asks for no credentials and no model', async () => {
    const definition = getDefinedProvider(CUSTOM_LOCAL_VOICE_PROVIDER_ID)!
    expect(definition.requiresCredentials).toBe(false)
    expect(definition.tasks).toContain('text-to-speech')

    // An empty model catalogue is what keeps the model picker hidden rather
    // than broken, the same shape Kokoro relies on.
    expect(await definition.extraMethods?.listModels?.({ voiceId: '' } as never, {} as never)).toEqual([])
  })

  it('publishes the imported voices as its catalogue', async () => {
    const definition = getDefinedProvider(CUSTOM_LOCAL_VOICE_PROVIDER_ID)!
    const voices = await definition.extraMethods?.listVoices?.({ voiceId: '' } as never, {} as never)

    expect(voices?.map(voice => voice.id)).toEqual(['profile-a', 'profile-b'])
    expect(voices?.[0]?.name).toBe('Lia pessoal')
    expect(voices?.[0]?.provider).toBe(CUSTOM_LOCAL_VOICE_PROVIDER_ID)
    // `VoiceInfo.languages` is a labelled list, not bare tags.
    expect(voices?.[0]?.languages).toEqual([{ code: 'pt-BR', title: 'pt-BR' }])
    // A profile with no recorded language claims none, rather than a guess.
    expect(voices?.[1]?.languages).toEqual([])
  })

  it('publishes an empty catalogue when there is no host', async () => {
    setCustomVoiceTransport(undefined)
    const definition = getDefinedProvider(CUSTOM_LOCAL_VOICE_PROVIDER_ID)!

    expect(await definition.extraMethods?.listVoices?.({ voiceId: '' } as never, {} as never)).toEqual([])
  })
})

describe('synthesis', () => {
  it('hands the selected profile id to the host and returns its audio', async () => {
    const transport = fakeTransport()
    setCustomVoiceTransport(transport)

    // A deliberately unguessable id: if the provider ever pinned a profile
    // instead of forwarding the selection, this would not match.
    const selected = 'profile-7f3c-selected-by-the-user'
    const response = await callSpeech('Olá! Eu sou a Lia.', selected)
    const bytes = await response.arrayBuffer()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('audio/wav')
    expect(Buffer.from(bytes).subarray(0, 4).toString('latin1')).toBe('RIFF')

    expect(transport.synthesize).toHaveBeenCalledWith({
      profileId: selected,
      text: 'Olá! Eu sou a Lia.',
    })
  })

  it('never sends a filename or path to the host', async () => {
    const transport = fakeTransport()
    setCustomVoiceTransport(transport)

    await callSpeech('Olá!', 'profile-7f3c-selected-by-the-user')

    const request = (transport.synthesize as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(Object.keys(request).sort()).toEqual(['profileId', 'text'])
    expect(request.profileId).not.toContain('/')
    expect(request.profileId).not.toContain('.wav')
  })

  it('fails loudly when no voice is selected', async () => {
    await expect(callSpeech('Olá!', '')).rejects.toThrow(/No custom voice selected/)
  })

  it('fails with a distinct, recoverable error when there is no host transport', async () => {
    setCustomVoiceTransport(undefined)

    // Distinct because "this build has no voice library" and "the server is
    // down" need different messages - and because throwing at all is what lets
    // the fallback policy advance to the next target.
    await expect(callSpeech('Olá!', 'profile-a')).rejects.toThrow(CustomVoiceUnavailableError)
    expect(getCustomVoiceTransport()).toBeUndefined()
  })

  it('fails when the host returns no audio rather than playing silence', async () => {
    setCustomVoiceTransport(fakeTransport({ synthesize: async () => new ArrayBuffer(0) }))

    await expect(callSpeech('Olá!', 'profile-a')).rejects.toThrow(/returned no audio/)
  })

  it('propagates a backend failure instead of swallowing it', async () => {
    setCustomVoiceTransport(fakeTransport({
      synthesize: async () => {
        throw new Error('AllTalk answered 503')
      },
    }))

    await expect(callSpeech('Olá!', 'profile-a')).rejects.toThrow(/503/)
  })

  it('rejects a malformed request body', async () => {
    const definition = getDefinedProvider(CUSTOM_LOCAL_VOICE_PROVIDER_ID)!
    const instance = await definition.createProvider({ voiceId: '' } as never)
    const speechFetch = (instance.speech?.({ voiceId: '' } as never) as { fetch?: typeof fetch })?.fetch!

    await expect(speechFetch('http://x/v1/audio/speech', { method: 'POST' })).rejects.toThrow(/Invalid request body/)
  })
})
