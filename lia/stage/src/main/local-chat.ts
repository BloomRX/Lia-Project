import type { LiaProductConfigRead } from '@lia/core/product/config'

import type { TransportSnapshot } from '../../../core/src/transports/contracts.ts'

import { ProviderRegistry, ProviderRuntime } from '../../../core/src/providers/index.ts'

interface LocalChatDependencies {
  readProduct: () => Promise<LiaProductConfigRead>
  readTransports: () => Promise<TransportSnapshot>
}

export type LocalChatResult
  = | { ok: true, text: string }
    | { ok: false, code: 'invalid' | 'configuration' | 'unavailable' | 'cancelled' | 'busy' }

const providerId = 'local-chat'

export function createLocalChat({ readProduct, readTransports }: LocalChatDependencies) {
  const registry = new ProviderRegistry()
  registry.register({ id: providerId, protocol: 'chat-completions' })
  const runtime = new ProviderRuntime(registry)

  return async function send(input: unknown, signal: AbortSignal): Promise<LocalChatResult> {
    if (typeof input !== 'string' || input.length > 8_000 || !input.trim())
      return { ok: false, code: 'invalid' }
    try {
      signal.throwIfAborted()
      const product = await readProduct()
      const preferred = product.status === 'ok' ? product.value.provider?.chat?.preferred : undefined
      if (preferred?.providerId !== providerId || !preferred.modelId)
        return { ok: false, code: 'configuration' }

      const transports = await readTransports()
      const record = transports.records.find(record => record.id === providerId)
      if (!record?.enabled || transports.tombstones.includes(providerId)
        || record.providerId !== providerId || record.definitionId !== providerId
        || record.protocol !== 'chat-completions' || record.adapterOptions.localOnly !== true
        || record.adapterOptions.allowUnauthenticated !== true || !record.modelIds.includes(preferred.modelId))
        return { ok: false, code: 'configuration' }

      const destination = new URL(record.baseUrl)
      if (!['127.0.0.1', '[::1]'].includes(destination.hostname))
        return { ok: false, code: 'configuration' }

      const response = await runtime.chat({ providerId, baseUrl: record.baseUrl }, {
        model: preferred.modelId,
        messages: [{ role: 'user', content: input.trim() }],
      }, { signal })
      signal.throwIfAborted()
      return { ok: true, text: response.text }
    }
    catch {
      return { ok: false, code: signal.aborted ? 'cancelled' : 'unavailable' }
    }
  }
}
