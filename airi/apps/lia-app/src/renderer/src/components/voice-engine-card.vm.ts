import type { LiaVoiceEngineSurfaceState } from '../../../main/voice-engine-service'
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
