import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  homeAiChipVm,
  homeBlockerHintVm,
  homeConversationLabelVm,
  homeConversationStartingVm,
} from './home-vm'

/**
 * Phase 8.0A-3: the migrated Lia Home, proven the launcher way - node-only
 * (the launcher test runner is node-only by design). Pure VM facts are
 * executed directly; the view's guarantees are structural: what Home
 * consumes (tokens/primitives, the EXISTING launch path and status
 * sources) and what it can never contain (AIRI branding, jargon, raw
 * colors, product logic).
 */

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

const HOME_VUE = () => readSource('./HomeView.vue')
const HOME_VM = () => readSource('./home-vm.ts')

describe('home uses the 8.0A foundation (A)', () => {
  it('a: Home is built on the Lia primitives and semantic tokens', () => {
    const source = HOME_VUE()
    for (const primitive of ['LiaPanel', 'LiaButton', 'LiaStatusChip']) {
      expect(source, primitive).toContain(`import ${primitive} from '../components/lia/${primitive}.vue'`)
      expect(source, `${primitive} used`).toContain(`<${primitive}`)
    }
    const styleBlock = source.slice(source.indexOf('<style scoped>'))
    for (const token of [
      '--lia-space-3',
      '--lia-space-6',
      '--lia-space-8',
      '--lia-text-md',
      '--lia-text-2xl',
      '--lia-text-secondary',
      '--lia-accent',
      '--lia-border-accent',
      '--lia-font-bold',
      '--lia-status-error',
      '--lia-status-warning',
    ]) {
      expect(styleBlock, token).toContain(`var(${token})`)
    }
  })
})

describe('the primary action keeps the existing launch path (B, F)', () => {
  it('b: "Conversar com Lia" still invokes api.conversar() exactly, with busy guard and refresh', () => {
    const source = HOME_VUE()
    expect(source).toContain('await props.api.conversar()')
    expect(source).toContain('emit(\'refresh\')')
    expect(source).toContain(':disabled="busy || conversationStarting"')
    expect(source).toContain('{{ conversationLabel }}')
  })

  it('f: the pure VM keeps the EXISTING status-source semantics (labels, phases, blocker)', () => {
    // Label follows the Stage phase contract, verbatim.
    expect(homeConversationLabelVm(undefined)).toBe('Conversar com Lia')
    expect(homeConversationLabelVm({})).toBe('Conversar com Lia')
    expect(homeConversationLabelVm({ stage: { state: { phase: 'starting' } } })).toBe('Abrindo o palco…')
    expect(homeConversationLabelVm({ stage: { state: { phase: 'running' } } })).toBe('Conversando…')
    expect(homeConversationStartingVm({ stage: { state: { phase: 'starting' } } })).toBe(true)
    expect(homeConversationStartingVm({ stage: { state: { phase: 'running' } } })).toBe(false)

    // IA readiness derives from the SAME home-status fact.
    expect(homeAiChipVm({ ai: { ready: true } })).toEqual({ label: 'IA pronta', variant: 'ready' })
    expect(homeAiChipVm({ ai: { ready: false } })).toEqual({ label: 'IA a configurar', variant: 'warning' })
    expect(homeAiChipVm(undefined)).toEqual({ label: 'IA a configurar', variant: 'warning' })

    // The honest blocker appears only while IA is unconfigured.
    expect(homeBlockerHintVm({ ai: { ready: false } })).toContain('configuração de IA')
    expect(homeBlockerHintVm({ ai: { ready: true } })).toBeUndefined()
    expect(homeBlockerHintVm(undefined)).toBeUndefined()
  })

  it('f2: voice readiness arrives as a shell prop - Home never opens its own state source', () => {
    const source = HOME_VUE()
    expect(source).toContain('readiness?: any')
    expect(source).toContain('voiceStatusChipVm(props.readiness, props.language)')
    // No direct IPC/provisioning calls from the view.
    expect(source).not.toContain('voiceProvisioningState')
    expect(source).not.toContain('window as any')
  })
})

describe('home stays product-clean (C, D, E)', () => {
  it('c: no AIRI branding anywhere in Home or its VM', () => {
    expect(HOME_VUE()).not.toMatch(/\bAIRI\b/i)
    expect(HOME_VM()).not.toMatch(/\bAIRI\b/i)
  })

  it('d: no backend/runtime jargon reaches the normal Home surface', () => {
    const forbidden = /kokoro|python|onnx|\bpip\b|venv|directml|alltalk|xtts|runtime home|runtimeHome|installDir|install dir|backend|huggingface/i
    expect(HOME_VUE()).not.toMatch(forbidden)
    expect(HOME_VM()).not.toMatch(forbidden)
  })

  it('e: no raw new hex/rgb colors in the Home styles', () => {
    const styleBlock = HOME_VUE().slice(HOME_VUE().indexOf('<style scoped>'))
    expect(styleBlock).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(styleBlock).not.toMatch(/\brgb\(|\brgba\(|\bhsl\(/i)
  })
})

describe('logic stays out of the view (G)', () => {
  it('g: no product/provisioning/business logic moved into the renderer view', () => {
    const source = HOME_VUE()
    // The view consumes the pure VM and existing state only.
    expect(source).toContain('from \'./home-vm\'')
    expect(source).not.toMatch(/inspect|provisioning|ensureKokoro|voiceRuntimeInstalled|spawn|child_process/i)
    // No config writes from Home.
    expect(source).not.toContain('updateConfig')
    // The VM itself is metadata-only: no IPC, no fs, no engine ids.
    const vm = HOME_VM()
    expect(vm).not.toMatch(/ipcRenderer|invoke|fetch\(|kokoro|engine/i)
  })
})

describe('home fits the shell (H)', () => {
  it('h: the page renders safely inside the shell structure - bounded width, scroll-friendly, no overflow traps', () => {
    const source = HOME_VUE()
    expect(source).toMatch(/<template>\s*<section class="home">/)
    const styleBlock = source.slice(source.indexOf('<style scoped>'))
    // Bounded + centered inside the stage; never forces a width.
    expect(styleBlock).toContain('max-width: 760px')
    expect(styleBlock).toContain('margin: 0 auto')
    expect(styleBlock).toContain('min-width: 0')
    // Wrapping chips never create a horizontal overflow line.
    expect(styleBlock).toContain('flex-wrap: wrap')
    // The shell still mounts Home as its default view.
    const app = readSource('../App.vue')
    expect(app).toContain('default: return HomeView')
    expect(app).toContain('import HomeView from \'./views/HomeView.vue\'')
  })
})
