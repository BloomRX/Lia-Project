import type { BrowserWindow, IpcMainEvent } from 'electron'

import { describe, expect, it } from 'vitest'

import { isLiaSecretSenderAllowed } from './secrets-sender-policy'

function fakeWindow(id: string, options: { destroyed?: boolean } = {}) {
  const mainFrame = { url: `https://lia.invalid/${id}` }
  const webContents = {
    id,
    isDestroyed: () => options.destroyed === true,
    mainFrame,
  }
  const window = {
    isDestroyed: () => options.destroyed === true,
    webContents,
  }
  return { window: window as unknown as BrowserWindow, webContents, mainFrame }
}

function eventFor(sender: unknown, senderFrame: unknown): IpcMainEvent {
  return { sender, senderFrame } as unknown as IpcMainEvent
}

describe('isLiaSecretSenderAllowed', () => {
  it('allows the top frame of the user-facing Stage window', () => {
    const stage = fakeWindow('stage')
    expect(isLiaSecretSenderAllowed(eventFor(stage.webContents, stage.mainFrame), stage.window)).toBe(true)
  })

  it('allows the top frame of the settings window', () => {
    const stage = fakeWindow('stage')
    const settings = fakeWindow('settings')
    expect(isLiaSecretSenderAllowed(eventFor(settings.webContents, settings.mainFrame), stage.window, settings.window)).toBe(true)
  })

  it('denies an unknown window even when both product windows exist', () => {
    const stage = fakeWindow('stage')
    const settings = fakeWindow('settings')
    const caption = fakeWindow('caption')
    expect(isLiaSecretSenderAllowed(eventFor(caption.webContents, caption.mainFrame), stage.window, settings.window)).toBe(false)
  })

  it('denies a subframe of an allowed window', () => {
    const stage = fakeWindow('stage')
    const subframe = { url: 'https://ads.invalid/frame' }
    expect(isLiaSecretSenderAllowed(eventFor(stage.webContents, subframe), stage.window)).toBe(false)
  })

  it('denies a missing, null or destroyed sender', () => {
    const stage = fakeWindow('stage')
    expect(isLiaSecretSenderAllowed(undefined, stage.window)).toBe(false)
    expect(isLiaSecretSenderAllowed(eventFor(stage.webContents, null), stage.window)).toBe(false)
    const gone = fakeWindow('gone', { destroyed: true })
    expect(isLiaSecretSenderAllowed(eventFor(gone.webContents, gone.mainFrame), gone.window)).toBe(false)
  })

  it('denies everything when no product window is registered yet', () => {
    const stage = fakeWindow('stage')
    expect(isLiaSecretSenderAllowed(eventFor(stage.webContents, stage.mainFrame))).toBe(false)
  })
})
