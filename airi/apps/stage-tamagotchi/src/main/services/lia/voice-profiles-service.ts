import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LiaCustomVoiceProfile, LiaVoiceProfileImportRequest } from '../../../shared/eventa'
import type { LiaVoiceProfileStore } from './voice-profiles'

import { join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { app, BrowserWindow, dialog } from 'electron'

import {
  electronLiaVoiceEnginesList,
  electronLiaVoiceProfilesImport,
  electronLiaVoiceProfilesList,
  electronLiaVoiceProfilesPick,
  electronLiaVoiceProfilesRemove,
} from '../../../shared/eventa'
import { createLiaVoiceProfileStore, VOICE_ENGINES } from './voice-profiles'

type MainContext = ReturnType<typeof createContext>['context']

/**
 * IPC surface for the private voice library.
 *
 * Two rules shape this file:
 *
 * 1. **The renderer never picks a file.** The OS dialog runs here, in the main
 *    process, and the absolute paths it returns are remembered in `offeredPaths`.
 *    Import then only accepts paths from that set, so a compromised or buggy
 *    renderer cannot ask the app to read an arbitrary file by sending a path.
 * 2. **This bridge does not write `voice.tts`.** Selecting a profile for playback
 *    still goes through `electronLiaVoiceConfigSet`, so there is exactly one
 *    writer of the TTS target.
 */
export function registerLiaVoiceProfilesBridge(params: {
  context: MainContext
  rootDir?: string
  /**
   * Shared store. The AllTalk bridge needs the *same* registry instance to
   * publish and unpublish voices, so the app creates one and hands it to both.
   */
  store?: LiaVoiceProfileStore
  /**
   * Runs before a profile is deleted. The AllTalk bridge uses it to remove the
   * derived copy it published, so a removed voice leaves nothing behind in
   * AllTalk's folder. A failure here never blocks the removal: the canonical
   * profile is the real record, and an orphaned copy is harmless.
   */
  beforeRemove?: (id: string) => Promise<void>
}): void {
  const { context } = params
  const rootDir = params.rootDir ?? join(app.getPath('userData'), 'lia-voices')
  const store = params.store ?? createLiaVoiceProfileStore({ rootDir })

  /**
   * Paths the dialog has handed back and that have not been consumed yet.
   * Deliberately a bounded, short-lived allowlist rather than "anything the
   * renderer sends".
   */
  const offeredPaths = new Set<string>()
  const MAX_OFFERED = 64

  function offer(paths: string[]): void {
    for (const path of paths) {
      if (offeredPaths.size >= MAX_OFFERED)
        offeredPaths.clear()
      offeredPaths.add(path)
    }
  }

  defineInvokeHandler(context, electronLiaVoiceEnginesList, () =>
    VOICE_ENGINES.map(engine => ({
      id: engine.id,
      label: engine.label,
      roles: [...engine.roles],
      extensions: [...engine.extensions],
    })))

  defineInvokeHandler(context, electronLiaVoiceProfilesList, async (): Promise<LiaCustomVoiceProfile[]> =>
    store.list())

  defineInvokeHandler(
    context,
    electronLiaVoiceProfilesPick,
    async (options: { extensions: string[], multiple?: boolean, title?: string }): Promise<string[] | null> => {
      const filters = Array.isArray(options?.extensions) && options.extensions.length > 0
        ? [{ name: 'Voice model', extensions: options.extensions.map(extension => extension.replace(/^\./, '')) }]
        : []

      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const result = parent
        ? await dialog.showOpenDialog(parent, {
            title: options?.title || 'Import voice',
            properties: options?.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
            ...(filters.length > 0 ? { filters } : {}),
          })
        : await dialog.showOpenDialog({
            title: options?.title || 'Import voice',
            properties: options?.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
            ...(filters.length > 0 ? { filters } : {}),
          })

      // Cancel is a normal outcome, not an error: nothing is offered and nothing
      // downstream changes state.
      if (result.canceled || result.filePaths.length === 0)
        return null

      offer(result.filePaths)
      return result.filePaths
    },
  )

  defineInvokeHandler(
    context,
    electronLiaVoiceProfilesImport,
    async (request: LiaVoiceProfileImportRequest) => {
      const result = await store.importProfile(request, offeredPaths)
      if (result.ok) {
        // The offered paths were consumed by this import; drop them so they
        // cannot be replayed into a later, different profile.
        for (const source of request?.sources ?? [])
          offeredPaths.delete(source?.path)
      }
      return result
    },
  )

  defineInvokeHandler(context, electronLiaVoiceProfilesRemove, async (payload: { id: string }) => {
    const id = String(payload?.id ?? '')
    if (params.beforeRemove)
      await params.beforeRemove(id).catch(() => {})
    return store.remove(id)
  })
}
