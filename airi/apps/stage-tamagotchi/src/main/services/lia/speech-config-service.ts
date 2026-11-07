import type { LiaSecretVault } from '@lia/core/secrets/vault'

import type { createTransportRepository } from '../../../../../../../lia/core/src/transports/repository'
import type { LiaSpeechConfigResult, LiaSpeechConfigSaveInput } from '../../../shared/eventa/lia-speech-config'

import { isTransportRecord } from '../../../../../../../lia/core/src/transports/validation'
import { supportsMainSpeech } from '../../../shared/lia/speech-transport'
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
      return { ok: true, config: { baseUrl: record?.enabled && record.protocol === 'audio-speech' ? record.baseUrl : '', hasKey: vault.hasSecret(input.providerId, 'apiKey'), revision: snapshot.revision } }
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
        const previous = vault.getSecret(providerId, 'apiKey')
        if (!apiKey && !previous)
          return credentials
        if (apiKey && !await vault.setSecret(providerId, 'apiKey', apiKey))
          return credentials
        let result
        try {
          result = await repository.mutate({ kind: 'put', expectedRevision: revision, record })
        }
        catch {
          result = storage
        }
        if (!result.ok) {
          if (apiKey) {
            const restored = previous
              ? await vault.setSecret(providerId, 'apiKey', previous)
              : await vault.deleteSecret(providerId, 'apiKey')
            if (!restored)
              return storage
          }
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
