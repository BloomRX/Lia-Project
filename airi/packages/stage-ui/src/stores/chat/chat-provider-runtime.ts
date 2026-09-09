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

let providerCredentialResolver: ProviderCredentialResolver | undefined
let chatFallbackResolver: ChatFallbackResolver | undefined

/** Hard ceiling on total attempts per message (primary + fallbacks). */
export const CHAT_FALLBACK_MAX_ATTEMPTS = 4

export function registerProviderCredentialResolver(resolver?: ProviderCredentialResolver): void {
  providerCredentialResolver = resolver
}

export function registerChatFallbackResolver(resolver?: ChatFallbackResolver): void {
  chatFallbackResolver = resolver
}

export function getProviderCredentialResolver(): ProviderCredentialResolver | undefined {
  return providerCredentialResolver
}

export function getChatFallbackResolver(): ChatFallbackResolver | undefined {
  return chatFallbackResolver
}

export function resetChatProviderRuntimeExtensionsForTesting(): void {
  providerCredentialResolver = undefined
  chatFallbackResolver = undefined
}
