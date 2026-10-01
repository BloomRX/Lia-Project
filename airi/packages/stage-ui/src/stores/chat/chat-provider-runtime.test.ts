import type { ChatRoundOutcome, ChatRoundSettledObservation } from '@proj-airi/core-agent'

import type { ChatRequestStartedObservation, ChatRequestStartedObserver, ChatSendSettledObservation } from './chat-provider-runtime'

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getChatRequestStartedObserver,
  getChatRoundSettledObserver,
  getChatSendSettledObserver,
  notifyChatRequestStarted,
  notifyChatRoundSettled,
  notifyChatSendSettled,
  registerChatFallbackResolver,
  registerChatRequestStartedObserver,
  registerChatRoundSettledObserver,
  registerChatSendSettledObserver,
  registerProviderCredentialResolver,
  resetChatProviderRuntimeExtensionsForTesting,
} from './chat-provider-runtime'
// TEST-ONLY helper: keep source guards stable across CRLF/LF checkouts
function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

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
  const SOURCE = normalizeLineEndings(readFileSync(new URL('./chat-provider-runtime.ts', import.meta.url), 'utf-8'))
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

/**
 * Phase 8.0D-10B-4D4C4-B1: the logical-send sibling of the request-start and
 * round-settled seams.
 *
 * Same convention once more - one optional slot, plain `register*` / `get*` /
 * reset-for-testing, verbatim synchronous forwarding and a swallowed observer
 * failure - now over the settlement of ONE whole Stage logical send (the entire
 * send/retry invocation, not a round and not an attempt). Unlike those two, the
 * observation type is Stage-owned and declared here: the send lifecycle belongs
 * to this package, not to the Core Agent.
 */
describe('chat send-settled observation extension', () => {
  const SOURCE = normalizeLineEndings(readFileSync(new URL('./chat-provider-runtime.ts', import.meta.url), 'utf-8'))
  /** Source without comments: guards must only find vocabulary in real code. */
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const SEND_REGION = CODE.slice(
    CODE.indexOf('export function notifyChatSendSettled'),
    CODE.indexOf('export function resetChatProviderRuntimeExtensionsForTesting'),
  )
  const DECLARATION_REGION = CODE.slice(
    CODE.indexOf('export type ChatSendOutcome'),
    CODE.indexOf('let chatSendSettledObserver:'),
  )

  const settled: ChatSendSettledObservation = { outcome: 'succeeded' }

  afterEach(() => resetChatProviderRuntimeExtensionsForTesting())

  it('a: with no observer registered the seam is an inert no-op', () => {
    expect(getChatSendSettledObserver()).toBeUndefined()
    expect(() => notifyChatSendSettled(settled)).not.toThrow()
    expect(notifyChatSendSettled(settled)).toBeUndefined()
    expect(notifyChatSendSettled({ outcome: 'failed' })).toBeUndefined()
  })

  it('b: registration exposes exactly the registered observer and uses it once', () => {
    const observer = vi.fn()
    registerChatSendSettledObserver(observer)

    expect(getChatSendSettledObserver()).toBe(observer)
    // Registration alone observes nothing.
    expect(observer).not.toHaveBeenCalled()

    notifyChatSendSettled(settled)
    expect(observer).toHaveBeenCalledTimes(1)
    expect(observer).toHaveBeenCalledWith(settled)
  })

  it('c: the observer receives the caller object itself, and its return value is ignored', () => {
    const received: unknown[] = []
    const observer = ((observation: ChatSendSettledObservation) => {
      received.push(observation)
      return { outcome: 'failed', correlationId: 'hijacked' }
    }) as unknown as (observation: ChatSendSettledObservation) => void
    registerChatSendSettledObserver(observer)

    // Identity is preserved: the seam forwards, it does not re-wrap.
    expect(notifyChatSendSettled(settled)).toBeUndefined()
    expect(received[0]).toBe(settled)
    expect(getChatSendSettledObserver()).toBe(observer)
  })

  it('d: re-registering replaces the previous observer, and undefined clears it', () => {
    const first = vi.fn()
    const second = vi.fn()
    registerChatSendSettledObserver(first)
    registerChatSendSettledObserver(second)

    notifyChatSendSettled(settled)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)

    registerChatSendSettledObserver(undefined)
    expect(getChatSendSettledObserver()).toBeUndefined()
    expect(() => notifyChatSendSettled(settled)).not.toThrow()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('e: the testing reset clears the send observer without touching the other extensions', () => {
    const send = vi.fn()
    const round = vi.fn()
    const requestStart = vi.fn()
    registerChatSendSettledObserver(send)
    registerChatRoundSettledObserver(round)
    registerChatRequestStartedObserver(requestStart)

    resetChatProviderRuntimeExtensionsForTesting()

    expect(getChatSendSettledObserver()).toBeUndefined()
    notifyChatSendSettled(settled)
    expect(send).not.toHaveBeenCalled()
    expect(round).not.toHaveBeenCalled()
    expect(requestStart).not.toHaveBeenCalled()
  })

  it('f: a throwing observer is isolated at the seam - one attempt, nothing escapes', () => {
    const observer = vi.fn(() => {
      throw new Error('observer exploded')
    })
    registerChatSendSettledObserver(observer)

    expect(() => notifyChatSendSettled(settled)).not.toThrow()
    expect(notifyChatSendSettled({ outcome: 'failed' })).toBeUndefined()
    // Exactly one attempt per notification: no retry, no second call.
    expect(observer).toHaveBeenCalledTimes(2)

    const later = vi.fn()
    registerChatSendSettledObserver(later)
    notifyChatSendSettled(settled)
    expect(later).toHaveBeenCalledTimes(1)
  })

  it('g: an absent correlationId stays absent, and a present one is never filtered', () => {
    const captured: ChatSendSettledObservation[] = []
    registerChatSendSettledObserver(observation => captured.push(observation))

    notifyChatSendSettled({ outcome: 'failed' })
    expect(captured).toEqual([{ outcome: 'failed' }])
    expect('correlationId' in (captured[0] as object)).toBe(false)

    // The generic seam applies no "usable key" rule of its own: even an empty or
    // whitespace-only key crosses verbatim - filtering is a consumer's job.
    for (const correlationId of ['', '   ', 'logical-send-7']) {
      const observation = { correlationId, outcome: 'succeeded' as const }
      notifyChatSendSettled(observation)
      expect(captured.at(-1)).toBe(observation)
      expect(captured.at(-1)?.correlationId).toBe(correlationId)
      expect(Object.keys(captured.at(-1) as object).sort()).toEqual(['correlationId', 'outcome'])
    }
  })

  it('h: the observation is exactly the three contract fields and the outcome is either literal', () => {
    // Three fields: optional join key, required outcome, optional factual initialRouteOverride - and nothing
    // about the send's round, attempt, provider, model, error or timing.
    expect(DECLARATION_REGION.match(/^\s{2}(?:readonly )?(\w+)\??:/gm)?.map(field => field.trim()))
      .toEqual(['correlationId?:', 'outcome:', 'initialRouteOverride?:'])
    expect(DECLARATION_REGION).toContain(`export type ChatSendOutcome = 'succeeded' | 'failed'`)
    // No third settlement value may creep in as a cast or an alias.
    expect(DECLARATION_REGION).not.toMatch(/abandoned|cancelled|superseded|completed|fallbackExhausted|unknown|any/i)

    // Both literals cross the seam unchanged, in both key shapes.
    const captured: ChatSendSettledObservation[] = []
    registerChatSendSettledObserver(observation => captured.push(observation))
    notifyChatSendSettled({ outcome: 'succeeded' })
    notifyChatSendSettled({ outcome: 'failed' })
    notifyChatSendSettled({ correlationId: 'logical-send-1', outcome: 'succeeded' })
    notifyChatSendSettled({ correlationId: 'logical-send-1', outcome: 'failed' })
    expect(captured.map(observation => observation.outcome)).toEqual([
      'succeeded',
      'failed',
      'succeeded',
      'failed',
    ])
  })

  it('i: the seam owns one slot, one notifier and no state of its own', () => {
    // Exactly one slot, assigned exactly once, read exactly once.
    expect(CODE.match(/^let chatSendSettledObserver:/m)).toHaveLength(1)
    expect(CODE.match(/chatSendSettledObserver = observer/g)).toHaveLength(1)
    expect(CODE.match(/const observer = chatSendSettledObserver/g)).toHaveLength(1)
    // Exactly one implementation of each of the three entry points.
    expect(CODE.match(/export function notifyChatSendSettled/g)).toHaveLength(1)
    expect(CODE.match(/export function registerChatSendSettledObserver/g)).toHaveLength(1)
    expect(CODE.match(/export function getChatSendSettledObserver/g)).toHaveLength(1)

    // No state collections, history or caching in the notifier.
    expect(SEND_REGION).not.toMatch(/\bnew Map\b|\bnew Set\b|\bhistory\b|lastOutcome|\bcache\b|\bqueue\b|\bbuffer\b/)
    // No second observer framework: no array of subscribers anywhere.
    expect(CODE).not.toMatch(/SendObservers\b|subscribers|listeners\.push|\.subscribe\(/)
    // No async, timers or retries.
    expect(SEND_REGION).not.toMatch(/\basync\b|\bawait\b|Promise|queueMicrotask|setTimeout|setInterval|retry/i)
    // No foreign capability and no diagnostics output.
    expect(SEND_REGION).not.toMatch(/eventa|electron|ipcMain|ipcRenderer|BrowserWindow|main-process/i)
    expect(SEND_REGION).not.toMatch(/\bBrain\b|LiaBrain|lia-brain|correlation-store|providerStore|providersStore/i)
    expect(SEND_REGION).not.toMatch(/console\.|@guiiai\/logg|logger|telemetry|posthog/i)
    // No aggregate/verdict vocabulary, in any casing.
    expect(SEND_REGION).not.toMatch(/winner|finalAttempt|firstAttempt|anyAttempt|fallbackObserved|fallbackCount|routeMatch|mismatch|divergence|aligned|verdict|score|recommendation/i)
    // No execution authority.
    expect(SEND_REGION).not.toMatch(/setProvider|setModel|activeProvider|activeModel|resolver|permission|toolCall|cancel/i)
    // The two siblings are still the untouched seams.
    expect(CODE).toContain('export function notifyChatRoundSettled(observation: ChatRoundSettledObservation): void {')
    expect(CODE).toContain('export function notifyChatRequestStarted(observation: ChatRequestStartedObservation): void {')
  })

  it('j: the seam has exactly ONE production registration, and one notification site', () => {
    const airiRoot = fileURLToPath(new URL('../../../../..', import.meta.url))
    const roots = ['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src']
    const registrarSites: string[] = []
    const notifySites: string[] = []
    for (const root of roots) {
      for (const entry of readdirSync(join(airiRoot, root), { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.'))
          continue
        const file = join(entry.parentPath, entry.name)
        const source = normalizeLineEndings(readFileSync(file, 'utf-8'))
        const site = relative(airiRoot, file).replace(/\\/g, '/')
        // The registration SIGNAL: CALLING the installer, never defining it.
        if (/(?<!function )registerChatSendSettledObserver\(/.test(source))
          registrarSites.push(site)
        if (/(?<!function )notifyChatSendSettled\(/.test(source))
          notifySites.push(site)
      }
    }

    // B1 shipped this seam with ZERO production consumers; 8.0D-10B-4D4C4-B2
    // evolves that allowlist honestly to exactly ONE - the Lia send-terminal
    // reporter - and no other layer installs an observer of its own.
    expect(registrarSites).toEqual(['apps/stage-tamagotchi/src/renderer/services/lia/send-terminal-reporter.ts'])
    // Exactly one notification site, and it is the Stage send owner.
    expect(notifySites).toEqual(['packages/stage-ui/src/stores/chat.ts'])
  })

  it('k: the wrapper is the only caller of executeSend, with exactly the two send entry points', () => {
    const chatSource = normalizeLineEndings(readFileSync(new URL('../chat.ts', import.meta.url), 'utf-8'))
    const chatCode = chatSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    // One textual notification site in the store, reached by both settlements.
    expect(chatCode.match(/(?<!function )notifyChatSendSettled\(/g)).toHaveLength(1)
    // `executeSend` runs only through the wrapper: one call site, not two.
    expect(chatCode.match(/(?<!function )executeSend\(/g)).toHaveLength(1)
    // The wrapper has exactly the two logical-send entry points as callers.
    expect(chatCode.match(/(?<!function )executeSettledSend\(/g)).toHaveLength(2)
    // Its notification happens before the pre-existing error bubble.
    const wrapperRegion = chatCode.slice(
      chatCode.indexOf('async function executeSettledSend'),
      chatCode.indexOf('async function send'),
    )
    expect(wrapperRegion.indexOf('settle(\'failed\')')).toBeLessThan(wrapperRegion.indexOf('appendSendError('))
    // The whole fallback loop is inside the settlement boundary: the wrapper
    // awaits `executeSend` as a whole and inspects nothing about the failure.
    expect(wrapperRegion).toContain('await executeSend(payload)')
    // The wrapper inspects nothing about the failure. D2B7's route observability
    // legitimately names the request-side override fields, so those two are pinned
    // by their own contract assertion below instead of being banned here.
    expect(wrapperRegion).not.toMatch(/instanceof|errorMessageFrom|fallbackResolver|attempt|roundId/)
    // D2B7: the only route identity the wrapper may touch is the caller-supplied
    // override, copied field-by-field (providerId/modelId) and never derived from
    // the settled outcome or the result.
    expect(wrapperRegion).toMatch(/const initialRouteOverride = payload\.routeOverride === undefined[\s\S]*?providerId: payload\.routeOverride\.providerId,[\s\S]*?modelId: payload\.routeOverride\.modelId,/)
    expect(wrapperRegion).not.toMatch(/(outcome|result)\.(providerId|modelId)/)
    // The failure settlement is UNCONDITIONAL: any rejection of the whole send -
    // including one thrown by the fallback resolver or by the restore work that
    // `executeSend` runs in its own finally - settles as failed. Nothing about
    // the rejection is inspected to decide that, so no failure kind can escape
    // the seam or be reported twice.
    expect(wrapperRegion).toMatch(/catch \(error\) \{\s*settle\('failed'\)/)
    // Result and error keep their identity: nothing is cloned, spread or wrapped.
    expect(wrapperRegion).toContain('return result')
    expect(wrapperRegion).toContain('throw error')
    expect(wrapperRegion).not.toMatch(/structuredClone|toRaw|\.\.\.result|\.\.\.error/)
  })
})
