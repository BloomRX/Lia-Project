import { errorMessageFrom } from '@moeru/std'

/**
 * Optional TTS provider fallback policy (M1 Phase 4D-3).
 *
 * The speech runtime knows nothing about Lia: it only knows that a synthesis
 * attempt failed and that *somebody* may be able to switch to another voice
 * target and ask for a retry. That somebody registers itself here.
 *
 * Deliberately minimal and inert:
 *  - with no policy registered, {@link synthesizeWithSpeechFallback} performs
 *    exactly one attempt and rethrows — byte-for-byte the previous behaviour;
 *  - the policy both DECIDES and APPLIES the switch, so this module never has
 *    to import a store, a provider list, or anything app-specific. That is what
 *    keeps `stage-ui` usable by stage-web / stage-pocket while the Lia policy
 *    lives in the tamagotchi app.
 *
 * Retry unit: one segment. `speech-pipeline` calls the host `tts()` callback
 * once per segment and only enqueues playback for the buffer it returns, so
 * retrying inside that callback can never duplicate audio, reorder segments
 * (playback order is keyed by `request.sequence`, not completion order) or put
 * two providers on the air at once — the failed attempt produced no buffer.
 *
 * Mirrors the shape of `stores/chat/chat-provider-runtime.ts` (register / get /
 * reset-for-testing + a hard attempt ceiling) so both fallbacks read the same.
 */

/** Describes the attempt that just failed. */
export interface SpeechTtsFallbackContext {
  /** 1-based index of the failed attempt within this segment. */
  attempt: number
  /** The error the attempt threw. */
  error: unknown
  /** Diagnostics only — never used to decide. */
  turnId?: string
  streamId?: string
  segmentId?: string
}

export interface SpeechTtsFallbackPolicy {
  /**
   * Called after a RECOVERABLE, non-aborted attempt failed.
   *
   * The policy owns ordering and the switch itself: it decides whether another
   * target exists, applies it, and returns `true` to ask the runtime to retry
   * the same segment. Returning `false`/`undefined` ends the chain and the
   * segment fails normally.
   */
  onAttemptFailed: (ctx: SpeechTtsFallbackContext) => boolean | Promise<boolean>
  /**
   * Called when a speech turn finished (`onTurnEnd` of the speech pipeline).
   * Lets the policy restore its preferred target so a fallback never becomes
   * the permanent provider. Optional.
   */
  onTurnEnded?: () => void | Promise<void>
}

/**
 * Hard ceiling on attempts per segment (preferred + fallbacks). A safety net
 * only — a well-formed policy exhausts its own chain first.
 */
export const SPEECH_TTS_FALLBACK_MAX_ATTEMPTS = 6

let speechTtsFallbackPolicy: SpeechTtsFallbackPolicy | undefined

export function registerSpeechTtsFallbackPolicy(policy?: SpeechTtsFallbackPolicy): void {
  speechTtsFallbackPolicy = policy
}

export function getSpeechTtsFallbackPolicy(): SpeechTtsFallbackPolicy | undefined {
  return speechTtsFallbackPolicy
}

export function resetSpeechTtsFallbackForTesting(): void {
  speechTtsFallbackPolicy = undefined
}

/**
 * Whether an error is an intentional cancellation (user pressed stop, a new
 * message superseded this one, mute, unmount). Never a fallback trigger: the
 * segment is being abandoned on purpose, so switching provider would start new
 * work the caller just stopped.
 */
export function isAbortError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null | undefined)?.name
  if (name === 'AbortError')
    return true

  const text = (errorMessageFrom(error) ?? '').toLowerCase()
  return text.includes('aborterror')
    || text.includes('aborted')
    || text.includes('this operation was aborted')
}

/**
 * Error markers that mean "another provider will fail the same way": bad or
 * missing credentials, a model/endpoint that does not exist, malformed input,
 * or a configuration every provider shares. Kept as a deny-list (the same
 * approach as the chat fallback classifier) so ordinary provider/network
 * trouble stays recoverable without a large taxonomy.
 */
const NON_RECOVERABLE_SPEECH_MARKERS = [
  '401',
  '403',
  'unauthorized',
  'forbidden',
  'authentication',
  'invalid api key',
  'api key',
  '404',
  'not found',
  'model_not_found',
  '400',
  'bad request',
  'invalid_request',
  'unsupported',
  'not configured',
  'no credentials',
  'credentials',
  'cors',
  'certificate',
  'blocked',
  'insufficient_quota',
  'insufficient quota',
  'billing',
]

/**
 * Whether retrying the same text on a DIFFERENT voice provider could plausibly
 * succeed: provider unavailable, network failure, 5xx, timeout, provider
 * initialisation failure, TTS request failure. Abort is never recoverable, and
 * an empty/uninformative error gets the benefit of the doubt (the attempt
 * ceiling and the policy's own chain bound the damage).
 */
export function isRecoverableSpeechError(error: unknown): boolean {
  if (isAbortError(error))
    return false

  const text = (errorMessageFrom(error) ?? String(error ?? '')).toLowerCase()
  return !NON_RECOVERABLE_SPEECH_MARKERS.some(marker => text.includes(marker))
}

export interface SynthesizeWithSpeechFallbackOptions {
  /** The segment's cancellation signal. Checked before every attempt. */
  signal: AbortSignal
  /** Diagnostics only. */
  turnId?: string
  streamId?: string
  segmentId?: string
}

/**
 * Runs one segment synthesis, retrying it on recoverable failures while the
 * registered policy keeps supplying a new voice target.
 *
 * `synthesize` returns `null` when there is legitimately nothing to speak
 * (muted, noop provider, empty segment, no model/voice picked) — that is a
 * result, not a failure, and never triggers a fallback. It THROWS when the
 * attempt actually failed.
 *
 * Rethrows (leaving the caller's existing error handling in charge) when the
 * segment was aborted, the error is not recoverable, no policy is registered,
 * the policy declines, or the attempt ceiling is reached.
 */
export async function synthesizeWithSpeechFallback<TAudio>(
  synthesize: () => Promise<TAudio | null>,
  options: SynthesizeWithSpeechFallbackOptions,
): Promise<TAudio | null> {
  const { signal } = options
  let attempt = 0

  for (;;) {
    attempt += 1

    try {
      return await synthesize()
    }
    catch (error) {
      // Cancellation wins over everything: no fallback, no new attempt, no
      // provider switch.
      if (signal.aborted || isAbortError(error))
        throw error

      if (!isRecoverableSpeechError(error))
        throw error

      const policy = speechTtsFallbackPolicy
      if (!policy)
        throw error

      if (attempt >= SPEECH_TTS_FALLBACK_MAX_ATTEMPTS)
        throw error

      const retry = await policy.onAttemptFailed({
        attempt,
        error,
        turnId: options.turnId,
        streamId: options.streamId,
        segmentId: options.segmentId,
      })

      if (retry !== true)
        throw error

      // The policy switched target; the user may have stopped during the
      // switch, so re-check before spending another attempt.
      if (signal.aborted)
        throw error
    }
  }
}

/** The identity fields a segment carries, used for diagnostics only. */
export interface SpeechTtsSegmentRef {
  turnId?: string
  streamId?: string
  segmentId?: string
}

/**
 * Wraps a host's per-segment `tts()` callback with the fallback retry loop.
 *
 * Drop-in: the returned function has the same signature the speech pipeline
 * expects, returns the same `TAudio | null`, and — with no policy registered —
 * performs exactly one attempt. On give-up it returns `null` (the segment is
 * dropped and the conversation continues), which is what hosts already did by
 * catching and returning `null` themselves; the wrapped callback keeps owning
 * the diagnostic logging so no context is lost.
 */
export function withSpeechTtsSegmentFallback<TAudio, TRequest extends SpeechTtsSegmentRef>(
  synthesize: (request: TRequest, signal: AbortSignal) => Promise<TAudio | null>,
): (request: TRequest, signal: AbortSignal) => Promise<TAudio | null> {
  return async (request, signal) => {
    try {
      return await synthesizeWithSpeechFallback(
        () => synthesize(request, signal),
        {
          signal,
          turnId: request.turnId,
          streamId: request.streamId,
          segmentId: request.segmentId,
        },
      )
    }
    catch {
      return null
    }
  }
}

/**
 * Tells the registered policy that a speech turn finished, so it can restore
 * its preferred target. No-op (and never throws) when no policy is registered.
 */
export function notifySpeechTtsTurnEnded(): void {
  const onTurnEnded = speechTtsFallbackPolicy?.onTurnEnded
  if (!onTurnEnded)
    return

  void Promise.resolve(onTurnEnded()).catch((error) => {
    console.warn('[Speech Pipeline] TTS fallback policy onTurnEnded failed', { error })
  })
}
