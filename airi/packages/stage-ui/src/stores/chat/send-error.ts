/**
 * Phase 7.3, provider-error UX (QA item 10 + test K).
 *
 * A provider auth failure used to reach the chat bubble as the raw transport
 * text ("Remote sent 401 response: {"error":…}"). That text is diagnostics,
 * not communication. This module maps KNOWN failure kinds to one human
 * message while the raw error ALWAYS keeps going to the diagnostic log
 * (console) - the two audiences get the two texts they need.
 */

/** Recognized failure kinds with a human-facing mapping. */
export type HumanizedSendError
  = | { humanText: string, kind: 'auth-failure' }
    | { humanText: string, kind: 'other' }

const AUTH_PATTERNS = [
  /\b401\b/,
  /\binvalid[_\s-]?api[_\s-]?key\b/i,
  /\binvalid_api_key\b/i,
  /\bunauthorized\b/i,
  /\bauthentication (failed|error)/i,
]

/** Pure classifier: is this an authentication/credential failure? */
export function isAuthSendError(message: string): boolean {
  return AUTH_PATTERNS.some(pattern => pattern.test(message))
}

/**
 * The human-facing text for a send error. `authHint` lets hosts brand the
 * repair path ("check the provider key in the Lia Settings"); `fallback` is
 * the previous raw behaviour for anything we do not recognize.
 */
export function humanizeSendErrorMessage(
  message: string,
  options: { authHint: string, fallback: string },
): HumanizedSendError {
  if (isAuthSendError(message)) {
    return {
      humanText: `Couldn't authenticate the AI. Check the provider API key in ${options.authHint}.`,
      kind: 'auth-failure',
    }
  }
  return { humanText: message || options.fallback, kind: 'other' }
}
