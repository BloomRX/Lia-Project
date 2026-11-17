import type { BrowserWindow, IpcMainEvent } from 'electron'

/**
 * Who may use the Lia secret vault from a renderer.
 *
 * The vault bridge has no sender check of its own: Eventa routes every
 * `eventa-message` invoke to `ipcMain`, so any WebContents that loaded the
 * preload — the main window, the settings window, captions, widgets, the
 * beat-sync window, the about window, a desktop overlay, a future chat
 * follower — reaches the same handlers. Without this policy a caption window
 * could delete a stored credential, and a subframe inside an allowed window
 * could write one.
 *
 * The rule is the narrowest one that still supports the product:
 *
 *  - the top frame of the user-facing Stage window (chat providers run in this
 *    renderer, so it must be able to read, write and delete their key);
 *  - the top frame of the hearing/settings window (AI settings is where a user
 *    types a key);
 *  - nothing else, and never a subframe.
 *
 * Kept separate from `transcription-sender-policy.ts` on purpose: transcription
 * additionally allows provider sub-routes, and secret access must not inherit
 * that widening by accident.
 */
function isTopFrame(event: IpcMainEvent, window?: BrowserWindow): boolean {
  return window !== undefined
    && !window.isDestroyed()
    && event.sender === window.webContents
    && event.senderFrame !== null
    && event.senderFrame === window.webContents.mainFrame
}

export function isLiaSecretSenderAllowed(
  event: IpcMainEvent | undefined,
  stage?: BrowserWindow,
  settings?: BrowserWindow,
): boolean {
  if (!event || !event.sender || event.sender.isDestroyed())
    return false
  return isTopFrame(event, stage) || isTopFrame(event, settings)
}
