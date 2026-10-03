/**
 * The OS file picker for voice imports, behind a testable seam.
 *
 * Everything Electron-flavoured is one injectable away, because QA caught a
 * real failure shape here (Phase 6 hotfix, item Q): the friendly
 * "The file picker could not be opened." sentence appeared in the UI, which
 * means the click reached the main process and something between the handler
 * and `showOpenDialog` threw. The two suspects this design eliminates:
 *
 * - **A destroyed parent window.** `BrowserWindow.getFocusedWindow()` can
 *   still return a window whose underlying object has been destroyed; passing
 *   that handle to the dialog throws. A live window passes `isDestroyed()`, a
 *   dead one does not - and a dead one must be skipped silently, not handed
 *   to the OS.
 * - **A silent throw.** Before this, a rejection surfaced in the UI as a
 *   "could not open" sentence with no trace. Every hop now logs one line with
 *   the `[LIA-VOICE-IMPORT]` prefix, end to end: received, opening (with
 *   which parent), result (cancelled + count), or the technical failure.
 *   File paths never appear in the log - a picked WAV is the user's private
 *   audio, and the count is all a diagnosis needs.
 */

import { errorMessageFromUnknown } from '@proj-airi/stage-shared'

/** The subset of `dialog.showOpenDialog` this module needs. */
export interface VoicePickDialog {
  (options: Record<string, unknown>): Promise<{ canceled: boolean, filePaths: string[] }>
  (window: unknown, options: Record<string, unknown>): Promise<{ canceled: boolean, filePaths: string[] }>
}

/** A BrowserWindow, narrowed to the one property the picker reads. */
export interface VoicePickWindow {
  isDestroyed: () => boolean
}

export interface VoicePickDeps {
  dialog: VoicePickDialog
  /** The platform's window lists; injected so tests model the destroyed case. */
  getFocusedWindow: () => VoicePickWindow | null
  getAllWindows: () => VoicePickWindow[]
  log: (line: string) => void
}

export interface VoicePickOptions {
  extensions: string[]
  multiple?: boolean
  title?: string
}

export const VOICE_IMPORT_LOG_PREFIX = '[LIA-VOICE-IMPORT]'

/**
 * The window the dialog may be parented to, or `undefined` for a free-floating
 * dialog.
 *
 * The rule: never parent to a window that fails `isDestroyed()`. The focused
 * window is preferred because the dialog then opens over what the user is
 * looking at; the first alive window is the fallback; none alive means no
 * parent, which is still a perfectly legal dialog.
 */
export function windowForDialog(
  getFocusedWindow: () => VoicePickWindow | null,
  getAllWindows: () => VoicePickWindow[],
): VoicePickWindow | undefined {
  try {
    const focused = getFocusedWindow()
    if (focused && !focused.isDestroyed())
      return focused
  }
  catch {
    // A destroyed native object can throw on any touch; treat as "no focus".
  }
  for (const window of getAllWindows()) {
    try {
      if (!window.isDestroyed())
        return window
    }
    catch {
      // Same object-has-been-destroyed edge; skip this candidate.
    }
  }
  return undefined
}

/**
 * Runs the dialog in the main process and returns the chosen paths, or `null`
 * on cancel. A throw propagates (the UI turns it into a sentence) - but only
 * after the technical detail has been logged.
 */
export async function pickVoiceFiles(
  deps: VoicePickDeps,
  options: VoicePickOptions,
): Promise<string[] | null> {
  const { log } = deps

  const filters = options.extensions.length > 0
    ? [{ extensions: options.extensions.map(extension => extension.replace(/^\./, '')), name: 'Voice model' }]
    : []
  const dialogOptions: Record<string, unknown> = {
    properties: options.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    title: options.title || 'Import voice',
    ...(filters.length > 0 ? { filters } : {}),
  }

  log('picker-main-received')

  const parent = windowForDialog(deps.getFocusedWindow, deps.getAllWindows)
  log(parent ? 'picker-open-dialog parent=alive-window' : 'picker-open-dialog parent=none')

  let result: { canceled: boolean, filePaths: string[] }
  try {
    result = parent
      ? await deps.dialog(parent, dialogOptions)
      : await deps.dialog(dialogOptions)
  }
  catch (error) {
    // The technical reason belongs to exactly one place: this log line.
    log(`picker-failed ${errorMessageFromUnknown(error)}`)
    throw error
  }

  log(`picker-result cancelled=${result.canceled} count=${result.filePaths.length}`)

  if (result.canceled || result.filePaths.length === 0)
    return null
  return result.filePaths
}
