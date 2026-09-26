import type { ChatRoundOutcome, ChatRoundSettledObservation } from '@proj-airi/core-agent'

import type { ChatRequestStartedObservation, ChatRequestStartedObserver } from './chat-provider-runtime'

import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getChatRequestStartedObserver,
  getChatRoundSettledObserver,
  notifyChatRequestStarted,
  notifyChatRoundSettled,
  registerChatFallbackResolver,
  registerChatRequestStartedObserver,
  registerChatRoundSettledObserver,
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
  describe('logical send correlation on the observation', () => {
    it('u: correlationId is optional and travels verbatim, never invented', () => {
      const captured: ChatRequestStartedObservation[] = []
      registerChatRequestStartedObserver(observation => captured.push(observation))

      // Absent: stays absent - the seam never synthesizes one.
      notifyChatRequestStarted(observation)
      expect(captured[0]?.correlationId).toBeUndefined()
      expect(Object.keys(captured[0] as object)).not.toContain('correlationId')

      // Present: forwarded exactly as supplied, alongside the per-attempt keys.
      const correlated = { ...observation, correlationId: 'logical-send-7' }
      notifyChatRequestStarted(correlated)
      expect(captured[1]?.correlationId).toBe('logical-send-7')
      expect(captured[1]).toEqual({
        conversationId: 'session-1',
        roundId: 'round-1',
        providerId: 'groq',
        modelId: 'openai/gpt-oss-120b',
        correlationId: 'logical-send-7',
      })
      // The seam forwards the caller's object; it neither adds nor rewrites ids.
      expect(captured[1]).toBe(correlated)
    })

    it('y: a throwing observer stays isolated for correlated observations too', () => {
      const observer = vi.fn(() => {
        throw new Error('observer exploded')
      })
      registerChatRequestStartedObserver(observer)

      expect(() => notifyChatRequestStarted({ ...observation, correlationId: 'logical-send-8' })).not.toThrow()
      expect(observer).toHaveBeenCalledTimes(1)
      expect(getChatRequestStartedObserver()).toBe(observer)
    })
  })
})

/**
 * Phase 8.0D-10B-4D4B2: the settled-round sibling of the request-start seam.
 *
 * It is the SAME convention, not a second framework: one optional slot, plain
 * `register*` / `get*` / reset-for-testing, verbatim synchronous forwarding and
 * a swallowed observer failure. The observation type itself is NOT declared
 * here - it is the Core Agent's, imported as a type.
 */
describe('chat round-settled observation extension', () => {
  const SOURCE = readFileSync(new URL('./chat-provider-runtime.ts', import.meta.url), 'utf-8')
  /** Source without comments: guards must only find vocabulary in real code. */
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const SETTLED_REGION = CODE.slice(
    CODE.indexOf('export function notifyChatRoundSettled'),
    CODE.indexOf('export function resetChatProviderRuntimeExtensionsForTesting'),
  )

  const settled: ChatRoundSettledObservation = {
    outcome: 'succeeded',
    roundId: 'round-1',
  }

  afterEach(() => resetChatProviderRuntimeExtensionsForTesting())

  it('a: with no observer registered the seam is an inert no-op', () => {
    expect(getChatRoundSettledObserver()).toBeUndefined()
    expect(() => notifyChatRoundSettled(settled)).not.toThrow()
    expect(notifyChatRoundSettled(settled)).toBeUndefined()
  })

  it('b: registration exposes exactly the registered observer and uses it once', () => {
    const observer = vi.fn()
    registerChatRoundSettledObserver(observer)

    expect(getChatRoundSettledObserver()).toBe(observer)
    // Registration alone observes nothing.
    expect(observer).not.toHaveBeenCalled()

    notifyChatRoundSettled(settled)
    expect(observer).toHaveBeenCalledTimes(1)
    expect(observer).toHaveBeenCalledWith(settled)
  })

  it('c: the observer receives the caller object itself, and its return value is ignored', () => {
    const received: unknown[] = []
    const observer = ((observation: ChatRoundSettledObservation) => {
      received.push(observation)
      return { outcome: 'hijacked', roundId: 'hijacked' }
    }) as unknown as (observation: ChatRoundSettledObservation) => void
    registerChatRoundSettledObserver(observer)

    // Identity is preserved: the seam forwards, it does not re-wrap.
    expect(notifyChatRoundSettled(settled)).toBeUndefined()
    expect(received[0]).toBe(settled)
    expect(getChatRoundSettledObserver()).toBe(observer)
  })

  it('d: re-registering replaces the previous observer, and undefined clears it', () => {
    const first = vi.fn()
    const second = vi.fn()
    registerChatRoundSettledObserver(first)
    registerChatRoundSettledObserver(second)

    notifyChatRoundSettled(settled)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)

    registerChatRoundSettledObserver(undefined)
    expect(getChatRoundSettledObserver()).toBeUndefined()
    expect(() => notifyChatRoundSettled(settled)).not.toThrow()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('e: clearing is unconditional and there is no disposer - a cleared slot cannot be revived', () => {
    const first = vi.fn()
    registerChatRoundSettledObserver(first)
    registerChatRoundSettledObserver(undefined)
    // Re-registering after the clear is a NEW registration, and the previous
    // observer never receives another observation.
    const second = vi.fn()
    registerChatRoundSettledObserver(second)

    notifyChatRoundSettled(settled)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('f: the testing reset clears the settled observer without touching the other extensions', () => {
    const observer = vi.fn()
    const fallback = vi.fn()
    const credentials = vi.fn()
    registerChatRoundSettledObserver(observer)
    registerChatFallbackResolver(fallback)
    registerProviderCredentialResolver(credentials)

    resetChatProviderRuntimeExtensionsForTesting()

    expect(getChatRoundSettledObserver()).toBeUndefined()
    notifyChatRoundSettled(settled)
    expect(observer).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
    expect(credentials).not.toHaveBeenCalled()
  })

  it('g: a throwing observer is isolated at the seam - one attempt, nothing escapes', () => {
    const observer = vi.fn(() => {
      throw new Error('observer exploded')
    })
    registerChatRoundSettledObserver(observer)

    expect(() => notifyChatRoundSettled(settled)).not.toThrow()
    expect(notifyChatRoundSettled(settled)).toBeUndefined()
    // Exactly one attempt per notification: no retry, no second call.
    expect(observer).toHaveBeenCalledTimes(2)

    const later = vi.fn()
    registerChatRoundSettledObserver(later)
    notifyChatRoundSettled(settled)
    expect(later).toHaveBeenCalledTimes(1)
  })

  it('h/i: an absent correlationId stays absent, with roundId and outcome untouched', () => {
    const received: ChatRoundSettledObservation[] = []
    registerChatRoundSettledObserver(observation => received.push(observation))

    notifyChatRoundSettled({ outcome: 'abandoned', roundId: 'round-9' })

    expect(received).toEqual([{ outcome: 'abandoned', roundId: 'round-9' }])
    // Nothing is synthesized at this layer: the Lia-specific "no id -> ignore"
    // rule belongs to a future reporter, not to this generic transport seam.
    expect('correlationId' in (received[0] as object)).toBe(false)
    expect(received[0]?.correlationId).toBeUndefined()
  })

  it('j: a present correlationId is forwarded verbatim', () => {
    const received: ChatRoundSettledObservation[] = []
    registerChatRoundSettledObserver(observation => received.push(observation))

    const correlated: ChatRoundSettledObservation = { correlationId: 'logical-send-5', outcome: 'failed', roundId: 'round-5' }
    notifyChatRoundSettled(correlated)

    expect(received).toEqual([correlated])
    expect(received[0]).toBe(correlated)
  })

  it('k/l: every outcome crosses the seam unchanged, with no filtering or translation', () => {
    const outcomes: ChatRoundOutcome[] = ['succeeded', 'failed', 'abandoned']
    const received: ChatRoundSettledObservation[] = []
    registerChatRoundSettledObserver(observation => received.push(observation))

    for (const outcome of outcomes)
      notifyChatRoundSettled({ correlationId: 'logical-send-6', outcome, roundId: `round-${outcome}` })

    expect(received.map(observation => observation.outcome)).toEqual(outcomes)
    expect(received.map(observation => observation.roundId)).toEqual([
      'round-succeeded',
      'round-failed',
      'round-abandoned',
    ])
    expect(received.every(observation => observation.correlationId === 'logical-send-6')).toBe(true)
  })

  it('m: the seam owns one slot, one notifier and no state of its own', () => {
    // Exactly one slot, assigned exactly once, read exactly once.
    expect(CODE.match(/^let chatRoundSettledObserver:/m)).toHaveLength(1)
    expect(CODE.match(/chatRoundSettledObserver = observer/g)).toHaveLength(1)
    expect(CODE.match(/const observer = chatRoundSettledObserver/g)).toHaveLength(1)
    // Exactly one notifier implementation.
    expect(CODE.match(/export function notifyChatRoundSettled/g)).toHaveLength(1)
    expect(CODE.match(/export function registerChatRoundSettledObserver/g)).toHaveLength(1)

    // No state collections, history or caching in the settled region.
    expect(SETTLED_REGION).not.toMatch(/\bnew Map\b|\bnew Set\b|\bhistory\b|lastOutcome|\bcache\b|\bqueue\b|\bbuffer\b/)
    // No second observer framework: no array of subscribers.
    expect(CODE).not.toMatch(/Observers\b|subscribers|listeners\.push|\.subscribe\(/)
    // No async, timers or retries.
    expect(SETTLED_REGION).not.toMatch(/\basync\b|\bawait\b|Promise|queueMicrotask|setTimeout|setInterval|retry/i)
  })

  it('n: the Core observation is imported as a TYPE - never re-declared here', () => {
    expect(SOURCE).toContain(`import type { ChatRoundSettledObservation } from '@proj-airi/core-agent'`)
    // No value import from the package, and no local re-declaration of the
    // payload or of the outcome union.
    expect(CODE).not.toMatch(/import \{[^}]*\} from '@proj-airi\/core-agent'/)
    expect(CODE).not.toMatch(/export (?:type|interface) ChatRoundSettledObservation/)
    expect(CODE).not.toMatch(/export type ChatRoundOutcome/)
    expect(CODE).not.toMatch(/ChatRoundOutcome/)
  })

  it('o: the settled seam adds no foreign capability and no diagnostics output', () => {
    expect(SETTLED_REGION).not.toMatch(/eventa|electron|ipcMain|ipcRenderer|BrowserWindow|main-process/i)
    expect(SETTLED_REGION).not.toMatch(/\bBrain\b|LiaBrain|lia-brain|correlation-store|providerStore|providersStore/i)
    expect(SETTLED_REGION).not.toMatch(/console\.|@guiiai\/logg|logger|telemetry|posthog/i)
    // No aggregate/verdict vocabulary, in any casing.
    expect(SETTLED_REGION).not.toMatch(/winner|finalAttempt|firstAttempt|anyAttempt|fallbackObserved|routeMatch|mismatch|divergence|aligned|verdict|score|recommendation/i)
    // No execution authority.
    expect(SETTLED_REGION).not.toMatch(/setProvider|setModel|activeProvider|activeModel|resolver|permission|toolCall/i)
  })

  it('p: the request-start seam is still the untouched sibling', () => {
    expect(CODE).toContain('export function notifyChatRequestStarted(observation: ChatRequestStartedObservation): void {')
    expect(CODE).toContain('export function registerChatRequestStartedObserver(observer?: ChatRequestStartedObserver): void {')
    expect(CODE).toContain('const observer = chatRequestStartedObserver')
    // Both notifiers share the same isolation shape: an inlined single-slot
    // lookup, a no-op without an observer, and a swallowed observer failure.
    for (const notifier of ['notifyChatRequestStarted', 'notifyChatRoundSettled']) {
      const region = CODE.slice(
        CODE.indexOf(`export function ${notifier}`),
        CODE.indexOf('export function resetChatProviderRuntimeExtensionsForTesting'),
      )
      expect(region, notifier).toContain('const observer = ')
      expect(region, notifier).toContain('if (!observer)')
      expect(region, notifier).toContain('observer(observation)')
      expect(region, notifier).toContain('catch {')
      // Neither notifier rethrows or reports anything.
      expect(region, notifier).not.toMatch(/console\.|throw |telemetry|logger/i)
    }
    // The request-start observation type was not touched either.
    expect(CODE).toContain('export interface ChatRequestStartedObservation {')
    expect(CODE).toContain('export type ChatRequestStartedObserver = (observation: ChatRequestStartedObservation) => void')
  })
})
