import type { AllTalkRuntimeConfig, AllTalkSynthesizeTiming } from './alltalk-client'
import type { LiaVoiceProfileStore } from './voice-profiles'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AllTalkGenerationError, createAllTalkClient, toAllTalkLanguage } from './alltalk-client'
import { createAllTalkSyncService } from './alltalk-voices-sync'
import { sniffWavMetadata } from './wav-metadata'

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
  /**
   * Phase 7.7.2, item 11: the voice profile's own language tag (e.g. the
   * imported profile reads pt-BR) - used when neither the request nor the
   * product preferences carried one. This is what stops `auto` from being
   * sent for a voice whose language is KNOWABLE.
   */
  profileLanguage?: string
}): string | undefined {
  const requested = String(options.requested ?? '').trim()
  if (requested)
    return requested
  const configured = String(options.configured ?? '').trim()
  if (configured)
    return configured
  const profile = String(options.profileLanguage ?? '').trim()
  return profile || undefined
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
    ...await sniffReferenceWavForDiagnostics(runtime.voicesDir, published.filename),
  })

  let timing: AllTalkSynthesizeTiming | undefined

  // Phase 7.7.2, items 1-2: "started" is fired by the BACKEND slot now, not
  // by this envelope - the Windows QA showed activeSynthesisCount=2 because
  // the envelope counted at CALL time while the real concurrency point is
  // the synthesis slot inside the client (module-level FIFO mutex, one
  // holder at a time). queued = ordinal log above; started = slot won;
  // completed = slot released. active==2 is now impossible by construction:
  // no second request can acquire while the first holds the slot.
  try {
    const bytes = await createAllTalkClient(runtime, params.fetchImpl).synthesize({
      text,
      characterVoiceGen: published.filename,
      // The provider passes a BCP-47 tag through; AllTalk only accepts `pt`.
      language: languageUsed,
    }, {
      onSlotAcquired: () => {
        activeSynthesisCount += 1
        logRequest({
          activeSynthesisCount,
          event: 'lia.voice.synthesize.started',
          ordinal,
          profileId,
          provider: 'custom-local-voice',
          textLength: text.length,
        })
      },
      onSlotReleased: () => {
        activeSynthesisCount -= 1
        logCompleted(ordinal, profileId, text.length)
      },
      onTiming: (next) => { timing = next },
    })
    const totalMs = Date.now() - queuedAt
    const generated = await sniffGeneratedWavForDiagnostics(bytes)
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
      queueWaitMs: timing?.queueWaitMs ?? -1,
      requestDurationMs: Date.now() - requestStartedAt,
      textLength: text.length,
      ...generated.logFields,
    })
    if (generated.qaDumpPath)
      logRequest({ event: 'lia.voice.synthesize.qa-dump', ordinal, path: generated.qaDumpPath })
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

/**
 * Phase 7.7.2, items 7-9 and tests D/F: structural metadata of the generated
 * WAV (sample rate, channels, bit depth, duration) plus a CONTENT-FREE hash
 * - the Stage side hashes the bytes it receives before decodeAudioData, and
 * identical hashes prove the playback input is byte-identical to what
 * AllTalk returned. Under LIA_VOICE_QA_DUMP=1 (dev/diagnostics only) the raw
 * WAV is also copied to the OS temp dir so the QA can play it in a normal
 * player and isolate GENERATION vs PLAYBACK (item 7). The dump never lives
 * in the repository and is never written without the flag.
 */
async function sniffGeneratedWavForDiagnostics(bytes: ArrayBuffer): Promise<{ logFields: Record<string, string | number>, qaDumpPath?: string }> {
  const logFields: Record<string, string | number> = {
    wavBytes: bytes.byteLength,
    wavSha256: createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
  }
  const meta = sniffWavMetadata(bytes)
  if (meta.container !== 'unknown') {
    if (meta.sampleRate)
      logFields.wavSampleRate = meta.sampleRate
    if (meta.channels)
      logFields.wavChannels = meta.channels
    if (meta.bitDepth)
      logFields.wavBitDepth = meta.bitDepth
    if (meta.durationMs !== undefined)
      logFields.wavDurationMs = meta.durationMs
    logFields.wavCodec = meta.codec
  }

  let qaDumpPath: string | undefined
  if (process.env.LIA_VOICE_QA_DUMP === '1') {
    const dir = join(tmpdir(), 'lia-voice-qa')
    const path = join(dir, `lia-qa-${Date.now()}.wav`)
    // Awaited: the dump is a dev-only diagnostic and its log line must mean
    // "the file is on disk now", not "a write exists somewhere in flight".
    // Cost is a single local file write, and only under the flag.
    await mkdir(dir, { recursive: true }).catch(() => undefined)
    await writeFile(path, Buffer.from(bytes)).catch(() => undefined)
    qaDumpPath = path
  }
  return { logFields, qaDumpPath }
}

/**
 * Phase 7.7.2, item 9: the reference file AllTalk actually reads - structural
 * metadata only, logged once per synthesis next to preflight so a low-
 * bandwidth or reverberant SOURCE is visible in QA instead of being masked.
 */
async function sniffReferenceWavForDiagnostics(voicesDir: string | undefined, filename: string): Promise<Record<string, string | number>> {
  if (!voicesDir)
    return {}
  try {
    const bytes = await readFile(join(voicesDir, filename))
    const fields: Record<string, string | number> = { refWavBytes: bytes.byteLength }
    const meta = sniffWavMetadata(bytes)
    if (meta.sampleRate)
      fields.refWavSampleRate = meta.sampleRate
    if (meta.channels)
      fields.refWavChannels = meta.channels
    if (meta.bitDepth)
      fields.refWavBitDepth = meta.bitDepth
    if (meta.durationMs !== undefined)
      fields.refWavDurationMs = meta.durationMs
    if (meta.codec !== 'unknown')
      fields.refWavCodec = meta.codec
    return fields
  }
  catch {
    return {}
  }
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
