/**
 * Voice facts that both processes need.
 *
 * Lives in `shared/` because the main process has to answer "does the active
 * voice need the local runtime?" without importing renderer code - the renderer
 * store pulls in Vue, which has no business loading in the main process.
 *
 * The renderer keeps re-exporting this so existing imports stay valid and there
 * is still exactly one definition of the id.
 */

/**
 * The provider id a custom voice is selected under.
 *
 * A custom voice fits the existing target schema exactly - `providerId` plus a
 * `voiceId` that is the profile id - so no new configuration shape and no second
 * source of truth is needed.
 */
export const CUSTOM_VOICE_PROVIDER_ID = 'custom-local-voice'

/* --------------------------------------------------------------------------
 * Voice-runtime bootstrap
 *
 * Shared because the renderer renders the progress and the main process runs it.
 * Keeping the vocabulary here means the UI cannot invent a phase the main
 * process never emits.
 * -------------------------------------------------------------------------- */

/** Lifecycle states of the managed runtime install. */
export type LiaBootstrapPhase
  = | 'not-installed'
    | 'checking'
    | 'installing-prerequisites'
    | 'installing-runtime'
    | 'preparing-model'
    | 'verifying'
    | 'ready'
    | 'repair-needed'
    | 'failed'
    | 'cancelled'

export type LiaBootstrapStepStatus = 'done' | 'failed' | 'pending' | 'running' | 'skipped'

export interface LiaBootstrapStep {
  id: string
  status: LiaBootstrapStepStatus
  /** Short, user-safe note. Never a stack trace, never a raw path. */
  detail?: string
  elapsedMs?: number
}

export type LiaBootstrapFailureCategory
  = | 'cancelled'
    | 'disk'
    | 'download'
    | 'health'
    | 'network'
    /** The install folder has a name the installer cannot use, e.g. a space. */
    | 'path'
    | 'setup'
    | 'unsupported'

export interface LiaBootstrapState {
  phase: LiaBootstrapPhase
  steps: LiaBootstrapStep[]
  /** Set when `phase` is `failed`. A sentence, not an exception. */
  message?: string
  /** Stable id, so the UI translates without parsing prose. */
  failureCategory?: LiaBootstrapFailureCategory
  /** Installed runtime version, when known. */
  version?: string
}

/** Whether an install or repair is in flight. Drives the disabled Install button. */
export type LiaBootstrapBusy = boolean

/**
 * The phases in which an install or repair is actually running.
 *
 * This list has exactly one home because three consumers branch on it - the
 * main-process service (autostart must not race an install), the renderer store
 * (a click mid-install is a no-op) and the install card (which button shows).
 * Three copies of one list is how an install becomes "running" to one of them
 * and "idle" to another.
 */
export function isLiaBootstrapActivePhase(phase: LiaBootstrapPhase | undefined): LiaBootstrapBusy {
  return phase === 'checking' || phase === 'installing-prerequisites' || phase === 'installing-runtime'
    || phase === 'preparing-model' || phase === 'verifying'
}

/** The one action the install card may offer, derived - never stored - from the real states. */
export type LiaVoiceRuntimePrimaryAction = 'install' | 'installing' | 'none' | 'repair' | 'retry'

/**
 * What the primary button of the install card means right now.
 *
 * Round-7 hotfix contract ("a tela nunca fica sem ação quando o runtime não
 * está pronto"): every bootstrap phase maps to exactly one action, so there is
 * no branch in which a partial, failed, cancelled or never-started runtime
 * leaves the panel empty-handed. `none` is allowed only when the runtime
 * itself is healthy - then the card is not the view responsible for actions
 * (the voice panel is), and any `none` while the runtime cannot work is the
 * regression this function exists to make testable.
 *
 * Pure by design: the main process owns the state machine; a renderer-side
 * copy of it would be the second source of truth the brief forbids. The
 * function asks the real states one question (what should the one button
 * say?) instead of re-deriving them.
 */
export function resolveVoiceRuntimePrimaryAction(input: {
  bootstrap?: LiaBootstrapState
  /** Whether the voice server actually works right now. */
  runtimeReady: boolean
}): LiaVoiceRuntimePrimaryAction {
  const phase = input.bootstrap?.phase
  // In flight: the button must stay on screen, disabled - never absent.
  if (phase && isLiaBootstrapActivePhase(phase))
    return 'installing'
  // A finished install offers the same idempotent walk for maintenance.
  if (phase === 'ready' || phase === 'repair-needed')
    return 'repair'
  // A failed health check leaves the files in place; repair, not reinstall.
  if (phase === 'failed')
    return input.bootstrap?.failureCategory === 'health' ? 'repair' : 'retry'
  if (phase === 'cancelled')
    return 'retry'
  // 'not-installed', or the state has not arrived yet: the bootstrap is the
  // only way out when the runtime does not work.
  return input.runtimeReady ? 'none' : 'install'
}
