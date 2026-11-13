import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electronMocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
    send: electronMocks.send,
  },
}))

import { expose } from './shared'

function exposedElectron() {
  const exposure = electronMocks.exposeInMainWorld.mock.calls.find(([key]) => key === 'electron')
  expect(exposure).toBeDefined()
  return exposure![1] as { ipcRenderer: Record<string, (...args: any[]) => any> }
}

describe('restricted Stage preload bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    expose()
  })

  it('exposes only the IPC facade and its four approved methods', () => {
    expect(Object.keys(exposedElectron())).toEqual(['ipcRenderer'])
    expect(Object.keys(exposedElectron().ipcRenderer).sort()).toEqual(['invoke', 'on', 'removeListener', 'send'])
    expect(electronMocks.exposeInMainWorld).toHaveBeenCalledWith('platform', process.platform)
  })

  it('rejects disallowed channels and strips Electron event capabilities from listeners', () => {
    const ipc = exposedElectron().ipcRenderer
    expect(() => ipc.send('electron:open-path', 'C:\\private')).toThrow('Renderer IPC channel is not allowed.')
    expect(() => ipc.invoke('eventa:invoke:electron:app:quit')).toThrow('Renderer IPC channel is not allowed.')

    const listener = vi.fn()
    ipc.on('eventa-message', listener)
    const registered = electronMocks.on.mock.calls[0][1]
    registered({ sender: { send: vi.fn() }, ports: [], preventDefault: vi.fn() }, { eventa: 'payload' })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0]).not.toHaveProperty('sender')
    expect(listener.mock.calls[0][1]).toEqual({ eventa: 'payload' })
    ipc.removeListener('eventa-message', listener)
    expect(electronMocks.removeListener).toHaveBeenCalledWith('eventa-message', registered)
  })

  it('keeps OIDC invoke channels explicit', async () => {
    const ipc = exposedElectron().ipcRenderer
    electronMocks.invoke.mockResolvedValue({ ok: true })

    await expect(ipc.invoke('lia:oidc:resource', { id: 'id', operation: {} })).resolves.toEqual({ ok: true })
    expect(() => ipc.invoke('lia:oidc:unknown', {})).toThrow('Renderer IPC channel is not allowed.')
  })
})
