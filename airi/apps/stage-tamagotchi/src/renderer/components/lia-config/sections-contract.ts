/**
 * Section contract for the unified "Configurar Lia" panel.
 *
 * These ids are stable contract values rather than labels: tests and any future
 * deep link refer to them, while the visible labels stay translatable. Keeping
 * the list here means the panel, the tests and later phases agree on the shape
 * of the screen without importing a component.
 *
 * Phase 4E-1 fixes the structure. Sections are expected to grow their own
 * editors without changing these ids.
 */
export type LiaConfigSectionId = 'ai' | 'personality' | 'voice' | 'appearance'

export interface LiaConfigSection {
  id: LiaConfigSectionId
  /** Suffix under `tamagotchi.home.config.sections.<id>`. */
  summaryKey: string
}

export const LIA_CONFIG_SECTIONS: readonly LiaConfigSection[] = [
  { id: 'ai', summaryKey: 'sections.ai.summary' },
  { id: 'personality', summaryKey: 'sections.personality.summary' },
  { id: 'voice', summaryKey: 'sections.voice.summary' },
  { id: 'appearance', summaryKey: 'sections.appearance.summary' },
]

/** The section shown when the panel opens. */
export const LIA_CONFIG_DEFAULT_SECTION: LiaConfigSectionId = 'ai'

/**
 * Appearance contract, declared now and implemented in the Avatar/VRM phase.
 *
 * Deliberately mechanism-agnostic: whether an outfit ends up as a VRM variant,
 * a separate prefab or something else is decided later, so this only names the
 * slots the UX has to be able to change independently.
 */
export interface LiaAppearanceContract {
  /** Base avatar asset, e.g. `Lia.vrm`. */
  avatar: string | null
  /** Independent outfit slot: escolar, praia, inverno, ... */
  outfit: string | null
  /** Independent accessory slot: óculos, presilhas, ... */
  accessory: string | null
  /** Expressive state: normal, concentrada, relaxada, ... */
  state: string | null
}

/** Nothing is wired yet; the section renders this empty contract. */
export const LIA_APPEARANCE_CONTRACT: LiaAppearanceContract = {
  avatar: null,
  outfit: null,
  accessory: null,
  state: null,
}
