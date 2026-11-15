/**
 * Safe, canonical content for persisted errors; transport payloads never belong in chat.
 * Keep these strings as stable persistence aliases when changing display translations.
 */
const SAFE_SEND_ERRORS = {
  'auth-failure': 'The AI service could not verify access. Check your connection settings and try again.',
  'permission-failure': 'Access to the AI service was denied. Check your connection settings and try again.',
  'input-limit': 'This conversation or its attachments are too large. Start a new conversation or use fewer, smaller images.',
  'quota': 'The AI service has reached its usage limit. Wait a moment and try again, or check the service limits in settings.',
  'network': 'Could not reach the AI service. Check your connection and try again.',
  'service-unavailable': 'The AI service is temporarily unavailable. Wait a moment and try again.',
  'empty-response': 'The AI service finished without sending a response. Try again.',
  'other': 'Could not send your message. Try again. If the problem continues, check your connection settings.',
} as const

export type SendErrorKind = keyof typeof SAFE_SEND_ERRORS

export interface HumanizedSendError {
  humanText: string
  kind: SendErrorKind
}

function transportStatus(message: string): number | undefined {
  // Status belongs to the transport envelope, never an arbitrary number in its body.
  const envelope = message.trimStart().replace(/^Error:\s*/i, '')
  const remoteStatus = envelope.match(/^Remote sent ([1-5]\d{2}) response\b/i)
  if (remoteStatus)
    return Number(remoteStatus[1])

  const prefix = envelope.match(/^(?:Request failed with )?(?:HTTP(?:\/\d(?:\.\d)?)?|status(?: code)?)\b/i)
  if (prefix) {
    let statusText = envelope.slice(prefix[0].length).trimStart()
    if (statusText.startsWith(':') || statusText.startsWith('='))
      statusText = statusText.slice(1).trimStart()
    const status = statusText.match(/^([1-5]\d{2})\b/)
    if (status)
      return Number(status[1])
  }

  try {
    const parsed = JSON.parse(message)
    const status = parsed?.status ?? parsed?.statusCode ?? parsed?.error?.status ?? parsed?.error?.statusCode
    if ((typeof status === 'number' || typeof status === 'string') && /^[1-5]\d{2}$/.test(String(status)))
      return Number(status)
  }
  catch {
    // Most transport errors are plain text rather than JSON.
  }
}

function classifySendError(message: string): SendErrorKind {
  // Safe persisted content is idempotent and can be localized after a restart.
  for (const [kind, text] of Object.entries(SAFE_SEND_ERRORS)) {
    if (message === text)
      return kind as SendErrorKind
  }
  if (message === 'O serviço de IA terminou sem enviar uma resposta. Tente novamente.')
    return 'empty-response'

  const status = transportStatus(message)
  if (status === 401)
    return 'auth-failure'
  if (status === 403)
    return 'permission-failure'
  if (status === 413)
    return 'input-limit'
  if (status === 429)
    return 'quota'
  if (status !== undefined && status >= 500 && status <= 599)
    return 'service-unavailable'

  if (/\b(?:invalid[_\s-]?api[_\s-]?key|unauthorized|authentication (?:failed|error))\b/i.test(message))
    return 'auth-failure'
  if (/\b(?:failed to fetch|network(?:error| error)|socket timeout|timed? out|timeout|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT)\b/i.test(message))
    return 'network'

  return 'other'
}

export function isAuthSendError(message: string): boolean {
  return classifySendError(message) === 'auth-failure'
}

/** Unknown and legacy payloads are replaced wholesale, never redacted piecemeal. */
export function humanizeSendErrorMessage(
  message: string,
  options: { translate?: (key: string) => string } = {},
): HumanizedSendError {
  const kind = classifySendError(message)
  const fallback = SAFE_SEND_ERRORS[kind]
  const key = `stage.chat.errors.${kind}`
  try {
    const translated = options.translate?.(key)
    return { humanText: translated && translated !== key ? translated : fallback, kind }
  }
  catch {
    return { humanText: fallback, kind }
  }
}
