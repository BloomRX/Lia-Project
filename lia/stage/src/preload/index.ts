import { contextBridge, ipcRenderer } from 'electron'

import { stageChatCancel, stageChatSend, stageChatSpeak, stageTranscribe, stageTranscriptionCancel } from '../shared/chat-ipc.ts'

contextBridge.exposeInMainWorld('liaStageChat', {
  send: (message: string) => ipcRenderer.invoke(stageChatSend, message),
  cancel: () => ipcRenderer.invoke(stageChatCancel),
  speak: () => ipcRenderer.invoke(stageChatSpeak),
  transcribe: (bytes: Uint8Array, mimeType: string) => ipcRenderer.invoke(stageTranscribe, bytes, mimeType),
  cancelTranscription: () => ipcRenderer.invoke(stageTranscriptionCancel),
})
