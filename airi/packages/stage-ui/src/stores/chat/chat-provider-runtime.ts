import type { ChatRoundSettledObservation } from '@proj-airi/core-agent'

/**
 * Optional, inert-by-default runtime extensions for provider-backed chat.
 *
 * (M1 Phase 4C) The Lia desktop app configures a *secure* provider credential
 * (stored in the Electron main process via safeStorage) and an ordered set of
 * chat providers to fail over to. Neither concept belongs to the shared,
 * Electron-free provider/chat runtime, so this module exposes a single pair of
 * **optional** registration points:
 *
 * - {@link registerProviderCredentialResolver}: supplies per-use credentials
 *   (e.g. `apiKey`) when building a provider instance, instead of them living in
 *   renderer localStorage. The returned value stays in memory for one provider
 *   build; it is never persisted and never logged.
 * - {@link registerChatFallbackResolver}: decides, after a *recoverable* send
 *   failure, whether to retry the same message with another provider/model.
 * - {@link registerChatRequestStartedObserver}: observes that one LLM request
 *   is starting, with the provider/model identity resolved for that attempt.
 *   Notification only - it can neither choose nor alter execution.
 * - {@link registerChatRoundSettledObserver}: observes the factual terminal
 *   treatment of a round that already entered the send body (`succeeded`,
 *   `failed`, `abandoned`, as the Core runtime defined them). Same convention,
 *   same single slot, same isolation - and equally unable to influence it.
 * - {@link registerChatSendSettledObserver}: observes the factual settlement of
 *   ONE logical chat send as a whole (`succeeded`/`failed`) - the entire
 *   send/retry invocation, not one round and not one attempt. Same convention,
 *   same single slot, same isolation - and equally unable to influence it.
 *
 * Nothing is imported from Electron here. Without any registration every
 * consumer (web, pocket, …) behaves exactly as before — these hooks are purely
 * opt-in by the Electron Lia desktop.
 */

/** One provider/model target a chat send may be (re)routed to. */
export interface ChatProviderCandidate {
  providerId: string
  modelId?: string
}

/**
 * Returns per-use credentials (e.g. `{ apiKey: '…' }`) to merge into a
 * provider config at instance-build time. Returning `undefined` leaves the
 * config untouched. Values are held in memory only for the current build.
 */
export type ProviderCredentialResolver = (
  providerId: string,
) => Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined

/** Context describing a failed chat send that a fallback policy may act on. */
export interface ChatFallbackContext {
  /** The error thrown by the send attempt. */
  error: unknown
  /** Provider that was active when the attempt failed. */
  providerId?: string
  /** Model that was active when the attempt failed. */
  modelId?: string
  /** 0-based index of the failed attempt within this message's lifecycle. */
  attemptIndex: number
}

/**
 * Given a failed send, returns the next provider/model to try, or `undefined`
 * to stop (no more attempts). The policy owns recoverability, ordering and the
 * enabled/disabled switch; the runtime only applies a hard ceiling.
 */
export type ChatFallbackResolver = (
  ctx: ChatFallbackContext,
) => ChatProviderCandidate | undefined | Promise<ChatProviderCandidate | undefined>

/**
 * Phase 8.0D-10B-2: the smallest generic observation of one LLM request start.
 *
 * Plain metadata only - the identity the runtime resolved for THIS attempt
 * plus its existing round correlation. No provider object, no request body, no
 * prompt/messages, no headers, no credential, no endpoint: an observer can
 * describe which provider/model ran, and nothing else.
 */
export interface ChatRequestStartedObservation {
  /**
   * Phase 8.0D-10B-3B1: opaque key of the logical send this attempt belongs to,
   * when the caller supplied one. Every attempt of one send reports the same
   * value; callers that carry none leave it absent. It is a join key only -
   * never a provider/model/route identity.
   */
  correlationId?: string
  /** Application conversation that owns the round. */
  conversationId: string
  /** Stable round key of the attempt about to reach the provider. */
  roundId: string
  /** Provider id that executes this attempt. */
  providerId: string
  /** Model id that executes this attempt. */
  modelId: string
}

/**
 * Observes that an LLM request is starting. Return value is ignored: this is a
 * notification, never a decision - it cannot supply a provider/model, pick a
 * retry target, cancel the request or transform it.
 */
export type ChatRequestStartedObserver = (observation: ChatRequestStartedObservation) => void

/**
 * Phase 8.0D-10B-4D4B2: observes the factual terminal treatment of ONE Core
 * Agent round.
 *
 * The observation is consumed by TYPE-ONLY import from `@proj-airi/core-agent`:
 * this module is a transport seam, not a second owner of that contract, and it
 * re-declares neither the outcome union nor the payload. The return value is
 * ignored - this is a notification, never a decision, and it can neither pick a
 * provider/model, drive fallback, retry a send nor change a Brain decision.
 */
export type ChatRoundSettledObserver = (observation: ChatRoundSettledObservation) => void

/**
 * Phase 8.0D-10B-4D4C4-B1: how ONE logical chat send ended.
 *
 * The send is the whole `send`/`retry` invocation - every provider attempt the
 * fallback policy ran inside it, plus its own rollback/restore work - never one
 * Core Agent round. There is no third value and no derived one: a logical send
 * either resolved (`succeeded`) or rejected (`failed`).
 */
export type ChatSendOutcome = 'succeeded' | 'failed'

/**
 * Phase 8.0D-10B-4D4C4-B1: the smallest generic observation of one settled
 * logical chat send.
 *
 * Plain outcome metadata only. `correlationId` is the opaque key the caller
 * carried on the send payload: forwarded verbatim when it was present and left
 * absent when it was not - this generic transport seam applies no filtering of
 * its own (the "usable key" rule belongs to a consumer). No round, attempt,
 * provider, model, error, message, timing, fallback or verdict travels here.
 */
export interface ChatSendSettledObservation {
  /**
   * Opaque key of the logical send this settlement belongs to, when the caller
   * supplied one. It is a join key only - never a provider/model/route identity.
   */
  correlationId?: string
  /** Factual settlement of the logical send as a whole. */
  outcome: ChatSendOutcome
}

/**
 * Observes that one logical chat send settled. Return value is ignored: this is
 * a notification, never a decision - it cannot supply a provider/model, pick a
 * retry target, drive fallback, cancel a send or transform it.
 */
export type ChatSendSettledObserver = (observation: ChatSendSettledObservation) => void

let providerCredentialResolver: ProviderCredentialResolver | undefined
let chatFallbackResolver: ChatFallbackResolver | undefined
let chatRequestStartedObserver: ChatRequestStartedObserver | undefined
let chatRoundSettledObserver: ChatRoundSettledObserver | undefined
let chatSendSettledObserver: ChatSendSettledObserver | undefined

/** Hard ceiling on total attempts per message (primary + fallbacks). */
export const CHAT_FALLBACK_MAX_ATTEMPTS = 4

export function registerProviderCredentialResolver(resolver?: ProviderCredentialResolver): void {
  providerCredentialResolver = resolver
}

export function registerChatFallbackResolver(resolver?: ChatFallbackResolver): void {
  chatFallbackResolver = resolver
}

/**
 * Installs (or with `undefined` clears) the single request-start observer.
 * Registration alone does nothing: the observer only ever runs when the
 * runtime reports that a request is starting.
 */
export function registerChatRequestStartedObserver(observer?: ChatRequestStartedObserver): void {
  chatRequestStartedObserver = observer
}

/**
 * Installs (or with `undefined` clears) the single round-settled observer.
 * Exactly the request-start convention: one slot, replacement on re-register,
 * no disposer, no multiple subscribers. Registration alone observes nothing -
 * the observer only ever runs when the runtime reports a settled round.
 */
export function registerChatRoundSettledObserver(observer?: ChatRoundSettledObserver): void {
  chatRoundSettledObserver = observer
}

/**
 * Installs (or with `undefined` clears) the single logical-send-settled
 * observer. Exactly the same convention as its two siblings: one slot,
 * replacement on re-register, no disposer, no multiple subscribers.
 * Registration alone observes nothing - the observer only ever runs when a
 * logical send actually settles.
 */
export function registerChatSendSettledObserver(observer?: ChatSendSettledObserver): void {
  chatSendSettledObserver = observer
}

export function getProviderCredentialResolver(): ProviderCredentialResolver | undefined {
  return providerCredentialResolver
}

export function getChatFallbackResolver(): ChatFallbackResolver | undefined {
  return chatFallbackResolver
}

export function getChatRequestStartedObserver(): ChatRequestStartedObserver | undefined {
  return chatRequestStartedObserver
}

export function getChatRoundSettledObserver(): ChatRoundSettledObserver | undefined {
  return chatRoundSettledObserver
}

export function getChatSendSettledObserver(): ChatSendSettledObserver | undefined {
  return chatSendSettledObserver
}

/**
 * Forwards one request-start observation to the registered observer, if any.
 *
 * Failure isolation: an observer is diagnostic, so a throwing observer is
 * swallowed right here - execution continues, nothing is retried, no fallback
 * is triggered and no error reaches the chat. The observation object is passed
 * through untouched (no defaults are applied); with no observer registered this
 * is a no-op.
 */
export function notifyChatRequestStarted(observation: ChatRequestStartedObservation): void {
  const observer = chatRequestStartedObserver
  if (!observer)
    return

  try {
    observer(observation)
  }
  catch {
    // Downstream-only: an observer must never be able to break a send.
  }
}

/**
 * Forwards one settled-round observation to the registered observer, if any.
 *
 * Same isolation contract as the request-start notification: the SAME
 * observation object is forwarded verbatim (a missing `correlationId` stays
 * missing - this generic seam applies no filtering of its own), exactly once,
 * synchronously, and a throwing observer is swallowed right here so it cannot
 * change whether a send succeeded or failed, cannot trigger a retry, and cannot
 * reach a fallback decision.
 */
export function notifyChatRoundSettled(observation: ChatRoundSettledObservation): void {
  const observer = chatRoundSettledObserver
  if (!observer)
    return

  try {
    observer(observation)
  }
  catch {
    // Downstream-only: an observer must never be able to break a send.
  }
}

/**
 * Forwards one settled-logical-send observation to the registered observer, if
 * any.
 *
 * Same isolation contract as its two siblings: the SAME observation object is
 * forwarded verbatim (a missing `correlationId` stays missing - this generic
 * seam applies no filtering of its own), exactly once per settlement,
 * synchronously, and a throwing observer is swallowed right here so it cannot
 * change whether a send succeeded or failed, cannot trigger a retry, and cannot
 * reach a fallback decision. With no observer registered this is a no-op.
 */
export function notifyChatSendSettled(observation: ChatSendSettledObservation): void {
  const observer = chatSendSettledObserver
  if (!observer)
    return

  try {
    observer(observation)
  }
  catch {
    // Downstream-only: an observer must never be able to break a send.
  }
}

export function resetChatProviderRuntimeExtensionsForTesting(): void {
  providerCredentialResolver = undefined
  chatFallbackResolver = undefined
  chatRequestStartedObserver = undefined
  chatRoundSettledObserver = undefined
  chatSendSettledObserver = undefined
}
