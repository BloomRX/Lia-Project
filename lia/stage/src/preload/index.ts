import type { LiaMemoryMutation } from '../../../core/src/memory/contracts.ts'
import type { LiaIntensityContextId, LiaPersonalityAttributes } from '../../../core/src/persona/default.ts'

import { contextBridge, ipcRenderer } from 'electron'

import { stageChatCancel, stageChatSend, stageChatSpeak, stageMemoryGet, stageMemoryMutate, stageMicrophoneArm, stagePresenceClose, stagePresenceCommand, stagePresenceOpen, stagePresenceRead, stagePresenceRendered, stageTranscribe, stageTranscriptionCancel } from '../shared/chat-ipc.ts'
import { stageConversationChange, stageHistoryChange, stageHistoryGet, stageHistoryImport, stageLanguageGet, stagePresenceDisplays } from '../shared/chat-ipc.ts'
import { stagePersonaChange, stagePersonaGet } from '../shared/chat-ipc.ts'
import { stagePresenceReadPackagedAvatar } from '../shared/chat-ipc.ts'
import { stageChatStopSpeech, stageVoiceAutoPlay } from '../shared/chat-ipc.ts'

contextBridge.exposeInMainWorld('liaStageLanguage', {
  get: () => ipcRenderer.invoke(stageLanguageGet),
})

contextBridge.exposeInMainWorld('liaStagePresence', {
  open: (bytes: Uint8Array) => ipcRenderer.invoke(stagePresenceOpen, bytes),
  readPackagedAvatar: (bytes: Uint8Array) => ipcRenderer.invoke(stagePresenceReadPackagedAvatar, bytes),
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
  changePersona: (input: string | Uint8Array | null | { attributes: LiaPersonalityAttributes, contextId: LiaIntensityContextId }) =>
    ipcRenderer.invoke(stagePersonaChange, input),
  activePersona: () => ipcRenderer.invoke(stagePersonaGet),
  changeConversation: (action: 'create' | 'select' | 'delete', id?: string) => ipcRenderer.invoke(stageConversationChange, action, id),
  importHistory: (file: string) => ipcRenderer.invoke(stageHistoryImport, file),
  changeHistory: (action: 'enable' | 'disable' | 'clear') => ipcRenderer.invoke(stageHistoryChange, action),
  send: (message: string, image?: Uint8Array, allowClock?: boolean) => ipcRenderer.invoke(stageChatSend, message, image, allowClock),
  cancel: () => ipcRenderer.invoke(stageChatCancel),
  speak: () => ipcRenderer.invoke(stageChatSpeak),
  stopSpeech: () => ipcRenderer.invoke(stageChatStopSpeech),
  autoPlay: (enabled?: boolean) => ipcRenderer.invoke(stageVoiceAutoPlay, enabled),
  transcribe: (bytes: Uint8Array, mimeType: string) => ipcRenderer.invoke(stageTranscribe, bytes, mimeType),
  cancelTranscription: () => ipcRenderer.invoke(stageTranscriptionCancel),
  armMicrophone: () => ipcRenderer.invoke(stageMicrophoneArm),
})
