import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { defineInvokeHandler } from '@moeru/eventa'

import type { LiaProviderChatConfig } from '../../../shared/eventa'
import type { LiaProductConfig } from '../../configs/lia'

import {
  electronLiaProviderChatConfigGet,
  electronLiaProviderChatConfigSet,
} from '../../../shared/eventa'
import { defaultLiaProductConfig } from '../../configs/lia'

type MainContext = ReturnType<typeof createContext>['context']

/**
 * Wires the Lia `provider.chat` configuration (references/metadata only — no
 * secrets) between the renderer and the Lia product config at
 * `userData/lia-product.json`.
 */
export function registerLiaProviderConfigBridge(params: {
  context: MainContext
  liaProductConfig: { get: () => LiaProductConfig | undefined, update: (value: LiaProductConfig) => void }
}): void {
  const { context, liaProductConfig } = params

  defineInvokeHandler(context, electronLiaProviderChatConfigGet, (): LiaProviderChatConfig => {
    const product = liaProductConfig.get()
    return product?.provider?.chat ?? {}
  })

  defineInvokeHandler(context, electronLiaProviderChatConfigSet, (chat: LiaProviderChatConfig) => {
    if (!chat || typeof chat !== 'object')
      return

    const current = liaProductConfig.get() ?? defaultLiaProductConfig
    const provider = current.provider ?? {}
    liaProductConfig.update({
      schemaVersion: current.schemaVersion ?? defaultLiaProductConfig.schemaVersion,
      persona: current.persona ?? {},
      provider: { ...provider, chat },
      voice: current.voice ?? {},
      preferences: current.preferences ?? {},
    })
  })
}
