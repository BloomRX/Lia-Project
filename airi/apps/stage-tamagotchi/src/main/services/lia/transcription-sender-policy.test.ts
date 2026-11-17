import type { BrowserWindow, IpcMainEvent } from 'electron'

import { describe, expect, it } from 'vitest'

import { isLiaTranscriptionSenderAllowed } from './transcription-sender-policy'

function fixture(route: string) {
  const frame = { url: `file:///app/index.html#${route}` }
  const sender = { mainFrame: frame }
  return {
    window: { webContents: sender, isDestroyed: () => false } as unknown as BrowserWindow,
    event: { sender, senderFrame: frame } as unknown as IpcMainEvent,
  }
}

describe('transcription sender policy', () => {
  it('allows the Stage and the hearing Settings preview, and rejects other windows, routes and frames', () => {
    const stage = fixture('/')
    const hearing = fixture('/settings/modules/hearing?lia-managed=true')
    const provider = fixture('/settings/providers/transcription/openai-audio-transcription')
    const unrelatedProvider = fixture('/settings/providers/transcription/official-provider-transcription')
    const other = fixture('/settings')
    expect(isLiaTranscriptionSenderAllowed(stage.event, stage.window, hearing.window)).toBe(true)
    expect(isLiaTranscriptionSenderAllowed(hearing.event, stage.window, hearing.window)).toBe(true)
    expect(isLiaTranscriptionSenderAllowed(provider.event, stage.window, provider.window)).toBe(true)
    expect(isLiaTranscriptionSenderAllowed(unrelatedProvider.event, stage.window, unrelatedProvider.window)).toBe(false)
    expect(isLiaTranscriptionSenderAllowed(hearing.event, stage.window, other.window)).toBe(false)
    expect(isLiaTranscriptionSenderAllowed(other.event, stage.window, other.window)).toBe(false)
    expect(isLiaTranscriptionSenderAllowed({ ...stage.event, senderFrame: null }, stage.window, hearing.window)).toBe(false)
  })
})
