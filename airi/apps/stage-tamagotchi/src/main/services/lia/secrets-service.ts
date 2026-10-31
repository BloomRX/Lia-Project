import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LiaSecretVault } from './secrets'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'

import {
  electronLiaSecretDelete,
  electronLiaSecretEncryptionAvailable,
  electronLiaSecretGet,
  electronLiaSecretHas,
  electronLiaSecretSet,
} from '../../../shared/eventa'
import { createLiaSecretVault } from './secrets'

const log = useLogg('lia:secrets').useGlobalConfig()
const writes = new WeakMap<LiaSecretVault, Promise<unknown>>()

function serializeWrite<T>(vault: LiaSecretVault, action: () => Promise<T>): Promise<T> {
  const result = (writes.get(vault) ?? Promise.resolve()).then(action)
  writes.set(vault, result.catch(() => {}))
  return result
}

type MainContext = ReturnType<typeof createContext>['context']

/**
 * Wires the main-process Lia secret vault to the renderer over a minimal,
 * scoped IPC contract.
 *
 * The renderer can ask whether encryption is available, test presence, and
 * store/delete a single opaque `scope:key` secret. Migrated transports deny
 * reads and execute authenticated requests in main. The optional legacy read
 * policy exists for consumers not migrated yet; it is not a privacy guarantee
 * for those legacy consumers. Values never enter logs or product configuration.
 */
export function registerLiaSecretsBridge(params: {
  context: MainContext
  vault: LiaSecretVault
  /** Migrated transports execute in main and may not export stored credentials. */
  allowRendererRead?: (scope: string) => Promise<boolean>
}): void {
  const { context, vault } = params
  const validReference = (payload: { scope?: string, key?: string } | undefined) =>
    typeof payload?.scope === 'string' && payload.scope.length > 0 && payload.scope.length <= 256
    && typeof payload.key === 'string' && payload.key.length > 0 && payload.key.length <= 64
    && ![...payload.scope + payload.key].some(character => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127)

  defineInvokeHandler(context, electronLiaSecretEncryptionAvailable, () => {
    return vault.isEncryptionAvailable()
  })

  defineInvokeHandler(context, electronLiaSecretHas, (payload) => {
    if (!validReference(payload))
      return false
    return vault.hasSecret(payload.scope, payload.key)
  })

  defineInvokeHandler(context, electronLiaSecretSet, async (payload) => {
    if (!validReference(payload) || typeof payload.value !== 'string' || payload.value.length === 0 || payload.value.length > 16384
      || (payload.onlyIfMissing !== undefined && typeof payload.onlyIfMissing !== 'boolean')) {
      log.warn('Rejected secret store request with missing/invalid fields')
      return false
    }
    const stored = await serializeWrite(vault, async () => {
      if (payload.onlyIfMissing === true && vault.hasSecret(payload.scope, payload.key))
        return true
      return vault.setSecret(payload.scope, payload.key, payload.value)
    })
    if (!stored) {
      // Never echo the value. Only report outcome + whether it was a platform
      // limitation so the UI can show a friendly, non-revealing message.
      log.warn('Failed to store secret (keychain may be unavailable)')
    }
    return stored
  })

  defineInvokeHandler(context, electronLiaSecretGet, (payload) => {
    if (!validReference(payload))
      return undefined
    if (params.allowRendererRead) {
      return params.allowRendererRead(payload.scope)
        .then(allowed => allowed ? vault.getSecret(payload.scope, payload.key) : undefined)
        .catch(() => undefined)
    }
    return vault.getSecret(payload.scope, payload.key)
  })

  defineInvokeHandler(context, electronLiaSecretDelete, async (payload) => {
    if (!validReference(payload))
      return false
    return serializeWrite(vault, () => vault.deleteSecret(payload.scope, payload.key))
  })
}

export { createLiaSecretVault }
export type { LiaSecretVault } from './secrets'
