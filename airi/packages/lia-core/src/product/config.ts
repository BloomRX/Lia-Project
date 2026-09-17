import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

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

  const parsed = safeDestr<unknown>(raw)
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
