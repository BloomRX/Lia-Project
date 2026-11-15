/**
 * Test-only mirror of the main-process `secret:adopt` handler.
 *
 * The renderer's credential migration now asks main to fold a legacy plaintext
 * key into the vault and report whether main holds *that* value. Every store
 * test stubs the IPC surface with a handler map, so each of them needs that
 * handler wired to its own fake vault.
 *
 * Rather than copy the same four-branch logic into thirteen harnesses — where
 * one copy would eventually disagree with main — the shape is written once here
 * and given each harness's own three operations. It is a fixture, not a second
 * implementation: `secrets-service.test.ts` exercises the real handler against
 * the real vault, and this only keeps the store-level stubs faithful to it.
 */
export interface AdoptHarnessIpc {
  secretHas: (payload: { scope: string, key: string }) => boolean | Promise<boolean>
  secretGet: (payload: { scope: string, key: string }) => string | undefined | Promise<string | undefined>
  secretSet: (payload: { scope: string, key: string, value: string, onlyIfMissing?: boolean }) => boolean | Promise<boolean>
}

export type AdoptFixtureResult = 'stored' | 'matching' | 'conflict' | 'unavailable'

export function createSecretAdoptHandler(ipc: AdoptHarnessIpc) {
  return async (payload: { scope: string, key: string, value: string }): Promise<AdoptFixtureResult> => {
    // Narrowed to the address, the way the real vault is keyed: a harness that
    // asserts on `secretHas` must see `{ scope, key }` and not the value.
    const address = { scope: payload.scope, key: payload.key }
    if (await ipc.secretHas(address))
      return (await ipc.secretGet(address)) === payload.value ? 'matching' : 'conflict'
    return await ipc.secretSet({ ...address, value: payload.value }) ? 'stored' : 'unavailable'
  }
}
