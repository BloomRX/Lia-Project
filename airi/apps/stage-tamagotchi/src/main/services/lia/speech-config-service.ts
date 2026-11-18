import type { createTransportRepository } from '@lia/contracts/transports/repository'
import type { LiaSecretVault } from '@lia/core/secrets/vault'

import type { LiaSpeechConfigResult, LiaSpeechConfigSaveInput } from '../../../shared/eventa/lia-speech-config'

import { bindCredential, credentialForDestination } from '@lia/contracts/credentials/destination'
import { isTransportRecord } from '@lia/contracts/transports'

import { supportsMainSpeech } from '../../../shared/lia/speech-transport'
import { resolveMainCredential } from './credential-owner-access'
import { serializeWrite } from './secrets-service'

export function createSpeechConfigService(
  repository: Pick<ReturnType<typeof createTransportRepository>, 'read' | 'mutate'>,
  vault: LiaSecretVault,
  invalidate: (snapshot: Awaited<ReturnType<typeof repository.read>>) => void,
) {
  const invalid = { ok: false, code: 'invalid' } as const
  const storage = { ok: false, code: 'storage' } as const
  const credentials = { ok: false, code: 'credentials' } as const
  const conflict = { ok: false, code: 'conflict' } as const
  const find = (snapshot: Awaited<ReturnType<typeof repository.read>>, id: string) =>
    snapshot.records.filter(record => record.providerId === id)

  async function read(input: { providerId: string }): Promise<LiaSpeechConfigResult> {
    try {
      if (typeof input?.providerId !== 'string' || !supportsMainSpeech(input.providerId))
        return invalid
      const snapshot = await repository.read()
      const matches = find(snapshot, input.providerId)
      if (matches.length > 1)
        return conflict
      const record = matches[0]
      const baseUrl = record?.enabled && record.protocol === 'audio-speech' ? record.baseUrl : ''
      const origin = URL.parse(baseUrl)
      const value = origin && vault.hasSecret(input.providerId, 'apiKey')
        ? await resolveMainCredential(vault, input.providerId, 'apiKey')
        : undefined
      const hasKey = !!origin && !!credentialForDestination(value, input.providerId, origin)
      return { ok: true, config: { baseUrl, hasKey, revision: snapshot.revision } }
    }
    catch {
      return storage
    }
  }

  async function save(input: LiaSpeechConfigSaveInput): Promise<LiaSpeechConfigResult> {
    try {
      if (!input || Object.keys(input).some(key => !['providerId', 'baseUrl', 'revision', 'apiKey'].includes(key)))
        return invalid
      const { providerId, baseUrl, revision, apiKey } = input
      if (typeof providerId !== 'string' || !supportsMainSpeech(providerId)
        || typeof baseUrl !== 'string' || baseUrl.length > 4096 || !Number.isSafeInteger(revision)
        || (apiKey !== undefined && (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 16384 || /[^\x21-\x7E]/.test(apiKey)))) {
        return invalid
      }
      const expectedKeyRevision = vault.secretRevision?.(providerId, 'apiKey')
      let url: URL
      try {
        url = new URL(baseUrl)
      }
      catch {
        return invalid
      }
      if (url.protocol !== 'https:' && (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
        return invalid
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
      return await serializeWrite(vault, async () => {
        const snapshot = await repository.read()
        const matches = find(snapshot, providerId)
        if (snapshot.revision !== revision || matches.length > 1)
          return conflict
        const existing = matches[0]
        const record = {
          id: existing?.id ?? providerId,
          providerId,
          definitionId: providerId,
          type: 'http',
          protocol: 'audio-speech',
          baseUrl: url.toString(),
          enabled: true,
          adapterOptions: { managedSpeechConfig: true },
          modelIds: [],
          metadata: existing?.metadata ?? {},
          credentialRef: { scope: providerId, key: 'apiKey' },
        } as const
        if (!isTransportRecord(record))
          return invalid
        const bound = apiKey ? bindCredential(providerId, url, apiKey) : undefined
        if (bound && bound.length > 16384)
          return invalid
        if (!bound) {
          if (!existing || !vault.hasSecret(providerId, 'apiKey'))
            return credentials
          const previous = await resolveMainCredential(vault, providerId, 'apiKey')
          if (!credentialForDestination(previous, providerId, url))
            return credentials
        }
        let writeRevision = revision
        if (!existing && vault.hasSecret(providerId, 'apiKey')) {
          // An orphan key is preserved. Establish an inert, CAS-protected
          // reference before asking its Main owner to read it for this save.
          const provisional = await repository.mutate({ kind: 'put', expectedRevision: revision, record: { ...record, enabled: false } })
          if (!provisional.ok)
            return provisional
          writeRevision = provisional.snapshot.revision
        }
        const change = bound && expectedKeyRevision !== undefined
          ? await vault.changeSecret?.(providerId, 'apiKey', bound, { expectedRevision: expectedKeyRevision })
          : undefined
        if (apiKey && !change)
          return credentials
        let result
        try {
          result = await repository.mutate({ kind: 'put', expectedRevision: writeRevision, record })
        }
        catch {
          result = storage
        }
        if (!result.ok) {
          if (change && !await change.rollback())
            return storage
          return result
        }
        invalidate(result.snapshot)
        return { ok: true, config: { baseUrl: record.baseUrl, hasKey: true, revision: result.snapshot.revision } }
      })
    }
    catch {
      return storage
    }
  }
  return { read, save }
}
