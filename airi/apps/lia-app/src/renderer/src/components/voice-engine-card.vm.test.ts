import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { LIA_VOICE_ENGINE_STRINGS, pickVoiceEngineLocale, voiceEngineText } from '../voice-engine-strings'
import {
  voiceEnabledPayload,
  voiceEngineCardVm,
  voiceEngineSelectionPayload,
  voiceEngineStateLabel,
  voiceProvisioningVm,
} from './voice-engine-card.vm'

/**
 * Phase 7.9G: product rules of the Voice Engine card, proven WITHOUT a
 * DOM (the launcher test runner is node-only by design) - state/label
 * resolution in both shipped locales, the exact canonical selection
 * payload, i18n entry parity, and static guarantees that the renderer
 * stays engine-neutral, jargon-free and never writes JSON itself.
 */

const KOKORO_ROW = {
  id: 'kokoro',
  installed: true,
  name: 'Kokoro',
  nameKey: 'lia.voice.engines.kokoro.name',
  selectable: true,
  selected: true,
} as never

describe('voiceEngineCardVm (7.9G product rows)', () => {
  it('installed Kokoro renders ready + selected; no install/select actions offered', () => {
    const vm = voiceEngineCardVm({ engines: [KOKORO_ROW], phase: 'idle', selectedId: 'kokoro' })
    expect(vm.title).toBe('Voz da Lia')
    expect(vm.unavailable).toBe(false)
    expect(vm.rows).toHaveLength(1)
    expect(vm.rows[0]).toMatchObject({
      canInstall: false,
      canSelect: false,
      selected: true,
      stateKey: 'lia.voice.engines.state.ready',
      userFacingName: 'Kokoro',
    })
    expect(voiceEngineStateLabel(vm.rows[0], vm.locale)).toBe('Pronto')
  })

  it('missing Kokoro renders the install action with a friendly hint', () => {
    const vm = voiceEngineCardVm({
      engines: [{ ...KOKORO_ROW, installed: false, selectable: false }],
      phase: 'idle',
      selectedId: 'kokoro',
    })
    expect(vm.rows[0]).toMatchObject({
      canInstall: true,
      canSelect: false,
      stateKey: 'lia.voice.engines.state.notInstalled',
    })
    expect(vm.hintKey).toBe('lia.voice.engines.install.hint')
  })

  it('while installing, the row shows a single installing state and all actions block', () => {
    const vm = voiceEngineCardVm({
      engines: [{ ...KOKORO_ROW, installed: false, selectable: false }],
      phase: 'installing',
      selectedId: 'kokoro',
    })
    expect(vm.rows[0].canInstall).toBe(false) // never double an install
    expect(vm.rows[0].canSelect).toBe(false)
    expect(voiceEngineStateLabel(vm.rows[0], vm.locale)).toBe('Instalando…')
  })

  it('unknown configured engine: honest unavailable, zero rows, never a renamed fallback', () => {
    const vm = voiceEngineCardVm({ engines: [], phase: 'idle', unknownConfiguredId: 'mister-voice' })
    expect(vm.unavailable).toBe(true)
    expect(vm.hintKey).toBe('lia.voice.engines.state.unavailable')
    expect(vm.rows).toHaveLength(0)
    expect(voiceEngineText(vm.locale, vm.hintKey)).toBe('Não disponível')
  })

  it('en-US preference renders real English entries', () => {
    const vm = voiceEngineCardVm({ engines: [KOKORO_ROW], phase: 'idle', selectedId: 'kokoro' }, 'en-US')
    expect(vm.title).toBe('Lia voice')
    expect(vm.rows[0].userFacingName).toBe('Kokoro')
    expect(voiceEngineStateLabel(vm.rows[0], vm.locale)).toBe('Ready')
  })

  it('the selection payload is EXACTLY the canonical field, nothing else', () => {
    expect(voiceEngineSelectionPayload('kokoro')).toEqual({
      update: { voice: { engine: { preferred: 'kokoro' } } },
    })
  })
})

describe('voice-engine strings catalog (7.9G)', () => {
  it('pt-BR and en-US ship the SAME key set, all non-empty', () => {
    const pt = LIA_VOICE_ENGINE_STRINGS['pt-BR']
    const en = LIA_VOICE_ENGINE_STRINGS['en-US']
    expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort())
    for (const [key, value] of Object.entries(pt))
      expect(value, `pt-BR ${key}`).not.toMatch(/^\s*$/)
    for (const [key, value] of Object.entries(en))
      expect(value, `en-US ${key}`).not.toMatch(/^\s*$/)
  })

  it('the 7.9F descriptor nameKey resolves to REAL entries in both locales', () => {
    expect(voiceEngineText('pt-BR', 'lia.voice.engines.kokoro.name')).toBe('Kokoro')
    expect(voiceEngineText('en-US', 'lia.voice.engines.kokoro.name')).toBe('Kokoro')
  })

  it('locale pick is conservative: English preference only, otherwise pt-BR', () => {
    expect(pickVoiceEngineLocale(undefined)).toBe('pt-BR')
    expect(pickVoiceEngineLocale('en-US')).toBe('en-US')
    expect(pickVoiceEngineLocale('English')).toBe('en-US')
    expect(pickVoiceEngineLocale('pt-BR')).toBe('pt-BR')
  })

  it('no technical jargon leaks into product strings (both locales)', () => {
    const forbidden = /python|backend|onnx|provider|runtime|execution|directml|spawn|child_process|\bpip\b|\bvenv\b|model sha|hf hub|huggingface/i
    for (const [locale, table] of Object.entries(LIA_VOICE_ENGINE_STRINGS)) {
      for (const [key, value] of Object.entries(table))
        expect(value, `${locale}:${key}`).not.toMatch(forbidden)
    }
  })
})

describe('renderer static guarantees (7.9G)', () => {
  const readSource = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')

  it('the card persists ONLY through updateConfig - never fs, never the document file', () => {
    const component = readSource('./VoiceEngineCard.vue')
    expect(component).not.toMatch(/node:fs|writeFile|productConfigFile|ipcRenderer/)
    expect(component).toContain('updateConfig') // the canonical writer seam
    expect(component).toContain('voiceEngineSelectionPayload') // payload built by the vm
  })

  it('the renderer stays engine-neutral: no hardcoded engine ids in the card or the Voice screen', () => {
    const component = readSource('./VoiceEngineCard.vue')
    const view = readSource('../views/VoiceView.vue')
    for (const source of [component, view]) {
      expect(source).not.toMatch(/\bkokoro\b/i)
      expect(source).not.toMatch(/voice\.engine\.preferred/)
    }
  })

  it('normal UI vocabulary: no backend/runtime jargon in the card component', () => {
    const component = readSource('./VoiceEngineCard.vue')
    const forbidden = /python|onnx|backend|provider|directml|execution|runtime home|runtimeHome|model sha|spawn|\bpip\b|\bvenv\b|DevKit/i
    expect(component).not.toMatch(forbidden)
  })
})

describe('structural placement in VoiceView (7.9G finalize)', () => {
  const readSource = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')

  it('voiceView mounts VoiceEngineCard exactly once', () => {
    const view = readSource('../views/VoiceView.vue')
    expect(view.split('<VoiceEngineCard').length - 1).toBe(1)
  })

  it('the card is KIND-INDEPENDENT: it precedes - and is NOT inside - the custom conditional', () => {
    const view = readSource('../views/VoiceView.vue')
    const cardAt = view.indexOf('<VoiceEngineCard')
    expect(cardAt).toBeGreaterThan(-1)
    // Above the kind toggle section AND before the custom conditional opens.
    const customAt = view.indexOf('v-if="kind === \'custom\'"')
    expect(customAt).toBeGreaterThan(-1)
    expect(cardAt).toBeLessThan(customAt)
    // And it does not carry a kind condition of its own.
    const cardPrefix = view.slice(Math.max(0, cardAt - 60), cardAt)
    expect(cardPrefix).not.toMatch(/v-if="kind/)
  })

  it('the renderer never writes the config file directly (selection rides updateConfig only)', () => {
    const view = readSource('../views/VoiceView.vue')
    expect(view).not.toMatch(/node:fs|writeFile|productConfigFile|ipcRenderer/)
  })
})

describe('voiceProvisioningVm (7.9H automatic first-run readiness)', () => {
  it('the normal first-run arc renders jargon-free product copy (pt-BR)', () => {
    expect(voiceProvisioningVm({ state: 'checking' })).toMatchObject({
      busy: true,
      canRetry: false,
      enabled: true,
      stateLabel: 'Verificando voz…',
    })
    expect(voiceProvisioningVm({ state: 'preparing' })).toMatchObject({
      busy: true,
      progressLabel: 'Preparando voz…',
      stateLabel: 'Preparando voz…',
    })
    expect(voiceProvisioningVm({ state: 'ready' })).toMatchObject({
      busy: false,
      enabled: true,
      stateLabel: 'Voz pronta',
    })
  })

  it('progress follows the honest step metadata - environment, download, finalizing', () => {
    expect(voiceProvisioningVm({ state: 'preparing', step: 'python' }).progressLabel).toBe('Configurando ambiente…')
    expect(voiceProvisioningVm({ state: 'preparing', step: 'pip' }).progressLabel).toBe('Configurando ambiente…')
    expect(voiceProvisioningVm({ state: 'preparing', step: 'model' }).progressLabel).toBe('Baixando voz…')
    expect(voiceProvisioningVm({ state: 'preparing', step: 'voices' }).progressLabel).toBe('Finalizando…')
    // Unknown step metadata degrades to the generic honest line.
    expect(voiceProvisioningVm({ state: 'preparing', step: 'mystery' }).progressLabel).toBe('Preparando voz…')
    // No invented progress outside the preparing state.
    expect(voiceProvisioningVm({ state: 'ready', step: 'voices' }).progressLabel).toBeUndefined()
  })

  it('voice OFF renders as "Desativada" - never error, never "not installed"', () => {
    const vm = voiceProvisioningVm({ state: 'disabled' })
    expect(vm).toMatchObject({ busy: false, canRetry: false, enabled: false, stateLabel: 'Desativada' })
    expect(vm.toggleLabel).toBe('Ativar voz')
    expect(vm.stateLabel).not.toContain('instala')
    expect(vm.stateLabel.toLowerCase()).not.toContain('erro')
  })

  it('a retryable failure offers exactly one recovery path; non-retryable stays honest', () => {
    expect(voiceProvisioningVm({ retryable: true, state: 'error' })).toMatchObject({
      canRetry: true,
      stateLabel: 'Não foi possível preparar a voz',
    })
    expect(voiceProvisioningVm({ retryable: false, state: 'error' })).toMatchObject({ canRetry: false })
  })

  it('en-US locale renders the same honest model in English', () => {
    expect(voiceProvisioningVm({ state: 'preparing', step: 'model' }, 'en-US').progressLabel).toBe('Downloading voice…')
    expect(voiceProvisioningVm({ state: 'disabled' }, 'en-US').stateLabel).toBe('Off')
    expect(voiceProvisioningVm({ state: 'ready' }, 'en-US').stateLabel).toBe('Voice ready')
  })

  it('the enable/disable toggle rides the canonical config-update payload', () => {
    expect(voiceEnabledPayload(false)).toEqual({ update: { voice: { enabled: false } } })
    expect(voiceEnabledPayload(true)).toEqual({ update: { voice: { enabled: true } } })
  })
})
