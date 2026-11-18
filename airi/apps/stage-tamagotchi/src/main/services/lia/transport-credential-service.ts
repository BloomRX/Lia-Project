import type { TransportSnapshot } from '@lia/contracts/transports'
import type { LiaSecretVault } from '@lia/core/secrets/vault'

import { bindCredential, credentialForDestination, unboundCredential } from '@lia/contracts/credentials/destination'

import { supportsMainSpeech } from '../../../shared/lia/speech-transport'
import { resolveMainCredential } from './credential-owner-access'
import { serializeWrite } from './secrets-service'
import { isNativeRecordingTranscriptionProvider, resolveTranscriptionDestination } from './transcription-adapters'

export function createTransportCredentialService(repository: { read: () => Promise<TransportSnapshot> }, vault: LiaSecretVault, purpose: 'transcription' | 'chat') {
  function recordFor(snapshot: TransportSnapshot, providerId: string) {
    const matches = snapshot.records.filter(record => record.providerId === providerId)
    const record = matches[0]
    if (matches.length !== 1 || !record.enabled)
      return
    const transcription = isNativeRecordingTranscriptionProvider(record.definitionId)
    if (purpose === 'transcription')
      return record.protocol === 'audio-transcription' && transcription ? record : undefined
    return record.protocol === 'chat-completions' && record.adapterOptions.localOnly !== true && !transcription && !supportsMainSpeech(providerId) ? record : undefined
  }

  function destinationFor(record: NonNullable<ReturnType<typeof recordFor>>) {
    if (purpose === 'transcription')
      return resolveTranscriptionDestination(record)
    const url = new URL(record.baseUrl)
    if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      return url
  }

  function validInput(input: unknown, keys: string[]): input is Record<string, unknown> & { providerId: string } {
    return !!input && typeof input === 'object' && !Array.isArray(input)
      && Object.keys(input).length === keys.length && Object.keys(input).every(key => keys.includes(key))
      && 'providerId' in input && typeof input.providerId === 'string' && input.providerId.length <= 256
  }

  async function has(input: unknown): Promise<boolean> {
    try {
      if (!validInput(input, ['providerId']))
        return false
      const record = recordFor(await repository.read(), input.providerId)
      if (!record || !vault.hasSecret(input.providerId, 'apiKey'))
        return false
      const destination = destinationFor(record)
      return !!destination && !!credentialForDestination(await resolveMainCredential(vault, input.providerId, 'apiKey'), input.providerId, destination, purpose)
    }
    catch { return false }
  }

  async function save(input: unknown): Promise<boolean> {
    try {
      if (!validInput(input, ['providerId', 'revision', 'expectedBaseUrl', 'apiKey']) || !Number.isSafeInteger(input.revision)
        || typeof input.expectedBaseUrl !== 'string' || input.expectedBaseUrl.length > 4096
        || typeof input.apiKey !== 'string' || !/^[\x21-\x7E]{1,16384}$/.test(input.apiKey) || !unboundCredential(input.apiKey)) {
        return false
      }
      const { providerId, revision, expectedBaseUrl, apiKey } = input
      const expectedRevision = vault.secretRevision?.(providerId, 'apiKey')
      if (expectedRevision === undefined)
        return false
      return await serializeWrite(vault, async () => {
        const snapshot = await repository.read()
        const record = recordFor(snapshot, providerId)
        if (!record || snapshot.revision !== revision || record.baseUrl !== expectedBaseUrl)
          return false
        const destination = destinationFor(record)
        if (!destination)
          return false
        const bound = bindCredential(providerId, destination, apiKey, purpose)
        if (bound.length > 16384)
          return false
        // The vault revision fences replacement or deletion from another process.
        // A later record change makes this key unusable outside its original origin.
        return await vault.setSecret(providerId, 'apiKey', bound, undefined, expectedRevision)
      })
    }
    catch { return false }
  }

  return { has, save }
}
