import type { LiaProviderChatConfig } from '../../shared/eventa'
import type { LiaModelDiscoveryResult } from '../stores/lia/provider-runtime'

import locales from '@proj-airi/i18n/locales'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { nextTick, reactive } from 'vue'
import { createI18n } from 'vue-i18n'

import LiaProviderConfig from './LiaProviderConfig.vue'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const fixture = vi.hoisted(() => ({
  config: { preferred: { providerId: 'openai-compatible', modelId: 'custom/Meu-modelo:Q4' }, fallbackEnabled: false } as LiaProviderChatConfig,
  discoverModels: vi.fn(async (): Promise<LiaModelDiscoveryResult> => ({ status: 'ready', models: [{ id: 'discovered/model', label: 'Discovered model' }] })),
  persistConfig: vi.fn(async (config: LiaProviderChatConfig) => { fixture.config = structuredClone(config) }),
  testConnection: vi.fn(async () => ({ ok: true, message: '', scope: 'text' })),
}))

vi.mock('../stores/lia/provider', async (original) => {
  const actual = await original<typeof import('../stores/lia/provider')>()
  return {
    ...actual,
    useLiaProviderStore: () => reactive({
      loadedConfig: fixture.config,
      refreshConfig: async () => fixture.config,
      persistConfig: fixture.persistConfig,
      discoverModels: fixture.discoverModels,
      testConnection: fixture.testConnection,
      providerNeedsKey: () => false,
      providerApiKeyUrl: () => undefined,
      providerBaseUrl: () => 'https://service.invalid/v1/',
      hasApiKey: async () => false,
      ensureProviderRecord: async () => {},
      activatePreferred: async () => true,
    }),
  }
})
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

function input(container: HTMLElement, id: string) {
  const element = container.querySelector<HTMLInputElement>(`#${id}`)
  expect(element).not.toBeNull()
  return element!
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.config = { preferred: { providerId: 'openai-compatible', modelId: 'custom/Meu-modelo:Q4' }, fallbackEnabled: false }
})

async function mount(locale = 'pt-BR') {
  const i18n = createI18n({ legacy: false, locale, messages: {
    'pt-BR': locales['pt-BR'],
    'en': locales.en,
  } })
  return render(LiaProviderConfig, { props: { mode: 'manage' }, global: { plugins: [i18n] } })
}

describe('editable model selection', () => {
  it('preserves a custom model on load, edit, save and provider change', async () => {
    const screen = await mount()
    await vi.waitFor(() => expect(input(screen.container, 'lia-model').value).toBe('custom/Meu-modelo:Q4'))
    const model = input(screen.container, 'lia-model')
    model.value = 'custom/Novo:V2'
    model.dispatchEvent(new Event('input', { bubbles: true }))
    const providers = screen.container.querySelector('select')!
    providers.value = 'ollama'
    providers.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    expect(model.value).toBe('custom/Novo:V2')
    await screen.getByRole('button', { name: 'Salvar', exact: true }).click()
    await vi.waitFor(() => expect(fixture.persistConfig).toHaveBeenCalledWith(expect.objectContaining({ preferred: { providerId: 'ollama', modelId: 'custom/Novo:V2' } })))
  })

  it('keeps manual entry enabled when discovery fails', async () => {
    fixture.discoverModels.mockResolvedValueOnce({ status: 'error', models: [] })
    const screen = await mount()
    await vi.waitFor(() => expect(screen.container.textContent).toContain('Não foi possível buscar modelos.'))
    expect(input(screen.container, 'lia-model').disabled).toBe(false)
    expect(input(screen.container, 'lia-model').value).toBe('custom/Meu-modelo:Q4')
  })
  it('offers recommended and discovered suggestions without changing the selected ID', async () => {
    const screen = await mount()
    await vi.waitFor(() => expect(screen.container.querySelector('option[value="discovered/model"]')).not.toBeNull())
    expect(screen.container.querySelector('option[value="gpt-4o-mini"]')).not.toBeNull()
    expect(input(screen.container, 'lia-model').value).toBe('custom/Meu-modelo:Q4')
    const model = input(screen.container, 'lia-model')
    model.value = 'gpt-4o-mini'
    model.dispatchEvent(new Event('input', { bubbles: true }))
    await screen.getByRole('button', { name: 'Salvar', exact: true }).click()
    await vi.waitFor(() => expect(fixture.config.preferred?.modelId).toBe('gpt-4o-mini'))
  })

  it('restores a saved custom ID when reopening the editor', async () => {
    const screen = await mount()
    await vi.waitFor(() => expect(input(screen.container, 'lia-model').value).toBe('custom/Meu-modelo:Q4'))
    await screen.getByRole('button', { name: 'Salvar', exact: true }).click()
    await vi.waitFor(() => expect(fixture.persistConfig).toHaveBeenCalledTimes(1))
    screen.unmount()
    const reopened = await mount()
    await vi.waitFor(() => expect(input(reopened.container, 'lia-model').value).toBe('custom/Meu-modelo:Q4'))
  })

  it('does not persist a blank model or silently restore a recommendation', async () => {
    const screen = await mount()
    await vi.waitFor(() => expect(input(screen.container, 'lia-model').value).toBe('custom/Meu-modelo:Q4'))
    const model = input(screen.container, 'lia-model')
    model.value = ''
    model.dispatchEvent(new Event('input', { bubbles: true }))
    await screen.getByRole('button', { name: 'Salvar', exact: true }).click()
    expect(fixture.persistConfig).not.toHaveBeenCalled()
    expect(model.value).toBe('')
  })

  it.each(['pt-BR', 'en'])('renders translated discovery feedback in %s', async (locale) => {
    const screen = await mount(locale)
    await vi.waitFor(() => expect(screen.container.textContent).toContain(locale === 'en' ? 'Suggestions received.' : 'Sugestões recebidas.'))
    expect(screen.container.textContent).not.toContain('tamagotchi.home.')
    await page.screenshot({ path: `J:/Lia-Project/airi/apps/stage-tamagotchi/node_modules/.cache/lia-models-${locale}.png` })
  })

  it('invalidates a successful text probe when the endpoint changes', async () => {
    const screen = await mount()
    await vi.waitFor(() => expect(input(screen.container, 'lia-model').value).toBe('custom/Meu-modelo:Q4'))
    await screen.getByRole('button', { name: 'Testar conexão', exact: true }).click()
    await vi.waitFor(() => expect(screen.container.textContent).toContain('O modelo respondeu ao teste de texto.'))
    const endpoint = screen.container.querySelector<HTMLInputElement>('input[type="text"]')!
    endpoint.value = 'https://changed.invalid/v1/'
    endpoint.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(screen.container.textContent).not.toContain('O modelo respondeu ao teste de texto.')
  })
  it('preserves a custom backup model while editing and saving', async () => {
    fixture.config.fallbackEnabled = true
    fixture.config.fallback = [{ providerId: 'openai', modelId: 'custom/Backup:Q8' }]
    const screen = await mount()
    await vi.waitFor(() => expect(input(screen.container, 'lia-fallback-model').value).toBe('custom/Backup:Q8'))
    await screen.getByRole('button', { name: 'Salvar', exact: true }).click()
    await vi.waitFor(() => expect(fixture.config.fallback?.[0].modelId).toBe('custom/Backup:Q8'))
    expect(fixture.config.preferred?.modelId).toBe('custom/Meu-modelo:Q4')
  })

  it.each(['unsupported', 'ready'] as const)('keeps a custom ID editable with %s discovery and no suggestions', async (status) => {
    fixture.discoverModels.mockResolvedValueOnce({ status, models: [] })
    const screen = await mount()
    await vi.waitFor(() => expect(screen.container.textContent).toContain(status === 'unsupported' ? 'Este serviço não lista modelos.' : 'O serviço não retornou sugestões.'))
    expect(input(screen.container, 'lia-model').disabled).toBe(false)
    expect(input(screen.container, 'lia-model').value).toBe('custom/Meu-modelo:Q4')
  })
})
