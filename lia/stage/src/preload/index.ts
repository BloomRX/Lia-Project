import type { LiaMemoryMutation } from '../../../core/src/memory/contracts.ts'

import { contextBridge, ipcRenderer } from 'electron'

import { stageChatCancel, stageChatSend, stageChatSpeak, stageMemoryGet, stageMemoryMutate, stageMicrophoneArm, stagePresenceClose, stagePresenceCommand, stagePresenceOpen, stagePresenceRead, stagePresenceRendered, stageTranscribe, stageTranscriptionCancel } from '../shared/chat-ipc.ts'
import { stageHistoryChange, stageHistoryGet } from '../shared/chat-ipc.ts'

contextBridge.exposeInMainWorld('liaStagePresence', {
  open: (bytes: Uint8Array) => ipcRenderer.invoke(stagePresenceOpen, bytes),
  close: () => ipcRenderer.invoke(stagePresenceClose),
  command: (action: string) => ipcRenderer.invoke(stagePresenceCommand, action),
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
  send: (message: string) => ipcRenderer.invoke(stageChatSend, message),
  cancel: () => ipcRenderer.invoke(stageChatCancel),
  speak: () => ipcRenderer.invoke(stageChatSpeak),
  transcribe: (bytes: Uint8Array, mimeType: string) => ipcRenderer.invoke(stageTranscribe, bytes, mimeType),
  cancelTranscription: () => ipcRenderer.invoke(stageTranscriptionCancel),
  armMicrophone: () => ipcRenderer.invoke(stageMicrophoneArm),
})
