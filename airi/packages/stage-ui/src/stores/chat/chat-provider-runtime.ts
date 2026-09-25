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

let providerCredentialResolver: ProviderCredentialResolver | undefined
let chatFallbackResolver: ChatFallbackResolver | undefined
let chatRequestStartedObserver: ChatRequestStartedObserver | undefined

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

export function getProviderCredentialResolver(): ProviderCredentialResolver | undefined {
  return providerCredentialResolver
}

export function getChatFallbackResolver(): ChatFallbackResolver | undefined {
  return chatFallbackResolver
}

export function getChatRequestStartedObserver(): ChatRequestStartedObserver | undefined {
  return chatRequestStartedObserver
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

export function resetChatProviderRuntimeExtensionsForTesting(): void {
  providerCredentialResolver = undefined
  chatFallbackResolver = undefined
  chatRequestStartedObserver = undefined
}
