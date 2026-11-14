import locales from '@proj-airi/i18n/locales'

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { createI18n } from 'vue-i18n'

import ChatActionMenu from './index.vue'

// Internal report: docs/reports/LIA-UI-UX-AUDIT-2026-11-14.md (UI-S01/UI-A02).
async function mount(locale = 'en', onDelete = vi.fn()) {
  await page.viewport(1024, 768)
  const screen = render(ChatActionMenu, {
    props: { copyText: 'A saved message', onDelete },
    slots: { default: '<p>A saved message</p>' },
    global: { plugins: [createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: locales })] },
  })
  return { onDelete, screen }
}

describe('message deletion confirmation', () => {
  it('cancel and Escape leave the message intact; a later explicit confirmation emits once', async () => {
    const { onDelete, screen } = await mount()
    await screen.getByRole('button', { name: 'Message actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete message', exact: true }).click()
    await expect.element(page.getByRole('alertdialog')).toBeVisible()
    await expect.element(page.getByText('This removes only this message from this conversation. It cannot be undone.')).toBeVisible()
    expect(onDelete).not.toHaveBeenCalled()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(onDelete).not.toHaveBeenCalled()

    await screen.getByRole('button', { name: 'Message actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete message', exact: true }).click()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await userEvent.keyboard('{Escape}')
    expect(onDelete).not.toHaveBeenCalled()

    await screen.getByRole('button', { name: 'Message actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete message', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm deletion', exact: true }).click()
    expect(onDelete).toHaveBeenCalledTimes(1)
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('uses Portuguese action, scope and cancellation copy in the same locale', async () => {
    const { onDelete, screen } = await mount('pt-BR')
    await screen.getByRole('button', { name: 'Ações da mensagem' }).click()
    await page.getByRole('menuitem', { name: 'Excluir mensagem', exact: true }).click()
    await expect.element(page.getByText('Esta ação remove apenas esta mensagem desta conversa. Não pode ser desfeita.')).toBeVisible()
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    expect(onDelete).not.toHaveBeenCalled()
  })
})
