import type { ChatRequest, ProviderConfig, ProviderRuntime } from '../../../core/src/providers/index.ts'

import { ProviderError } from '../../../core/src/providers/index.ts'

const clock = {
  type: 'function',
  function: {
    name: 'lia_local_time',
    description: 'Returns the current local date and time on this computer. Use when the user asks what time or date it is.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
} as const

export async function chatWithLocalClock(
  runtime: ProviderRuntime,
  config: ProviderConfig,
  request: ChatRequest,
  signal: AbortSignal,
  authorizeFollowUp: () => Promise<boolean>,
) {
  const response = await runtime.dispatch(config, { ...request, tools: [clock], tool_choice: 'auto', stream: false }, { signal })
  const { choices } = await response.json().catch(() => { throw new ProviderError('protocol') })
  const message = choices?.[0]?.message
  if (message?.tool_calls === undefined || message.tool_calls === null) {
    const text = message?.content
    if (typeof text !== 'string' || !text.trim())
      throw new ProviderError('empty')
    return { text }
  }

  const calls = message.tool_calls
  const call = Array.isArray(calls) && calls.length === 1 ? calls[0] : undefined
  const id = call?.id
  if (typeof id !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(id)
    || call.type !== 'function' || call.function?.name !== clock.function.name
    || typeof call.function.arguments !== 'string' || call.function.arguments.length > 32
    || !/^\{\s*\}$/.test(call.function.arguments))
    throw new ProviderError('protocol')
  if (!await authorizeFollowUp())
    throw new ProviderError('configuration')
  signal.throwIfAborted()
  const result = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'long' })
  return runtime.chat(config, {
    ...request,
    messages: [
      ...request.messages,
      { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: clock.function.name, arguments: '{}' } }] },
      { role: 'tool', tool_call_id: id, content: result },
    ],
  }, { signal })
}
