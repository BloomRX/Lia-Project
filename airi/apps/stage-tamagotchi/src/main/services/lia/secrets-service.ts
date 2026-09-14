import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'

import {
  electronLiaSecretDelete,
  electronLiaSecretEncryptionAvailable,
  electronLiaSecretGet,
  electronLiaSecretHas,
  electronLiaSecretSet,
} from '../../../shared/eventa'
import { createLiaSecretVault, type LiaSecretVault } from './secrets'

const log = useLogg('lia:secrets').useGlobalConfig()

type MainContext = ReturnType<typeof createContext>['context']

/**
 * Wires the main-process Lia secret vault to the renderer over a minimal,
 * scoped IPC contract.
 *
 * The renderer can ask whether encryption is available, test presence, and
 * store/read/delete a single opaque `scope:key` secret. Reads are returned so
 * the renderer can use the value transiently (e.g. to build one provider
 * instance) — it is never persisted by the renderer. Secret values are never
 * written to logs or to `lia-product.json`.
 */
export function registerLiaSecretsBridge(params: {
  context: MainContext
  vault: LiaSecretVault
}): void {
  const { context, vault } = params

  defineInvokeHandler(context, electronLiaSecretEncryptionAvailable, () => {
    return vault.isEncryptionAvailable()
  })

  defineInvokeHandler(context, electronLiaSecretHas, (payload) => {
    if (!payload?.scope || !payload?.key)
      return false
    return vault.hasSecret(payload.scope, payload.key)
  })

  defineInvokeHandler(context, electronLiaSecretSet, async (payload) => {
    if (!payload?.scope || !payload?.key || typeof payload.value !== 'string' || payload.value.length === 0) {
      log.warn('Rejected secret store request with missing/invalid fields')
      return false
    }
    const stored = await vault.setSecret(payload.scope, payload.key, payload.value)
    if (!stored) {
      // Never echo the value. Only report outcome + whether it was a platform
      // limitation so the UI can show a friendly, non-revealing message.
      log.warn('Failed to store secret (keychain may be unavailable)')
    }
    return stored
  })

  defineInvokeHandler(context, electronLiaSecretGet, (payload) => {
    if (!payload?.scope || !payload?.key)
      return undefined
    return vault.getSecret(payload.scope, payload.key)
  })

  defineInvokeHandler(context, electronLiaSecretDelete, async (payload) => {
    if (!payload?.scope || !payload?.key)
      return false
    return vault.deleteSecret(payload.scope, payload.key)
  })
}

export { createLiaSecretVault }
export type { LiaSecretVault } from './secrets'
