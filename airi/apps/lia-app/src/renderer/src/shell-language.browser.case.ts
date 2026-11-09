import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'

import App from './App.vue'
import ConfigView from './views/ConfigView.vue'

import './styles.css'
import './styles/lia-tokens.css'

function button(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label)
  expect(found, label).toBeDefined()
  return found!
}

function fixture(language = 'pt-BR') {
  let savedLanguage = language
  let listener: (payload: { event: string }) => void = () => {}
  const api = {
    homeStatus: vi.fn().mockResolvedValue({}),
    voiceProvisioningState: vi.fn().mockResolvedValue(undefined),
    productConfig: vi.fn(async () => ({ status: 'ok', filePath: 'profile.json', snapshot: { preferences: { language: savedLanguage }, setup: { completed: true } } })),
    onLiaEvent: vi.fn((callback: typeof listener) => {
      listener = callback
      return () => {}
    }),
    updateConfig: vi.fn(async (payload: { update: { preferences: { language: string } } }) => {
      savedLanguage = payload.update.preferences.language
      listener({ event: 'lia-app.config-updated' })
      return { status: 'ok' }
    }),
  }
  Object.assign(window, { liaApi: api })
  return { api, event: (event: string) => listener({ event }) }
}

async function chooseLanguage(container: HTMLElement, language: string) {
  const select = container.querySelector('select')!
  select.value = language
  select.dispatchEvent(new Event('change', { bubbles: true }))
  container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

afterEach(() => {
  delete (window as any).liaApi
})

describe('saved Launcher language in the real DOM', () => {
  it('switches Portuguese to English and back after saving, without remounting the shell', async () => {
    const { api, event } = fixture()
    const screen = await render(App)
    await vi.waitFor(() => expect(api.onLiaEvent).toHaveBeenCalled())
    button(screen.container, 'Configuração').click()
    await vi.waitFor(() => expect(screen.container.querySelector('select')?.value).toBe('pt-BR'))
    await chooseLanguage(screen.container, 'en-US')
    await vi.waitFor(() => expect(screen.container.querySelector('.settings')?.textContent).toContain('Settings'))
    expect(screen.container.textContent).toContain('Home')
    expect(screen.container.textContent).toContain('AI & Resources')
    expect(screen.container.textContent).toContain('Diagnostics')
    expect(screen.container.querySelector('.contextbar')?.textContent).toContain('voice:')
    expect(screen.container.textContent).toContain('Configuration saved.')
    expect(screen.container.textContent).toContain('Product language')
    expect(screen.container.querySelector('input[type=password]')?.getAttribute('placeholder')).toBe('enter to replace; stored only in the vault')
    await page.screenshot({ path: '__screenshots__/shell-config-en.png' })
    const reads = api.productConfig.mock.calls.length
    event('lia-app.stage-log')
    await Promise.resolve()
    expect(api.productConfig).toHaveBeenCalledTimes(reads)
    await chooseLanguage(screen.container, 'pt-BR')
    await vi.waitFor(() => expect(screen.container.querySelector('.settings')?.textContent).toContain('Configuração'))
    expect(screen.container.textContent).toContain('Configuração salva.')
    expect(screen.container.querySelector('.contextbar')?.textContent).toContain('voz:')
    await page.screenshot({ path: '__screenshots__/shell-config-pt.png' })
  })

  it('keeps the saved English locale on failed save and presents a safe translated error', async () => {
    const { api } = fixture('en-US')
    const screen = await render(App)
    await vi.waitFor(() => expect(screen.container.querySelector('.settings')?.textContent).toContain('Settings'))
    button(screen.container, 'Settings').click()
    await vi.waitFor(() => expect(screen.container.querySelector('select')?.value).toBe('en-US'))
    api.updateConfig.mockRejectedValueOnce(new Error('PRIVATE_SENTINEL'))
    await chooseLanguage(screen.container, 'pt-BR')
    await vi.waitFor(() => expect(screen.container.textContent).toContain('Could not save the configuration. Try again.'))
    expect(screen.container.textContent).not.toContain('PRIVATE_SENTINEL')
    expect(screen.container.querySelector('.settings')?.textContent).toContain('Settings')
  })

  it('localizes loading, pending save and resolved save failures without exposing details', async () => {
    let finishLoad!: (value: any) => void
    let finishSave!: (value: any) => void
    const api = {
      productConfig: vi.fn(() => new Promise((resolve) => { finishLoad = resolve })),
      updateConfig: vi.fn(() => new Promise((resolve) => { finishSave = resolve })),
    }
    const screen = await render(ConfigView, { props: { api, status: {}, language: 'en-US' } })
    expect(screen.container.textContent).toContain('Loading configuration…')
    expect(screen.container.querySelector('form')).toBeNull()
    finishLoad({ status: 'ok', snapshot: { preferences: { language: 'en-US' } } })
    await vi.waitFor(() => expect(screen.container.querySelector('select')).not.toBeNull())
    await chooseLanguage(screen.container, 'pt-BR')
    await vi.waitFor(() => expect(button(screen.container, 'Saving…').disabled).toBe(true))
    finishSave({ status: 'failed', message: 'PRIVATE_SENTINEL' })
    await vi.waitFor(() => expect(screen.container.textContent).toContain('Could not save the configuration. Try again.'))
    expect(screen.container.textContent).not.toContain('PRIVATE_SENTINEL')
    expect(button(screen.container, 'Save configuration').disabled).toBe(false)
  })

  it('uses Portuguese fallback and lets a failed configuration read retry', async () => {
    const api = { productConfig: vi.fn().mockRejectedValueOnce(new Error('PRIVATE_SENTINEL')).mockResolvedValue({ status: 'ok', snapshot: {} }) }
    const screen = await render(ConfigView, { props: { api, status: {}, language: 'es' } })
    await vi.waitFor(() => expect(screen.container.textContent).toContain('Não foi possível carregar a configuração. Tente novamente.'))
    expect(screen.container.textContent).not.toContain('PRIVATE_SENTINEL')
    button(screen.container, 'Tentar novamente').click()
    await vi.waitFor(() => expect(screen.container.textContent).toContain('Salvar configuração'))
  })

  it.each(['invalid', 'read-error', 'io-error'])('blocks resolved %s configuration reads until a successful retry', async (status) => {
    const api = {
      productConfig: vi.fn()
        .mockResolvedValueOnce({ status, filePath: 'PRIVATE_SENTINEL', error: 'PRIVATE_SENTINEL', snapshot: { preferences: { language: 'en-US' }, provider: { chat: { preferred: { providerId: 'PRIVATE_SENTINEL' } } } } })
        .mockResolvedValue({ status: 'ok', snapshot: { preferences: { language: 'en-US' } } }),
      updateConfig: vi.fn().mockResolvedValue({ status: 'ok' }),
    }
    const screen = await render(ConfigView, { props: { api, status: {}, language: 'en-US' } })
    await vi.waitFor(() => expect(screen.container.textContent).toContain('Could not load the configuration. Try again.'))
    expect(screen.container.querySelector('form')).toBeNull()
    expect(screen.container.textContent).not.toContain('PRIVATE_SENTINEL')
    expect(screen.container.textContent).not.toContain('Configuration saved.')
    expect(api.updateConfig).not.toHaveBeenCalled()
    button(screen.container, 'Try again').click()
    await vi.waitFor(() => expect(screen.container.querySelector('form')).not.toBeNull())
    await chooseLanguage(screen.container, 'en-US')
    await vi.waitFor(() => expect(screen.container.textContent).toContain('Configuration saved.'))
    expect(api.updateConfig).toHaveBeenCalledTimes(1)
  })

  it('lets a new profile explicitly create its missing configuration with Portuguese defaults', async () => {
    const api = {
      productConfig: vi.fn().mockResolvedValueOnce({ status: 'missing', filePath: 'new-profile.json' }).mockResolvedValue({ status: 'ok', snapshot: { preferences: { language: 'pt-BR' } } }),
      updateConfig: vi.fn().mockResolvedValue({ status: 'ok' }),
    }
    const screen = await render(ConfigView, { props: { api, status: {} } })
    await vi.waitFor(() => expect(screen.container.querySelector('form')).not.toBeNull())
    expect(api.updateConfig).not.toHaveBeenCalled()
    button(screen.container, 'Salvar configuração').click()
    await vi.waitFor(() => expect(screen.container.textContent).toContain('Configuração salva.'))
    expect(api.updateConfig).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ preferences: { language: 'pt-BR' } }) }))
  })

  it('preserves the saved shell language when a later configuration read resolves invalid', async () => {
    const { api, event } = fixture('en-US')
    const screen = await render(App)
    await vi.waitFor(() => expect(screen.container.querySelector('.settings')?.textContent).toContain('Settings'))
    const reads = api.productConfig.mock.calls.length
    api.productConfig.mockResolvedValueOnce({ status: 'invalid', filePath: 'profile.json', snapshot: { preferences: { language: 'pt-BR' }, setup: { completed: true } } })
    event('lia-app.config-updated')
    await vi.waitFor(() => expect(api.productConfig).toHaveBeenCalledTimes(reads + 1))
    expect(screen.container.querySelector('.settings')?.textContent).toContain('Settings')
  })
})
