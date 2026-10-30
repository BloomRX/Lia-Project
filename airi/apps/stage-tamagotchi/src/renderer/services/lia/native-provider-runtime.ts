import type { ChatRequest, ProviderConfig } from '../../../../../../../lia/core/src/providers/index'

import { ProviderError, ProviderRegistry, ProviderRuntime } from '../../../../../../../lia/core/src/providers/index'

/** Persisted compatibility ID, not a model/vendor catalogue. Other IDs stay legacy. */
export const NATIVE_CHAT_PROVIDER_ID = 'openai-compatible'

export interface NativeChatProvider {
  chat: (model: string) => { model: string, baseURL: string, fetch: typeof globalThis.fetch }
}

/** Production bridge: the SDK keeps the tool loop; Lia owns actual HTTP execution. */
export function createNativeProviderRuntime(options: {
  readConfig: (providerId: string) => Record<string, unknown> | undefined
  resolveCredential: (providerId: string) => Promise<string | undefined>
}) {
  const registry = new ProviderRegistry()
  registry.register({ id: NATIVE_CHAT_PROVIDER_ID, protocol: 'chat-completions' })
  const runtime = new ProviderRuntime(registry, { resolveCredential: options.resolveCredential })

  function owns(providerId: string) {
    return registry.has(providerId)
  }

  function configFor(providerId: string, draft = options.readConfig(providerId)): ProviderConfig {
    return { providerId, baseUrl: typeof draft?.baseUrl === 'string' ? draft.baseUrl : '' }
  }

  async function getChatProvider(providerId: string): Promise<NativeChatProvider | undefined> {
    if (!owns(providerId))
      return undefined
    // This resolves no upstream instance and retains no credential in the factory.
    const config = runtime.getInstance(configFor(providerId)).config
    return {
      chat(model) {
        return {
          model,
          baseURL: config.baseUrl,
          fetch: async (_input, init) => {
            // A tool round can outlive an endpoint edit. Never resurrect the
            // old endpoint or send a newly resolved credential to that address.
            const current = runtime.getInstance(configFor(providerId)).config
            if (current.baseUrl !== config.baseUrl)
              throw new ProviderError('cancelled')
            if (init?.method !== 'POST' || typeof init.body !== 'string')
              throw new ProviderError('configuration')
            let request: ChatRequest
            try {
              request = JSON.parse(init.body)
              if (!request || typeof request !== 'object' || request.model !== model)
                throw new ProviderError('configuration')
            }
            catch {
              throw new ProviderError('configuration')
            }
            // Preserve the wire payload (tools/images/reasoning included). The
            // runtime validates it, applies authentication and manages the body.
            return runtime.dispatch(config, request, { signal: init.signal ?? undefined })
          },
        }
      },
    }
  }

  async function discover(providerId: string, draft: Record<string, unknown>) {
    const temporary = new ProviderRuntime(registry, {
      resolveCredential: () => typeof draft.apiKey === 'string' ? draft.apiKey : undefined,
    })
    try {
      return { status: 'ready' as const, models: await temporary.discover({ ...configFor(providerId, draft), timeoutMs: 15000 }) }
    }
    catch {
      return { status: 'error' as const, models: [] }
    }
    finally {
      temporary.dispose()
    }
  }

  async function probe(providerId: string, model: string, draft: Record<string, unknown>) {
    const temporary = new ProviderRuntime(registry, {
      resolveCredential: () => typeof draft.apiKey === 'string' ? draft.apiKey : undefined,
    })
    try {
      await temporary.chat({ ...configFor(providerId, draft), timeoutMs: 15000 }, { model, messages: [{ role: 'user', content: 'Reply with OK.' }] })
      return { ok: true, scope: 'text' as const }
    }
    catch (error) {
      const code = error instanceof ProviderError ? error.code : undefined
      const failure = code === 'configuration' || code === 'unknown-provider'
        ? 'configuration'
        : code === 'empty'
          ? 'empty'
          : code === 'network' ? 'endpoint' : 'request'
      return { ok: false, scope: 'text' as const, failure }
    }
    finally {
      temporary.dispose()
    }
  }

  return { owns, getChatProvider, discover, probe, dispose: (providerId?: string) => runtime.dispose(providerId) }
}
