/**
 * Phase 7.7, Parts 7-11: the Lia product capability port.
 *
 * What the persona is allowed to know about herself, as data. Two gates are
 * structural here, not conventional:
 *
 * - The snapshot contains PRODUCT truth only: `voice.configured`,
 *   `voice.available`, `avatar.available`. There is no AllTalk, no XTTS, no
 *   port, no path, no process id (Part 7/9) - the type simply has no field
 *   to carry them, so a prompt or a log cannot leak them by accident.
 *
 * - An authoritative host (the desktop app, whose MAIN process computes the
 *   truth - Part 10) installs the latest snapshot with
 *   `setLiaCapabilitySnapshot`; the renderer never *computes* it. The chat
 *   core reads context providers synchronously at a turn boundary (Part 11),
 *   which is why the port holds the last-good snapshot the host has already
 *   resolved - refreshing it is the host's job, done BETWEEN turns and never
 *   mid-generation.
 *
 * Without any installed snapshot the context provider injects NOTHING: a
 * non-desktop build must not fabricate capabilities in either direction.
 */

export interface LiaCapabilitySnapshot {
  voice: {
    /** A voice is selected and its profile is valid. */
    configured: boolean
    /** Voice output can actually play right now. */
    available: boolean
  }
  avatar: {
    /** A stage avatar is present and rendering. */
    available: boolean
  }
}

let installedSnapshot: LiaCapabilitySnapshot | undefined
let refreshHook: (() => Promise<void>) | undefined

/** Installs the latest authoritative snapshot. Called by the host only. */
export function setLiaCapabilitySnapshot(snapshot: LiaCapabilitySnapshot | undefined): void {
  installedSnapshot = snapshot
}

export function getLiaCapabilitySnapshot(): LiaCapabilitySnapshot | undefined {
  return installedSnapshot
}

/**
 * Registers the host's between-turn refresh (Part 11). Stage.vue calls it at
 * the message-composed boundary; without a host it simply never fires.
 */
export function setLiaCapabilityRefreshHook(hook: (() => Promise<void>) | undefined): void {
  refreshHook = hook
}

export function getLiaCapabilityRefreshHook(): (() => Promise<void>) | undefined {
  return refreshHook
}

/** Deterministic helper for tests. */
export function resetLiaCapabilitySnapshotForTesting(): void {
  installedSnapshot = undefined
  refreshHook = undefined
}
