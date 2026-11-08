import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultPresence } from '../../../../../../../lia/core/src/presence'
import { useLiaPresenceStore } from './presence'

const ipc = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), action: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (event: { receiveEvent: { id: string } }) => event.receiveEvent.id.includes(':get-')
    ? ipc.get
    : event.receiveEvent.id.includes(':set-') ? ipc.set : ipc.action,
}))
const snapshot = () => ({ config: { ...defaultPresence }, displays: [], active: false, fullscreen: false })
beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  ipc.get.mockResolvedValue({ ok: true, state: snapshot() })
})
describe('presence renderer state', () => {
  it('serializes the saved Home object across IPC on subsequent edits', async () => {
    const store = useLiaPresenceStore()
    ipc.get.mockResolvedValue({ ok: true, state: { ...snapshot(), config: { ...defaultPresence, mode: 'free', home: { x: 100, y: 200 } } } })
    await store.refresh()
    ipc.set.mockImplementation(async (input) => {
      const config = structuredClone(input)
      return { ok: true, state: { ...snapshot(), config } }
    })
    expect(await store.update({ paused: true })).toBe(true)
    expect(store.state?.config).toMatchObject({ paused: true, home: { x: 100, y: 200 } })
    expect(await store.update({ mode: 'tamagotchi' })).toBe(true)
    expect(store.state?.config.mode).toBe('tamagotchi')
  })
  it('loads canonical state and commits only saved configuration', async () => {
    const store = useLiaPresenceStore()
    await store.refresh()
    ipc.set.mockResolvedValue({ ok: false, code: 'storage' })
    expect(await store.update({ mode: 'free' })).toBe(false)
    expect(store.state?.config.mode).toBe('tamagotchi')
    expect(store.error).toBe(true)
    ipc.set.mockResolvedValue({ ok: true, state: { ...snapshot(), config: { ...defaultPresence, mode: 'free' } } })
    expect(await store.update({ mode: 'free' })).toBe(true)
    expect(store.state?.config.mode).toBe('free')
    expect(store.error).toBe(false)
  })
  it('reports IPC failures and recovers without inventing state', async () => {
    const store = useLiaPresenceStore()
    ipc.get.mockRejectedValueOnce(new Error('channel'))
    expect(await store.refresh()).toBe(false)
    expect(store.state).toBeUndefined()
    expect(store.busy).toBe(false)
    expect(await store.refresh()).toBe(true)
  })
})
