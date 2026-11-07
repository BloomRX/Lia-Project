import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import ProviderApiKeyInput from './provider-api-key-input.vue'

import { registerProviderCredentialConfigPort } from '../../../stores/providers/credential-config-port'

const disposers: Array<() => void> = []
afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose())
})

function mountInput(onUpdate = vi.fn(), onConfigured = vi.fn(), providerId = 'native-stt') {
  return render(ProviderApiKeyInput, {
    props: { providerId, 'label': 'Chave', 'description': 'Credencial', 'modelValue': '', 'onUpdate:modelValue': onUpdate, onConfigured },
    global: { plugins: [createI18n({ legacy: false, locale: 'pt-BR', messages: { 'pt-BR': {} }, missingWarn: false, fallbackWarn: false })] },
  })
}

describe('host-owned provider key input', () => {
  it('saves the replacement explicitly without emitting a key or changing configuration', async () => {
    const config = { baseUrl: 'https://example.invalid/v1', model: 'test-transcription', apiKey: '' }
    const onUpdate = vi.fn((value: string) => {
      config.apiKey = value
    })
    const onConfigured = vi.fn()
    const save = vi.fn(async () => true)
    disposers.push(registerProviderCredentialConfigPort({ owns: id => id === 'native-stt', has: async () => true, save }))
    const screen = await mountInput(onUpdate, onConfigured)
    await expect.element(screen.getByRole('status')).toHaveTextContent('Chave salva')
    const input = screen.getByLabelText('Chave', { exact: false })
    await input.fill('synthetic-replacement-credential')
    expect(onUpdate).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    await screen.getByRole('button', { name: 'Salvar chave' }).click()
    await expect.poll(() => save.mock.calls.length).toBe(1)
    expect(save).toHaveBeenCalledWith('native-stt', 'synthetic-replacement-credential')
    await expect.element(input).toHaveValue('')
    expect(onUpdate).not.toHaveBeenCalled()
    expect(config).toEqual({ baseUrl: 'https://example.invalid/v1', model: 'test-transcription', apiKey: '' })
    expect(onConfigured).toHaveBeenLastCalledWith(true)
  })

  it('clears failed saves and renders a generic retry message', async () => {
    disposers.push(registerProviderCredentialConfigPort({
      owns: () => true,
      has: async () => false,
      save: async () => {
        throw new Error('synthetic-secret-error')
      },
    }))
    const screen = await mountInput()
    await expect.element(screen.getByRole('status')).toHaveTextContent('Nenhuma chave salva')
    const input = screen.getByLabelText('Chave', { exact: false })
    await input.fill('synthetic-replacement-credential')
    await screen.getByRole('button', { name: 'Salvar chave' }).click()
    await expect.element(screen.getByRole('status')).toHaveTextContent('Não foi possível salvar a chave. Tente novamente.')
    await expect.element(input).toHaveValue('')
  })

  it('disables duplicate saves while waiting and ignores completion after unmount', async () => {
    let finish!: (value: boolean) => void
    const save = vi.fn(() => new Promise<boolean>((resolve) => {
      finish = resolve
    }))
    disposers.push(registerProviderCredentialConfigPort({ owns: () => true, has: async () => false, save }))
    const onConfigured = vi.fn()
    const screen = await mountInput(vi.fn(), onConfigured)
    await expect.element(screen.getByRole('status')).toHaveTextContent('Nenhuma chave salva')
    await screen.getByLabelText('Chave', { exact: false }).fill('synthetic-replacement-credential')
    await screen.getByRole('button', { name: 'Salvar chave' }).click()
    await expect.element(screen.getByRole('button', { name: 'Salvando chave…' })).toBeDisabled()
    screen.unmount()
    finish(true)
    await Promise.resolve()
    expect(onConfigured).toHaveBeenLastCalledWith(false)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('preserves the original model contract when the host does not own this provider', async () => {
    const onUpdate = vi.fn()
    disposers.push(registerProviderCredentialConfigPort({ owns: () => false, has: async () => true, save: async () => true }))
    const screen = await mountInput(onUpdate)
    await screen.getByLabelText('Chave', { exact: false }).fill('web-credential')
    expect(onUpdate).toHaveBeenLastCalledWith('web-credential')
  })

  it('clears the draft on provider change and ignores the previous pending presence check', async () => {
    let finishOldCheck!: (value: boolean) => void
    const onUpdate = vi.fn()
    const onConfigured = vi.fn()
    disposers.push(registerProviderCredentialConfigPort({
      owns: () => true,
      has: id => id === 'native-stt'
        ? new Promise<boolean>((resolve) => {
            finishOldCheck = resolve
          })
        : Promise.resolve(false),
      save: async () => true,
    }))
    const screen = await mountInput(onUpdate, onConfigured)
    const input = screen.getByLabelText('Chave', { exact: false })
    await expect.element(screen.getByRole('status')).toHaveTextContent('Verificando chave salva…')
    await input.fill('synthetic-old-provider-draft')
    await screen.rerender({ providerId: 'another-native-stt' })
    await expect.element(input).toHaveValue('')
    await expect.element(screen.getByRole('status')).toHaveTextContent('Nenhuma chave salva')
    finishOldCheck(true)
    await Promise.resolve()
    await expect.element(screen.getByRole('status')).toHaveTextContent('Nenhuma chave salva')
    expect(onConfigured).toHaveBeenLastCalledWith(false)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
