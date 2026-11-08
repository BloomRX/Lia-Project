import { registerProviderCredentialConfigPort } from '@proj-airi/stage-ui/stores/providers/credential-config-port'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { reactive } from 'vue'
import { createI18n } from 'vue-i18n'

import Editor from './index.vue'

interface ProviderFixture { id: string, definitionId: string, config: Record<string, unknown>, status: string }

const fixture = vi.hoisted(() => ({
  current: { id: 'generic-test', definitionId: 'test-definition', config: {} as Record<string, unknown>, status: 'configured' },
  registry: undefined as { current: ProviderFixture } | undefined,
  advanced: false,
  required: true,
  update: vi.fn(),
  validate: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { providerId: 'generic-test' } }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))
vi.mock('@proj-airi/stage-ui/stores/providers/config', () => ({
  useProviderConfigStore: () => ({
    getProvider: () => fixture.registry!.current,
    updateProviderConfig: fixture.update,
    setProviderStatus: vi.fn(),
  }),
}))
vi.mock('@proj-airi/stage-ui/libs', async () => {
  const { z } = await import('zod')
  return {
    getDefinedProvider: () => ({
      id: 'test-definition',
      name: 'Serviço de IA',
      nameLocalize: () => 'Serviço de IA',
      descriptionLocalize: () => 'Configuração',
      createProviderConfig: async () => z.object({
        apiKey: (fixture.required ? z.string().min(1) : z.string().optional()).meta({ labelLocalized: 'Chave', section: fixture.advanced ? 'advanced' : 'basic' }),
        baseUrl: z.string().meta({ labelLocalized: 'Endereço' }),
      }),
    }),
    getSchemaDefault: () => ({}),
    getValidatorsOfProvider: async () => ({ shouldValidate: false, steps: [] }),
    validateProvider: fixture.validate,
  }
})
vi.mock('@proj-airi/stage-ui/components', async () => {
  const { defineComponent, h } = await import('vue')
  const { default: ProviderApiKeyInput } = await import('../../../../../../../../stage-ui/src/components/scenarios/providers/provider-api-key-input.vue')
  const { default: ProviderBaseUrlInput } = await import('../../../../../../../../stage-ui/src/components/scenarios/providers/provider-base-url-input.vue')
  const wrapper = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
  return {
    ProviderApiKeyInput,
    ProviderBaseUrlInput,
    ProviderAccountIdInput: wrapper,
    ProviderAdvancedSettings: wrapper,
    ProviderBasicSettings: wrapper,
    ProviderSettingsContainer: wrapper,
    ProviderSettingsLayout: wrapper,
    ProviderValidationDetailsDialog: wrapper,
    Alert: wrapper,
  }
})

const disposers: Array<() => void> = []
beforeEach(() => {
  fixture.current = reactive({ id: 'generic-test', definitionId: 'test-definition', config: { apiKey: 'synthetic-historical', baseUrl: 'https://example.invalid/v1', token: 'custom-token' }, status: 'configured' })
  fixture.registry = reactive({ current: fixture.current })
  fixture.advanced = false
  fixture.required = true
  vi.clearAllMocks()
})
afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose())
})

function mountEditor() {
  return render(Editor, {
    global: { plugins: [createI18n({ legacy: false, locale: 'pt-BR', messages: { 'pt-BR': {} }, missingWarn: false, fallbackWarn: false })] },
  })
}

describe('generic native credential editor', () => {
  it('preserves unsaved settings when credential migration replaces the provider record', async () => {
    const save = vi.fn(async () => {
      const config = { ...fixture.current.config }
      delete config.apiKey
      fixture.current = reactive({ ...fixture.current, config, status: 'bypassed' })
      fixture.registry!.current = fixture.current
      return true
    })
    disposers.push(registerProviderCredentialConfigPort({ owns: () => true, has: async () => true, save }))
    const screen = mountEditor()
    const endpoint = screen.getByLabelText('Endereço', { exact: false })
    await endpoint.fill('https://unsaved.invalid/v1')
    await screen.getByLabelText('Chave', { exact: false }).fill('synthetic-new-key')
    await screen.getByRole('button', { name: 'Salvar chave', exact: true }).click()
    await expect.poll(() => save.mock.calls.length).toBe(1)
    await expect.element(endpoint).toHaveValue('https://unsaved.invalid/v1')
    await screen.getByRole('button', { name: 'Salvar configuração' }).click()
    expect(fixture.update).toHaveBeenCalledWith('generic-test', { baseUrl: 'https://unsaved.invalid/v1', token: 'custom-token' }, 'bypassed')
  })
  it('isolates typing, saves key explicitly and never resurrects a migrated key when configuration is saved', async () => {
    const save = vi.fn(async () => {
      delete fixture.current.config.apiKey
      return true
    })
    disposers.push(registerProviderCredentialConfigPort({ owns: () => true, has: async () => true, save }))
    const screen = mountEditor()
    const input = screen.getByLabelText('Chave', { exact: false })
    await expect.element(input).toHaveValue('')
    await input.fill('synthetic-new-key')
    expect(fixture.current.config.apiKey).toBe('synthetic-historical')
    expect(fixture.update).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    await screen.getByRole('button', { name: 'Salvar chave', exact: true }).click()
    await expect.poll(() => save.mock.calls.length).toBe(1)
    await expect.element(input).toHaveValue('')
    await screen.getByLabelText('Endereço', { exact: false }).fill('https://changed.invalid/v1')
    await screen.getByRole('button', { name: 'Salvar configuração' }).click()
    expect(fixture.update).toHaveBeenCalledWith('generic-test', { baseUrl: 'https://changed.invalid/v1', token: 'custom-token' }, 'bypassed')
    expect(fixture.validate).not.toHaveBeenCalled()
  })

  it('uses the secure component for an advanced apiKey field and requires saved presence', async () => {
    fixture.advanced = true
    disposers.push(registerProviderCredentialConfigPort({ owns: () => true, has: async () => false, save: async () => true }))
    const screen = mountEditor()
    await expect.element(screen.getByRole('button', { name: 'Salvar chave', exact: true })).toBeVisible()
    await expect.element(screen.getByLabelText('Chave', { exact: false })).toHaveValue('')
    await screen.getByLabelText('Endereço', { exact: false }).fill('https://changed.invalid')
    await expect.element(screen.getByRole('button', { name: 'Salvar configuração' })).toBeDisabled()
    expect(fixture.current.config.apiKey).toBe('synthetic-historical')
  })

  it('allows configuration for a keyless native service', async () => {
    fixture.required = false
    delete fixture.current.config.apiKey
    disposers.push(registerProviderCredentialConfigPort({ owns: () => true, has: async () => false, save: async () => true }))
    const screen = mountEditor()
    await screen.getByLabelText('Endereço', { exact: false }).fill('https://changed.invalid')
    await screen.getByRole('button', { name: 'Salvar configuração' }).click()
    expect(fixture.update).toHaveBeenCalledWith('generic-test', { baseUrl: 'https://changed.invalid', token: 'custom-token' }, 'bypassed')
  })

  it.each([false, true])('preserves the web input contract with an unmapped host port: %s', async (hasPort) => {
    if (hasPort)
      disposers.push(registerProviderCredentialConfigPort({ owns: () => false, has: async () => false, save: async () => true }))
    const screen = mountEditor()
    const input = screen.getByLabelText('Chave', { exact: false })
    await expect.element(input).toHaveValue('synthetic-historical')
    await input.fill('synthetic-web-replacement')
    expect(fixture.current.config.apiKey).toBe('synthetic-historical')
    await expect.element(input).toHaveValue('synthetic-web-replacement')
    await expect.element(screen.getByRole('button', { name: 'Salvar chave', exact: true })).not.toBeInTheDocument()
  })
})
