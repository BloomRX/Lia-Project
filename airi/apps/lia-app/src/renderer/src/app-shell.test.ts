import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Phase 8.0A-2: the persistent Lia app shell, proven the launcher way -
 * node-only static guarantees (the launcher test runner is node-only by
 * design). The shell is layout: what it contains (ONE brand, the real
 * destinations, the settings footer, the readiness source of truth), what
 * it consumes (8.0A-1 tokens/primitives), and what it can NEVER contain
 * (AIRI branding, jargon, raw new colors, page migrations).
 */

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

const APP_VUE = () => readSource('./App.vue')

describe('app shell structure (8.0A-2)', () => {
  it('a: exactly ONE Lia branding surface (sidebar top) - never repeated', () => {
    const source = APP_VUE()
    // Count TEMPLATE occurrences only (style blocks legitimately repeat the
    // class selectors): one brand container, one name, one mark.
    const template = source.slice(source.indexOf('<template>'), source.indexOf('<style scoped>'))
    expect(template.match(/sidebar-brand/g)?.length).toBe(1)
    expect(template.match(/brand-name/g)?.length).toBe(1)
    expect(template.match(/brand-mark/g)?.length).toBe(1)
    // The brand lives in the SIDEBAR, not the top/context bar.
    const sidebarAt = template.indexOf('class="sidebar"')
    expect(template.indexOf('sidebar-brand')).toBeGreaterThan(sidebarAt)
    const contextBar = template.slice(template.indexOf('class="contextbar"'), template.indexOf('class="stage"'))
    expect(contextBar).not.toContain('brand')
    // No subtitle/second-line branding invention.
    expect(source).not.toContain('Desktop Companion')
    expect(source).not.toContain('Companion')
  })

  it('b: every current navigation destination is preserved and wired to the same view components', () => {
    const source = APP_VUE()
    // All four destinations exist as page ids...
    for (const id of ['home', 'voice', 'diagnostics', 'config'])
      expect(source, id).toContain(`'${id}'`)
    // ...each still mapped to its original view component.
    expect(source).toContain('case \'config\': return ConfigView')
    expect(source).toContain('case \'diagnostics\': return DiagnosticsView')
    expect(source).toContain('case \'voice\': return VoiceView')
    expect(source).toContain('default: return HomeView')
    // The middle nav keeps the icon + label treatment.
    expect(source).toContain('{ icon: \'●\', id: \'home\', label: \'Início\' }')
    expect(source).toContain('{ icon: \'🎙\', id: \'voice\', label: \'Voz\' }')
    expect(source).toContain('{ icon: \'◧\', id: \'diagnostics\', label: \'Diagnósticos\' }')
  })

  it('c: the settings action lives in the sidebar footer area (never the top status area)', () => {
    const source = APP_VUE()
    expect(source).toContain('sidebar-footer')
    // The footer gear opens the SAME config page - destination preserved.
    const footerAt = source.indexOf('sidebar-footer')
    expect(source.slice(footerAt)).toContain('@click="page = \'config\'"')
    expect(source.slice(footerAt)).toContain('aria-label="Configuração"')
    // And settings never sits inside the context bar.
    const contextBar = source.slice(source.indexOf('class="contextbar"'), source.indexOf('class="stage"'))
    expect(contextBar).not.toContain('Configuração')
    expect(contextBar).not.toContain('⚙')
  })

  it('d: no AIRI branding appears anywhere in the normal shell source', () => {
    const source = APP_VUE()
    expect(source).not.toMatch(/\bAIRI\b/i)
    expect(source).not.toContain('Projeto AIRI')
    expect(source).not.toContain('airi-card')
  })

  it('e: the global voice status uses the CURRENT provisioning/readiness source of truth', () => {
    const source = APP_VUE()
    // Same IPC source + same rail event the Voice page chip uses - one
    // readiness model, no second voice state anywhere in the shell.
    expect(source).toContain('voiceProvisioningState')
    expect(source).toContain('LIA_VOICE_READINESS_EVENT')
    expect(source).toContain('voiceStatusChipVm(readiness.value, language.value)')
    // Rendered through the LiaStatusChip primitive with the shared mapping.
    expect(source).toContain('<LiaStatusChip :variant="voiceVariant">')
    expect(source).toMatch(/voz: \{\{ voiceChip\.label \}\}/)
  })

  it('f: the shell consumes the 8.0A-1 tokens and primitives (no hand-rolled palette)', () => {
    const source = APP_VUE()
    const styleBlock = source.slice(source.indexOf('<style scoped>'))
    // Core token groups are all consumed by the shell styles.
    for (const token of [
      '--lia-bg-app',
      '--lia-bg-surface',
      '--lia-bg-surface-raised',
      '--lia-border-subtle',
      '--lia-border-accent',
      '--lia-text-primary',
      '--lia-text-secondary',
      '--lia-accent',
      '--lia-radius-md',
      '--lia-space-2',
      '--lia-focus-ring',
      '--lia-transition-fast',
    ]) {
      expect(styleBlock, token).toContain(`var(${token})`)
    }
    // Primitive import is real (not just a comment mention).
    expect(source).toContain('import LiaStatusChip from \'./components/lia/LiaStatusChip.vue\'')
  })

  it('g: no raw new hex colors are introduced in the shell styles', () => {
    const source = APP_VUE()
    const styleBlock = source.slice(source.indexOf('<style scoped>'))
    expect(styleBlock).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(styleBlock).not.toMatch(/\brgb\(|\brgba\(|\bhsl\(/i)
  })

  it('h: the existing view-switching contract remains intact', () => {
    const source = APP_VUE()
    // Same state-driven mechanism (no router invented), same props/events.
    expect(source).toContain('type Page = \'config\' | \'diagnostics\' | \'home\' | \'voice\'')
    expect(source).toContain('const page = ref<Page>(\'home\')')
    // The switching contract is intact; Home additionally receives the
    // shell's readiness facts (8.0A-3) - and ONLY Home.
    expect(source).toContain(':is="current"')
    expect(source).toContain(':status="status"')
    expect(source).toContain(':api="api"')
    expect(source).toContain('@refresh="refresh"')
    expect(source).toContain('v-bind="page === \'home\' ? { language, readiness, setup } : {}"')
    expect(source).toContain('switch (page.value)')
    // Views stay imported exactly as before - nothing migrated or replaced.
    for (const view of ['ConfigView', 'DiagnosticsView', 'HomeView', 'VoiceView'])
      expect(source, view).toContain(`import ${view} from './views/${view}.vue'`)
  })

  it('the shell stays product-clean: no provider/backend/engine jargon in the frame', () => {
    const source = APP_VUE()
    expect(source).not.toMatch(/kokoro|python|onnx|\bpip\b|directml|alltalk|xtts|backend/i)
  })

  it('window safety: narrower widths collapse to an icon rail without dropping destinations', () => {
    const source = APP_VUE()
    // CSS-only tolerance (not a mobile nav system): labels hide, buttons
    // keep their aria-labels, and overflow stays bounded.
    expect(source).toContain('@media (max-width: 640px)')
    expect(source).toContain('aria-label="Configuração"')
    expect(source).toMatch(/aria-label="item\.label"|:aria-label="item\.label"/)
    expect(source).toContain('min-width: 0')
    expect(source).toContain('overflow-y: auto')
  })
})
