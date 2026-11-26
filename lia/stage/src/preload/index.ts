import type { LiaMemoryMutation } from '../../../core/src/memory/contracts.ts'
import type { LiaIntensityContextId, LiaPersonalityAttributes } from '../../../core/src/persona/default.ts'

import { contextBridge, ipcRenderer } from 'electron'

import { stageChatCancel, stageChatSend, stageChatSpeak, stageMemoryGet, stageMemoryMutate, stageMicrophoneArm, stagePresenceClose, stagePresenceCommand, stagePresenceOpen, stagePresenceRead, stagePresenceRendered, stageTranscribe, stageTranscriptionCancel } from '../shared/chat-ipc.ts'
import { stageConversationChange, stageHistoryChange, stageHistoryGet, stageHistoryImport, stageHistoryRemoveMessage, stageLanguageGet, stagePresenceDisplays } from '../shared/chat-ipc.ts'
import { stagePersonaChange, stagePersonaGet } from '../shared/chat-ipc.ts'
import { stagePresenceReadPackagedAvatar, stagePresenceVisibility } from '../shared/chat-ipc.ts'
import { stageHubCatalogGet, stageImageAudit, stageImageCopy, stageImageCopyCancel, stageImageInspect, stageMemoryExport } from '../shared/chat-ipc.ts'
import { stageChatStopSpeech, stageVoiceAutoPlay } from '../shared/chat-ipc.ts'

contextBridge.exposeInMainWorld('liaStageLanguage', {
  get: () => ipcRenderer.invoke(stageLanguageGet),
})

contextBridge.exposeInMainWorld('liaStageHub', {
  catalog: () => ipcRenderer.invoke(stageHubCatalogGet),
})

contextBridge.exposeInMainWorld('liaStagePresence', {
  open: (bytes: Uint8Array) => ipcRenderer.invoke(stagePresenceOpen, bytes),
  readPackagedAvatar: (bytes: Uint8Array) => ipcRenderer.invoke(stagePresenceReadPackagedAvatar, bytes),
  close: () => ipcRenderer.invoke(stagePresenceClose),
  command: (action: string | { monitor: number | null | 'all' }) => ipcRenderer.invoke(stagePresenceCommand, action),
  displays: () => ipcRenderer.invoke(stagePresenceDisplays),
  read: () => ipcRenderer.invoke(stagePresenceRead),
  onVisibility: (listener: (visible: boolean) => void) => {
    const receive = (_event: unknown, visible: unknown) => {
      if (typeof visible === 'boolean')
        listener(visible)
    }
    ipcRenderer.on(stagePresenceVisibility, receive)
    return () => ipcRenderer.removeListener(stagePresenceVisibility, receive)
  },
  reportRender: (rendered: boolean) => ipcRenderer.send(stagePresenceRendered, rendered),
})

contextBridge.exposeInMainWorld('liaStageImage', {
  inspect: (bytes: Uint8Array) => ipcRenderer.invoke(stageImageInspect, bytes),
  copy: (bytes: Uint8Array) => ipcRenderer.invoke(stageImageCopy, bytes),
  cancel: () => ipcRenderer.invoke(stageImageCopyCancel),
  audit: () => ipcRenderer.invoke(stageImageAudit),
})

contextBridge.exposeInMainWorld('liaStageMemory', {
  get: () => ipcRenderer.invoke(stageMemoryGet),
  exportNotes: () => ipcRenderer.invoke(stageMemoryExport),
  mutate: (request: LiaMemoryMutation) => ipcRenderer.invoke(stageMemoryMutate, request),
})

contextBridge.exposeInMainWorld('liaStageChat', {
  history: () => ipcRenderer.invoke(stageHistoryGet),
  removeSavedMessage: (id: string, revision: string, index: number, side: 'user' | 'assistant') =>
    ipcRenderer.invoke(stageHistoryRemoveMessage, id, revision, index, side),
  changePersona: (input: string | Uint8Array | null | { attributes: LiaPersonalityAttributes, contextId: LiaIntensityContextId }) =>
    ipcRenderer.invoke(stagePersonaChange, input),
  activePersona: () => ipcRenderer.invoke(stagePersonaGet),
  changeConversation: (action: 'create' | 'select' | 'delete', id?: string) => ipcRenderer.invoke(stageConversationChange, action, id),
  importHistory: (file: string) => ipcRenderer.invoke(stageHistoryImport, file),
  changeHistory: (action: 'enable' | 'disable' | 'clear') => ipcRenderer.invoke(stageHistoryChange, action),
  send: (message: string, image?: Uint8Array, intent?: boolean | { capability: 'local-clock', mode: 'suggest' }) => ipcRenderer.invoke(stageChatSend, message, image, intent),
  cancel: () => ipcRenderer.invoke(stageChatCancel),
  speak: () => ipcRenderer.invoke(stageChatSpeak),
  stopSpeech: () => ipcRenderer.invoke(stageChatStopSpeech),
  autoPlay: (enabled?: boolean) => ipcRenderer.invoke(stageVoiceAutoPlay, enabled),
  transcribe: (bytes: Uint8Array, mimeType: string) => ipcRenderer.invoke(stageTranscribe, bytes, mimeType),
  cancelTranscription: () => ipcRenderer.invoke(stageTranscriptionCancel),
  armMicrophone: () => ipcRenderer.invoke(stageMicrophoneArm),
})
