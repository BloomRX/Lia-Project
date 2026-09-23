/**
 * Phase 7.9G: the REAL strings behind the Voice Engine card.
 *
 * The launcher has no i18n framework today (its other screens hardcode
 * pt-BR inline). This surface is the first one with a formal pt-BR/en-US
 * catalog, keyed by the SAME stable keys the 7.9F descriptor model emits
 * (e.g. `lia.voice.engines.kokoro.name`), so a future framework adoption
 * becomes a mechanical move - no rename, no re-key.
 *
 * Product vocabulary only: a normal user reads "Voz da Lia", "Kokoro",
 * "Pronto", "Selecionado" - never engine/backend/runtime jargon.
 */

/** Every key the Voice Engine card may resolve, per locale. */
export const LIA_VOICE_ENGINE_STRINGS = {
  'en-US': {
    'lia.voice.engines.install.action': 'Install voice',
    'lia.voice.engines.install.failed': 'The voice could not finish installing. Try again.',
    'lia.voice.engines.install.hint': 'Installs a new local Lia voice on this computer. It takes a few minutes on the first time.',
    'lia.voice.engines.kokoro.name': 'Kokoro',
    'lia.voice.engines.select.action': 'Select',
    'lia.voice.engines.selected': 'Selected',
    'lia.voice.engines.state.installing': 'Installing',
    'lia.voice.engines.state.notInstalled': 'Not installed',
    'lia.voice.engines.state.ready': 'Ready',
    'lia.voice.engines.state.unavailable': 'Unavailable',
    'lia.voice.engines.title': 'Lia voice',
  },
  'pt-BR': {
    'lia.voice.engines.install.action': 'Instalar voz',
    'lia.voice.engines.install.failed': 'Não foi possível concluir a instalação da voz. Tente novamente.',
    'lia.voice.engines.install.hint': 'Instala uma nova voz local da Lia neste computador. Na primeira vez, pode levar alguns minutos.',
    'lia.voice.engines.kokoro.name': 'Kokoro',
    'lia.voice.engines.select.action': 'Selecionar',
    'lia.voice.engines.selected': 'Selecionado',
    'lia.voice.engines.state.installing': 'Instalando…',
    'lia.voice.engines.state.notInstalled': 'Não instalado',
    'lia.voice.engines.state.ready': 'Pronto',
    'lia.voice.engines.state.unavailable': 'Não disponível',
    'lia.voice.engines.title': 'Voz da Lia',
  },
} as const

export type LiaVoiceEngineLocale = keyof typeof LIA_VOICE_ENGINE_STRINGS
export type LiaVoiceEngineStringKey = keyof typeof LIA_VOICE_ENGINE_STRINGS['pt-BR']

/**
 * The launcher's language pick for THIS surface: an explicit English
 * preference selects en-US; everything else keeps the product's current
 * pt-BR voice (the whole app ships pt-BR today).
 */
export function pickVoiceEngineLocale(preference: string | undefined): LiaVoiceEngineLocale {
  if (typeof preference === 'string' && preference.trim().toLowerCase().startsWith('en'))
    return 'en-US'
  return 'pt-BR'
}

/** Template-less interpolation: `{count}` style slots. */
export function voiceEngineText(locale: LiaVoiceEngineLocale, key: string, vars?: Record<string, string | number>): string {
  const table = LIA_VOICE_ENGINE_STRINGS[locale] as Record<string, string>
  const raw = table[key] ?? (LIA_VOICE_ENGINE_STRINGS['pt-BR'] as Record<string, string>)[key] ?? key
  if (!vars)
    return raw
  return Object.entries(vars).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), raw)
}
