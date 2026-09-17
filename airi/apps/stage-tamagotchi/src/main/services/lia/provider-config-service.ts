import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LiaProviderChatConfig } from '../../../shared/eventa'
import type { LiaProductConfig } from '../../configs/lia'

import { defineInvokeHandler } from '@moeru/eventa'

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
      // The persisted shape (valibot output: fallback defaulted to []) and the
      // wire shape (shared eventa type: everything optional) differ by design;
      // bridge them explicitly instead of leaning on structural luck.
      provider: {
        ...provider,
        chat: {
          ...(chat.strategy ? { strategy: chat.strategy } : {}),
          ...(chat.preferred ? { preferred: chat.preferred } : {}),
          fallback: chat.fallback ?? [],
          ...(chat.fallbackEnabled !== undefined ? { fallbackEnabled: chat.fallbackEnabled } : {}),
          ...(chat.onboarded !== undefined ? { onboarded: chat.onboarded } : {}),
        },
      },
      voice: current.voice ?? {},
      preferences: current.preferences ?? {},
    })
  })
}
