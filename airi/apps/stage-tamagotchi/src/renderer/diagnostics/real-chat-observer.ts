/**
 * TEMPORARY, READ-ONLY diagnostic: captures the real outgoing chat request.
 *
 * Purpose: the provider diagnostic reported a healthy credential chain
 * (DIAG_STATUS=PASS) while the real app still returns 401. This observer sits
 * on `globalThis.fetch` inside the renderer - the closest point to the wire
 * that does not require touching provider or chat behaviour - and records only
 * metadata about each request the real chat path performs.
 *
 * It never prints an API key, an Authorization value, a full header map, or a
 * request body. It changes nothing: the wrapped fetch forwards every argument
 * untouched and returns the original response, and response bodies are only
 * read (from a clone) when the response already failed, so streaming replies
 * are not buffered or altered.
 *
 * Remove this file and its single import in `main.ts` once the 401 is located.
 */

/** One observed request. Values are metadata only. */
export interface ObservedRequest {
  index: number
  /** Host-based inference; the URL is the wire truth, not app state. */
  providerId: string
  /** Read from the outgoing JSON body's `model` field. */
  modelId: string | null
  /** Wire value of `reasoning_effort`, exactly as sent to the provider. */
  reasoningEffort: string | null
  endpoint: string
  host: string
  path: string
  method: string
  hasAuthorizationHeader: boolean
  authorizationHeaderLength: number
  requestStarted: boolean
  /** How many tools this request sent; null when the body carried none. */
  toolCount: number | null
  /** The outgoing `messages` array, reduced to safe metadata. */
  messages: ObservedMessage[]
  /** True for chat-completions calls, as opposed to a `/models` probe. */
  isChatRequest: boolean
  responseStatus: number | null
  responseOk: boolean | null
  /** The provider's own error text, verbatim apart from secret redaction. */
  rawHttpErrorMessage: string | null
  failed: boolean
  failureKind: string | null
}

/** One message of the outgoing `messages` array, reduced to safe metadata. */
export interface ObservedMessage {
  index: number
  role: string
  /** Length of the flattened text content. */
  size: number
  /** First ~300 characters, secrets redacted. */
  head: string
  /** Last ~200 characters, secrets redacted. */
  tail: string
  /** Which persona markers this message carries. */
  markers: string[]
}

export interface RealChatReport {
  status: 'PASS' | 'FAIL'
  provider: string
  model: string
  instanceCredential: boolean
  requestCount: number
  assistantResponseReceived: boolean
  first401Endpoint: string | null
  requests: ObservedRequest[]
}

const KNOWN_HOSTS: Record<string, string> = {
  'api.openai.com': 'openai',
  'api.groq.com': 'groq',
  'openrouter.ai': 'openrouter-ai',
  'api.openrouter.ai': 'openrouter-ai',
  'api.together.xyz': 'together-ai',
  'api.mistral.ai': 'mistral-ai',
  'api.x.ai': 'xai',
  'api.deepseek.com': 'deepseek',
  'generativelanguage.googleapis.com': 'google-generative-ai',
  'api.anthropic.com': 'anthropic',
  'api.fireworks.ai': 'fireworks-ai',
  'api.cerebras.ai': 'cerebras-ai',
  'integrate.api.nvidia.com': 'nvidia',
  'api.featherless.ai': 'featherless-ai',
  'api.novita.ai': 'novita-ai',
  'api.moonshot.ai': 'moonshot-ai',
  'api.minimax.io': 'minimax',
  'api-inference.modelscope.cn': 'modelscope',
  'ark.cn-beijing.volces.com': 'ark',
  'api.302.ai': '302-ai',
}

/** Maps a request host to the provider id that owns it. */
export function providerIdFromHost(host: string): string {
  if (KNOWN_HOSTS[host])
    return KNOWN_HOSTS[host]
  return host || 'unknown'
}

/** True for hosts that are plausibly an LLM API rather than app telemetry. */
export function isCandidateRequest(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  }
  catch {
    return false
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    return false

  const host = parsed.hostname
  // Never observe the dev server, HMR socket, or local Electron assets.
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.local'))
    return false

  return host in KNOWN_HOSTS || parsed.pathname.includes('/v1/') || parsed.pathname.includes('/models')
}

/** Strips anything that could be a credential from a server message. */
export function sanitizeResponseMessage(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0)
    return null

  // A bearer token is a long opaque run that almost always contains a digit.
  // Requiring that keeps ordinary prose - including the very common
  // "Missing bearer authentication in header" - readable instead of redacting
  // the evidence we are trying to collect.
  const isTokenLike = (value: string) => value.length >= 20 && /\d/.test(value)

  const redacted = raw
    .replace(/Bearer\s+([\w.~+/=-]+)/gi, (match, token: string) => (isTokenLike(token) ? 'Bearer [REDACTED]' : match))
    .replace(/\b(?:sk|gsk|pk|rk|key)-[\w-]{8,}\b/gi, '[REDACTED_KEY]')
    // Long opaque runs are almost always a secret echoed back.
    .replace(/\b[\w-]{32,}\b/g, (match: string) => (/\d/.test(match) ? '[REDACTED_TOKEN]' : match))

  return redacted.length > 240 ? `${redacted.slice(0, 240)}…` : redacted
}

/** Pulls only `error.message` / `error.code` out of a failed JSON body. */
export function extractErrorMessage(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: unknown, code?: unknown }
      message?: unknown
    }
    const message = parsed?.error?.message ?? parsed?.message
    const code = parsed?.error?.code
    const parts = [
      typeof message === 'string' ? message : null,
      typeof code === 'string' ? `code=${code}` : null,
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(' ') : null
  }
  catch {
    // A non-JSON error body still carries useful text.
    return text.length > 0 ? text : null
  }
}

/**
 * Reads the wire `reasoning_effort` out of an outgoing JSON body.
 *
 * At this point the body has already been serialized by `@xsai/shared`'s
 * `requestBody`, so the key is snake_case - this is the value the provider
 * actually receives, not the camelCase one held in memory.
 */
export function readReasoningEffortFromBody(body: unknown): string | null {
  if (typeof body !== 'string' || body.length === 0)
    return null
  try {
    const parsed = JSON.parse(body) as { reasoning_effort?: unknown }
    return typeof parsed?.reasoning_effort === 'string' ? parsed.reasoning_effort : null
  }
  catch {
    return null
  }
}

/** Counts the tools on an outgoing request without keeping the body. */
export function readToolCountFromBody(body: unknown): number | null {
  if (typeof body !== 'string' || body.length === 0)
    return null
  try {
    const parsed = JSON.parse(body) as { tools?: unknown }
    return Array.isArray(parsed?.tools) ? parsed.tools.length : null
  }
  catch {
    return null
  }
}

/**
 * Markers whose presence in the outgoing prompt answers "is the persona
 * actually in this request, and where". `<|ACT` rather than `ACT` so ordinary
 * prose does not match the stage token.
 */
const PERSONA_MARKERS: ReadonlyArray<readonly [needle: string, label: string]> = [
  ['Lia', 'LIA'],
  ['pt-BR', 'PTBR'],
  ['tsundere', 'TSUNDERE'],
  ['Idioma', 'IDIOMA'],
  ['<|ACT', 'ACT_TOKEN'],
  ['systemPrompt', 'SYSTEMPROMPT'],
  ['personality', 'PERSONALITY'],
  ['description', 'DESCRIPTION'],
  ['scenario', 'SCENARIO'],
]

/**
 * English meta-commentary that must never reach the user. Its presence in the
 * prompt is what makes a model narrate its own rules instead of acting.
 */
const META_INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /the assistant should/i,
  /according to (the )?(guidelines|instructions|rules)/i,
  /user says/i,
  /as an ai/i,
  /\bthe model should\b/i,
  /\byou are an? (ai|assistant) that/i,
]

/** Flattens the string-or-parts content shape into plain text. */
function flattenMessageContent(content: unknown): string {
  if (typeof content === 'string')
    return content
  if (Array.isArray(content)) {
    return content
      .map(part => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : ''))
      .join('\n')
  }
  return ''
}

/**
 * Reduces the outgoing `messages` array to roles, sizes and short redacted
 * excerpts. The full text is never retained, and no header or credential is
 * read here - only the `messages` key of the request body.
 */
export function readMessagesFromBody(body: unknown): ObservedMessage[] {
  if (typeof body !== 'string' || body.length === 0)
    return []

  let parsed: { messages?: unknown }
  try {
    parsed = JSON.parse(body) as { messages?: unknown }
  }
  catch {
    return []
  }

  if (!Array.isArray(parsed?.messages))
    return []

  return parsed.messages.map((raw: unknown, index: number) => {
    const message = (raw && typeof raw === 'object' ? raw : {}) as { role?: unknown, content?: unknown }
    const role = typeof message.role === 'string' ? message.role : 'unknown'
    const text = flattenMessageContent(message.content)

    // Only the instruction roles get an excerpt. The user's own words and the
    // assistant's earlier replies are personal content, not diagnostics: the
    // question is what instructions precede the user message, and echoing the
    // conversation back into a console log would trade one leak for another.
    const isInstructionRole = role === 'system' || role === 'developer'
    const redacted = isInstructionRole ? (sanitizeResponseMessage(text) ?? '') : ''

    return {
      index: index + 1,
      role,
      size: text.length,
      head: redacted.slice(0, 300),
      tail: redacted.length > 300 ? redacted.slice(-200) : '',
      markers: PERSONA_MARKERS.filter(([needle]) => text.includes(needle)).map(([, label]) => label),
    }
  })
}

/** True when a message narrates its own instructions instead of acting. */
export function hasMetaInstructionText(text: string): boolean {
  return META_INSTRUCTION_PATTERNS.some(pattern => pattern.test(text))
}

export interface MessageSummary {
  systemCount: number
  developerCount: number
  userCount: number
  assistantCount: number
  personaPresent: boolean
  languagePtBrPresent: boolean
  identityLiaPresent: boolean
  metaInstructionPresent: boolean
  /** Index of the last message carrying persona markers, for ordering checks. */
  lastPersonaMessageIndex: number | null
}

/** Rolls the per-message digest up into the requested presence flags. */
export function summarizeMessages(messages: ObservedMessage[]): MessageSummary {
  const countRole = (role: string) => messages.filter(message => message.role === role).length
  const anyMarker = (label: string) => messages.some(message => message.markers.includes(label))
  const personaIndexes = messages.filter(message => message.markers.length > 0).map(message => message.index)

  return {
    systemCount: countRole('system'),
    developerCount: countRole('developer'),
    userCount: countRole('user'),
    assistantCount: countRole('assistant'),
    personaPresent: anyMarker('TSUNDERE') || anyMarker('IDIOMA') || anyMarker('PERSONALITY'),
    languagePtBrPresent: anyMarker('PTBR'),
    identityLiaPresent: anyMarker('LIA'),
    metaInstructionPresent: messages.some(message => hasMetaInstructionText(`${message.head}\n${message.tail}`)),
    lastPersonaMessageIndex: personaIndexes.length > 0 ? Math.max(...personaIndexes) : null,
  }
}

/** True for the endpoints that actually carry a chat completion. */
export function isChatEndpoint(path: string): boolean {
  return path.endsWith('/chat/completions') || path.endsWith('/completions')
}

/** Reads an Authorization header from any of the three fetch header shapes. */
export function readAuthorizationLength(headers: unknown): number {
  const get = (name: string): string | null => {
    if (!headers)
      return null
    if (typeof (headers as Headers).get === 'function')
      return (headers as Headers).get(name)
    if (Array.isArray(headers)) {
      const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase())
      return found ? String(found[1]) : null
    }
    if (typeof headers === 'object') {
      const entry = Object.entries(headers as Record<string, unknown>)
        .find(([key]) => key.toLowerCase() === name.toLowerCase())
      return entry ? String(entry[1]) : null
    }
    return null
  }

  const value = get('authorization') ?? get('x-api-key') ?? get('api-key')
  return value ? value.length : 0
}

/** Reads `model` out of an outgoing JSON body without keeping the body. */
export function readModelFromBody(body: unknown): string | null {
  if (typeof body !== 'string' || body.length === 0)
    return null
  try {
    const parsed = JSON.parse(body) as { model?: unknown }
    return typeof parsed?.model === 'string' ? parsed.model : null
  }
  catch {
    return null
  }
}

/** Builds the final report block from the observed requests. */
export function buildReport(
  requests: ObservedRequest[],
  configured: { provider: string | null, model: string | null },
): RealChatReport {
  const first401 = requests.find(request => request.responseStatus === 401)
  const anyCredential = requests.some(request => request.hasAuthorizationHeader && request.authorizationHeaderLength > 0)
  const anyFailure = requests.some(request => request.failed || (request.responseStatus !== null && request.responseStatus >= 400))
  // A 2xx on the chat endpoint means the provider answered and streamed a
  // reply. That is the evidence separating "the provider rejected us" from
  // "the provider answered and the model itself wrote that text".
  const assistantResponseReceived = requests.some(request => request.isChatRequest && request.responseOk === true)

  // The observer sees the wire, not the store, so "instance credential" means
  // "some real request carried a non-empty Authorization".
  const provider = requests[0]?.providerId ?? configured.provider ?? 'unknown'
  const model = requests.find(request => request.modelId)?.modelId ?? configured.model ?? 'unknown'

  return {
    status: anyFailure || requests.length === 0 ? 'FAIL' : 'PASS',
    provider,
    model,
    instanceCredential: anyCredential,
    requestCount: requests.length,
    assistantResponseReceived,
    first401Endpoint: first401 ? `${first401.method} ${first401.endpoint}` : null,
    requests,
  }
}

/** Renders the report in the exact `KEY=value` shape requested. */
export function formatReport(report: RealChatReport): string {
  const lines: string[] = [
    '===== LIA REAL CHAT DIAGNOSTIC =====',
    `REAL_CHAT_STATUS=${report.status}`,
    `PROVIDER=${report.provider}`,
    `MODEL=${report.model}`,
    `INSTANCE_CREDENTIAL=${report.instanceCredential}`,
    `REQUEST_COUNT=${report.requestCount}`,
    `ASSISTANT_RESPONSE_RECEIVED=${report.assistantResponseReceived}`,
  ]

  report.requests.slice(0, 5).forEach((request, position) => {
    const n = position + 1
    lines.push(
      `REQUEST_${n}_PROVIDER=${request.providerId}`,
      `REQUEST_${n}_MODEL=${request.modelId ?? 'unknown'}`,
      `REQUEST_${n}_REASONING_EFFORT=${request.reasoningEffort ?? 'omitted'}`,
      `REQUEST_${n}_TOOLCOUNT=${request.toolCount ?? 'none'}`,
      ...formatMessageDigest(request.messages),
      `REQUEST_${n}_IS_CHAT=${request.isChatRequest}`,
      `REQUEST_${n}_ENDPOINT=${request.method} ${request.endpoint}`,
      `REQUEST_${n}_AUTH=${request.hasAuthorizationHeader}(len=${request.authorizationHeaderLength})`,
      `REQUEST_${n}_STARTED=${request.requestStarted}`,
      `REQUEST_${n}_STATUS=${request.responseStatus ?? 'no-response'}`,
      `REQUEST_${n}_RAW_HTTP_ERROR_MESSAGE=${request.rawHttpErrorMessage ?? ''}`,
    )
  })

  lines.push(`FIRST_401_ENDPOINT=${report.first401Endpoint ?? 'none'}`)
  lines.push('===== END LIA REAL CHAT DIAGNOSTIC =====')
  return lines.join('\n')
}

/** Renders the message digest for one request: order, roles, sizes, excerpts. */
export function formatMessageDigest(messages: ObservedMessage[]): string[] {
  if (messages.length === 0)
    return []

  const summary = summarizeMessages(messages)
  const lines: string[] = [
    `MESSAGES_TOTAL=${messages.length}`,
    `SYSTEM_MESSAGE_COUNT=${summary.systemCount}`,
    `DEVELOPER_MESSAGE_COUNT=${summary.developerCount}`,
    `USER_MESSAGE_COUNT=${summary.userCount}`,
    `ASSISTANT_MESSAGE_COUNT=${summary.assistantCount}`,
    `PERSONA_PRESENT=${summary.personaPresent}`,
    `LANGUAGE_PTBR_PRESENT=${summary.languagePtBrPresent}`,
    `IDENTITY_LIA_PRESENT=${summary.identityLiaPresent}`,
    `METAINSTRUCTION_TEXT_PRESENT=${summary.metaInstructionPresent}`,
    `LAST_PERSONA_MESSAGE_INDEX=${summary.lastPersonaMessageIndex ?? 'none'}`,
  ]

  for (const message of messages) {
    lines.push(
      `MESSAGE_${message.index}_ROLE=${message.role}`,
      `MESSAGE_${message.index}_SIZE=${message.size}`,
      `MESSAGE_${message.index}_MARKERS=${message.markers.join('+') || 'none'}`,
      `MESSAGE_${message.index}_HEAD=${message.head}`,
    )
    if (message.tail.length > 0)
      lines.push(`MESSAGE_${message.index}_TAIL=${message.tail}`)
  }

  return lines
}

interface ObserverHandles {
  requests: ObservedRequest[]
  report: () => string
  reset: () => void
}

/**
 * Installs the fetch observer once. Returns handles for reading the report.
 * Idempotent: repeated calls (HMR) reuse the first installation.
 */
export function installRealChatObserver(win: Window & { __LIA_REAL_CHAT_DIAG__?: ObserverHandles }): ObserverHandles {
  if (win.__LIA_REAL_CHAT_DIAG__)
    return win.__LIA_REAL_CHAT_DIAG__

  const requests: ObservedRequest[] = []
  const originalFetch = win.fetch.bind(win)

  const handles: ObserverHandles = {
    requests,
    report: () => formatReport(buildReport(requests, readConfiguredFromLocalStorage(win))),
    reset: () => {
      requests.length = 0
    },
  }

  win.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url

    if (!isCandidateRequest(url))
      return originalFetch(input as RequestInfo, init)

    let parsed: URL
    try {
      parsed = new URL(url)
    }
    catch {
      return originalFetch(input as RequestInfo, init)
    }

    const record: ObservedRequest = {
      index: requests.length + 1,
      providerId: providerIdFromHost(parsed.hostname),
      modelId: readModelFromBody(init?.body),
      reasoningEffort: readReasoningEffortFromBody(init?.body),
      toolCount: readToolCountFromBody(init?.body),
      messages: readMessagesFromBody(init?.body),
      isChatRequest: isChatEndpoint(parsed.pathname),
      // Query strings can carry identifiers; only origin + path is recorded.
      endpoint: `${parsed.origin}${parsed.pathname}`,
      host: parsed.hostname,
      path: parsed.pathname,
      method: (init?.method ?? 'GET').toUpperCase(),
      hasAuthorizationHeader: readAuthorizationLength(init?.headers) > 0,
      authorizationHeaderLength: readAuthorizationLength(init?.headers),
      requestStarted: true,
      responseStatus: null,
      responseOk: null,
      rawHttpErrorMessage: null,
      failed: false,
      failureKind: null,
    }
    requests.push(record)

    console.info(
      `[LIA-DIAG] #${record.index} ${record.method} ${record.endpoint}`
      + ` auth=${record.hasAuthorizationHeader}(len=${record.authorizationHeaderLength})`
      + ` model=${record.modelId ?? 'unknown'} provider=${record.providerId}`
      + ` reasoning_effort=${record.reasoningEffort ?? 'omitted'}`
      + ` toolCount=${record.toolCount ?? 'none'} chat=${record.isChatRequest}`,
    )

    let response: Response
    try {
      response = await originalFetch(input as RequestInfo, init)
    }
    catch (error) {
      record.failed = true
      record.failureKind = error instanceof Error ? error.name : 'unknown'
      console.info(`[LIA-DIAG] #${record.index} FAILED ${record.failureKind}`)
      printIfConclusive(handles)
      throw error
    }

    record.responseStatus = response.status
    record.responseOk = response.ok

    // Only inspect bodies that already failed. Successful chat responses are
    // streamed, and cloning-then-reading one would buffer the whole reply.
    if (!response.ok) {
      try {
        const text = await response.clone().text()
        record.rawHttpErrorMessage = sanitizeResponseMessage(extractErrorMessage(text))
      }
      catch {
        record.rawHttpErrorMessage = null
      }
      console.info(
        `[LIA-DIAG] #${record.index} -> HTTP ${response.status} ${record.rawHttpErrorMessage ?? ''}`.trimEnd(),
      )
      printIfConclusive(handles)
    }
    else if (record.isChatRequest) {
      // A successful chat call is itself the finding: it rules out a real
      // 401/400 and means whatever text the user saw came from the reply.
      console.info(`[LIA-DIAG] #${record.index} -> HTTP ${response.status} chat accepted by provider`)
      printIfConclusive(handles)
    }

    return response
  }) as typeof win.fetch

  win.__LIA_REAL_CHAT_DIAG__ = handles
  console.info('[LIA-DIAG] real chat observer installed (read-only, metadata only)')
  return handles
}

/** Reads the configured provider/model straight from persisted localStorage. */
export function readConfiguredFromLocalStorage(win: Window): { provider: string | null, model: string | null } {
  const read = (key: string): string | null => {
    try {
      const raw = win.localStorage.getItem(key)
      return raw && raw !== 'null' ? raw : null
    }
    catch {
      return null
    }
  }
  return {
    provider: read('settings/consciousness/active-provider'),
    model: read('settings/consciousness/active-model'),
  }
}

/**
 * Prints the full block once a chat request has finished - failing or not.
 *
 * Printing only on failure would hide exactly the case we need to tell apart:
 * a 200 on the chat endpoint means there was no HTTP error at all, and the
 * troubleshooting text the user read came out of the reply rather than out of
 * a rejected request.
 */
function printIfConclusive(handles: ObserverHandles) {
  const chatFinished = handles.requests.some(
    request => request.isChatRequest && (request.failed || request.responseStatus !== null),
  )
  if (!chatFinished)
    return

  console.info(`\n${formatReport(buildReport(handles.requests, { provider: null, model: null }))}\n`)
}
