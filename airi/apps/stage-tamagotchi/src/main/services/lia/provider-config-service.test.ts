import type { LiaProviderChatConfig } from '../../../shared/eventa'
import type { LiaProductConfig } from '../../configs/lia'

import { parse } from 'valibot'
import { describe, expect, it, vi } from 'vitest'

import { liaProductConfigSchema } from '../../configs/lia-schema'
import { registerLiaProviderConfigBridge } from './provider-config-service'

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (value?: LiaProviderChatConfig) => unknown>() }))
vi.mock('@moeru/eventa', () => ({
  defineInvokeHandler: (_context: unknown, channel: { id: string }, handler: (value?: LiaProviderChatConfig) => unknown) => {
    ipc.handlers.set(channel.id, handler)
  },
}))
vi.mock('../../../shared/eventa', () => ({
  electronLiaProviderChatConfigGet: { id: 'get' },
  electronLiaProviderChatConfigSet: { id: 'set' },
}))
vi.mock('../../configs/lia', () => import('../../configs/lia-schema'))

describe('provider configuration persistence bridge', () => {
  it('round-trips a custom model without discarding existing optional product preferences', async () => {
    let product: LiaProductConfig = parse(liaProductConfigSchema, {
      schemaVersion: 1,
      setup: { completed: true },
      brain: { mode: 'manual', engine: { preferred: 'independent-engine' }, model: { preferred: 'existing/model' } },
      provider: { chat: { preferred: { providerId: 'existing', modelId: 'legacy/id' } } },
      preferences: { language: 'pt-BR' },
    })
    const before = structuredClone(product)
    registerLiaProviderConfigBridge({
      // Transport is replaced above; the real bridge body and schema still run.
      context: {} as Parameters<typeof registerLiaProviderConfigBridge>[0]['context'],
      liaProductConfig: {
        get: () => product,
        updateAndSave: async (mutator) => {
          product = parse(liaProductConfigSchema, JSON.parse(JSON.stringify(mutator(product))))
        },
      },
    })
    const chat = { preferred: { providerId: 'service', modelId: 'custom/Exact:Q4' }, fallbackEnabled: false }
    await ipc.handlers.get('set')!(chat)
    expect(ipc.handlers.get('get')!()).toMatchObject(chat)
    expect(product.brain).toEqual(before.brain)
    expect(product.setup).toEqual(before.setup)
    expect(product.preferences).toEqual(before.preferences)
    expect(product.schemaVersion).toBe(before.schemaVersion)
  })

  it('rejects malformed or secret-bearing selection targets without writing', async () => {
    let product: LiaProductConfig = parse(liaProductConfigSchema, {
      schemaVersion: 1,
      provider: { chat: { preferred: { providerId: 'custom-local', modelId: 'model-a' } } },
    })
    const updateAndSave = vi.fn(async (mutator: (current: LiaProductConfig) => LiaProductConfig) => {
      product = parse(liaProductConfigSchema, JSON.parse(JSON.stringify(mutator(product))))
    })
    registerLiaProviderConfigBridge({
      context: {} as Parameters<typeof registerLiaProviderConfigBridge>[0]['context'],
      liaProductConfig: { get: () => product, updateAndSave },
    })
    const handler = ipc.handlers.get('set')!
    const secretBearingPreferred = {
      preferred: { providerId: 'custom-local', modelId: 'model-a', apiKey: 'private' },
    }
    const secretBearingExpected = {
      preferred: { providerId: 'custom-local', modelId: 'model-b' },
      expectedPreferred: { providerId: 'custom-local', modelId: 'model-a', apiKey: 'private' },
    }

    expect(await handler(secretBearingPreferred))
      .toEqual({ ok: false, code: 'invalid' })
    expect(await handler(secretBearingExpected))
      .toEqual({ ok: false, code: 'invalid' })
    expect(updateAndSave).not.toHaveBeenCalled()
    expect(product.provider?.chat?.preferred).toEqual({ providerId: 'custom-local', modelId: 'model-a' })
  })
})
