import type { LiaProviderChatConfig } from '../../../shared/eventa'
import type { RendererWindowContext } from '../../window-context'

interface ManagedChatProvider {
  loadedConfig: LiaProviderChatConfig | null | undefined
  activateConfiguredProvider: () => Promise<boolean>
}

interface ChatSelection {
  activeProvider: string
  activeModel: string
}

/** Projects Main's canonical target only in the managed Stage owner. */
export async function initializeManagedChat(
  windowContext: RendererWindowContext,
  provider: ManagedChatProvider,
  selection: ChatSelection,
): Promise<'skipped' | 'ready' | 'unavailable'> {
  if (!windowContext.liaManaged || windowContext.leadership !== 'leader-only')
    return 'skipped'

  try {
    const activated = await provider.activateConfiguredProvider()
    const preferred = provider.loadedConfig?.preferred
    if (activated && preferred?.providerId && preferred.modelId
      && selection.activeProvider === preferred.providerId
      && selection.activeModel === preferred.modelId) {
      return 'ready'
    }
  }
  catch {
    // IPC/provider errors can contain private addresses or credentials. The
    // caller receives a fixed status, never the underlying error.
  }

  // A saved renderer selection must not silently substitute for a failed
  // canonical activation. This does not change the configured fallback chain.
  selection.activeProvider = ''
  selection.activeModel = ''
  return 'unavailable'
}

export function managedChatStartupError(language: string): string {
  return language.startsWith('pt')
    ? 'Não foi possível preparar o serviço de IA. Confira a configuração da Lia e abra a conversa novamente.'
    : 'The AI service could not be prepared. Check the Lia settings and open the conversation again.'
}
