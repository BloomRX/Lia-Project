import { LIA_DEFAULT_PERSONA, renderLiaPersonaFields } from '@proj-airi/stage-ui/constants/lia-persona'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import PersonalitySection from './PersonalitySection.vue'

import { createPersonalityDraft, preparePersonalityCard } from '../../../services/lia/personality-editor'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

vi.mock('@proj-airi/stage-ui/stores/modules/artistry', () => ({ useArtistryStore: () => ({ resetToGlobal: () => {}, globalProviderOptions: {} }) }))
vi.mock('@proj-airi/stage-ui/stores/modules/consciousness', () => ({ useConsciousnessStore: () => ({}) }))
vi.mock('@proj-airi/stage-ui/stores/modules/speech', () => ({ useSpeechStore: () => ({}) }))
vi.mock('@proj-airi/stage-ui/stores/modules/vision', () => ({ useVisionStore: () => ({}) }))
vi.mock('@proj-airi/stage-ui/stores/settings/stage-model', () => ({ useSettingsStageModel: () => ({}) }))
vi.mock('@proj-airi/stage-ui/libs/analytics', () => ({ captureAnalyticsEvent: () => {} }))

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})
async function mount(locale = 'pt-BR') {
  const store = useAiriCardStore()
  await store.initialize()
  const screen = render(PersonalitySection, { global: { plugins: [createI18n({ legacy: false, locale, messages: {} })] } })
  return { screen, store }
}
async function setTrait(value: number, label = 'Energia') {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  input.value = String(value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  return input
}

describe('structured personality editor', () => {
  it('saves through the real store, reprojects runtime prose, and reloads persisted values', async () => {
    const { screen, store } = await mount()
    const identity = JSON.parse(JSON.stringify(store.activeCard!.extensions.airi.persona!.identity))
    const runtime = store.activeCard!.systemPrompt
    await setTrait(0.23)
    expect(store.activeCard!.extensions.airi.persona!.attributes.energy).toBe(0.7)
    await screen.getByRole('combobox').selectOptions('serious')
    await screen.getByRole('button', { name: 'Salvar personalidade', exact: true }).click()
    await expect.element(screen.getByText('Personalidade salva.', { exact: true })).toBeVisible()
    expect(store.activeCard!.personality).toContain('energia 0.23')
    expect(store.systemPrompt).toContain('energia 0.23')
    expect(store.activeCard!.personality).toBe(renderLiaPersonaFields(store.activeCard!.extensions.airi.persona!).personality)
    expect(store.activeCard!.extensions.airi.persona!.identity).toEqual(identity)
    expect(store.activeCard!.extensions.airi.persona!.preset).toBe('tsundere')
    expect(store.activeCard!.systemPrompt).toBe(runtime)
    await nextTick()
    await screen.unmount()
    store.$dispose()
    setActivePinia(createPinia())
    const reopened = await mount()
    expect(reopened.store.activeCard!.extensions.airi.persona!.attributes.energy).toBe(0.23)
    expect(reopened.store.activeCard!.personality).toContain('energia 0.23')
    expect(reopened.store.systemPrompt).toContain('energia 0.23')
    await expect.element(reopened.screen.getByRole('combobox')).toHaveValue('serious')
  })

  it('resets only editable traits on explicit save, preserving custom data', async () => {
    const { screen, store } = await mount()
    const custom = JSON.parse(JSON.stringify(store.activeCard!))
    custom.extensions.airi.persona.customRules = ['Minha regra pessoal.']
    custom.extensions.airi.persona.preferences = { theme: 'space' }
    custom.extensions.airi.persona.attributes.energy = 0.13
    await store.updateCard(store.activeCardId, preparePersonalityCard(custom, createPersonalityDraft(custom.extensions.airi.persona)))
    await screen.getByRole('button', { name: 'Descartar alterações' }).click()
    await screen.getByRole('button', { name: 'Redefinir traços para o padrão' }).click()
    expect(store.activeCard!.extensions.airi.persona!.attributes.energy).toBe(0.13)
    await screen.getByRole('button', { name: 'Salvar personalidade', exact: true }).click()
    expect(store.activeCard!.extensions.airi.persona!.attributes).toEqual(LIA_DEFAULT_PERSONA.attributes)
    expect(store.activeCard!.extensions.airi.persona!.customRules).toEqual(['Minha regra pessoal.'])
    expect(store.activeCard!.extensions.airi.persona!.preferences).toEqual({ theme: 'space' })
    expect(store.activeCard!.personality).toContain('Minha regra pessoal.')
  })

  it('reports failed save and retains persisted values and draft in English', async () => {
    const { screen, store } = await mount('en')
    const input = await setTrait(0.25, 'Energy')
    vi.spyOn(store, 'updateCard').mockRejectedValueOnce(new Error('unavailable'))
    await screen.getByRole('button', { name: 'Save personality', exact: true }).click()
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Could not save.')
    expect(store.activeCard!.extensions.airi.persona!.attributes.energy).toBe(0.7)
    expect(input.value).toBe('0.25')
  })

  it('discards unsaved changes without writing the card', async () => {
    const { screen, store } = await mount()
    await setTrait(0.12)
    await screen.getByRole('button', { name: 'Descartar alterações' }).click()
    expect(store.activeCard!.extensions.airi.persona!.attributes.energy).toBe(0.7)
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Energia"]')!.value).toBe('0.7')
  })

  it('blocks a stale draft until the user reloads another window’s values', async () => {
    const { screen, store } = await mount()
    await setTrait(0.12)
    const current = store.activeCard!
    const remoteDraft = createPersonalityDraft(current.extensions.airi.persona!)
    remoteDraft.attributes.energy = 0.91
    await store.updateCard(store.activeCardId, preparePersonalityCard(current, remoteDraft))
    await expect.element(screen.getByRole('alert')).toHaveTextContent('A personalidade mudou em outra janela.')
    await expect.element(screen.getByRole('button', { name: 'Salvar personalidade', exact: true })).toBeDisabled()
    await screen.getByRole('button', { name: 'Descartar alterações' }).click()
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Energia"]')!.value).toBe('0.91')
    expect(store.activeCard!.extensions.airi.persona!.attributes.energy).toBe(0.91)
  })

  it('leaves a character without structured persona untouched', async () => {
    const { screen, store } = await mount()
    const card = { ...store.activeCard!, extensions: { ...store.activeCard!.extensions, airi: { ...store.activeCard!.extensions.airi, persona: undefined } } }
    await store.updateCard(store.activeCardId, card)
    await expect.element(screen.getByText('Esta personagem não tem uma personalidade estruturada para editar.')).toBeVisible()
    expect(document.querySelector('input[type="range"]')).toBeNull()
    expect(store.activeCard!.extensions.airi.persona).toBeUndefined()
  })
})
