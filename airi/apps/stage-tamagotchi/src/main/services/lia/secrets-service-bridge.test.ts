import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerLiaSecretsBridge } from './secrets-service'

const handlers = vi.hoisted(() => new Map<string, (value: any) => any>())
vi.mock('@moeru/eventa', async original => ({
  ...await original<typeof import('@moeru/eventa')>(),
  defineInvokeHandler: (_context: unknown, event: { receiveEvent: { id: string } }, handler: (value: any) => any) => {
    handlers.set(event.receiveEvent.id, handler)
  },
}))
vi.mock('./secrets', () => ({ createLiaSecretVault: vi.fn() }))

function handler(name: string) {
  return handlers.get(`eventa:invoke:lia:secret:${name}-receive`)!
}
function setup(allowRendererRead = async () => false) {
  const values = new Map<string, string>()
  const vault = {
    isEncryptionAvailable: () => true,
    hasSecret: (scope: string, key: string) => values.has(`${scope}:${key}`),
    getSecret: vi.fn((scope: string, key: string) => values.get(`${scope}:${key}`)),
    setSecret: vi.fn(async (scope: string, key: string, value: string) => {
      values.set(`${scope}:${key}`, value)
      return true
    }),
    deleteSecret: vi.fn(async (scope: string, key: string) => values.delete(`${scope}:${key}`)),
  }
  registerLiaSecretsBridge({ context: {} as never, vault, allowRendererRead })
  return { vault, values }
}
beforeEach(() => handlers.clear())

describe('secret bridge ownership and migration', () => {
  it('does not read or export a protected credential, even when present', async () => {
    const { vault, values } = setup()
    values.set('protected:apiKey', 'SYNTHETIC_PRIVATE_VALUE')
    expect(await handler('get')({ scope: 'protected', key: 'apiKey' })).toBeUndefined()
    expect(vault.getSecret).not.toHaveBeenCalled()
    expect(await handler('has')({ scope: 'protected', key: 'apiKey' })).toBe(true)
  })
  it('fails closed when the authority check rejects, without disclosing the error', async () => {
    const { vault } = setup(async () => {
      throw new Error('SYNTHETIC_PRIVATE_VALUE')
    })
    expect(await handler('get')({ scope: 'protected', key: 'apiKey' })).toBeUndefined()
    expect(vault.getSecret).not.toHaveBeenCalled()
  })
  it('serializes import-if-missing with an explicit key update and preserves the new key', async () => {
    const { values } = setup()
    const reference = { scope: 'protected', key: 'apiKey' }
    const update = handler('set')({ ...reference, value: 'SYNTHETIC_NEW' })
    const staleImport = handler('set')({ ...reference, value: 'SYNTHETIC_OLD', onlyIfMissing: true })
    expect(await update).toBe(true)
    expect(await staleImport).toBe(true)
    expect(values.get('protected:apiKey')).toBe('SYNTHETIC_NEW')
  })
  it('rejects oversized values, control characters and invalid references before vault access', async () => {
    const { vault } = setup()
    expect(await handler('set')({ scope: 'protected', key: 'apiKey', value: 'x'.repeat(16385) })).toBe(false)
    expect(await handler('get')({ scope: 'bad\u0000scope', key: 'apiKey' })).toBeUndefined()
    expect(await handler('delete')({ scope: 'x'.repeat(257), key: 'apiKey' })).toBe(false)
    expect(vault.setSecret).not.toHaveBeenCalled()
    expect(vault.getSecret).not.toHaveBeenCalled()
    expect(vault.deleteSecret).not.toHaveBeenCalled()
  })
})
