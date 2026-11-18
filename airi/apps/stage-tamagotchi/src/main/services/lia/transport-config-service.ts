import type { TransportSnapshot } from '@lia/contracts/transports'
import type { LiaSecretVault } from '@lia/core/secrets/vault'
import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { dirname, join } from 'node:path'
import { env } from 'node:process'

import { createTransportRepository } from '@lia/contracts/transports/repository'
import { defineInvokeHandler } from '@moeru/eventa'
import { app } from 'electron'

import { electronLiaSpeechConfigGet, electronLiaSpeechConfigSave } from '../../../shared/eventa/lia-speech-config'
import { electronLiaChatCredentialHas, electronLiaChatCredentialSave, electronLiaTranscriptionCredentialHas, electronLiaTranscriptionCredentialSave } from '../../../shared/eventa/lia-transport-credentials'
import { electronLiaTransportsGet, electronLiaTransportsMutate } from '../../../shared/eventa/lia-transports'
import { isCuratedChatProvider } from '../../../shared/lia/provider-catalog'
import { supportsMainSpeech } from '../../../shared/lia/speech-transport'
import { supportsMainTranscription } from '../../../shared/lia/transcription-transport'
import { serializeWrite } from './secrets-service'
import { createSpeechConfigService } from './speech-config-service'
import { createTransportCredentialService } from './transport-credential-service'
import { registerLiaTransportExecutionBridge } from './transport-execution-service'

let applicationRepository: ReturnType<typeof createTransportRepository> | undefined

/**
 * The single application-wide transport repository.
 *
 * Exported so the transcription service reads the SAME file and the same
 * revision that chat executes against, instead of opening a second view of the
 * user's configuration. One process, one writer, one authority.
 */
export function getApplicationRepository() {
  const productFile = env.LIA_PRODUCT_CONFIG_FILE?.trim()
  const directory = productFile ? dirname(productFile) : app.getPath('userData')
  return applicationRepository ??= createTransportRepository(join(directory, 'lia-transports.json'))
}

/**
 * Whether the renderer may read a stored secret.
 *
 * Denies every curated chat provider, because those execute in the main process
 * and nothing in the renderer needs their key; and denies every scope that a
 * transport record or tombstone covers, because that record means the same
 * thing. Anything else — a provider the Lia does not curate — keeps its
 * previous behaviour.
 *
 * There is no exception list any more. Corte B's first pass kept one for `groq`,
 * because the hearing pipeline built its transcription client in the renderer
 * and therefore needed the key there. Speech-to-text now runs in the main
 * process (`transcription-service.ts`), so that consumer is gone and the last
 * curated credential stopped being readable. Adding an exception back would
 * re-open renderer read access and must be argued in review.
 */
export async function canRendererReadLegacySecret(
  scope: string,
  repository: { read: () => Promise<TransportSnapshot> } = getApplicationRepository(),
): Promise<boolean> {
  if (isCuratedChatProvider(scope) || supportsMainSpeech(scope) || supportsMainTranscription(scope))
    return false
  try {
    const snapshot = await repository.read()
    if (snapshot.credentialProtectionIncomplete || (snapshot.tombstones.length > 0 && !snapshot.protectedCredentialScopes))
      return false
    return !snapshot.protectedCredentialScopes?.includes(scope)
      && !snapshot.records.some(record => record.credentialRef.scope === scope) && !snapshot.tombstones.includes(scope)
  }
  catch {
    return false
  }
}

/** One main-process writer; renderers exchange only validated, secret-free records. */
export function registerLiaTransportConfigBridge(params: {
  context: ReturnType<typeof createContext>['context']
  isAllowedSpeechConfigSender: (event: Electron.IpcMainEvent | undefined) => boolean
  repository?: ReturnType<typeof createTransportRepository>
  vault: LiaSecretVault
}) {
  const repository = params.repository ?? getApplicationRepository()
  const execution = registerLiaTransportExecutionBridge({ context: params.context, repository, vault: params.vault })
  const speech = createSpeechConfigService(repository, params.vault, execution.invalidate)
  const transcriptionCredential = createTransportCredentialService(repository, params.vault, 'transcription')
  const chatCredential = createTransportCredentialService(repository, params.vault, 'chat')
  defineInvokeHandler(params.context, electronLiaSpeechConfigGet, async (input, options) =>
    params.isAllowedSpeechConfigSender(options?.raw?.ipcMainEvent) ? speech.read(input) : { ok: false, code: 'invalid' })
  defineInvokeHandler(params.context, electronLiaSpeechConfigSave, async (input, options) =>
    params.isAllowedSpeechConfigSender(options?.raw?.ipcMainEvent) ? speech.save(input) : { ok: false, code: 'invalid' })
  defineInvokeHandler(params.context, electronLiaTranscriptionCredentialHas, async (input, options) =>
    params.isAllowedSpeechConfigSender(options?.raw?.ipcMainEvent) && transcriptionCredential.has(input))
  defineInvokeHandler(params.context, electronLiaTranscriptionCredentialSave, async (input, options) =>
    params.isAllowedSpeechConfigSender(options?.raw?.ipcMainEvent) && transcriptionCredential.save(input))
  defineInvokeHandler(params.context, electronLiaChatCredentialHas, async (input, options) =>
    params.isAllowedSpeechConfigSender(options?.raw?.ipcMainEvent) && chatCredential.has(input))
  defineInvokeHandler(params.context, electronLiaChatCredentialSave, async (input, options) =>
    params.isAllowedSpeechConfigSender(options?.raw?.ipcMainEvent) && chatCredential.save(input))
  defineInvokeHandler(params.context, electronLiaTransportsGet, async () => {
    try {
      return { ok: true as const, snapshot: await repository.read() }
    }
    catch {
      return { ok: false as const, code: 'storage' as const }
    }
  })
  defineInvokeHandler(params.context, electronLiaTransportsMutate, async mutation => serializeWrite(params.vault, async () => {
    try {
      const result = await repository.mutate(mutation)
      if (result.ok)
        execution.invalidate(result.snapshot)
      return result
    }
    catch {
      return { ok: false as const, code: 'storage' as const }
    }
  }))
}
