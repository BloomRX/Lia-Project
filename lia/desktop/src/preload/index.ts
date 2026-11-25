import { contextBridge, ipcRenderer } from 'electron'

/**
 * The renderer bridge (Phase 7): a typed, minimal surface. The window gets
 * invoke helpers and an event subscription; it never gets `ipcRenderer`
 * itself, and it never gets secret values.
 */
const api = {
  oidcStatus: () => ipcRenderer.invoke('lia:oidc:status'),
  oidcLogin: () => ipcRenderer.invoke('lia:oidc:login'),
  oidcCancel: () => ipcRenderer.invoke('lia:oidc:cancel'),
  oidcProfile: () => ipcRenderer.invoke('lia:oidc:profile'),
  oidcLogout: () => ipcRenderer.invoke('lia:oidc:logout'),
  // PROMPT-39: AI Settings. Every operation names ONE catalog definition;
  // the renderer never receives a secret value, only typed non-secret state.
  aiProviders: () => ipcRenderer.invoke('lia:ai:providers'),
  aiConnectionGet: (providerId?: string) => ipcRenderer.invoke('lia:ai:connection:get', providerId),
  aiConnectionSave: (input: unknown) => ipcRenderer.invoke('lia:ai:connection:save', input),
  aiConnectionRemove: (providerId: string, revision: number) => ipcRenderer.invoke('lia:ai:connection:remove', providerId, revision),
  speechConnection: () => ipcRenderer.invoke('lia:voice:speech-connection'),
  speechConnectionSave: (input: unknown) => ipcRenderer.invoke('lia:voice:speech-save', input),
  transcriptionConnection: (local?: boolean) => ipcRenderer.invoke('lia:voice:transcription-connection', local),
  transcriptionConnectionSave: (input: unknown) => ipcRenderer.invoke('lia:voice:transcription-save', input),
  localSpeechOptions: () => ipcRenderer.invoke('lia:voice:speech-local-options'),
  useLocalSpeech: (voiceId?: string) => ipcRenderer.invoke('lia:voice:speech-local', voiceId),
  aiConnectionModels: (providerId?: string) => ipcRenderer.invoke('lia:ai:connection:models', providerId),
  aiConnectionTest: (providerId?: string) => ipcRenderer.invoke('lia:ai:connection:test', providerId),
  bridge: () => ipcRenderer.invoke('lia:bridge'),
  conversar: () => ipcRenderer.invoke('lia:stage:start'),
  homeStatus: () => ipcRenderer.invoke('lia:home-status'),
  listVoices: () => ipcRenderer.invoke('lia:voices:list'),
  removeVoice: (id: string) => ipcRenderer.invoke('lia:voices:remove', id),
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
  // Phase 7.9G: Voice Engine surface - state read + the ONE install action.
  // Selection writes ride `updateConfig` (the existing canonical seam).
  installVoiceEngine: () => ipcRenderer.invoke('lia:voice-engine:install'),
  voiceEngineState: () => ipcRenderer.invoke('lia:voice-engine:state'),
  // Phase 7.9H: automatic first-run voice readiness. The launcher provisions
  // by itself; the renderer reads the readiness state and can retry a
  // failure. Live transitions ride the existing `onLiaEvent` rail
  // (`lia-app.voice-readiness` details).
  retryVoiceProvisioning: () => ipcRenderer.invoke('lia:voice-provisioning:retry'),
  voiceProvisioningState: () => ipcRenderer.invoke('lia:voice-provisioning:state'),
}

export type LiaApi = typeof api

contextBridge.exposeInMainWorld('liaApi', api)
