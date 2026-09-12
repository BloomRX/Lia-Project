import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LIA_APPEARANCE_CONTRACT, LIA_CONFIG_DEFAULT_SECTION, LIA_CONFIG_SECTIONS } from './sections-contract'

/**
 * Contract tests for the unified "Configurar Lia" panel (Phase 4E-1).
 *
 * The tamagotchi suite runs in Node with no DOM, so these assert the structure
 * and the translation contract rather than mounting components - which also
 * keeps them out of fragile snapshot/screenshot territory.
 */

const RENDERER = join(__dirname, '..', '..')
const I18N = join(__dirname, '..', '..', '..', '..', '..', '..', 'packages', 'i18n', 'src', 'locales')

const PANEL_SOURCES = [
  'components/lia-config/LiaConfigPanel.vue',
  'components/lia-config/sections/AiSection.vue',
  'components/lia-config/sections/PersonalitySection.vue',
  'components/lia-config/sections/VoiceSection.vue',
  'components/lia-config/sections/AppearanceSection.vue',
]

function readSource(relative: string): string {
  return readFileSync(join(RENDERER, relative), 'utf8')
}

/** Parses a flat YAML mapping into dotted keys. Enough for these locale files. */
function yamlKeys(path: string): Set<string> {
  const keys = new Set<string>()
  const stack: string[] = []

  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#'))
      continue
    const match = /^(\s*)(\w+):(.*)$/.exec(rawLine)
    if (!match)
      continue
    const [, indent, key, rest] = match
    stack.length = indent.length / 2
    stack.push(key)
    if (rest.trim())
      keys.add(stack.join('.'))
  }

  return keys
}

describe('lia config panel contract', () => {
  it('exposes the four sections a user reasons about', () => {
    expect(LIA_CONFIG_SECTIONS.map(section => section.id)).toEqual(['ai', 'personality', 'voice', 'appearance'])
    expect(LIA_CONFIG_DEFAULT_SECTION).toBe('ai')
  })

  it('declares the appearance slots without implementing them', () => {
    // The Avatar/VRM phase owns the mechanism; 4E-1 only fixes the UX contract.
    expect(Object.keys(LIA_APPEARANCE_CONTRACT).sort()).toEqual(['accessory', 'avatar', 'outfit', 'state'])
    expect(Object.values(LIA_APPEARANCE_CONTRACT).every(value => value === null)).toBe(true)
  })

  it('reuses the existing provider configuration instead of a second one', () => {
    const ai = readSource('components/lia-config/sections/AiSection.vue')
    expect(ai).toContain('LiaProviderConfig')
    expect(ai).toContain('mode="manage"')
    // No second provider store and no free-text model id.
    expect(ai).not.toContain('useLiaProviderStore')
    expect(ai).not.toMatch(/<input/)
  })

  it('edits the persona source of truth and never the projected prose', () => {
    const personality = readSource('components/lia-config/sections/PersonalitySection.vue')
    expect(personality).toContain('useAiriCardStore')
    expect(personality).toContain('extensions?.airi?.persona')
    // description/personality/scenario stay derived; the section must not write them.
    expect(personality).not.toContain('updateCard')
    expect(personality).not.toMatch(/\bdescription\s*=/)
  })

  it('reuses the existing voice runtime instead of reimplementing it', () => {
    const voice = readSource('components/lia-config/sections/VoiceSection.vue')
    expect(voice).toContain('useLiaVoiceStore')
    // No provider registry, TTS runtime or speech store is built here. The tab
    // reads the real catalogues through the editor, never by reaching for the
    // speech store itself.
    expect(voice).not.toContain('registerRuntimeExtensions')
    expect(voice).not.toContain('useSpeechStore')
    expect(voice).not.toContain('applyVoiceTarget')
    expect(voice).toContain('useVoiceEditor')
  })

  it('writes voice.tts only through the central writer', () => {
    const voice = readSource('components/lia-config/sections/VoiceSection.vue')
    const editor = readSource('stores/lia/voice-editor.ts')

    // `saveTtsConfiguration` is what owns the voice.tts -> card -> runtime
    // order, so nothing above it may take a shortcut past it.
    expect(editor).toContain('saveTtsConfiguration')
    for (const source of [voice, editor]) {
      expect(source, 'must not call the writer directly').not.toMatch(/\b(?:updateTtsConfig|persistTtsConfig)\s*\(/)
      expect(source, 'must not apply the runtime target directly').not.toMatch(/\bapplyVoiceTarget\s*\(/)
      expect(source, 'no direct card write').not.toMatch(/updateActiveCardSpeech|persistActiveCardModuleSelections/)
    }
  })

  it('offers no free-text field and no hardcoded catalogue in the voice UI', () => {
    const voice = readSource('components/lia-config/sections/VoiceSection.vue')
    const editor = readSource('stores/lia/voice-editor.ts')

    // A free-text model id would let a user persist something the runtime cannot
    // resolve, so the model field is a dropdown over the real catalogue or nothing.
    expect(voice).not.toMatch(/<input/)

    expect(editor).toContain('availableSpeechProvidersMetadata')
    expect(editor).toContain('getVoicesForProvider')
    expect(editor).toContain('getModelsForProvider')
    // No provider, voice or model is baked into the editor.
    for (const baked of ['alloy', 'af_heart', 'bf_emma', 'tts-1', 'kokoro-82m'])
      expect(editor, baked).not.toContain(baked)
  })

  it('keeps navigation inside the panel and inside the main window', () => {
    const panel = readSource('components/lia-config/LiaConfigPanel.vue')
    expect(panel).toContain('emit(\'back\')')
    // No AIRI settings route and no second window.
    expect(panel).not.toContain('meta.settingsEntry')
    expect(panel).not.toContain('openSettings')
    expect(panel).not.toContain('useRouter')

    const home = readSource('pages/home.vue')
    expect(home).toContain('<LiaConfigPanel @back="onSettingsBack" />')
  })

  it('never exposes a secret field in the new surfaces', () => {
    for (const source of PANEL_SOURCES) {
      const text = readSource(source)
      expect(text, source).not.toMatch(/apiKey/i)
      expect(text, source).not.toMatch(/authorization/i)
    }
  })
})

describe('lia config i18n coverage', () => {
  const ptBr = yamlKeys(join(I18N, 'pt-BR', 'home.yaml'))
  const en = yamlKeys(join(I18N, 'en', 'tamagotchi', 'home.yaml'))

  /** Every `tamagotchi.home.<key>` the new surfaces resolve through `tt()`. */
  function referencedKeys(): string[] {
    const keys = new Set<string>()

    for (const source of PANEL_SOURCES) {
      const text = readSource(source)
      const prefix = /tt = \(key: string\) => t\(`tamagotchi\.home\.([^.]+(?:\.[^.]+)*)\.\$\{key\}`\)/.exec(text)?.[1]
      if (!prefix)
        continue

      // Static tt('...') calls.
      for (const match of text.matchAll(/tt\('([^']+)'\)/g))
        keys.add(`${prefix}.${match[1]}`)
      // Template-literal tt(`...`) calls without interpolation.
      for (const match of text.matchAll(/tt\(`([^`$]+)`\)/g))
        keys.add(`${prefix}.${match[1]}`)

      // Interpolated calls such as tt(`fields.${row.key}`), where the suffixes
      // come from a row/slot list. These are exactly the keys most likely to be
      // missed, so expand every literal `key: '<value>'` in the file against the
      // interpolated prefix instead of skipping them.
      for (const match of text.matchAll(/tt\(`([^`$]+)\.\$\{[^}]+\}`\)/g)) {
        for (const value of text.matchAll(/\bkey: '([^']+)'/g))
          keys.add(`${prefix}.${match[1]}.${value[1]}`)
      }
    }

    return [...keys]
  }

  it('resolves every referenced key in pt-BR, the product language', () => {
    const keys = referencedKeys()
    expect(keys.length).toBeGreaterThan(10)
    expect(keys.filter(key => !ptBr.has(key))).toEqual([])
  })

  it('resolves every referenced key in en, so nothing falls back silently', () => {
    const keys = referencedKeys()
    expect(keys.filter(key => !en.has(key))).toEqual([])
  })

  it('carries the per-section titles and summaries in both locales', () => {
    for (const section of LIA_CONFIG_SECTIONS) {
      for (const suffix of ['title', 'summary']) {
        const key = `config.sections.${section.id}.${suffix}`
        expect(ptBr.has(key), `pt-BR missing ${key}`).toBe(true)
        expect(en.has(key), `en missing ${key}`).toBe(true)
      }
    }
  })

  it('keeps the two locale files in sync for the whole home namespace', () => {
    expect([...ptBr].filter(key => !en.has(key)).sort()).toEqual([])
    expect([...en].filter(key => !ptBr.has(key)).sort()).toEqual([])
  })
})
