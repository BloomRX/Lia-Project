import type { LiaProductConfigRead } from '@lia/core/product/config'

import type { TransportSnapshot } from '../../../core/src/transports/contracts.ts'
import type { LiaMemoryResult } from '../../../core/src/memory/contracts.ts'

import { credentialForDestination } from '../../../core/src/credentials/destination.ts'
import { LIA_MEMORY_LIMITS } from '../../../core/src/memory/contracts.ts'
import { findLiaAiProviderByStageProviderId, ProviderRegistry, ProviderRuntime } from '../../../core/src/providers/index.ts'

interface StageChatDependencies {
  fetch?: typeof globalThis.fetch
  recallMemory?: (query: string) => Promise<LiaMemoryResult<string>>
  readCredential?: (providerId: string) => string | undefined
  readProduct: () => Promise<LiaProductConfigRead>
  readTransports: () => Promise<TransportSnapshot>
}

export type StageChatResult
  = | { ok: true, text: string }
    | { ok: false, code: 'invalid' | 'configuration' | 'unavailable' | 'cancelled' | 'busy' }

const historyTurns = 6

interface Turn {
  user: string
  assistant: string
}

export function createStageChat({ fetch, recallMemory, readCredential, readProduct, readTransports }: StageChatDependencies) {
  let history: { destination: string, model: string, providerId: string, turns: Turn[] } | undefined

  function unavailableConfiguration(): StageChatResult {
    history = undefined
    return { ok: false, code: 'configuration' }
  }

  return async function send(input: unknown, signal: AbortSignal): Promise<StageChatResult> {
    if (typeof input !== 'string' || input.length > 8_000 || !input.trim())
      return { ok: false, code: 'invalid' }
    try {
      signal.throwIfAborted()
      const product = await readProduct()
      const preferred = product.status === 'ok' ? product.value.provider?.chat?.preferred : undefined
      if (!preferred?.modelId)
        return unavailableConfiguration()
      const { providerId, modelId } = preferred
      const definition = findLiaAiProviderByStageProviderId(providerId)
      if (!definition || definition.availability !== 'ready')
        return unavailableConfiguration()

      const transports = await readTransports()
      const records = transports.records.filter(record => record.providerId === providerId)
      const [record] = records
      if (records.length !== 1 || !record?.enabled || transports.tombstones.includes(record.id)
        || record.definitionId !== definition.definitionId || record.credentialRef.scope !== providerId
        || record.protocol !== 'chat-completions' || !record.modelIds.includes(modelId))
        return unavailableConfiguration()

      const destination = new URL(record.baseUrl)
      let credential: string | undefined
      if (definition.localOnly) {
        if (!['127.0.0.1', '[::1]'].includes(destination.hostname)
          || record.adapterOptions.localOnly !== true || record.adapterOptions.allowUnauthenticated !== true)
          return unavailableConfiguration()
      }
      else {
        if (!definition.requiresApiKey || destination.protocol !== 'https:')
          return unavailableConfiguration()
        credential = credentialForDestination(readCredential?.(providerId), providerId, destination, 'chat')
        if (!credential)
          return unavailableConfiguration()
      }

      if (history?.destination !== destination.href || history.model !== modelId || history.providerId !== providerId)
        history = { destination: destination.href, model: modelId, providerId, turns: [] }
      const current = history
      const text = input.trim()
      const memory = definition.localOnly ? await recallMemory?.(text.slice(0, LIA_MEMORY_LIMITS.query)) : undefined
      signal.throwIfAborted()
      const context = memory?.ok ? memory.value : ''

      const registry = new ProviderRegistry()
      registry.register({ id: providerId, protocol: 'chat-completions', credentialRequired: definition.requiresApiKey })
      const runtime = new ProviderRuntime(registry, { fetch, resolveCredential: () => credential })
      const response = await runtime.chat({ providerId, baseUrl: record.baseUrl }, {
        model: modelId,
        messages: [
          ...(context ? [{ role: 'system' as const, content: context }] : []),
          ...current.turns.flatMap(turn => [
            { role: 'user', content: turn.user },
            { role: 'assistant', content: turn.assistant },
          ]),
          { role: 'user', content: text },
        ],
      }, { signal })
      signal.throwIfAborted()
      if (credential && response.text.includes(credential))
        return { ok: false, code: 'unavailable' }
      if (!context)
        current.turns = [...current.turns, { user: text, assistant: response.text.slice(0, 8_000) }].slice(-historyTurns)
      return { ok: true, text: response.text }
    }
    catch {
      return { ok: false, code: signal.aborted ? 'cancelled' : 'unavailable' }
    }
  }
}
