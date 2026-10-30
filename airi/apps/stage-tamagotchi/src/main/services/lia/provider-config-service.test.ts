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
  it('round-trips a custom model without discarding existing optional product preferences', () => {
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
        update: (value) => {
          product = parse(liaProductConfigSchema, JSON.parse(JSON.stringify(value)))
        },
      },
    })
    const chat = { preferred: { providerId: 'service', modelId: 'custom/Exact:Q4' }, fallbackEnabled: false }
    ipc.handlers.get('set')!(chat)
    expect(ipc.handlers.get('get')!()).toMatchObject(chat)
    expect(product.brain).toEqual(before.brain)
    expect(product.setup).toEqual(before.setup)
    expect(product.preferences).toEqual(before.preferences)
    expect(product.schemaVersion).toBe(before.schemaVersion)
  })
})
