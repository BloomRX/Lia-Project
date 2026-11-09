import type { LiaSecretVault } from '@lia/core/secrets/vault'

import { createCredentialOwnerClient, CredentialOwnerError, takeCredentialOwnerEnvironment } from '../../../../../../../lia/core/src/credentials/owner-channel'
import { ProviderError } from '../../../../../../../lia/core/src/providers/contracts'

let owner: ReturnType<typeof createCredentialOwnerClient> | undefined
const originals = new WeakMap<LiaSecretVault, LiaSecretVault>()

/** Consume bootstrap before Electron creates renderers or service children. */
export function initializeCredentialOwner(environment: NodeJS.ProcessEnv) {
  const bootstrap = takeCredentialOwnerEnvironment(environment)
  owner = Object.keys(bootstrap).length ? createCredentialOwnerClient(bootstrap) : undefined
}

/** Managed writes have one cipher owner. Standalone vault behavior is unchanged. */
export function withCredentialOwner(vault: LiaSecretVault): LiaSecretVault {
  if (!owner)
    return vault
  const client = owner
  const managed: LiaSecretVault = {
    ...vault,
    // Opaque rollback belongs to the cipher owner, never to this host facade.
    backupSecret: undefined,
    async setSecret(scope, key, value, signal) {
      if (key !== 'apiKey')
        return signal ? vault.setSecret(scope, key, value, signal) : vault.setSecret(scope, key, value)
      try {
        // The remote owner protocol has no guarded commit acknowledgement.
        if (signal)
          return false
        return await client.request({ operation: 'set', scope, key, value }) === true
      }
      catch { return false }
    },
    async deleteSecret(scope, key) {
      if (key !== 'apiKey')
        return vault.deleteSecret(scope, key)
      try {
        return await client.request({ operation: 'delete', scope, key }) === true
      }
      catch { return false }
    },
  }
  originals.set(managed, vault)
  return managed
}

/** Only Main transports call this asynchronous port. Never wire it to secret-get IPC. */
export async function resolveMainCredential(vault: LiaSecretVault, scope: string, key: string, signal?: AbortSignal): Promise<string | undefined> {
  const original = originals.get(vault)
  try {
    if (signal?.aborted)
      throw new CredentialOwnerError('cancelled')
    if (!owner || !original || key !== 'apiKey')
      return vault.getSecret(scope, key)
    const result = await owner.request({ operation: 'get', scope, key }, signal)
    if (result === undefined || typeof result === 'string')
      return result
    throw new CredentialOwnerError('unavailable')
  }
  catch (error) {
    // Older entries may have been written by this Stage profile. Preserve and
    // read them in their original host; never rewrite them during a read.
    if (!signal?.aborted && original && error instanceof CredentialOwnerError && error.code === 'unreadable') {
      try {
        return original.getSecret(scope, key)
      }
      catch { /* Neither original host can open this entry; preserve it. */ }
    }
    throw new ProviderError(signal?.aborted || (error instanceof CredentialOwnerError && error.code === 'cancelled') ? 'cancelled' : 'credentials')
  }
}
