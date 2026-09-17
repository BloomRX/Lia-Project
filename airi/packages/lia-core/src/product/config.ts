import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { safeDestr } from 'destr'

/**
 * Tolerant reader for the canonical Lia product document
 * (`<lia-user-data>/lia-product.json`, Phase 7).
 *
 * The AUTHORITATIVE schema lives with the product config writer (the Electron
 * hosts validate and auto-heal through their persistence layer). Lia Core's
 * job here is narrower: read whatever valid JSON exists, surface the fields
 * the launcher needs, and never write, never "heal", never guess. A document
 * we cannot parse is reported as unreadable - it is left on disk untouched.
 */

export interface LiaProductProviderTarget {
  providerId: string
  modelId?: string
}

export interface LiaProductChatConfig {
  strategy?: 'auto' | 'manual'
  preferred?: LiaProductProviderTarget
  fallback?: LiaProductProviderTarget[]
  fallbackEnabled?: boolean
  onboarded?: boolean
}

export interface LiaProductTtsTarget {
  providerId: string
  modelId?: string
  voiceId?: string
}

export interface LiaProductAllTalkRuntime {
  baseUrl?: string
  voicesDir?: string
  timeoutMs?: number
  installDir?: string
}

export interface LiaProductVoiceConfig {
  tts?: {
    preferred?: LiaProductTtsTarget
    fallback?: LiaProductTtsTarget[]
  }
  stt?: {
    preferred?: { providerId: string, modelId?: string }
  }
  runtime?: {
    alltalk?: LiaProductAllTalkRuntime
  }
}

export interface LiaProductConfigSnapshot {
  schemaVersion?: number
  persona?: { activeCardId?: string }
  provider?: { chat?: LiaProductChatConfig }
  voice?: LiaProductVoiceConfig
  preferences?: { language?: string }
}

export type LiaProductConfigRead
  = | { filePath: string, status: 'ok', value: LiaProductConfigSnapshot }
    | { filePath: string, status: 'missing' }
    | { error: unknown, filePath: string, status: 'invalid' | 'read-error' }

export interface LiaProductConfigReaderDeps {
  exists?: (path: string) => boolean
  read?: (path: string) => Promise<string>
}

/**
 * Structural extraction, deliberately forgiving: fields we know are lifted
 * when present and well-shaped; unknown fields are preserved by the `(raw)`
 * document when the host re-validates it. This reader never strips anything -
 * it does not write at all.
 */
export async function readLiaProductConfig(
  filePath: string,
  deps: LiaProductConfigReaderDeps = {},
): Promise<LiaProductConfigRead> {
  const exists = deps.exists ?? ((p: string) => existsSync(p))
  const read = deps.read ?? (async (p: string) => await readFile(p, 'utf8'))

  if (!exists(filePath))
    return { filePath, status: 'missing' }

  let raw: string
  try {
    raw = await read(filePath)
  }
  catch (error) {
    return { error, filePath, status: 'read-error' }
  }

  // A malformed document is INVALID, never a crash: the user keeps their
  // file, untouched, and the launcher keeps booting. safeDestr itself can
  // throw for JSON-shaped garbage, so the parse gets its own guard.
  let parsed: unknown
  try {
    parsed = safeDestr(raw)
  }
  catch (error) {
    return { error, filePath, status: 'invalid' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return { error: new Error('lia-product.json is not a JSON object'), filePath, status: 'invalid' }

  return { filePath, status: 'ok', value: extract(parsed as Record<string, unknown>) }
}

function extract(doc: Record<string, unknown>): LiaProductConfigSnapshot {
  const snapshot: LiaProductConfigSnapshot = {}
  if (typeof doc.schemaVersion === 'number')
    snapshot.schemaVersion = doc.schemaVersion

  const persona = asRecord(doc.persona)
  if (persona) {
    const activeCardId = asString(persona.activeCardId)
    if (activeCardId !== undefined)
      snapshot.persona = { activeCardId }
  }

  const provider = asRecord(doc.provider)
  const chat = provider ? asRecord(provider.chat) : undefined
  if (chat) {
    const extracted: LiaProductChatConfig = {}
    const strategy = chat.strategy
    if (strategy === 'auto' || strategy === 'manual')
      extracted.strategy = strategy
    extracted.preferred = asTarget(chat.preferred)
    extracted.fallback = Array.isArray(chat.fallback)
      ? chat.fallback.map(asTarget).filter((t): t is LiaProductProviderTarget => t !== undefined)
      : undefined
    if (typeof chat.fallbackEnabled === 'boolean')
      extracted.fallbackEnabled = chat.fallbackEnabled
    if (typeof chat.onboarded === 'boolean')
      extracted.onboarded = chat.onboarded
    snapshot.provider = { chat: extracted }
  }

  const voice = asRecord(doc.voice)
  if (voice) {
    const extracted: LiaProductVoiceConfig = {}
    const tts = asRecord(voice.tts)
    if (tts) {
      extracted.tts = {
        fallback: Array.isArray(tts.fallback)
          ? tts.fallback.map(asTtsTarget).filter((t): t is LiaProductTtsTarget => t !== undefined)
          : undefined,
        preferred: asTtsTarget(tts.preferred),
      }
    }
    const stt = asRecord(voice.stt)
    const sttPreferred = stt ? asTarget(stt.preferred) : undefined
    if (sttPreferred)
      extracted.stt = { preferred: sttPreferred }
    const runtime = asRecord(voice.runtime)
    const alltalk = runtime ? asRecord(runtime.alltalk) : undefined
    if (alltalk) {
      extracted.runtime = {
        alltalk: {
          baseUrl: asString(alltalk.baseUrl),
          installDir: asString(alltalk.installDir),
          timeoutMs: typeof alltalk.timeoutMs === 'number' ? alltalk.timeoutMs : undefined,
          voicesDir: asString(alltalk.voicesDir),
        },
      }
    }
    snapshot.voice = extracted
  }

  const preferences = asRecord(doc.preferences)
  const language = preferences ? asString(preferences.language) : undefined
  if (language !== undefined)
    snapshot.preferences = { language }

  return snapshot
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asTarget(value: unknown): LiaProductProviderTarget | undefined {
  const record = asRecord(value)
  const providerId = record ? asString(record.providerId) : undefined
  if (!providerId)
    return undefined
  return { modelId: asString(record!.modelId), providerId }
}

function asTtsTarget(value: unknown): LiaProductTtsTarget | undefined {
  const target = asTarget(value)
  if (!target)
    return undefined
  const record = asRecord(value)
  return { ...target, voiceId: record ? asString(record.voiceId) : undefined }
}


/* --------------------------------------------------------------------------
 * Writing: the controlled merge for the launcher's editable configuration
 * (Phase 7.1, item 5).
 *
 * The launcher's edits are SMALL: a selection here, a language there. The
 * canonical document keeps its whole shape - unknown fields from other
 * editors (the AIRI persistence layer included) survive untouched, because
 * the writer merges the patch onto the RAW parsed document and only ever
 * touches the exact branches named by the patch. Arrays and `preferred`
 * selections are REPLACED (a selection is atomic), scalar branches merged.
 *
 * Secrets never land here: API keys are vault material; hostile payloads
 * that carry one are rejected rather than healed, so a confused caller can
 * never accidentally funnel a secret into a world-readable JSON file.
 * ------------------------------------------------------------------------ */

export const SECRET_FIELD_NAMES = ['apikey', 'apisecret', 'bearer', 'secret', 'token'] as const

export interface LiaProductConfigUpdate {
  persona?: { activeCardId?: string }
  provider?: { chat?: Partial<LiaProductChatConfig> }
  preferences?: { language?: string }
  voice?: {
    runtime?: { alltalk?: Partial<LiaProductAllTalkRuntime> }
    tts?: { preferred?: LiaProductTtsTarget }
  }
}

export type LiaProductConfigWrite
  = | { filePath: string, status: 'ok', value: LiaProductConfigSnapshot }
    | { error: Error, filePath: string, status: 'secret-forbidden' | 'invalid-source' | 'write-failed' }

export interface LiaProductConfigWriterDeps {
  exists?: (path: string) => boolean
  read?: (path: string) => Promise<string>
  write?: (path: string, data: string) => Promise<void>
}

/** Walk every object in the patch - a secret-ish key anywhere vetoes the write. */
function containsSecretField(value: unknown): boolean {
  if (value === null || value === undefined || typeof value !== 'object')
    return false
  if (Array.isArray(value))
    return value.some(containsSecretField)
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELD_NAMES.some(name => key.toLowerCase().includes(name)))
      return true
    if (containsSecretField(nested))
      return true
  }
  return false
}

export async function updateLiaProductConfig(
  filePath: string,
  update: LiaProductConfigUpdate,
  deps: LiaProductConfigWriterDeps = {},
): Promise<LiaProductConfigWrite> {
  const exists = deps.exists ?? ((p: string) => existsSync(p))
  const read = deps.read ?? (async (p: string) => await readFile(p, 'utf8'))
  const write = deps.write ?? (async (p: string, data: string) => {
    await mkdir(dirname(p), { recursive: true })
    const tmp = `${p}.${randomUUID()}.tmp`
    await writeFile(tmp, data)
    await rename(tmp, p)
  })

  if (containsSecretField(update))
    return { error: new Error('API keys and tokens belong to the secret vault, never to lia-product.json.'), filePath, status: 'secret-forbidden' }

  // Start from the raw document when it exists and parses; create a fresh
  // one when the user simply never ran any host before.
  let raw: Record<string, unknown> = { schemaVersion: 1 }
  if (exists(filePath)) {
    let content: string
    try {
      content = await read(filePath)
    }
    catch (error) {
      return { error: error instanceof Error ? error : new Error(String(error)), filePath, status: 'invalid-source' }
    }
    let parsed: unknown
    try {
      parsed = safeDestr(content)
    }
    catch (error) {
      // An unreadable product document is NEVER healed into a fresh one by a
      // writer - the user's file stays exactly as it is.
      return { error: error instanceof Error ? error : new Error(String(error)), filePath, status: 'invalid-source' }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return { error: new Error('lia-product.json is not a JSON object'), filePath, status: 'invalid-source' }
    raw = parsed as Record<string, unknown>
  }

  const next = mergeProductUpdate(raw, update)
  try {
    await write(filePath, `${JSON.stringify(next, null, 2)}\n`)
  }
  catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)), filePath, status: 'write-failed' }
  }

  return { filePath, status: 'ok', value: extract(next) }
}

function mergeProductUpdate(raw: Record<string, unknown>, update: LiaProductConfigUpdate): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw }
  if (update.persona) {
    next.persona = { ...asRecord(raw.persona), ...definedOnly(update.persona) }
  }
  if (update.preferences) {
    next.preferences = { ...asRecord(raw.preferences), ...definedOnly(update.preferences) }
  }
  if (update.provider?.chat) {
    const provider = { ...asRecord(raw.provider) }
    provider.chat = { ...asRecord(provider.chat), ...definedOnly(update.provider.chat) }
    next.provider = provider
  }
  if (update.voice) {
    const voice = { ...asRecord(raw.voice) }
    if (update.voice.tts?.preferred !== undefined) {
      const tts = { ...asRecord(voice.tts) }
      // A selection is atomic: replace it whole, never deep-merge ids from
      // two different picks into one Franken-target.
      tts.preferred = definedOnly(update.voice.tts.preferred)
      voice.tts = tts
    }
    if (update.voice.runtime?.alltalk) {
      const runtime = { ...asRecord(voice.runtime) }
      runtime.alltalk = { ...asRecord(runtime.alltalk), ...definedOnly(update.voice.runtime.alltalk) }
      voice.runtime = runtime
    }
    next.voice = voice
  }
  return next
}

/** Drop `undefined` values so a partial patch never ERASES what it skipped. */
function definedOnly<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) {
    if (inner !== undefined)
      out[key] = inner
  }
  return out as T
}
