import type { LiaProductConfigSnapshot } from '@lia/core/product/config'

import { readVoiceEnabledConfig, readVoiceEngineConfig } from '@lia/core/voice/config'
import { resolveVoiceEngineSelection } from '@lia/core/voice/engines/registry'

/**
 * Phase 7.9H: automatic first-run voice provisioning.
 *
 * The normal experience: Lia starts, checks the required enabled
 * capabilities, prepares the missing basic local voice components by
 * herself, shows understandable progress, and becomes voice-ready - no
 * technical page visit required. The manual "Instalar voz" action from
 * Phase 7.9G remains, in the role of retry/recovery.
 *
 * What this module owns:
 * - the SMALL product-level readiness model (disabled/checking/missing/
 *   preparing/ready/error) and its honest transitions;
 * - exactly-one-attempt semantics: decisions are serialized and any
 *   reconcile/retry that meets an in-flight attempt JOINS it - duplicate
 *   checks never start duplicate installs;
 * - delegation of ALL real work: install proof comes from the 7.9E.2
 *   inspector, installation from the engine-owned `ensureKokoroInstalled`
 *   through the SAME 7.9G service seam the manual card uses (their
 *   single-flight guards compose), and the runtime home from the host's
 *   effective resolution (QA `voice.runtime.installDir` override keeps
 *   working untouched).
 *
 * What it refuses to own: engine knowledge beyond the shipped selection
 * model (a configured-but-unknown engine is reported honestly, never
 * silently swapped), cancellation (the engine installer has no safe
 * cancel - none is invented; a disable mid-flight flips the product state
 * while the attempt finishes quietly), and fake progress (step metadata
 * only - never invented percentages).
 */

export type LiaVoiceProvisioningState = 'checking' | 'disabled' | 'error' | 'missing' | 'preparing' | 'ready'

export interface LiaVoiceProvisioningStatus {
  /** Machine-readable step id (python/pip/model/voices/...) for diagnostics. */
  step?: string
  /** Metadata-only failure detail (never user-facing copy). */
  errorDetail?: string
  /** The engine this readiness refers to (only shipped engines are provisioned). */
  engineId?: string
  /** Whether a failed state can be retried by the user. */
  retryable?: boolean
  state: LiaVoiceProvisioningState
}

export interface LiaVoiceInstallOutcome { status: 'failed' | 'installed' | 'running' }

export interface LiaVoiceProvisioningDeps {
  /** The host's effective runtime home (honors the QA installDir override). */
  effectiveHome: () => Promise<string>
  /** Real install proof (7.9E.2 inspector) against one runtime home. */
  isInstalled: (runtimeHome: string) => Promise<boolean>
  /**
   * The ONE production install path, shared with the manual card. Returns
   * `running` when an attempt is already in flight elsewhere.
   */
  install: () => Promise<LiaVoiceInstallOutcome>
  /**
   * Completion/step events of the shared install path
   * (`lia-app.voice-install` details: `phase=installing step=...`,
   * `result=ready`, `result=failed detail=...`).
   */
  installEvents: (listener: (event: string, detail?: string) => void) => () => void
  /** Current product snapshot (voice.enabled + engine selection live here). */
  snapshot: () => Promise<LiaProductConfigSnapshot | undefined>
  /** Bounded status sink - every transition rides the rail once. */
  onStatus: (status: LiaVoiceProvisioningStatus) => void
}

const PROVISIONED_ENGINE_ID = 'kokoro'
const VOICE_INSTALL_EVENT = 'lia-app.voice-install'

export interface LiaVoiceProvisioning {
  status: () => LiaVoiceProvisioningStatus
  /** Re-derive readiness from current config + disk facts. Idempotent. */
  reconcile: (reason?: string) => Promise<LiaVoiceProvisioningStatus>
  /** One NEW attempt after an error (or from missing). Joins in-flight work. */
  retry: () => Promise<LiaVoiceProvisioningStatus>
}

export function createLiaVoiceProvisioning(deps: LiaVoiceProvisioningDeps): LiaVoiceProvisioning {
  let current: LiaVoiceProvisioningStatus = { state: 'checking' }
  let decisionChain: Promise<void> = Promise.resolve()
  let stepListenerOff: (() => void) | undefined

  function transition(next: LiaVoiceProvisioningStatus): LiaVoiceProvisioningStatus {
    current = next
    deps.onStatus(next)
    return current
  }

  /** Serializes DECISIONS only - an in-flight install never blocks them. */
  function decide(run: () => Promise<LiaVoiceProvisioningStatus>): Promise<LiaVoiceProvisioningStatus> {
    const next = decisionChain.then(run, run)
    decisionChain = next.then(() => undefined, () => undefined)
    return next
  }

  /** Waits for the shared install path to settle into ready/failed. */
  function waitForInstallResult(): Promise<'failed' | 'ready'> {
    return new Promise((resolve) => {
      const off = deps.installEvents((event, detail) => {
        if (event !== VOICE_INSTALL_EVENT)
          return
        if (detail?.startsWith('result=ready')) {
          off()
          resolve('ready')
        }
        else if (detail?.startsWith('result=failed')) {
          off()
          resolve('failed')
        }
      })
    })
  }

  /**
   * Runs the attempt detached from the decision chain. The first transition
   * (preparing) happens synchronously at call time, so a serialized caller
   * observes it immediately after.
   */
  function startProvisioning(): void {
    transition({ engineId: PROVISIONED_ENGINE_ID, state: 'preparing' })
    stepListenerOff?.()
    stepListenerOff = deps.installEvents((event, detail) => {
      if (event !== VOICE_INSTALL_EVENT || current.state !== 'preparing')
        return
      const step = detail?.match(/step=(\S+)/)?.[1]
      if (step)
        transition({ engineId: PROVISIONED_ENGINE_ID, state: 'preparing', step })
    })

    void (async () => {
      const outcome = await deps.install()
      let result: 'failed' | 'ready'
      if (outcome.status === 'installed') {
        result = 'ready'
      }
      else if (outcome.status === 'failed') {
        result = 'failed'
      }
      else {
        // Someone else owns the attempt - join it instead of starting another.
        result = await waitForInstallResult()
      }
      stepListenerOff?.()
      stepListenerOff = undefined

      // A disable/re-enable decision during the attempt wins over the
      // completion: the product state stays whatever the user last chose.
      if (current.state !== 'preparing')
        return
      if (result === 'ready')
        transition({ engineId: PROVISIONED_ENGINE_ID, state: 'ready' })
      else
        transition({ engineId: PROVISIONED_ENGINE_ID, errorDetail: 'install-failed', retryable: true, state: 'error' })
    })()
  }

  async function reconcileEnabled(snapshot: LiaProductConfigSnapshot | undefined): Promise<LiaVoiceProvisioningStatus> {
    const selection = resolveVoiceEngineSelection({
      availableEngineIds: [PROVISIONED_ENGINE_ID],
      preferred: readVoiceEngineConfig(snapshot?.voice).preferred,
    })
    if (selection.unknownConfiguredId) {
      // Honest unavailable - provisioning never silently swaps engines.
      return transition({ engineId: selection.unknownConfiguredId, errorDetail: 'unknown-configured-engine', retryable: false, state: 'error' })
    }
    if (current.state === 'preparing')
      return current

    const runtimeHome = await deps.effectiveHome()
    transition({ engineId: PROVISIONED_ENGINE_ID, state: 'checking' })
    let installed = false
    try {
      installed = await deps.isInstalled(runtimeHome)
    }
    catch {
      installed = false
    }
    if (installed)
      return transition({ engineId: PROVISIONED_ENGINE_ID, state: 'ready' })

    transition({ engineId: PROVISIONED_ENGINE_ID, state: 'missing' })
    startProvisioning()
    return current
  }

  return {
    reconcile: () => decide(async () => {
      const snapshot = await deps.snapshot()
      if (!readVoiceEnabledConfig(snapshot?.voice))
        return current.state === 'disabled' ? current : transition({ state: 'disabled' })
      return await reconcileEnabled(snapshot)
    }),
    retry: () => decide(async () => {
      if (current.state !== 'error' && current.state !== 'missing')
        return current
      // Non-retryable errors (e.g. a configured engine this build cannot
      // construct) stay honest - retrying would install the wrong thing.
      if (current.retryable === false)
        return current
      startProvisioning()
      return current
    }),
    status: () => current,
  }
}
