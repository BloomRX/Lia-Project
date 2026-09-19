import type { AllTalkRuntimeConfig, AllTalkSynthesizeTiming } from './alltalk-client'
import type { LiaVoiceProfileStore } from './voice-profiles'

import { AllTalkGenerationError, createAllTalkClient, toAllTalkLanguage } from './alltalk-client'
import { createAllTalkSyncService } from './alltalk-voices-sync'

/**
 * Phase 7.7.1, item H: how many synthesis requests are ACTIVELY inside the
 * server boundary right now. Every synthesis crosses this envelope, so the
 * counter is ground truth for "more than one in flight?" - the QA run
 * showed ordinals 3 and 4 appearing while 1:99/2:96 sized, which is exactly
 * what sentence pipelining vs true concurrent inference must be told apart
 * by. Metadata only, always.
 */
let activeSynthesisCount = 0

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

  // Phase 7.6/7.7, Parts 1+3: the synthesis path, split into its observable
  // phases, per request. The ~119s the Windows QA measured only becomes
  // attributable when these numbers exist side by side:
  //
  //   preflightMs   - profile publish + /api/voices visibility checks
  //   generationMs  - POST /api/tts-generate: server accept + internal queue
  //                   + XTTS inference + speaker conditioning + WAV write
  //                   (individually unobservable from outside the server's
  //                   HTTP boundary - that split needs AllTalk-side logging,
  //                   which the contract does not expose; reported, not guessed)
  //   downloadMs    - GET of the generated WAV (local HTTP overhead)
  //   totalMs       - everything above, end to end
  //
  // `ordinal` marks the first synthesis since process start: the first XTTS
  // inference after boot has a price the second one does not. Metadata only:
  // no text, no audio, ever.
  const ordinal = nextSynthesisOrdinal()
  const languageUsed = toAllTalkLanguage(language)
  const queuedAt = Date.now()

  const published = await createAllTalkSyncService({ store, voicesDir: runtime.voicesDir })
    .ensureProfileAvailableToAllTalk(profileId)

  if (!published.ok)
    throw new Error(published.message)

  const preflightMs = Date.now() - queuedAt
  const requestStartedAt = Date.now()

  // Phase 7.5, Part 2: exactly ONE request log line, metadata only. The full
  // text of what was said and any audio bytes never enter a log.
  logRequest({
    event: 'lia.voice.synthesize.request',
    language: languageUsed,
    ordinal,
    profileId,
    provider: 'custom-local-voice',
    requestVoiceName: published.filename,
    textLength: text.length,
  })

  let timing: AllTalkSynthesizeTiming | undefined

  // Phase 7.7.1, item H: the ordinal log above already marks "queued" at
  // envelope entry; this marks "started" just before the POST, with the
  // live active count. If active ever reads > 1 in the QA's log, the
  // overlap is here - not at the semaphore, which pins concurrency to 1 at
  // the generation step (the preflight profiles/publish phase is cheap and
  // preceeds this point).
  activeSynthesisCount += 1
  logRequest({
    activeSynthesisCount,
    event: 'lia.voice.synthesize.started',
    ordinal,
    profileId,
    provider: 'custom-local-voice',
    textLength: text.length,
  })

  try {
    const bytes = await createAllTalkClient(runtime, params.fetchImpl).synthesize({
      text,
      characterVoiceGen: published.filename,
      // The provider passes a BCP-47 tag through; AllTalk only accepts `pt`.
      language: languageUsed,
    }, {
      onTiming: (next) => { timing = next },
    })
    const totalMs = Date.now() - queuedAt
    activeSynthesisCount -= 1
    logRequest({
      activeSynthesisCount,
      audioBodyReadMs: timing?.audioBodyReadMs ?? -1,
      audioGetHeadersMs: timing?.audioGetHeadersMs ?? -1,
      bytes: bytes.byteLength,
      downloadMs: timing?.downloadMs ?? -1,
      event: 'lia.voice.synthesize.response',
      generationBodyMs: timing?.generationBodyMs ?? -1,
      generationMs: timing?.generationMs ?? -1,
      language: languageUsed,
      ms: totalMs,
      ordinal,
      preflightMs,
      profileId,
      provider: 'custom-local-voice',
      requestDurationMs: Date.now() - requestStartedAt,
      textLength: text.length,
    })
    logCompleted(ordinal, profileId, text.length)
    return bytes
  }
  catch (thrown) {
    activeSynthesisCount -= 1
    logCompleted(ordinal, profileId, text.length)
    if (thrown instanceof AllTalkGenerationError) {
      // The reason itself is NEVER swallowed: the full failure (status, body
      // snippet) lands here, in the MAIN-process diagnostic log, while the
      // renderer receives exactly one human sentence plus the category marker.
      logRequest({
        bodySnippet: thrown.bodySnippet ?? '',
        category: thrown.category,
        endpoint: thrown.endpoint,
        event: 'lia.voice.synthesize.response',
        generationMs: timing?.generationMs ?? -1,
        language: languageUsed,
        ms: Date.now() - queuedAt,
        ordinal,
        preflightMs,
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

/** Monotonic counter: marks the first synthesis of this process. */
let synthesisOrdinal = 0
function nextSynthesisOrdinal(): number {
  synthesisOrdinal += 1
  return synthesisOrdinal
}

/** Phase 7.7.1, item H: the terminal edge of one active synthesis. */
function logCompleted(ordinal: number, profileId: string, textLength: number): void {
  logRequest({
    activeSynthesisCount,
    event: 'lia.voice.synthesize.completed',
    ordinal,
    profileId,
    provider: 'custom-local-voice',
    textLength,
  })
}

/** Structured main-side log: key=value pairs, nothing free-form. */
function logRequest(meta: Record<string, string | number>, isError = false): void {
  const line = Object.entries(meta).map(([key, value]) => `${key}=${String(value)}`).join(' ')
  if (isError)
    console.error(line)
  else
    console.info(line)
}
