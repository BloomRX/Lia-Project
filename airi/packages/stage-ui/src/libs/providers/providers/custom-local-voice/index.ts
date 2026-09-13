import { z } from 'zod'

import { defineProvider } from '../registry'

/**
 * The Lia's own imported voices, synthesized by a local server.
 *
 * ## What this provider is
 *
 * It is the missing half of `voice.tts.preferred = { providerId:
 * 'custom-local-voice', voiceId: '<profile-id>' }`. The target schema already
 * fits a custom voice exactly, so nothing new was needed in the configuration -
 * only something that can actually speak it. Registering the provider *now*,
 * and not earlier, is deliberate: before this it could not synthesize, and a
 * provider in the picker that produces silence is worse than no provider.
 *
 * ## What it does not know
 *
 * It does not know about XTTS. The `voiceId` it receives is a Lia profile id;
 * resolving that to a reference file, publishing it, and choosing a backend are
 * all the host application's job, reached through {@link CustomVoiceTransport}.
 * Swapping XTTS-v2 for another cloning backend changes nothing here.
 *
 * ## Why the transport is injected
 *
 * This package is shared by the desktop app and the browser builds. Only the
 * desktop app has an Electron main process holding the private voice library and
 * the AllTalk connection, so the transport is installed at startup by whoever
 * has one. Without it, synthesis fails with a clear, recoverable error rather
 * than pretending to work - which matters because the TTS fallback policy
 * distinguishes recoverable failures from dead ends.
 */

export const CUSTOM_LOCAL_VOICE_PROVIDER_ID = 'custom-local-voice'

export interface CustomVoiceTransportRequest {
  /** Lia profile id - never a path, never a filename. */
  profileId: string
  text: string
  /** BCP-47 tag, e.g. `pt-BR`. The host normalizes it for its backend. */
  language?: string
}

export interface CustomVoiceProfileSummary {
  id: string
  name: string
  /** BCP-47 tag, when the profile records one. */
  language?: string
}

export interface CustomVoiceTransport {
  /** Synthesizes one utterance and returns the encoded audio. */
  synthesize: (request: CustomVoiceTransportRequest) => Promise<ArrayBuffer>
  /** The voices the user has imported, for the catalogue. */
  listProfiles: () => Promise<CustomVoiceProfileSummary[]>
}

let installedTransport: CustomVoiceTransport | undefined

/** Installs the host's transport. Called once at startup by the desktop app. */
export function setCustomVoiceTransport(transport: CustomVoiceTransport | undefined): void {
  installedTransport = transport
}

export function getCustomVoiceTransport(): CustomVoiceTransport | undefined {
  return installedTransport
}

/**
 * The error thrown when no host transport is present.
 *
 * A distinct message rather than a generic one, so a log tells "this build has
 * no voice library" apart from "the server is down".
 */
export class CustomVoiceUnavailableError extends Error {
  constructor() {
    super('Custom voices are not available in this build.')
    this.name = 'CustomVoiceUnavailableError'
  }
}

export const providerCustomLocalVoice = defineProvider({
  id: CUSTOM_LOCAL_VOICE_PROVIDER_ID,
  name: 'Custom voice',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.custom-local-voice.title'),
  description: 'Speak with a voice you imported yourself, through a local speech server.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.custom-local-voice.description'),
  tasks: ['text-to-speech'],
  icon: 'i-lobe-icons:speaker',
  requiresCredentials: false,
  createProviderConfig: () => z.object({
    /** Kept for shape parity; a profile carries its own settings. */
    voiceId: z.string().default(''),
  }),
  createProvider() {
    return {
      speech: () => ({
        baseURL: 'http://custom-local-voice/v1/',
        model: 'custom-voice',
        fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (!init?.body || typeof init.body !== 'string')
            throw new Error('Invalid request body')

          const body = JSON.parse(init.body) as { input?: string, voice?: string }
          if (!body.voice)
            throw new Error('No custom voice selected.')

          const transport = installedTransport
          if (!transport)
            throw new CustomVoiceUnavailableError()

          // The host resolves the profile, publishes its reference audio and
          // talks to the backend. This provider only carries the result back.
          const buffer = await transport.synthesize({
            profileId: body.voice,
            text: body.input ?? '',
          })

          if (!buffer || buffer.byteLength === 0)
            throw new Error('The speech server returned no audio.')

          return new Response(buffer, {
            status: 200,
            headers: { 'Content-Type': 'audio/wav' },
          })
        },
      }),
    }
  },
  validationRequiredWhen: () => false,
  extraMethods: {
    // No model catalogue: a custom voice is selected by profile, and the backend
    // is the host's concern. Returning [] is what keeps the model picker hidden
    // instead of broken - the same shape Kokoro already relies on.
    listModels: async () => [],
    async listVoices() {
      const transport = installedTransport
      if (!transport)
        return []

      try {
        const profiles = await transport.listProfiles()
        return profiles.map(profile => ({
          id: profile.id,
          name: profile.name,
          description: profile.name,
          previewURL: '',
          // `VoiceInfo.languages` is a labelled list, not bare tags.
          languages: profile.language ? [{ code: profile.language, title: profile.language }] : [],
          provider: CUSTOM_LOCAL_VOICE_PROVIDER_ID,
          gender: 'neutral' as const,
        }))
      }
      catch {
        // A library that cannot be listed is an empty catalogue, not a crash in
        // the provider picker.
        return []
      }
    },
  },
})
