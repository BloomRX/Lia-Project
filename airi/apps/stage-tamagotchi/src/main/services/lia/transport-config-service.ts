import type { LiaSecretVault } from '@lia/core/secrets/vault'
import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { app } from 'electron'

import { createTransportRepository } from '../../../../../../../lia/core/src/transports/repository'
import { electronLiaTransportsGet, electronLiaTransportsMutate } from '../../../shared/eventa/lia-transports'
import { registerLiaTransportExecutionBridge } from './transport-execution-service'

let applicationRepository: ReturnType<typeof createTransportRepository> | undefined

function getApplicationRepository() {
  return applicationRepository ??= createTransportRepository(join(app.getPath('userData'), 'lia-transports.json'))
}

/** Raw secret reads remain available only for scopes outside the migrated transport boundary. */
export async function canRendererReadLegacySecret(scope: string): Promise<boolean> {
  if (scope === 'openai-compatible' || scope === 'lm-studio')
    return false
  try {
    const snapshot = await getApplicationRepository().read()
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
  repository?: ReturnType<typeof createTransportRepository>
  vault: LiaSecretVault
}) {
  const repository = params.repository ?? getApplicationRepository()
  const execution = registerLiaTransportExecutionBridge({ context: params.context, repository, vault: params.vault })
  defineInvokeHandler(params.context, electronLiaTransportsGet, async () => {
    try {
      return { ok: true as const, snapshot: await repository.read() }
    }
    catch {
      return { ok: false as const, code: 'storage' as const }
    }
  })
  defineInvokeHandler(params.context, electronLiaTransportsMutate, async (mutation) => {
    try {
      const result = await repository.mutate(mutation)
      if (result.ok)
        execution.invalidate(result.snapshot)
      return result
    }
    catch {
      return { ok: false as const, code: 'storage' as const }
    }
  })
}
