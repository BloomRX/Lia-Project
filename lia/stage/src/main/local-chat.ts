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
const historyTurns = 6

interface Turn {
  user: string
  assistant: string
}

export function createLocalChat({ readProduct, readTransports }: LocalChatDependencies) {
  const registry = new ProviderRegistry()
  registry.register({ id: providerId, protocol: 'chat-completions' })
  const runtime = new ProviderRuntime(registry)
  let history: { destination: string, model: string, turns: Turn[] } | undefined

  function unavailableConfiguration(): LocalChatResult {
    history = undefined
    return { ok: false, code: 'configuration' }
  }

  return async function send(input: unknown, signal: AbortSignal): Promise<LocalChatResult> {
    if (typeof input !== 'string' || input.length > 8_000 || !input.trim())
      return { ok: false, code: 'invalid' }
    try {
      signal.throwIfAborted()
      const product = await readProduct()
      const preferred = product.status === 'ok' ? product.value.provider?.chat?.preferred : undefined
      if (preferred?.providerId !== providerId || !preferred.modelId)
        return unavailableConfiguration()

      const transports = await readTransports()
      const record = transports.records.find(record => record.id === providerId)
      if (!record?.enabled || transports.tombstones.includes(providerId)
        || record.providerId !== providerId || record.definitionId !== providerId
        || record.protocol !== 'chat-completions' || record.adapterOptions.localOnly !== true
        || record.adapterOptions.allowUnauthenticated !== true || !record.modelIds.includes(preferred.modelId))
        return unavailableConfiguration()

      const destination = new URL(record.baseUrl)
      if (!['127.0.0.1', '[::1]'].includes(destination.hostname))
        return unavailableConfiguration()

      if (history?.destination !== destination.href || history.model !== preferred.modelId)
        history = { destination: destination.href, model: preferred.modelId, turns: [] }
      const current = history
      const text = input.trim()

      const response = await runtime.chat({ providerId, baseUrl: record.baseUrl }, {
        model: preferred.modelId,
        messages: [
          ...current.turns.flatMap(turn => [
            { role: 'user', content: turn.user },
            { role: 'assistant', content: turn.assistant },
          ]),
          { role: 'user', content: text },
        ],
      }, { signal })
      signal.throwIfAborted()
      current.turns = [...current.turns, { user: text, assistant: response.text.slice(0, 8_000) }].slice(-historyTurns)
      return { ok: true, text: response.text }
    }
    catch {
      return { ok: false, code: signal.aborted ? 'cancelled' : 'unavailable' }
    }
  }
}
