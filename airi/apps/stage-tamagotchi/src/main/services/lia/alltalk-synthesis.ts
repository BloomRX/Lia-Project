import type { AllTalkRuntimeConfig } from './alltalk-client'
import type { LiaVoiceProfileStore } from './voice-profiles'

import { AllTalkGenerationError, createAllTalkClient, toAllTalkLanguage } from './alltalk-client'
import { createAllTalkSyncService } from './alltalk-voices-sync'

/**
 * One utterance, end to end: profile id in, audio out.
 *
 * ```
 * profile id
 *   -> ensureProfileAvailableToAllTalk()   publish the reference WAV if needed
 *   -> managed filename                    lia-<profile-id>.wav
 *   -> POST /api/tts-generate              answers with JSON, not audio
 *   -> GET  output_file_url                the actual bytes
 * ```
 *
 * Kept out of the IPC bridge so the whole chain - including the second HTTP hop
 * - can be driven against a local test server. The bridge is then just a thin
 * wrapper that reads the runtime config and forwards.
 *
 * The caller supplies a `profileId`, never a filename. The name AllTalk receives
 * as `character_voice_gen` is derived inside the sync service from that id, so
 * there is no path by which a caller can point a request at an arbitrary file in
 * AllTalk's folder.
 */
export interface SynthesizeProfileParams {
  profileId: string
  text: string
  /** BCP-47 tag, e.g. `pt-BR`; normalized to AllTalk's `pt` by the client. */
  language?: string
  /** Already resolved: `baseUrl` and `timeoutMs` are filled in by the caller. */
  runtime: AllTalkRuntimeConfig
  store: LiaVoiceProfileStore
  fetchImpl?: typeof fetch
}

/**
 * Phase 7.5, Part 10: one human, pt-BR sentence per failure CATEGORY. The
 * technical `[category=<key>]` marker stays appended so the renderer's
 * fallback policy can still classify terminal setup failures through the
 * IPC error serialization - the marker is metadata, not prose.
 */
export const ALLTALK_HUMAN_ERROR_MESSAGES: Record<string, string> = {
  'voice-not-found': 'Não foi possível carregar a voz selecionada.',
  'engine-unavailable': 'O sistema de voz não conseguiu carregar o modelo.',
  'generation-failed': 'Não foi possível gerar a fala da Lia.',
  'unknown': 'Ocorreu um problema no sistema de voz.',
}

/**
 * Phase 7.6, item 12: resolve the language a synthesis request should carry.
 *
 * The renderer usually does not name a language. AllTalk's own default is
 * `auto` detection - real per-request latency AND lossy pt-BR segmentation -
 * so the product's declared `preferences.language` (e.g. `pt-BR`) wins over
 * `auto` whenever it is set. An explicit request language (a future
 * per-utterance override) always beats both. Empty/missing = keep `auto`.
 *
 * Pure and total on purpose: the rule is the unit the tests pin, the IPC
 * handler just feeds it the two config sources.
 */
export function resolveSynthesisLanguage(options: {
  configured?: string
  requested?: string
}): string | undefined {
  const requested = String(options.requested ?? '').trim()
  if (requested)
    return requested
  const configured = String(options.configured ?? '').trim()
  return configured || undefined
}

export async function synthesizeProfileWithAllTalk(params: SynthesizeProfileParams): Promise<ArrayBuffer> {
  const { profileId, text, language, runtime, store } = params

  const published = await createAllTalkSyncService({ store, voicesDir: runtime.voicesDir })
    .ensureProfileAvailableToAllTalk(profileId)

  if (!published.ok)
    throw new Error(published.message)

  // Phase 7.5, Part 2: exactly ONE request log line, metadata only. The full
  // text of what was said and any audio bytes never enter a log.
  logRequest({
    event: 'lia.voice.synthesize.request',
    language: language ?? 'auto',
    profileId,
    provider: 'custom-local-voice',
    requestVoiceName: published.filename,
    textLength: text.length,
  })

  // Phase 7.6, item 3/10: wall-clock duration of the AllTalk round trip, per
  // synthesis request. This is the number the Windows QA never had - it lets
  // us separate a slow XTTS inference (large ms, constant per text length)
  // from server-internal queueing (small first request, large serial backlog).
  const startedAt = Date.now()

  try {
    const bytes = await createAllTalkClient(runtime, params.fetchImpl).synthesize({
      text,
      characterVoiceGen: published.filename,
      // The provider passes a BCP-47 tag through; AllTalk only accepts `pt`.
      language: toAllTalkLanguage(language),
    })
    logRequest({
      bytes: bytes.byteLength,
      event: 'lia.voice.synthesize.response',
      language: toAllTalkLanguage(language),
      ms: Date.now() - startedAt,
      profileId,
      provider: 'custom-local-voice',
      textLength: text.length,
    })
    return bytes
  }
  catch (thrown) {
    if (thrown instanceof AllTalkGenerationError) {
      // The reason itself is NEVER swallowed: the full failure (status, body
      // snippet) lands here, in the MAIN-process diagnostic log, while the
      // renderer receives exactly one human sentence plus the category marker.
      logRequest({
        bodySnippet: thrown.bodySnippet ?? '',
        category: thrown.category,
        endpoint: thrown.endpoint,
        event: 'lia.voice.synthesize.response',
        language: toAllTalkLanguage(language),
        ms: Date.now() - startedAt,
        profileId,
        provider: 'custom-local-voice',
        status: thrown.status,
        textLength: text.length,
      }, true)
      const human = ALLTALK_HUMAN_ERROR_MESSAGES[thrown.category] ?? ALLTALK_HUMAN_ERROR_MESSAGES.unknown
      throw new Error(`${human} [category=${thrown.category}]`)
    }
    throw thrown
  }
}

/** Structured main-side log: key=value pairs, nothing free-form. */
function logRequest(meta: Record<string, string | number>, isError = false): void {
  const line = Object.entries(meta).map(([key, value]) => `${key}=${String(value)}`).join(' ')
  if (isError)
    console.error(line)
  else
    console.info(line)
}
