import type { IntentHandle } from '@proj-airi/pipelines-audio'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useSpeechRuntimeStore } from '@proj-airi/stage-ui/stores/speech-runtime'

import {
  electronLiaVoiceStartupGreetingClaim,
  electronLiaVoiceStatus,
} from '../../../shared/eventa'
import { resolveRendererWindowContext } from '../../window-context'

/**
 * Phase 7.9E, items 2-5 (renderer half): Lia's ONE startup greeting.
 *
 * This is PRODUCT/speech orchestration, on purpose far from any engine:
 * - the text comes from a small LOCAL pt-BR pool - never an LLM call,
 *   never a hardcoded audio file;
 * - the utterance enters the NORMAL speech pipeline as an ordinary intent
 *   (`openIntent -> writeLiteral -> writeFlush -> end`, the exact shape
 *   character dialogue already uses), so the deterministic text-for-speech
 *   normalizer, the selected TTS engine and the playback manager all touch
 *   it exactly like a chat turn - that is what makes it the first real
 *   inference warmup, and it is also why a future TTS -> RVC -> playback
 *   converter inserted in that same pipeline will cover it for free;
 * - "one per real managed Stage launch" is enforced by the MAIN-process
 *   latch (renderer reload/HMR rebuilds this module - the latch survives),
 *   and a shutdown cancels a still-pending greeting honestly.
 *
 * Kokoro never knows a "startup greeting" concept exists.
 */

/**
 * The exact local pool (small, spoken pt-BR, content-addressed by index).
 */
export const LIA_STARTUP_GREETING_POOL = [
  'Oi! Estou pronta quando você quiser conversar.',
  'Oi! Já estou por aqui. Como posso te ajudar?',
  'Olá! Minha voz já está aquecida para você.',
  'Oi! Que bom te ver por aqui.',
] as const

export type LiaStartupGreetingOutcome
  = | 'spoken'
    | 'unmanaged'
    | 'voice-unavailable'
    | 'no-speech-host'
    | 'already-claimed'
    | 'claim-failed'
    | 'cancelled'

export type LiaStartupGreetingCancelReason = string

export interface LiaStartupGreetingLogEntry {
  event: 'lia.voice.startup-greeting'
  outcome?: LiaStartupGreetingOutcome
  /**
   * Pool index only - never message content (there is nothing private in
   * the pool, but metadata-only stays the house rule).
   */
  poolIndex?: number
  readyWaitMs?: number
  note?: string
}

export interface LiaStartupGreetingOptions {
  /** Honest product fact from the window context (lia-managed query). */
  managedLaunch: boolean
  /** IPC fact: current voice readiness through the engine-neutral bridge. */
  voiceStatus: () => Promise<{ state: string }>
  /** IPC exactly-once latch (main-process lifetime). */
  claimGreeting: () => Promise<{ granted: boolean }>
  /**
   * The normal speech pipeline intent factory. MUST answer `undefined`
   * while the Stage scene has not registered the speech host yet - the
   * scheduler polls instead of dropping utterances into a void.
   */
  openIntent: (options: { behavior: 'queue', ownerId: string, priority: 'normal' }) => IntentHandle | undefined
  /** Injected clock seams: tests sleep zero and still exercise every wait. */
  sleep: (ms: number) => Promise<void>
  now?: () => number
  random?: () => number
  /** Total budget for BOTH waits (voice ready, then speech host). */
  waitBudgetMs?: number
  pollIntervalMs?: number
  /** Acoustic identity intent fields; never a persona/visible-chat branch. */
  intentOwnerId?: string
  log?: (entry: LiaStartupGreetingLogEntry) => void
}

export interface LiaStartupGreetingHandle {
  /** Resolves with the honest outcome. NEVER rejects. */
  done: Promise<LiaStartupGreetingOutcome>
  /** Idempotent: Stage shutdown (beforeunload) or tests call this. */
  cancel: (reason?: LiaStartupGreetingCancelReason) => void
}

export function pickLiaStartupGreeting(pool: readonly string[], random: () => number = Math.random): { poolIndex: number, text: string } {
  const poolIndex = Math.min(pool.length - 1, Math.floor(random() * pool.length))
  return { poolIndex, text: pool[poolIndex]! }
}

export function scheduleLiaStartupGreeting(options: LiaStartupGreetingOptions): LiaStartupGreetingHandle {
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random
  const waitBudgetMs = options.waitBudgetMs ?? 45_000
  const pollIntervalMs = options.pollIntervalMs ?? 1_000
  const intentOwnerId = options.intentOwnerId ?? 'lia-startup-greeting'
  const log = options.log ?? (() => undefined)

  let cancelReason: string | undefined
  let intent: IntentHandle | undefined

  // `cancel()` writes this from outside the flow; the accessor keeps the
  // loop conditions honest for the consumer (and the loop-lint) without
  // changing the semantics: a single first-wins cancel.
  const isCancelled = () => cancelReason !== undefined

  const done = (async (): Promise<LiaStartupGreetingOutcome> => {
    if (!options.managedLaunch) {
      // Standalone stages never greet: the managed shell is the product
      // moment this belongs to. The latch is not touched here at all.
      log({ event: 'lia.voice.startup-greeting', outcome: 'unmanaged' })
      return 'unmanaged'
    }

    const startedAt = now()
    const deadline = startedAt + waitBudgetMs

    // 1. Wait for the voice to answer READY (the managed prewarm hides the
    //    usual cold start; a first-run box without the runtime fails this
    //    wait politely after the budget).
    let ready = false
    while (!isCancelled()) {
      const status = await options.voiceStatus().catch(() => undefined)
      if (status?.state === 'ready') {
        ready = true
        break
      }
      if (now() >= deadline)
        break
      await options.sleep(pollIntervalMs)
    }
    if (isCancelled())
      return finish('cancelled', { note: cancelReason })
    if (!ready)
      return finish('voice-unavailable', { readyWaitMs: now() - startedAt })
    const readyWaitMs = now() - startedAt

    // 2. Wait for the speech HOST to exist (Stage.vue registers it when the
    //    scene mounts). The same budget covers this: a stage without a
    //    speech host simply cannot greet audibly this launch.
    while (!isCancelled() && intent === undefined) {
      intent = options.openIntent({ behavior: 'queue', ownerId: intentOwnerId, priority: 'normal' })
      if (intent)
        break
      if (now() >= deadline)
        break
      await options.sleep(pollIntervalMs)
    }
    if (cancelReason !== undefined) {
      intent?.cancel(cancelReason)
      return finish('cancelled', { note: cancelReason })
    }
    if (!intent)
      return finish('no-speech-host', { readyWaitMs })

    // 3. Claim the launch's single slot BEFORE writing anything: a reload
    //    racing mid-greeting can never double-speak, because the claim is
    //    the gate and it lives under the main process.
    const claim = await options.claimGreeting().catch(() => undefined)
    if (cancelReason !== undefined) {
      intent.cancel(cancelReason)
      return finish('cancelled', { note: cancelReason })
    }
    if (!claim)
      return finish('claim-failed', { intent })
    if (!claim.granted)
      return finish('already-claimed', { intent })

    // 4. ONE utterance down the ordinary pipeline. `end()` hands it over;
    //    playback finishing later is the pipeline's business, not ours.
    const { poolIndex, text } = pickLiaStartupGreeting(LIA_STARTUP_GREETING_POOL, random)
    log({ event: 'lia.voice.startup-greeting', poolIndex, readyWaitMs })
    intent.writeLiteral(text)
    intent.writeFlush()
    intent.end()
    return 'spoken'
  })()

  function finish(outcome: LiaStartupGreetingOutcome, extra: { intent?: IntentHandle, note?: string, readyWaitMs?: number } = {}): LiaStartupGreetingOutcome {
    // A claim we did not win leaves the intent pristine but unneeded: close
    // it politely so it never holds a queue slot.
    if (outcome === 'already-claimed' || outcome === 'claim-failed')
      extra.intent?.cancel(outcome)
    if (outcome !== 'spoken')
      log({ event: 'lia.voice.startup-greeting', outcome, ...(extra.readyWaitMs !== undefined ? { readyWaitMs: extra.readyWaitMs } : {}), ...(extra.note ? { note: extra.note } : {}) })
    return outcome
  }

  const guarded = done.catch(() => 'cancelled' as LiaStartupGreetingOutcome)

  return {
    done: guarded,
    cancel: (reason?: LiaStartupGreetingCancelReason) => {
      if (cancelReason !== undefined)
        return
      cancelReason = reason ?? 'stage-shutdown'
      intent?.cancel(cancelReason)
    },
  }
}

/**
 * The desktop wiring: one scheduling call per RENDERER lifetime (module
 * scope imports this once). The duplicates this cannot stop by itself -
 * reloads - are stopped by the main-process latch inside the flow.
 */
export function installLiaStartupGreeting(pinia: Parameters<typeof useSpeechRuntimeStore>[0]): LiaStartupGreetingHandle {
  const voiceStatus = useElectronEventaInvoke(electronLiaVoiceStatus)
  const claimGreeting = useElectronEventaInvoke(electronLiaVoiceStartupGreetingClaim)
  const speechRuntime = () => useSpeechRuntimeStore(pinia)

  const handle = scheduleLiaStartupGreeting({
    claimGreeting: async () => claimGreeting(),
    log: entry => console.info('[lia.voice.startup-greeting]', Object.entries(entry).map(([key, value]) => `${key}=${String(value)}`).join(' ')),
    managedLaunch: resolveRendererWindowContext().liaManaged,
    openIntent: (intentOptions) => {
      // No speech host yet (scene not mounted) -> the scheduler must retry,
      // not speak into the void: tokens of a host-less intent go nowhere.
      if (!speechRuntime().isHost())
        return undefined
      return speechRuntime().openIntent(intentOptions) as unknown as IntentHandle
    },
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    voiceStatus: async () => voiceStatus(),
  })

  // Stage shutdown cancels a still-pending greeting honestly. beforeunload
  // also covers dev reloads, where cancelling a half-written intent is the
  // difference between a clean re-mount and a stray half-utterance.
  globalThis.addEventListener?.('beforeunload', () => handle.cancel('stage-window-unload'))

  // The outcome is diagnostics-only, but a rejection must be impossible.
  void handle.done.then(outcome => console.info('[lia.voice.startup-greeting] outcome=%s', outcome))

  return handle
}
