import { contextBridge, ipcRenderer } from 'electron'

import { stageChatCancel, stageChatSend } from '../shared/chat-ipc.ts'

contextBridge.exposeInMainWorld('liaStageChat', {
  send: (message: string) => ipcRenderer.invoke(stageChatSend, message),
  cancel: () => ipcRenderer.invoke(stageChatCancel),
})
