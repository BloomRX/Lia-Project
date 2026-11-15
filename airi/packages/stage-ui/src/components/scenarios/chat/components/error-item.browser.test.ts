import locales from '@proj-airi/i18n/locales'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'

import ErrorItem from './error-item.vue'

describe('chat error display', () => {
  beforeEach(async () => {
    await page.viewport(365, 720)
  })

  it('replaces a legacy transport blob before rendering or copying it', async () => {
    // The desktop dropdown deliberately does not exist below the mobile breakpoint.
    await page.viewport(1024, 768)
    const message = {
      role: 'error' as const,
      content: 'Remote sent 413 response: {"error":{"message":"SENTINEL_PRIVATE https://service.invalid/account user-qa"}}',
    }
    const screen = await render(ErrorItem, {
      props: { message, label: 'System', canRetry: true, retryLabel: 'Retry' },
      global: { plugins: [createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: locales })] },
    })

    await vi.waitFor(() => expect(screen.container.textContent).toContain('System'))
    expect(screen.container.textContent).not.toContain('SENTINEL_PRIVATE')
    expect(screen.container.textContent).not.toContain('https://')
    expect(screen.container.textContent).toContain('too large')
    expect(message.content).toContain('SENTINEL_PRIVATE')
    expect(screen.container.querySelector('[aria-label="Retry"]')).not.toBeNull()

    // Clipboard writes cross into the OS; retain the real menu and capture that boundary.
    const clipboardWrite = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    try {
      await screen.getByRole('button', { name: 'Message actions' }).click()
      await page.getByRole('menuitem', { name: 'Copy', exact: true }).click()
      expect(clipboardWrite).toHaveBeenCalledWith('This conversation or its attachments are too large. Start a new conversation or use fewer, smaller images.')
    }
    finally {
      clipboardWrite.mockRestore()
    }
  })

  it('changes the persisted canonical error language without reloading or rewriting the message', async () => {
    const i18n = createI18n({ legacy: false, locale: 'pt-BR', fallbackLocale: 'en', messages: locales })
    const message = {
      role: 'error' as const,
      content: 'The AI service has reached its usage limit. Wait a moment and try again, or check the service limits in settings.',
    }
    const onRetry = vi.fn()
    const screen = await render(ErrorItem, {
      props: { message, label: 'Sistema', canRetry: true, retryLabel: 'Tentar novamente', onRetry },
      global: { plugins: [i18n] },
    })

    await vi.waitFor(() => expect(screen.container.textContent).toContain('atingiu o limite de uso'))
    await screen.getByRole('button', { name: 'Tentar novamente' }).click()
    expect(onRetry).toHaveBeenCalledOnce()
    i18n.global.locale.value = 'en'
    await vi.waitFor(() => expect(screen.container.textContent).toContain('has reached its usage limit'))
    expect(screen.container.textContent).not.toContain('atingiu o limite de uso')
    expect(message.content).toBe('The AI service has reached its usage limit. Wait a moment and try again, or check the service limits in settings.')
  })

  it('falls back to English for en-US and retains the specific empty-response recovery', async () => {
    const screen = await render(ErrorItem, {
      props: {
        message: { role: 'error', content: 'O serviço de IA terminou sem enviar uma resposta. Tente novamente.' },
        label: 'System',
      },
      global: { plugins: [createI18n({ legacy: false, locale: 'en-US', fallbackLocale: 'en', messages: locales })] },
    })
    await vi.waitFor(() => expect(screen.container.textContent).toContain('finished without sending a response'))
    expect(screen.container.textContent).not.toContain('O serviço')
  })

  it('ships the Portuguese composer and retry labels in the same real locale', () => {
    const i18n = createI18n({ legacy: false, locale: 'pt-BR', fallbackLocale: 'en', messages: locales })
    expect(i18n.global.t('stage.message')).toBe('Escreva uma mensagem...')
    expect(i18n.global.t('stage.chat.actions.retry')).toBe('Tentar novamente')
    expect(i18n.global.t('stage.chat.sessions.new-chat-fallback')).toBe('Nova conversa')
  })
})
