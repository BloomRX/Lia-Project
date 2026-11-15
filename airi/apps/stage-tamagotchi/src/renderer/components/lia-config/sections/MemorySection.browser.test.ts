import type { LiaMemoryMutation, LiaMemoryState } from '../../../../shared/eventa/lia-memory'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import MemorySection from './MemorySection.vue'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const ipc = vi.hoisted(() => ({ get: vi.fn(), mutate: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (event: { receiveEvent: { id: string } }) => event.receiveEvent.id.includes(':get-') ? ipc.get : ipc.mutate,
}))

let persisted: LiaMemoryState
beforeEach(() => {
  vi.resetAllMocks()
  persisted = { schemaVersion: 1, enabled: false, entries: [] }
  ipc.get.mockImplementation(async () => ({ ok: true, value: structuredClone(persisted) }))
  ipc.mutate.mockImplementation(async (request: LiaMemoryMutation) => {
    if (request.action === 'enable')
      persisted.enabled = request.enabled
    if (request.action === 'save') {
      if (request.id)
        persisted.entries.find(entry => entry.id === request.id)!.text = request.text
      else
        persisted.entries.push({ id: 'saved-id', text: request.text, updatedAt: '' })
    }
    if (request.action === 'remove')
      persisted.entries = persisted.entries.filter(entry => entry.id !== request.id)
    if (request.action === 'clear')
      persisted.entries = []
    return { ok: true, value: structuredClone(persisted) }
  })
})
function mount(locale = 'pt-BR') {
  const pinia = createPinia()
  setActivePinia(pinia)
  return render(MemorySection, { global: { plugins: [pinia, createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: {} })] } })
}

describe('memory controls', () => {
  it('shows opt-in OFF and lets the user save, edit, reopen and delete memories', async () => {
    const screen = mount()
    await expect.element(screen.getByRole('checkbox')).not.toBeChecked()
    await expect.element(screen.getByText('Nenhuma lembrança guardada. Você decide o que adicionar.')).toBeVisible()
    await screen.getByRole('checkbox').click()
    await expect.element(screen.getByRole('checkbox')).toBeChecked()
    await screen.getByRole('textbox').fill('Gosto de jogos de estratégia.')
    await screen.getByRole('button', { name: 'Guardar lembrança' }).click()
    await expect.element(screen.getByText('Gosto de jogos de estratégia.', { exact: true })).toBeVisible()
    await screen.getByRole('button', { name: 'Editar', exact: true }).click()
    await screen.getByRole('textbox').fill('Gosto de jogos espaciais.')
    await screen.getByRole('button', { name: 'Salvar alteração' }).click()
    await expect.element(screen.getByText('Gosto de jogos espaciais.', { exact: true })).toBeVisible()
    await screen.unmount()
    const reopened = mount()
    await expect.element(reopened.getByText('Gosto de jogos espaciais.', { exact: true })).toBeVisible()
    await reopened.getByRole('button', { name: 'Apagar', exact: true }).click()
    await expect.element(reopened.getByText('Nenhuma lembrança guardada. Você decide o que adicionar.')).toBeVisible()
  })
  it('requires explicit confirmation for delete all, and supports English', async () => {
    persisted.entries = [{ id: 'saved-id', text: 'Saved memory', updatedAt: '' }]
    const screen = mount('en')
    await expect.element(screen.getByText('Saved memory', { exact: true })).toBeVisible()
    await screen.getByRole('button', { name: 'Delete all', exact: true }).click()
    expect(ipc.mutate).not.toHaveBeenCalled()
    await screen.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(persisted.entries).toHaveLength(1)
    await screen.getByRole('button', { name: 'Delete all', exact: true }).click()
    await screen.getByRole('button', { name: 'Yes, delete all' }).click()
    await expect.element(screen.getByText('No saved memories. You decide what to add.')).toBeVisible()
    expect(ipc.mutate).toHaveBeenCalledWith({ action: 'clear', confirmed: true })
  })
  it('shows unavailable state and retry instead of silently enabling memory', async () => {
    ipc.get.mockResolvedValue({ ok: false, code: 'unavailable' })
    const screen = mount()
    await expect.element(screen.getByRole('alert')).toBeVisible()
    await expect.element(screen.getByRole('checkbox')).toBeDisabled()
    ipc.get.mockResolvedValue({ ok: true, value: persisted })
    await screen.getByRole('button', { name: 'Tentar novamente' }).click()
    await expect.element(screen.getByRole('checkbox')).toBeEnabled()
    await expect.element(screen.getByRole('checkbox')).not.toBeChecked()
  })
  it('restores the checkbox when saving consent fails', async () => {
    const screen = mount()
    await expect.element(screen.getByRole('checkbox')).toBeEnabled()
    ipc.mutate.mockResolvedValue({ ok: false, code: 'unavailable' })
    await screen.getByRole('checkbox').click()
    await expect.element(screen.getByRole('alert')).toBeVisible()
    await expect.element(screen.getByRole('checkbox')).not.toBeChecked()
    expect(persisted.enabled).toBe(false)
  })
})
