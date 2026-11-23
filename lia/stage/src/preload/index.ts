import type { LiaMemoryMutation } from '../../../core/src/memory/contracts.ts'

import { contextBridge, ipcRenderer } from 'electron'

import { stageChatCancel, stageChatSend, stageChatSpeak, stageMemoryGet, stageMemoryMutate, stageMicrophoneArm, stagePresenceClose, stagePresenceCommand, stagePresenceOpen, stagePresenceRead, stagePresenceRendered, stageTranscribe, stageTranscriptionCancel } from '../shared/chat-ipc.ts'
import { stageHistoryChange, stageHistoryGet, stageLanguageGet, stagePresenceDisplays } from '../shared/chat-ipc.ts'

contextBridge.exposeInMainWorld('liaStageLanguage', {
  get: () => ipcRenderer.invoke(stageLanguageGet),
})

contextBridge.exposeInMainWorld('liaStagePresence', {
  open: (bytes: Uint8Array) => ipcRenderer.invoke(stagePresenceOpen, bytes),
  close: () => ipcRenderer.invoke(stagePresenceClose),
  command: (action: string | { monitor: number | null | 'all' }) => ipcRenderer.invoke(stagePresenceCommand, action),
  displays: () => ipcRenderer.invoke(stagePresenceDisplays),
  read: () => ipcRenderer.invoke(stagePresenceRead),
  reportRender: (rendered: boolean) => ipcRenderer.send(stagePresenceRendered, rendered),
})

contextBridge.exposeInMainWorld('liaStageMemory', {
  get: () => ipcRenderer.invoke(stageMemoryGet),
  mutate: (request: LiaMemoryMutation) => ipcRenderer.invoke(stageMemoryMutate, request),
})

contextBridge.exposeInMainWorld('liaStageChat', {
  history: () => ipcRenderer.invoke(stageHistoryGet),
  changeHistory: (action: 'enable' | 'disable' | 'clear') => ipcRenderer.invoke(stageHistoryChange, action),
  send: (message: string, image?: Uint8Array) => ipcRenderer.invoke(stageChatSend, message, image),
  cancel: () => ipcRenderer.invoke(stageChatCancel),
  speak: () => ipcRenderer.invoke(stageChatSpeak),
  transcribe: (bytes: Uint8Array, mimeType: string) => ipcRenderer.invoke(stageTranscribe, bytes, mimeType),
  cancelTranscription: () => ipcRenderer.invoke(stageTranscriptionCancel),
  armMicrophone: () => ipcRenderer.invoke(stageMicrophoneArm),
})
