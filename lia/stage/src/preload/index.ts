import type { LiaMemoryMutation } from '../../../core/src/memory/contracts.ts'

import { contextBridge, ipcRenderer } from 'electron'

import { stageChatCancel, stageChatSend, stageChatSpeak, stageMemoryGet, stageMemoryMutate, stageMicrophoneArm, stageTranscribe, stageTranscriptionCancel } from '../shared/chat-ipc.ts'

contextBridge.exposeInMainWorld('liaStageMemory', {
  get: () => ipcRenderer.invoke(stageMemoryGet),
  mutate: (request: LiaMemoryMutation) => ipcRenderer.invoke(stageMemoryMutate, request),
})

contextBridge.exposeInMainWorld('liaStageChat', {
  send: (message: string) => ipcRenderer.invoke(stageChatSend, message),
  cancel: () => ipcRenderer.invoke(stageChatCancel),
  speak: () => ipcRenderer.invoke(stageChatSpeak),
  transcribe: (bytes: Uint8Array, mimeType: string) => ipcRenderer.invoke(stageTranscribe, bytes, mimeType),
  cancelTranscription: () => ipcRenderer.invoke(stageTranscriptionCancel),
  armMicrophone: () => ipcRenderer.invoke(stageMicrophoneArm),
})
