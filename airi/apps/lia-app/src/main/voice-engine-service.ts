import type { LiaProductConfigSnapshot } from '@lia/core/product/config'
import type { KokoroLayout } from '@lia/core/voice/engines/kokoro'
import type { LiaVoiceEngineDescriptor, LiaVoiceEngineSelection } from '@lia/core/voice/engines/registry'

import type { LiaVoiceInstallInspector } from './voice-install-inspector'

import { defaultKokoroInstallDeps, ensureKokoroInstalled, resolveKokoroLayout } from '@lia/core/voice/engines/kokoro'
import { describeVoiceEngineOptions, resolveVoiceEngineSelection } from '@lia/core/voice/engines/registry'

/**
 * Phase 7.9G: the product-facing Voice Engine surface for the launcher.
 *
 * What this module owns (and what it refuses to own):
 * - it composes the 7.9F selection/resolution model, the 7.9E.2 REAL
 *   install proof and the Kokoro ENGINE's own installer
 *   (`ensureKokoroInstalled` - idempotent, marker-pinned, writes its
 *   durable state LAST) into ONE simple surface for the Voice screen:
 *   install state, one install action, and selection truth;
 * - ALL layout knowledge stays with the engine (`resolveKokoroLayout`);
 *   WHERE the runtime lives (canonical default vs. user-picked location)
 *   comes from the host's `runtimeLocationStatus` - this module never
 *   derives a path on its own;
 * - installation is asynchronous, single-flight and restart-safe BY THE
 *   ENGINE (its markers skip done work); the renderer never spawns, never
 *   writes JSON and never touches model files;
 * - renderer-facing state stays product vocabulary: not-installed /
 *   installing / ready / unavailable. Technical failures surface as
 *   metadata-only events - table stakes for the log rail, never UI copy.
 */
export interface LiaVoiceEngineServiceDeps {
  /**
   * The EFFECTIVE runtime home (canonical default or the user-picked
   * location), resolved by the host - the single source for WHERE.
   */
  effectiveHome: () => Promise<string>
  /** The 7.9E.2 real proof (read-only) against the effective home. */
  inspector: LiaVoiceInstallInspector
  /** Never-secret host event sink (same rail every host event rides). */
  onEvent: (event: string, detail?: string) => void
  /**
   * The engine-owned install path; tests replace it. Production default is
   * `ensureKokoroInstalled` over the engine's own layout - the exact steps
   * pinned/download/ci-verified under the engine's authority.
   */
  installImpl?: (layout: KokoroLayout, onStep: (step: string, detail?: string) => void) => Promise<void>
  /** The product document as-is (selection reads the canonical field). */
  snapshot: () => Promise<LiaProductConfigSnapshot | undefined>
}

/** Install-action state machine, in product vocabulary. */
export type LiaVoiceInstallPhase = 'error' | 'idle' | 'installing'

/** The whole Voice Engine surface the renderer needs. */
export interface LiaVoiceEngineSurfaceState {
  /** Engine rows (empty when an unknown engine was configured). */
  engines: LiaVoiceEngineDescriptor[]
  /** The pinned id a fresh install cannot satisfy, when that is the honest situation. */
  unknownConfiguredId?: string
  phase: LiaVoiceInstallPhase
  /** The selected engine id when the selection resolved one. */
  selectedId?: string
}

/** Install action outcomes, machine-shaped: the renderer picks the copy. */
export type LiaVoiceInstallResult
  = | { status: 'installed' }
    | { status: 'running' } // a user asked again mid-run: nothing doubles
    | { status: 'failed' }

/** The engine ids this launcher can build today (7.9F ownership: host seam). */
const LAUNCHER_ENGINE_IDS = ['kokoro'] as const

const INSTALL_EVENT = 'lia-app.voice-install'

/** Never-explodes message extraction (same contract as the host's reason()). */
function messageOf(thrown: unknown): string {
  try {
    if (thrown instanceof Error)
      return thrown.message
    return String(thrown)
  }
  catch {
    return 'unknown'
  }
}

export function createLiaVoiceEngineService(deps: LiaVoiceEngineServiceDeps): {
  install: () => Promise<LiaVoiceInstallResult>
  state: () => Promise<LiaVoiceEngineSurfaceState>
} {
  /** The engine's own installer; the whole seam is replaceable in tests. */
  const installImpl = deps.installImpl
    ?? (async (layout: KokoroLayout, onStep: (step: string, detail?: string) => void) => {
      await ensureKokoroInstalled(layout, {
        ...defaultKokoroInstallDeps(),
        log: entry => onStep(typeof entry.step === 'string' ? entry.step : 'install', typeof entry.detail === 'string' ? entry.detail : undefined),
      })
    })

  let phase: LiaVoiceInstallPhase = 'idle'

  /** Install events keep engine ids + step metadata only. */
  function publish(detail: string): void {
    deps.onEvent(INSTALL_EVENT, detail)
  }

  function selectionFor(snapshot: LiaProductConfigSnapshot | undefined): LiaVoiceEngineSelection {
    // Canonical 7.9F field, read from the typed snapshot - the renderer
    // never resolves engine ids on its own.
    const preferred = snapshot?.voice?.engine?.preferred
    return resolveVoiceEngineSelection({
      availableEngineIds: [...LAUNCHER_ENGINE_IDS],
      ...(preferred !== undefined ? { preferred } : {}),
    })
  }

  async function state(): Promise<LiaVoiceEngineSurfaceState> {
    const [snapshot, home] = await Promise.all([deps.snapshot(), deps.effectiveHome()])
    const selection = selectionFor(snapshot)
    let provenInstalled = false
    let probeFailed = false
    try {
      // The 7.9E.2 production proof answers "installed?" for every engine
      // the launcher can build (Kokoro today); its honesty is the engine's.
      provenInstalled = await deps.inspector(home)
    }
    catch (thrown) {
      probeFailed = true
      publish(`reason=inspect-failed detail=${messageOf(thrown)}`)
    }
    const installProof = (engineId: string) => provenInstalled && (LAUNCHER_ENGINE_IDS as readonly string[]).includes(engineId)
    // The authoritative 7.9F contract, mirrored on the surface: a pinned
    // engine this build cannot construct lists NOTHING - honest unavailable,
    // never a leftover row inviting a selection that would not work.
    const engines = selection.unknownConfiguredId
      ? []
      : describeVoiceEngineOptions({ installed: installProof, selection })
    return {
      engines,
      ...(selection.engineId ? { selectedId: selection.engineId } : {}),
      phase: probeFailed && phase === 'idle' ? 'error' : phase,
      ...(selection.unknownConfiguredId ? { unknownConfiguredId: selection.unknownConfiguredId } : {}),
    }
  }

  async function install(): Promise<LiaVoiceInstallResult> {
    if (phase === 'installing')
      return { status: 'running' }

    phase = 'installing'
    publish('phase=installing')

    try {
      const runtimeRoot = await deps.effectiveHome()
      // The ENGINE owns its tree: the layout it declares for this runtime
      // root is passed WHOLE - no path is ever hand-composed here.
      const layout = resolveKokoroLayout({ home: runtimeRoot })
      await installImpl(layout, (step) => {
        publish(`phase=installing step=${step}`)
      })
      phase = 'idle'
      publish('result=ready')
      return { status: 'installed' }
    }
    catch (thrown) {
      phase = 'error'
      publish(`result=failed detail=${messageOf(thrown)}`)
      return { status: 'failed' }
    }
  }

  return { install, state }
}
