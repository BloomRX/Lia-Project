import { registerProviderCredentialConfigPort } from '@proj-airi/stage-ui/stores/providers/credential-config-port'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import ProviderApiKeyInput from '../../../../../../packages/stage-ui/src/components/scenarios/providers/provider-api-key-input.vue'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

describe('native transcription credential component with Stage styles', () => {
  it('saves without returning the key to the configuration binding', async () => {
    const remove = registerProviderCredentialConfigPort({ owns: () => true, has: async () => true, save: async () => true })
    const screen = render(ProviderApiKeyInput, {
      props: { providerId: 'fixture', label: 'Chave do serviço de IA', description: 'Salva com segurança neste computador.' },
      global: { plugins: [createI18n({ legacy: false, locale: 'pt-BR', messages: {} })] },
    })
    try {
      await expect.element(screen.getByRole('status')).toHaveTextContent('Chave salva')
      await screen.getByLabelText('Chave do serviço de IA', { exact: false }).fill('synthetic-fixture-key')
      await screen.getByRole('button', { name: 'Salvar chave' }).click()
      await expect.element(screen.getByRole('status')).toHaveTextContent('Chave salva')
      await expect.element(screen.getByLabelText('Chave do serviço de IA', { exact: false })).toHaveValue('')
      if (import.meta.env.VITE_LIA_CAPTURE_QA === '1')
        await page.screenshot({ path: '../../../../Tests/artifacts/stt-credential-styled.png' })
    }
    finally {
      screen.unmount()
      remove()
    }
  })
})
