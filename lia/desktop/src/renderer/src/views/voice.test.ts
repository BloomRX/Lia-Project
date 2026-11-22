import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  voiceEnabledPayload,
  voiceEngineCardVm,
  voiceEngineRowChipVariant,
  voiceEngineSelectionPayload,
  voiceProvisioningVm,
  voiceStatusChipVariant,
  voiceStatusChipVm,
} from '../components/voice-engine-card.vm'
import { LIA_VOICE_ENGINE_STRINGS } from '../voice-engine-strings'

/**
 * Phase 8.0A-4: the Voice page migration, proven the launcher way -
 * node-only, WITHOUT a DOM (the launcher test environment is node-only by
 * design). The guarantees are structural: what the migrated surfaces are
 * built from, which state model feeds them, and what they can NEVER show
 * a normal user. The 7.9H readiness model stays the ONE source of truth.
 */

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

const VOICE_VIEW = () => readSource('./VoiceView.vue')
const VOICE_CARD = () => readSource('../components/VoiceEngineCard.vue')
const VOICE_VM = () => readSource('../components/voice-engine-card.vm.ts')

/** The user-visible slice of a .vue file (what a normal user reads). */
function templateOf(source: string): string {
  const start = source.indexOf('<template>')
  const end = source.indexOf('</template>')
  if (start === -1 || end === -1)
    throw new Error('template block not found')
  return source.slice(start, end)
}

/** The style slice of a .vue file (where raw colors would sneak in). */
function styleOf(source: string): string {
  const start = source.indexOf('<style')
  const end = source.indexOf('</style>')
  if (start === -1 || end === -1)
    throw new Error('style block not found')
  return source.slice(start, end)
}

describe('8.0A-4 Voice page: design-system migration', () => {
  it('a: the Voice page and card are built on Lia primitives + semantic tokens', () => {
    const view = VOICE_VIEW()
    const card = VOICE_CARD()

    // Primitives are the surfaces/actions/status of the page...
    expect(view).toContain('import LiaPanel from \'../components/lia/LiaPanel.vue\'')
    expect(view).toContain('import LiaButton from \'../components/lia/LiaButton.vue\'')
    expect(card).toContain('import LiaPanel from \'./lia/LiaPanel.vue\'')
    expect(card).toContain('import LiaButton from \'./lia/LiaButton.vue\'')
    expect(card).toContain('import LiaStatusChip from \'./lia/LiaStatusChip.vue\'')
    expect(view).toContain('<LiaPanel')
    expect(card).toContain('<LiaPanel')
    expect(card).toContain('<LiaStatusChip')

    // ...and every CSS variable used in their styles is a semantic token.
    for (const [name, source] of [['VoiceView', view], ['VoiceEngineCard', card]] as const) {
      const vars = [...styleOf(source).matchAll(/var\(([^)]+)\)/g)].map(match => match[1].trim())
      expect(vars.length, name).toBeGreaterThan(0)
      for (const variable of vars)
        expect(variable, name).toMatch(/^--lia-/)
    }
  })

  it('b: the canonical readiness state is STILL the existing 7.9H model - no second voice state', () => {
    const card = VOICE_CARD()

    // Same reader + rail event + view-models as before the migration...
    expect(card).toContain('voiceProvisioningState')
    expect(card).toContain('LIA_VOICE_READINESS_EVENT')
    expect(card).toContain('voiceProvisioningVm(readiness.value, language.value)')
    // ...and the chip face is the SAME shared vocabulary the shell and
    // Home render - one state model, never a local copy.
    expect(card).toContain('voiceStatusChipVm(readiness.value, language.value)')
    expect(card).toContain('voiceStatusChipVariant(chipVm.tone)')

    // The page never declares its own readiness state machine. ('ready'
    // alone is skipped: it is also the existing voice KIND literal.)
    expect(card).not.toMatch(/ref<[^>]*('disabled'|'checking'|'missing'|'preparing'|'error')/)
    expect(VOICE_VIEW()).not.toMatch(/ref<[^>]*('disabled'|'checking'|'missing'|'preparing'|'error')/)
  })

  it('c: disabled -> Desativada', () => {
    const chip = voiceStatusChipVm({ state: 'disabled' } as any)
    expect(chip.label).toBe('Desativada')
    expect(chip.tone).toBe('dim')
    expect(voiceStatusChipVariant(chip.tone)).toBe('disabled')

    const prov = voiceProvisioningVm({ state: 'disabled' } as any)
    expect(prov.enabled).toBe(false)
    expect(prov.stateLabel).toBe('Desativada')
    expect(prov.toggleLabel).toBe('Ativar voz')
  })

  it('d: preparing -> honest step label (never invented percentages)', () => {
    // A real step wins while preparing...
    expect(voiceStatusChipVm({ state: 'preparing', step: 'model' } as any).label).toBe('Baixando voz…')
    expect(voiceStatusChipVm({ state: 'preparing', step: 'python' } as any).label).toBe('Configurando ambiente…')
    expect(voiceStatusChipVm({ state: 'preparing', step: 'voices' } as any).label).toBe('Finalizando…')
    // ...and without a step the honest generic label shows.
    expect(voiceStatusChipVm({ state: 'preparing' } as any).label).toBe('Preparando voz…')

    const prov = voiceProvisioningVm({ state: 'preparing', step: 'model' } as any)
    expect(prov.busy).toBe(true)
    expect(prov.progressLabel).toBe('Baixando voz…')
    // No numeric fiction anywhere in the progress copy.
    for (const locale of Object.values(LIA_VOICE_ENGINE_STRINGS)) {
      for (const [key, value] of Object.entries(locale)) {
        if (key.includes('step.'))
          expect(value, key).not.toMatch(/\d/)
      }
    }
  })

  it('e: ready -> Pronto', () => {
    const chip = voiceStatusChipVm({ state: 'ready' } as any)
    expect(chip.label).toBe('Pronto')
    expect(chip.tone).toBe('ok')
    expect(voiceStatusChipVariant(chip.tone)).toBe('ready')
    expect(voiceProvisioningVm({ state: 'ready' } as any).stateLabel).toBe('Voz pronta')
  })

  it('f: error -> Erro, and the retry action remains available', () => {
    const chip = voiceStatusChipVm({ state: 'error' } as any)
    expect(chip.label).toBe('Erro')
    expect(chip.tone).toBe('err')
    expect(voiceStatusChipVariant(chip.tone)).toBe('error')

    const prov = voiceProvisioningVm({ state: 'error' } as any)
    expect(prov.canRetry).toBe(true)
    expect(prov.stateLabel).toBe('Não foi possível preparar a voz')

    // The migrated card still wires the SAME retry seam.
    const card = VOICE_CARD()
    expect(card).toContain('v-if="provVm.canRetry"')
    expect(card).toContain('@click="retryProvisioning"')
    expect(card).toContain('retryVoiceProvisioning')
  })

  it('g: voice enable/disable still rides the canonical config-update seam', () => {
    expect(voiceEnabledPayload(true)).toEqual({ update: { voice: { enabled: true } } })
    expect(voiceEnabledPayload(false)).toEqual({ update: { voice: { enabled: false } } })

    const card = VOICE_CARD()
    expect(card).toContain('props.api.updateConfig(voiceEnabledPayload(!provVm.value.enabled))')
    expect(card).toContain('@click="toggleVoiceEnabled"')
  })

  it('h: engine selection preserves the existing payload + row behavior', () => {
    expect(voiceEngineSelectionPayload('kokoro')).toEqual({
      update: { voice: { engine: { preferred: 'kokoro' } } },
    })

    // Row rules are untouched: installed rows select, uninstalled rows install.
    const installed = voiceEngineCardVm({
      engines: [{ id: 'kokoro', installed: true, name: 'Kokoro', nameKey: 'lia.voice.engines.kokoro.name', selectable: true, selected: false }],
      phase: 'idle',
    } as any)
    expect(installed.rows[0].canSelect).toBe(true)
    expect(installed.rows[0].canInstall).toBe(false)

    const missing = voiceEngineCardVm({
      engines: [{ id: 'kokoro', installed: false, name: 'Kokoro', nameKey: 'lia.voice.engines.kokoro.name', selectable: true, selected: false }],
      phase: 'idle',
    } as any)
    expect(missing.rows[0].canInstall).toBe(true)
    expect(missing.rows[0].canSelect).toBe(false)

    // The ONE row-state -> chip variant mapping (shared, no drift).
    expect(voiceEngineRowChipVariant('lia.voice.engines.state.ready')).toBe('ready')
    expect(voiceEngineRowChipVariant('lia.voice.engines.state.installing')).toBe('warning')
    expect(voiceEngineRowChipVariant('lia.voice.engines.state.notInstalled')).toBe('neutral')
    expect(voiceEngineRowChipVariant('lia.voice.engines.state.unavailable')).toBe('error')

    const card = VOICE_CARD()
    expect(card).toContain('props.api.updateConfig(voiceEngineSelectionPayload(engineId))')
    expect(card).toContain('@click="select(row.id)"')
    expect(card).toContain('@click="install"')
  })

  it('i: the normal page contains no implementation jargon', () => {
    // Python/ONNX/pip/venv/DirectML/vendor/paths/hashes never reach the
    // surface a normal user reads. ("Kokoro" is the product-facing engine
    // name by the 7.9G decision, not jargon.)
    const forbidden = /python|onnx|\bpip\b|venv|directml|alltalk|xtts|backend|huggingface|installdir|install dir|runtimehome|runtime home|\bhash\b/i

    expect(templateOf(VOICE_VIEW())).not.toMatch(forbidden)
    expect(templateOf(VOICE_CARD())).not.toMatch(forbidden)

    // ...nor the catalog copy behind every visible label.
    for (const [locale, table] of Object.entries(LIA_VOICE_ENGINE_STRINGS)) {
      for (const [key, value] of Object.entries(table)) {
        if (key.endsWith('.name'))
          continue
        expect(value, `${locale}/${key}`).not.toMatch(forbidden)
      }
    }
  })

  it('j: no raw new hex/rgb colors - semantic tokens only', () => {
    for (const [name, source] of [['VoiceView', VOICE_VIEW()], ['VoiceEngineCard', VOICE_CARD()]] as const) {
      const style = styleOf(source)
      expect(style, name).not.toMatch(/#[0-9a-f]{3,8}\b/i)
      expect(style, name).not.toMatch(/rgba?\(/i)
    }
  })

  it('k: no business logic moved into the renderer view', () => {
    for (const [name, source] of [['VoiceView', VOICE_VIEW()], ['VoiceEngineCard', VOICE_CARD()]] as const) {
      // Views never reach into main-process modules, processes or the disk.
      expect(source, name).not.toMatch(/from ['"]\.\..*main\//)
      expect(source, name).not.toMatch(/spawn|child_process|execFile|writeFile|mkdirSync/)
      // ...and never hardcode IPC channel names - everything rides the
      // existing api object (the launcher's only seam).
      expect(source, name).not.toContain('\'lia:')
    }

    // The readiness/install DECISIONS remain in the vm + main process; the
    // view only maps states to copy.
    expect(VOICE_VM()).toContain('voiceProvisioningVm')
    expect(VOICE_VM()).toContain('status?.state ?? \'checking\'')
  })

  it('the page preserves every existing action + the engine card stays first', () => {
    const view = VOICE_VIEW()

    // Header, in product words.
    expect(view).toContain('<h2>Voz</h2>')
    // The engine card appears ALWAYS, exactly once, before the kind choice.
    expect(view).toContain('<VoiceEngineCard v-if="props.api" :api="props.api" @changed="emit(\'refresh\')" />')
    expect(view.indexOf('<VoiceEngineCard')).toBeLessThan(view.indexOf('class="choices"'))

    // Every pre-existing action is still wired.
    for (const action of ['@click="changeLocation"', '@click="resetLocation"', '@click="activateReady"', '@click="activateCustom(p)"', '@click="importVoice"'])
      expect(view, action).toContain(action)

    // The shell still feeds the same props to the page.
    expect(view).toContain('defineProps<{ api: any, status: any }>()')
  })
})
