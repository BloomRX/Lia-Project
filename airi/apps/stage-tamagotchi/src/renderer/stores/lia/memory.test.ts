import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLiaMemoryStore } from './memory'

const ipc = vi.hoisted(() => ({ get: vi.fn(), mutate: vi.fn(), recall: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (event: { receiveEvent: { id: string } }) => {
    if (event.receiveEvent.id.includes(':get-'))
      return ipc.get
    if (event.receiveEvent.id.includes(':mutate-'))
      return ipc.mutate
    return ipc.recall
  },
}))
beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
  ipc.get.mockResolvedValue({ ok: true, value: { schemaVersion: 1, enabled: false, entries: [] } })
})
describe('memory renderer state', () => {
  it('loads Main state, saves only through IPC, and reports failure without dropping previous data', async () => {
    const store = useLiaMemoryStore()
    expect(store.state.enabled).toBe(false)
    expect(await store.load()).toBe(true)
    ipc.mutate.mockResolvedValue({ ok: true, value: { schemaVersion: 1, enabled: true, entries: [{ id: 'x', text: 'Saved', updatedAt: '' }] } })
    expect(await store.saveEntry('Saved')).toBe(true)
    expect(ipc.mutate).toHaveBeenCalledWith({ action: 'save', text: 'Saved', id: undefined })
    ipc.mutate.mockRejectedValue(new Error('unavailable'))
    expect(await store.removeEntry('x')).toBe(false)
    expect(store.state.entries[0].text).toBe('Saved')
    expect(store.error).toBe('unavailable')
    expect(await store.clear(false)).toBe(false)
    expect(ipc.mutate).toHaveBeenCalledTimes(2)
  })
  it('gets fresh permission and context on every turn and fails closed', async () => {
    const store = useLiaMemoryStore()
    ipc.recall.mockResolvedValueOnce({ ok: true, value: 'relevant data' }).mockResolvedValueOnce({ ok: true, value: '' }).mockRejectedValueOnce(new Error('failed'))
    expect(await store.retrieveContext('games')).toBe('relevant data')
    expect(await store.retrieveContext('games')).toBe('')
    expect(await store.retrieveContext('games')).toBe('')
    expect(ipc.recall).toHaveBeenCalledTimes(3)
  })
})
