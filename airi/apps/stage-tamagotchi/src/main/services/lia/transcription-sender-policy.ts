import type { BrowserWindow, IpcMainEvent } from 'electron'

import { supportsMainTranscription } from '../../../shared/lia/transcription-transport'

function isTopFrame(event: IpcMainEvent, window?: BrowserWindow): boolean {
  return window !== undefined
    && !window.isDestroyed()
    && event.sender === window.webContents
    && event.senderFrame !== null
    && event.senderFrame === window.webContents.mainFrame
}

export function isLiaTranscriptionSenderAllowed(
  event: IpcMainEvent,
  stage?: BrowserWindow,
  settings?: BrowserWindow,
): boolean {
  if (isTopFrame(event, stage))
    return true
  if (!isTopFrame(event, settings) || !event.senderFrame || !URL.canParse(event.senderFrame.url))
    return false
  const route = new URL(event.senderFrame.url).hash.slice(1).split('?')[0]
  const providerPrefix = '/settings/providers/transcription/'
  return route === '/settings/modules/hearing'
    || (route.startsWith(providerPrefix) && supportsMainTranscription(route.slice(providerPrefix.length)))
}
