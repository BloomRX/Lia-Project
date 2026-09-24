import type { LiaVoiceEngineSurfaceState } from '../../../main/voice-engine-service'
import type { LiaVoiceProvisioningStatus } from '../../../main/voice-provisioning'
import type { LiaVoiceEngineStringKey } from '../voice-engine-strings'

import { pickVoiceEngineLocale, voiceEngineText } from '../voice-engine-strings'

/**
 * Phase 7.9G: the Voice Engine card's view-model - framework-free, so the
 * product rules here are unit-tested WITHOUT a DOM (the launcher test
 * environment is node-only by design): which state label an engine row
 * shows, which action is enabled, and the exact config payload a selection
 * writes. The .vue file is a thin template over these functions.
 */

export interface VoiceEngineRowVm {
  canInstall: boolean
  canSelect: boolean
  id: string
  selectable: boolean
  selected: boolean
  stateKey: LiaVoiceEngineStringKey
  userFacingName: string
}

export interface VoiceEngineCardVm {
  /** Banner under the card title, when one applies. */
  hintKey?: LiaVoiceEngineStringKey
  locale: ReturnType<typeof pickVoiceEngineLocale>
  rows: VoiceEngineRowVm[]
  title: string
  /** True when the configured engine cannot be built at all (honest). */
  unavailable: boolean
}

const READY: LiaVoiceEngineStringKey = 'lia.voice.engines.state.ready'
const NOT_INSTALLED: LiaVoiceEngineStringKey = 'lia.voice.engines.state.notInstalled'
const INSTALLING: LiaVoiceEngineStringKey = 'lia.voice.engines.state.installing'
const UNAVAILABLE: LiaVoiceEngineStringKey = 'lia.voice.engines.state.unavailable'

/**
 * Rows + banner for the surface state the MAIN process computed. The
 * renderer stays engine-neutral: names come from the descriptor's
 * `nameKey` resolved against the REAL catalog entries (7.9G ships the
 * pt-BR/en-US entries used here); unknown ids render as honestly
 * unavailable, never silently re-skinned into a fallback.
 */
export function voiceEngineCardVm(state: LiaVoiceEngineSurfaceState, languagePreference?: string): VoiceEngineCardVm {
  const locale = pickVoiceEngineLocale(languagePreference)
  const unavailable = state.unknownConfiguredId !== undefined
  const nothingInstalled = !state.engines.some(engine => engine.installed)

  const rows: VoiceEngineRowVm[] = state.engines.map((engine) => {
    const resolved = voiceEngineText(locale, engine.nameKey)
    return {
      canInstall: !unavailable && state.phase !== 'installing' && !engine.installed,
      canSelect: !unavailable && state.phase !== 'installing' && engine.installed && engine.selectable && !engine.selected,
      id: engine.id,
      selectable: engine.selectable,
      selected: engine.selected,
      stateKey: state.phase === 'installing' ? INSTALLING : engine.installed ? READY : NOT_INSTALLED,
      userFacingName: resolved === engine.nameKey ? engine.name : resolved,
    }
  })

  return {
    locale,
    rows,
    title: voiceEngineText(locale, 'lia.voice.engines.title'),
    unavailable,
    ...(unavailable
      ? { hintKey: UNAVAILABLE }
      : nothingInstalled && state.phase !== 'installing'
        ? { hintKey: 'lia.voice.engines.install.hint' as const }
        : {}),
  }
}

/**
 * THE selection write contract: the ONLY payload the card ever sends, and
 * only through the existing `lia:config:update` product writer seam. The
 * renderer never writes JSON files itself.
 */
export function voiceEngineSelectionPayload(engineId: string): { update: { voice: { engine: { preferred: string } } } } {
  return { update: { voice: { engine: { preferred: engineId } } } }
}

/**
 * Which main-process event this card subscribes to (progress + completion)
 * through the existing bounded `lia:event` channel.
 */
export const LIA_VOICE_ENGINE_EVENT = 'lia-app.voice-install'

/** Renders the state label in product words - never raw phase names. */
export function voiceEngineStateLabel(row: VoiceEngineRowVm, locale: ReturnType<typeof pickVoiceEngineLocale>): string {
  return voiceEngineText(locale, row.stateKey)
}
// ---------------------------------------------------------------------------
// Phase 7.9H: automatic first-run voice provisioning - the card's readiness
// view. The main process owns the readiness model; the renderer only maps
// states/steps to catalog copy (never invents numbers, never names
// Python/ONNX/pip/paths/backends in normal labels).
// ---------------------------------------------------------------------------

export interface VoiceProvisioningVm {
  /** True while checking/preparing - the card shows live progress copy. */
  busy: boolean
  /** Retry is offered ONLY for honest, retryable failures. */
  canRetry: boolean
  /** Voice switch as seen by the user (disabled state = off). */
  enabled: boolean
  /** Honest step label, present only while preparing. */
  progressLabel?: string
  /** The readiness line in product words. */
  stateLabel: string
  /** Accessible label for the on/off toggle. */
  toggleLabel: string
}

/** Step metadata -> the honest progress line (labels only, no percentages). */
function provisioningStepKey(step: string | undefined): LiaVoiceEngineStringKey {
  if (step === 'python' || step === 'pip')
    return 'lia.voice.provisioning.step.settingUp'
  if (step === 'model')
    return 'lia.voice.provisioning.step.voice'
  if (step === 'voices')
    return 'lia.voice.provisioning.step.finalizing'
  return 'lia.voice.provisioning.step.preparing'
}

export function voiceProvisioningVm(status: LiaVoiceProvisioningStatus | undefined, languagePreference?: string): VoiceProvisioningVm {
  const locale = pickVoiceEngineLocale(languagePreference)
  const state = status?.state ?? 'checking'

  const stateKey = `lia.voice.provisioning.state.${state}` as LiaVoiceEngineStringKey
  const enabled = state !== 'disabled'
  const busy = state === 'checking' || state === 'missing' || state === 'preparing'

  return {
    busy,
    canRetry: state === 'error' && status?.retryable !== false,
    enabled,
    ...(busy && state !== 'checking'
      ? { progressLabel: voiceEngineText(locale, provisioningStepKey(status?.step)) }
      : {}),
    stateLabel: voiceEngineText(locale, stateKey),
    toggleLabel: voiceEngineText(locale, enabled ? 'lia.voice.provisioning.disable.action' : 'lia.voice.provisioning.enable.action'),
  }
}

/**
 * THE enable/disable write contract: rides the existing canonical
 * `lia:config:update` seam, exactly like the engine selection payload.
 */
export function voiceEnabledPayload(enabled: boolean): { update: { voice: { enabled: boolean } } } {
  return { update: { voice: { enabled } } }
}

/** Readiness transitions ride the bounded rail under this event name. */
export const LIA_VOICE_READINESS_EVENT = 'lia-app.voice-readiness'
