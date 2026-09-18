import { contextBridge, ipcRenderer } from 'electron'

/**
 * The renderer bridge (Phase 7): a typed, minimal surface. The window gets
 * invoke helpers and an event subscription; it never gets `ipcRenderer`
 * itself, and it never gets secret values.
 */
const api = {
  bridge: () => ipcRenderer.invoke('lia:bridge'),
  conversar: () => ipcRenderer.invoke('lia:stage:start'),
  homeStatus: () => ipcRenderer.invoke('lia:home-status'),
  listVoices: () => ipcRenderer.invoke('lia:voices:list'),
  onLiaEvent: (listener: (payload: { detail?: string, event: string }) => void) => {
    const wrapped = (_event: unknown, payload: { detail?: string, event: string }) => listener(payload)
    ipcRenderer.on('lia:event', wrapped)
    return () => ipcRenderer.removeListener('lia:event', wrapped)
  },
  productConfig: () => ipcRenderer.invoke('lia:product-config'),
  runtimeState: () => ipcRenderer.invoke('lia:runtime:state'),
  secretPresent: (providerId: string) => ipcRenderer.invoke('lia:secrets:presence', providerId),
  importVoice: (request: unknown) => ipcRenderer.invoke('lia:voices:import', request),
  pickVoiceFiles: () => ipcRenderer.invoke('lia:voices:pick'),
  requestQuit: () => ipcRenderer.invoke('lia:app:quit'),
  runtimeLocation: () => ipcRenderer.invoke('lia:runtime-location:status'),
  pickRuntimeLocation: () => ipcRenderer.invoke('lia:runtime-location:pick'),
  clearRuntimeLocation: () => ipcRenderer.invoke('lia:runtime-location:clear'),
  stageState: () => ipcRenderer.invoke('lia:stage:state'),
  stopStage: () => ipcRenderer.invoke('lia:stage:stop'),
  timings: () => ipcRenderer.invoke('lia:timings'),
  updateConfig: (payload: unknown) => ipcRenderer.invoke('lia:config:update', payload),
}

export type LiaApi = typeof api

contextBridge.exposeInMainWorld('liaApi', api)
