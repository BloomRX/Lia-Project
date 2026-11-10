import type { LiaSecretVault } from '@lia/core/secrets/vault'

import { createCredentialOwnerClient, CredentialOwnerError, isCredentialRevision, takeCredentialOwnerEnvironment } from '../../../../../../../lia/core/src/credentials/owner-channel'
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
    async changeSecret(scope, key, value, options = {}) {
      if (key !== 'apiKey')
        return vault.changeSecret?.(scope, key, value, options)
      try {
        const expectedRevision = options.expectedRevision ?? vault.secretRevision?.(scope, key)
        if (!expectedRevision)
          return undefined
        const previous = vault.hasSecret(scope, key) ? await resolveMainCredential(managed, scope, key, options.signal) : undefined
        const revision = await client.request({ operation: 'change', scope, key, expectedRevision, ...(value === undefined ? {} : { value }) }, options.signal)
        if (!isCredentialRevision(revision))
          return undefined
        let used = false
        return {
          revision,
          async rollback() {
            if (used)
              return false
            used = true
            try {
              return isCredentialRevision(await client.request({ operation: 'change', scope, key, expectedRevision: revision, ...(previous === undefined ? {} : { value: previous }) }))
            }
            catch { return false }
          },
        }
      }
      catch { return undefined }
    },
    async setSecret(scope, key, value, signal, revision) {
      if (key !== 'apiKey')
        return vault.setSecret(scope, key, value, signal, revision)
      try {
        const expectedRevision = revision ?? vault.secretRevision?.(scope, key)
        if (expectedRevision === undefined)
          return false
        return isCredentialRevision(await client.request({ operation: 'change', scope, key, value, expectedRevision }, signal))
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
