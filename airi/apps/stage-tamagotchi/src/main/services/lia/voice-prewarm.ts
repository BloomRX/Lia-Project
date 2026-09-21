import type { LiaVoiceEngine } from '@lia/core/voice/engines/types'

import { errorMessageFrom } from '@moeru/std'

/**
 * Phase 7.9E, item 1: the managed-launch voice PREWARM.
 *
 * The engine lifecycle already knows how to start (spawn worker, load the
 * model, answer health) and how to fail honestly when the runtime is not
 * installed - this module never re-implements any of that. Its whole job
 * is TIMING: under a real managed Stage launch (LIA_MANAGED=1) the engine
 * cold start is invited to happen BEHIND the Stage boot, so the first
 * audible turn (or the one startup greeting) does not pay it in the open.
 *
 * Guarantees pinned by tests:
 * - constructing the handle NEVER waits on the engine: `settled` is the
 *   only promise, and no caller is forced to await it;
 * - engines start sequentially and each `start()` is called exactly once
 *   (the engine contract itself is idempotent; we still never double-fire);
 * - any failure degrades silently to voice-unavailable plus ONE diagnostics
 *   line - prewarm errors can never crash the Stage;
 * - a non-managed launch keeps the historical lazy start untouched.
 */

export interface LiaVoicePrewarmLogEntry {
  event: 'lia.voice.prewarm'
  managed: boolean
  engine?: string
  ok?: boolean
  ms?: number
  note?: string
}

export interface LiaVoicePrewarmOptions {
  engines: LiaVoiceEngine[]
  /** Honest product fact (`isLauncherManaged()`), decided by the host. */
  managedLaunch: boolean
  log?: (entry: LiaVoicePrewarmLogEntry) => void
  now?: () => number
  /**
   * Fire-and-forget hook after the whole attempt settled (used by the host
   * to recompute capability snapshots so a warmed engine turns the UI's
   * voice truth to "available" without user action).
   */
  onSettled?: () => void
}

export interface LiaVoicePrewarmHandle {
  /** Resolves after the prewarm attempt settled. NEVER rejects. */
  settled: Promise<void>
  /** Ids of the engines confirmed started by THIS prewarm, in warm order. */
  readyEngines: () => string[]
}

function errorNote(error: unknown): string {
  return errorMessageFrom(error).replace(/\s+/g, ' ').trim().slice(0, 160)
}

export function prewarmManagedVoice(options: LiaVoicePrewarmOptions): LiaVoicePrewarmHandle {
  const { engines, managedLaunch } = options
  const log = options.log ?? (() => undefined)
  const now = options.now ?? Date.now
  const ready: string[] = []

  const settled = (async (): Promise<void> => {
    if (!managedLaunch) {
      // Standalone semantics stay byte-identical to before 7.9E: the engine
      // starts on first use, exactly as it always did.
      log({ event: 'lia.voice.prewarm', managed: false, note: 'standalone launch keeps lazy engine start' })
      return
    }
    if (engines.length === 0) {
      log({ event: 'lia.voice.prewarm', managed: true, note: 'no engines registered at the host seam' })
      return
    }

    // Sequential on purpose: a voice engine owns a real worker process and
    // the host machine warms one at a time - "as early as safely possible"
    // is still one python spawn + model load behind the boot.
    for (const engine of engines) {
      const startedAt = now()
      try {
        await engine.start()
        ready.push(engine.id)
        log({ event: 'lia.voice.prewarm', managed: true, engine: engine.id, ok: true, ms: now() - startedAt })
      }
      catch (error) {
        // Degrade, never crash: the most common cause is "runtime not
        // installed yet" (first-run state, install is the user's explicit
        // action), so the Stage simply keeps answering voice-unavailable.
        log({ event: 'lia.voice.prewarm', managed: true, engine: engine.id, ok: false, ms: now() - startedAt, note: errorNote(error) })
      }
    }
  })()

  // A settle can never surface as an unhandled rejection anywhere.
  const guarded = settled.catch(() => undefined)
  void guarded.then(() => options.onSettled?.()).catch(() => undefined)

  return {
    settled: guarded,
    readyEngines: () => [...ready],
  }
}
