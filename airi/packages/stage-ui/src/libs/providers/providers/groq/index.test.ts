import type { ChatProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import type { ChatRequestOptions, ProviderInstance } from '../../types'

import { requestBody } from '@xsai/shared'
import { describe, expect, it } from 'vitest'

import { providerMistralAI } from '../mistral-ai'
import { providerOllama } from '../ollama'
import { providerGroq } from './index'

/**
 * Regression for the Groq 400 `invalid_request_error`:
 *
 *   `reasoning_effort` must be one of `low`, `medium`, or `high`
 *
 * ROOT CAUSE: this adapter mapped AIRI's `reasoning: 'disabled'` to
 * `reasoningEffort: 'none'`. `@xsai/shared`'s `requestBody` turns that into
 * `reasoning_effort: "none"` on the wire, and Groq only accepts `none` for the
 * qwen3 family - `openai/gpt-oss-120b` accepts `low | medium | high` and
 * rejects anything else with a 400.
 *
 * The supported set is model-specific and models must not be hardcoded in a
 * provider adapter, so "disabled" now omits the field and lets Groq apply the
 * model default. `enabled` keeps the `medium` this adapter always sent, and no
 * other provider adapter was touched.
 */

type ChatProvider = ChatProviderWithExtraOptions<string, ChatRequestOptions>

/** Deliberately fake. Never a real key, and never expected in any output. */
const FAKE_KEY = 'gsk-diag-fake-credential-not-a-real-key'

/** The only values Groq accepts for gpt-oss. */
const GPT_OSS_EFFORTS = ['low', 'medium', 'high']

function asChatProvider(provider: ProviderInstance): ChatProvider {
  if (!('chat' in provider) || typeof provider.chat !== 'function')
    throw new Error('provider must support chat')
  return provider as ChatProvider
}

async function groqChat() {
  return asChatProvider(await providerGroq.createProvider({
    apiKey: FAKE_KEY,
    baseUrl: 'https://api.groq.com/openai/v1/',
  }))
}

/** The exact bytes `@xsai/shared` puts on the wire for a chat request. */
function wireBody(chatRequest: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(requestBody(chatRequest as never)) as Record<string, unknown>
}

describe('providerGroq reasoning effort', () => {
  it('omits reasoning_effort when reasoning is disabled - the value Groq rejected', async () => {
    const chat = await groqChat()
    const request = chat.chat('openai/gpt-oss-120b', { reasoning: 'disabled' }) as unknown as Record<string, unknown>

    expect(request).not.toHaveProperty('reasoningEffort')
    expect(wireBody(request)).not.toHaveProperty('reasoning_effort')
  })

  it('keeps medium when reasoning is enabled', async () => {
    const chat = await groqChat()
    const request = chat.chat('openai/gpt-oss-120b', { reasoning: 'enabled' }) as unknown as Record<string, unknown>

    expect(request.reasoningEffort).toBe('medium')
    expect(wireBody(request).reasoning_effort).toBe('medium')
  })

  it('omits the field when no reasoning option is supplied', async () => {
    const chat = await groqChat()
    const request = chat.chat('openai/gpt-oss-120b') as unknown as Record<string, unknown>

    expect(request).not.toHaveProperty('reasoningEffort')
  })

  it('never puts a value outside the gpt-oss effort scale on the wire', async () => {
    const chat = await groqChat()

    for (const reasoning of ['enabled', 'disabled'] as const) {
      const request = chat.chat('openai/gpt-oss-120b', { reasoning }) as unknown as Record<string, unknown>
      const sent = wireBody(request).reasoning_effort

      // Either omitted, or one of the values Groq accepts for this model.
      expect(
        sent === undefined || GPT_OSS_EFFORTS.includes(sent as string),
        `reasoning=${reasoning} sent ${JSON.stringify(sent)}`,
      ).toBe(true)
      expect(sent).not.toBe('none')
    }
  })

  it('leaves other reasoning providers untouched', async () => {
    // Ollama genuinely supports `none`, so its disabled mapping must stay.
    const ollama = asChatProvider(await providerOllama.createProvider({
      baseUrl: 'http://localhost:11434/v1/',
      thinkingMode: 'auto',
    }))
    expect(ollama.chat('gpt-oss:20b', { reasoning: 'disabled' })).toMatchObject({ reasoningEffort: 'none' })
    expect(ollama.chat('gpt-oss:20b', { reasoning: 'enabled' })).toMatchObject({ reasoningEffort: 'medium' })
  })

  it('gives no reasoning_effort to a provider that does not declare reasoning', async () => {
    // `getChatProviderInstance` only decorates a provider whose definition
    // declares the requested reasoning mode, so an undecorated provider is
    // called without options and can never receive the field.
    expect(providerMistralAI.capabilities?.chat?.reasoning).toBeUndefined()

    const mistral = asChatProvider(await providerMistralAI.createProvider({
      apiKey: FAKE_KEY,
    }))
    const request = mistral.chat('mistral-medium-latest') as unknown as Record<string, unknown>

    expect(request).not.toHaveProperty('reasoningEffort')
    expect(wireBody(request)).not.toHaveProperty('reasoning_effort')
  })

  it('never puts the API key on the wire', async () => {
    const chat = await groqChat()
    const request = chat.chat('openai/gpt-oss-120b', { reasoning: 'enabled' }) as unknown as Record<string, unknown>

    // The in-memory request record carries apiKey by design; `requestBody`
    // strips it (along with baseURL/fetch) before anything is serialized.
    expect(request).toHaveProperty('apiKey')

    const body = JSON.stringify(wireBody(request))
    expect(body).not.toContain(FAKE_KEY)
    expect(body).not.toContain('gsk-')
    expect(JSON.parse(body)).not.toHaveProperty('apiKey')
  })
})
