import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LiaProviderChatConfig, LiaProviderChatWrite, LiaProviderChatWriteResult } from '../../../shared/eventa'
import type { LiaProductConfig } from '../../configs/lia'

import { defineInvokeHandler } from '@moeru/eventa'

import {
  electronLiaProviderChatConfigGet,
  electronLiaProviderChatConfigSet,
} from '../../../shared/eventa'
import { decideSelectionWrite } from '../../../shared/lia/selection-write-policy'
import { defaultLiaProductConfig } from '../../configs/lia'

type MainContext = ReturnType<typeof createContext>['context']

/**
 * Wires the Lia `provider.chat` configuration (references/metadata only — no
 * secrets) between the renderer and the Lia product config at
 * `userData/lia-product.json`.
 *
 * AF-1 (12/11/2026): o Launcher passou a ser a autoridade de
 * `provider.chat.preferred` para os providers que ele gerencia. Este bridge
 * continua atendendo os provedores que o Launcher não gerencia — a tela de
 * configuração do Stage e o onboarding dependem dele — mas toda escrita passa
 * por `decideSelectionWrite`, que recusa (a) trocar a seleção de um provider
 * gerenciado e (b) sobrescrever uma seleção que mudou desde que a tela leu.
 *
 * `expectedPreferred` é DADO DE PROTOCOLO: ele viaja no payload, é consultado
 * antes de qualquer escrita e NUNCA é persistido.
 */
export function registerLiaProviderConfigBridge(params: {
  context: MainContext
  liaProductConfig: { get: () => LiaProductConfig | undefined, updateAndSave: (mutator: (current: LiaProductConfig) => LiaProductConfig) => Promise<void> }
}): void {
  const { context, liaProductConfig } = params

  defineInvokeHandler(context, electronLiaProviderChatConfigGet, (): LiaProviderChatConfig => {
    const product = liaProductConfig.get()
    return product?.provider?.chat ?? {}
  })

  defineInvokeHandler(context, electronLiaProviderChatConfigSet, async (chat: LiaProviderChatWrite): Promise<LiaProviderChatWriteResult> => {
    if (!chat || typeof chat !== 'object')
      return { ok: false, code: 'invalid' }

    const persisted = liaProductConfig.get()?.provider?.chat?.preferred
    const decision = decideSelectionWrite({
      persisted,
      incoming: chat.preferred,
      // Absent means "a caller that predates the field": no staleness check,
      // exactly the previous behaviour. `null` means "I read that there was none".
      ...(Object.hasOwn(chat, 'expectedPreferred') ? { expected: chat.expectedPreferred ?? null } : {}),
    })
    if (!decision.ok)
      return { ok: false, code: decision.code }

    await liaProductConfig.updateAndSave(current => ({
      ...current,
      schemaVersion: current.schemaVersion ?? defaultLiaProductConfig.schemaVersion,
      persona: current.persona ?? {},
      // The persisted shape (valibot output: fallback defaulted to []) and the
      // wire shape (shared eventa type: everything optional) differ by design;
      // bridge them explicitly instead of leaning on structural luck.
      provider: {
        ...current.provider,
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
    }))
    return { ok: true }
  })
}
