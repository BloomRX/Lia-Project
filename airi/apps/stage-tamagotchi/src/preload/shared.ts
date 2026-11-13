import { contextBridge, ipcRenderer } from 'electron'

import { isRendererChannelAllowed } from './ipc-channel-policy'

type RendererEvent = Pick<Event, 'defaultPrevented' | 'preventDefault'> & { ports: MessagePort[] }
type RendererListener = (event: RendererEvent, ...args: any[]) => void
type ElectronListener = Parameters<typeof ipcRenderer.on>[1]

function assertRendererChannel(channel: unknown, operation: 'invoke' | 'listen' | 'send'): asserts channel is string {
  if (isRendererChannelAllowed(channel, operation))
    return
  throw new Error('Renderer IPC channel is not allowed.')
}

const listeners = new WeakMap<RendererListener, Map<string, ElectronListener[]>>()
const sanitizedEvent: RendererEvent = Object.assign(new Event('message'), { ports: [] as MessagePort[] })

const restrictedIpcRenderer = {
  invoke(channel: string, ...args: any[]) {
    assertRendererChannel(channel, 'invoke')
    return ipcRenderer.invoke(channel, ...args)
  },
  on(channel: string, listener: RendererListener) {
    assertRendererChannel(channel, 'listen')
    const wrapped: ElectronListener = (_event, ...args) => listener(sanitizedEvent, ...args)
    const channelListeners = listeners.get(listener) ?? new Map<string, RendererListener[]>()
    const registered = channelListeners.get(channel) ?? []
    registered.push(wrapped)
    channelListeners.set(channel, registered)
    listeners.set(listener, channelListeners)
    ipcRenderer.on(channel, wrapped)
    return restrictedIpcRenderer
  },
  removeListener(channel: string, listener: RendererListener) {
    assertRendererChannel(channel, 'listen')
    const channelListeners = listeners.get(listener)
    const registered = channelListeners?.get(channel)
    const wrapped = registered?.pop()
    if (wrapped)
      ipcRenderer.removeListener(channel, wrapped)
    if (registered?.length === 0)
      channelListeners?.delete(channel)
    return restrictedIpcRenderer
  },
  send(channel: string, ...args: any[]) {
    assertRendererChannel(channel, 'send')
    ipcRenderer.send(channel, ...args)
  },
}

export function expose() {
  contextBridge.exposeInMainWorld('electron', { ipcRenderer: restrictedIpcRenderer })
  contextBridge.exposeInMainWorld('platform', process.platform)
}
