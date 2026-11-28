import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./App.vue', import.meta.url)), 'utf-8')
const template = source.slice(source.indexOf('<template>'), source.indexOf('<style scoped>'))
const styles = source.slice(source.indexOf('<style scoped>'))

describe('Launcher shell R04', () => {
  it('gives Home the full content area and leaves the voice header on the other views', () => {
    expect(template).toContain('class="stage" :class="{ \'stage-home\': page === \'home\' }"')
    expect(styles).toMatch(/\.stage-home\s*\{[^}]*padding:\s*0/)
    expect(template).toContain('<header v-if="page !== \'home\'" class="contextbar">')
    expect(template).not.toMatch(/sidebar-brand|brand-mark|brand-name/)
  })

  it('keeps all five destinations in the localized rail and exposes the current page', () => {
    expect(source).toMatch(/\['home', 'ai', 'voice'\],\s*\['config', 'diagnostics'\]/)
    expect(template).toContain('<nav class="sidebar" :aria-label="text.nav">')
    expect(template).toContain(':class="{ \'sidebar-footer\': group[0] === \'config\' }"')
    expect(template).toContain(':aria-label="text[destination]"')
    expect(template).toContain(':aria-current="page === destination ? \'page\' : undefined"')
    expect(template).toContain('@click="page = destination"')
    expect(template).toContain('<svg class="nav-icon"')
    expect(template).toContain('<span class="nav-label">{{ text[destination] }}</span>')
  })

  it('preserves the original view bindings and sends R04 readiness to Home', () => {
    expect(source).toContain('const page = ref<Page>(\'home\')')
    expect(source).toContain('switch (page.value)')
    expect(source).toContain('default: return HomeView')
    for (const [page, view] of [
      ['ai', 'AiResourcesView'],
      ['config', 'ConfigView'],
      ['diagnostics', 'DiagnosticsView'],
      ['voice', 'VoiceView'],
    ]) {
      expect(source).toContain('case \'' + page + '\': return ' + view)
    }

    expect(template).toContain(':is="current"')
    expect(template).toContain(':status="status"')
    expect(template).toContain(':api="api"')
    expect(template).toContain(':language="language"')
    expect(template).toContain('v-bind="page === \'home\' ? { readiness, setup, statusError } : {}"')
    expect(template).toContain('@refresh="refresh"')
    expect(template).toContain('@open-ai="openFromHome(\'ai\')"')
    expect(template).toContain('@open-diagnostics="openFromHome(\'diagnostics\')"')
  })

  it('keeps the existing voice provisioning source and shared indicator', () => {
    expect(source).toContain('voiceProvisioningState')
    expect(source).toContain('LIA_VOICE_READINESS_EVENT')
    expect(source).toContain('voiceStatusChipVm(readiness.value, language.value)')
    expect(source).toContain('import LiaStatusChip from \'./components/lia/LiaStatusChip.vue\'')
    expect(template).toContain('<LiaStatusChip :variant="voiceVariant">')
    expect(template).toContain('{{ text.voicePrefix }}: {{ voiceChip.label }}')
  })

  it('uses the Launcher palette for the rail with a distinct keyboard focus indicator', () => {
    for (const token of ['canvas', 'lowest', 'muted', 'selection', 'selection-text', 'focus'])
      expect(styles).toContain('var(--r04-' + token + ')')

    expect(styles).toMatch(/\.nav-item:focus-visible\s*\{[^}]*outline-color:\s*var\(--r04-focus\)/)
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl)\(/i)
  })

  it('allows the rail and main content to scroll when the window shrinks', () => {
    expect(styles).toMatch(/\.sidebar\s*\{[^}]*overflow-y:\s*auto/)
    expect(styles).toMatch(/\.stage\s*\{[^}]*min-width:\s*0[^}]*overflow-y:\s*auto/)
    expect(styles).not.toMatch(/\.nav-label\s*\{[^}]*display:\s*none/)
  })

  it('keeps internal implementation names out of the shell', () => {
    expect(source).not.toMatch(/\bAIRI\b|kokoro|python|onnx|\bpip\b|directml|alltalk|xtts|backend/i)
  })
})
