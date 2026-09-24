import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Phase 8.0A-1: the Lia design-token + primitive foundation, proven the
 * launcher way - node-only, WITHOUT a DOM (the launcher test environment
 * is node-only by design). The guarantees here are structural: what the
 * token sheet defines, what the primitives ARE (native semantics by
 * construction), and what they can NEVER contain (product/backend logic,
 * engine jargon). No existing screen is migrated yet - these tests pin
 * the foundation the upcoming phases build on.
 */

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

const TOKENS_CSS = () => readSource('../../styles/lia-tokens.css')
const MAIN_TS = () => readSource('../../main.ts')
const PANEL = () => readSource('./LiaPanel.vue')
const BUTTON = () => readSource('./LiaButton.vue')
const CHIP = () => readSource('./LiaStatusChip.vue')

describe('8.0A-1 design tokens (foundation only, no migration)', () => {
  it('a: the global Lia token stylesheet exists and is loaded by the renderer entry', () => {
    // The file itself...
    expect(TOKENS_CSS()).toContain(':root')
    // ...is imported globally, AFTER the raw palette it builds on.
    const main = MAIN_TS()
    expect(main).toContain('import \'./styles/lia-tokens.css\'')
    expect(main.indexOf('import \'./styles.css\'')).toBeLessThan(main.indexOf('import \'./styles/lia-tokens.css\''))
  })

  it('b: every required semantic token group exists (backgrounds, borders, text, accent, status, radius, spacing, typography, focus, motion)', () => {
    const css = TOKENS_CSS()

    // Backgrounds / surfaces
    for (const token of ['--lia-bg-app', '--lia-bg-surface', '--lia-bg-surface-raised'])
      expect(css, token).toContain(`${token}:`)

    // Borders
    for (const token of ['--lia-border-subtle', '--lia-border-accent'])
      expect(css, token).toContain(`${token}:`)

    // Text
    for (const token of ['--lia-text-primary', '--lia-text-secondary'])
      expect(css, token).toContain(`${token}:`)

    // The Lia magenta/purple identity accent
    expect(css).toContain('--lia-accent: var(--lia-magenta)')
    expect(css).toContain('--lia-accent-soft:')

    // Status semantics: ready / warning / error / disabled
    for (const token of ['--lia-status-ready', '--lia-status-warning', '--lia-status-error', '--lia-status-disabled'])
      expect(css, token).toContain(`${token}:`)

    // Radius + spacing scales
    for (const token of ['--lia-radius-sm', '--lia-radius-md', '--lia-radius-lg', '--lia-radius-xl'])
      expect(css, token).toContain(`${token}:`)
    for (const token of ['--lia-space-1', '--lia-space-2', '--lia-space-3', '--lia-space-4', '--lia-space-6', '--lia-space-8'])
      expect(css, token).toContain(`${token}:`)

    // Typography sizes/weights
    for (const token of ['--lia-text-xs', '--lia-text-sm', '--lia-text-md', '--lia-text-lg', '--lia-font-normal', '--lia-font-medium', '--lia-font-bold'])
      expect(css, token).toContain(`${token}:`)

    // Focus ring + basic transition duration
    expect(css).toContain('--lia-focus-ring:')
    expect(css).toContain('--lia-transition-fast:')
  })

  it('semantic tokens are ALIASES of the existing palette - no second color system', () => {
    const css = TOKENS_CSS()
    expect(css).toContain('--lia-bg-app: var(--lia-bg)')
    expect(css).toContain('--lia-bg-surface: var(--lia-panel)')
    expect(css).toContain('--lia-border-subtle: var(--lia-border)')
    expect(css).toContain('--lia-text-primary: var(--lia-text)')
    expect(css).toContain('--lia-text-secondary: var(--lia-text-dim)')
    expect(css).toContain('--lia-status-ready: var(--lia-ok)')
    expect(css).toContain('--lia-status-warning: var(--lia-warn)')
    expect(css).toContain('--lia-status-error: var(--lia-err)')
  })

  it('tokens stay semantic: no page-specific names', () => {
    const css = TOKENS_CSS()
    const pageSpecific = /--lia-(home|voice-page|config|diagnostics|sidebar|onboarding|hero)-/i
    expect(css).not.toMatch(pageSpecific)
  })
})

describe('8.0A-1 LiaPanel (standard surface)', () => {
  it('c: renders slot content inside a token-styled surface (border, radius, padding)', () => {
    const source = PANEL()
    // The default slot IS the content path.
    expect(source).toMatch(/<section class="lia-panel">\s*<slot \/>/)
    // Surface contract comes from the tokens, not hand-picked values.
    expect(source).toContain('background: var(--lia-bg-surface)')
    expect(source).toContain('border: 1px solid var(--lia-border-subtle)')
    expect(source).toContain('border-radius: var(--lia-radius-lg)')
    expect(source).toContain('padding: var(--lia-space-4) var(--lia-space-6)')
  })
})

describe('8.0A-1 LiaButton (native semantics by construction)', () => {
  it('d: the root element IS a native <button> - no wrapper, no role override, no hijacked clicks', () => {
    const source = BUTTON()
    // One root, and it is the native element.
    expect(source).toMatch(/<template>\s*<button class="lia-button"/)
    expect(source).not.toMatch(/role="/)
    // No component-level click interception: handlers fall through natively.
    expect(source).not.toMatch(/@click/)
    // Label rides the default slot.
    expect(source).toContain('<slot />')
    // Variants are visual-only.
    expect(source).toContain('variant?: \'primary\' | \'secondary\'')
  })

  it('e: disabled is the REAL disabled state (native attribute fall-through, no fake prop)', () => {
    const source = BUTTON()
    // The component never declares its own `disabled` prop, so the native
    // attribute reaches the real <button> untouched.
    expect(source).not.toMatch(/disabled\??:/)
    expect(source).not.toMatch(/:disabled="[^"]*(prop|state)/)
    // The visual disabled styling keys off the native pseudo-class only.
    expect(source).toContain('.lia-button:disabled {')
    expect(source).toContain('cursor: not-allowed')
  })

  it('g: keyboard focus is visibly styled through the shared focus-ring token', () => {
    const source = BUTTON()
    expect(source).toContain('.lia-button:focus-visible {')
    expect(source).toContain('box-shadow: var(--lia-focus-ring)')
    // Pointer clicks stay clean: focus ring is focus-VISIBLE only.
    expect(source).not.toContain('.lia-button:focus {')
  })
})

describe('8.0A-1 LiaStatusChip (five semantic variants)', () => {
  it('f: supports exactly neutral/ready/warning/error/disabled, each visibly styled', () => {
    const source = CHIP()
    // The prop union is exactly the five semantic variants (neutral default).
    expect(source).toContain('variant?: \'disabled\' | \'error\' | \'neutral\' | \'ready\' | \'warning\'')
    expect(source).toContain('{ variant: \'neutral\' }')
    // Every variant class exists and is colored from the status tokens.
    for (const variant of ['neutral', 'ready', 'warning', 'error', 'disabled']) {
      expect(source, variant).toContain(`lia-status-chip--${variant}`)
    }
    expect(source).toContain('background: var(--lia-status-ready)')
    expect(source).toContain('background: var(--lia-status-warning)')
    expect(source).toContain('background: var(--lia-status-error)')
    expect(source).toContain('background: var(--lia-status-disabled)')
    // Compact text slot + dot pairing (state never color-only, §27).
    expect(source).toContain('lia-status-chip__dot')
    expect(source).toContain('aria-hidden="true"')
    expect(source).toContain('lia-status-chip__label')
    expect(source).toContain('<slot />')
    expect(source).toContain('font-size: var(--lia-text-xs)')
  })
})

describe('8.0A-1 primitives stay pure (H)', () => {
  it('no product/backend logic, no engine or infrastructure terminology in any primitive or the token sheet', () => {
    const forbidden = /kokoro|python|onnx|\bpip\b|venv|directml|runtime home|runtimeHome|install dir|installDir|ipcRenderer|invoke|fetch\(|api\.|backend|alltalk|xtts|huggingface|engine id|engineId/i
    for (const [name, source] of Object.entries({
      'LiaButton.vue': BUTTON(),
      'LiaPanel.vue': PANEL(),
      'LiaStatusChip.vue': CHIP(),
      'lia-tokens.css': TOKENS_CSS(),
    })) {
      expect(source, name).not.toMatch(forbidden)
      // Presentation-only components never reach for app state or IPC.
      expect(source, name).not.toMatch(/import .*from.*(stores|liaApi|window)/)
      expect(source, name).not.toMatch(/defineEmits/)
    }
  })

  it('the foundation does NOT migrate existing UI: no existing component imports the primitives yet', () => {
    const appVue = readSource('../../App.vue')
    const voiceCard = readSource('../VoiceEngineCard.vue')
    for (const source of [appVue, voiceCard]) {
      expect(source).not.toContain('LiaPanel')
      expect(source).not.toContain('LiaButton')
      expect(source).not.toContain('LiaStatusChip')
    }
  })
})
