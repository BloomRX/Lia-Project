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
