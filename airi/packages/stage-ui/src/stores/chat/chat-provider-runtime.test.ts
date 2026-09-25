import type { ChatRequestStartedObservation, ChatRequestStartedObserver } from './chat-provider-runtime'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getChatRequestStartedObserver,
  notifyChatRequestStarted,
  registerChatFallbackResolver,
  registerChatRequestStartedObserver,
  registerProviderCredentialResolver,
  resetChatProviderRuntimeExtensionsForTesting,
} from './chat-provider-runtime'

/**
 * Phase 8.0D-10B-2: the request-start observation extension point.
 *
 * It follows the module's existing extension convention (single optional slot,
 * `register*` / `get*` / reset-for-testing) and adds no second registry.
 */

const observation: ChatRequestStartedObservation = {
  conversationId: 'session-1',
  roundId: 'round-1',
  providerId: 'groq',
  modelId: 'openai/gpt-oss-120b',
}

afterEach(() => resetChatProviderRuntimeExtensionsForTesting())

describe('chat request-start observation extension', () => {
  it('a: with no observer registered the seam is an inert no-op', () => {
    expect(getChatRequestStartedObserver()).toBeUndefined()
    expect(() => notifyChatRequestStarted(observation)).not.toThrow()
  })

  it('b: registration exposes exactly the registered observer and uses it', () => {
    const observer = vi.fn()
    registerChatRequestStartedObserver(observer)

    expect(getChatRequestStartedObserver()).toBe(observer)
    // Registration alone observes nothing.
    expect(observer).not.toHaveBeenCalled()

    notifyChatRequestStarted(observation)
    expect(observer).toHaveBeenCalledTimes(1)
    expect(observer).toHaveBeenCalledWith(observation)
  })

  it('c: re-registering replaces the previous observer, and undefined clears it', () => {
    const first = vi.fn()
    const second = vi.fn()
    registerChatRequestStartedObserver(first)
    registerChatRequestStartedObserver(second)

    notifyChatRequestStarted(observation)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)

    registerChatRequestStartedObserver(undefined)
    expect(getChatRequestStartedObserver()).toBeUndefined()
    expect(() => notifyChatRequestStarted(observation)).not.toThrow()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('d: the testing reset clears the observer without touching the other extensions', () => {
    const observer = vi.fn()
    const fallback = vi.fn()
    const credentials = vi.fn()
    registerChatRequestStartedObserver(observer)
    registerChatFallbackResolver(fallback)
    registerProviderCredentialResolver(credentials)

    resetChatProviderRuntimeExtensionsForTesting()

    expect(getChatRequestStartedObserver()).toBeUndefined()
    notifyChatRequestStarted(observation)
    expect(observer).not.toHaveBeenCalled()
    // The reset is the module's single reset: nothing else silently survives.
    expect(fallback).not.toHaveBeenCalled()
    expect(credentials).not.toHaveBeenCalled()
  })

  it('e: the seam carries no provider/model defaults of its own', () => {
    const captured: unknown[] = []
    registerChatRequestStartedObserver(value => captured.push(value))

    // Nothing is observed until a request actually starts, and the observation
    // is forwarded verbatim - no id is invented, added, removed or normalized.
    expect(captured).toEqual([])

    const partial: ChatRequestStartedObservation = {
      conversationId: 'session-9',
      roundId: 'round-9',
      providerId: '',
      modelId: '',
    }
    notifyChatRequestStarted(partial)
    expect(captured).toEqual([partial])
    expect(Object.keys(captured[0] as object).sort()).toEqual([
      'conversationId',
      'modelId',
      'providerId',
      'roundId',
    ])
  })

  it('isolates a throwing observer at the seam', () => {
    const observer = vi.fn(() => {
      throw new Error('observer exploded')
    })
    registerChatRequestStartedObserver(observer)

    expect(() => notifyChatRequestStarted(observation)).not.toThrow()
    expect(observer).toHaveBeenCalledTimes(1)

    // A later observation still reaches the same observer.
    expect(() => notifyChatRequestStarted(observation)).not.toThrow()
    expect(observer).toHaveBeenCalledTimes(2)
  })

  it('ignores whatever an observer returns', () => {
    const observer = (() => ({ providerId: 'hijacked', modelId: 'hijacked' })) as unknown as ChatRequestStartedObserver
    registerChatRequestStartedObserver(observer)

    expect(notifyChatRequestStarted(observation)).toBeUndefined()
    expect(getChatRequestStartedObserver()).toBe(observer)
  })
})
