import type {
  LiaCustomVoiceProfile,
  LiaVoiceProfileImportRequest,
  LiaVoiceProfileResult,
  LiaVoiceTtsTarget,
} from '../../../shared/eventa'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  electronLiaAllTalkSync,
  electronLiaVoiceEnginesList,
  electronLiaVoiceProfilesImport,
  electronLiaVoiceProfilesList,
  electronLiaVoiceProfilesPick,
  electronLiaVoiceProfilesRemove,
} from '../../../shared/eventa'
/**
 * Re-exported from `shared/lia-voice` so the main process can read the same id
 * without importing renderer code. Kept here because the whole renderer already
 * imports it from this module, and there must still be exactly one definition.
 */
import { CUSTOM_VOICE_PROVIDER_ID } from '../../../shared/lia-voice'
import { useLiaVoiceStore } from './voice'
/**
 * The renderer side of the private voice library.
 *
 * Two invariants this store is careful about:
 *
 * - **It never picks files itself.** Asking the OS for a file goes to the main
 *   process, which is also what makes the path allowlist possible. A cancelled
 *   picker resolves to `null` and changes nothing.
 * - **It is not a second writer of `voice.tts`.** Selecting or dropping a
 *   profile goes through the voice store's `saveTtsConfiguration()`, the same
 *   single route the Voz tab already uses.
 */
import { createVoicePreviewDriver } from './voice-preview'

export { CUSTOM_VOICE_PROVIDER_ID }

/** How `voice.tts` points at a profile: by id, never by path or by content. */
export function targetForProfile(profile: Pick<LiaCustomVoiceProfile, 'id'>): LiaVoiceTtsTarget {
  return { providerId: CUSTOM_VOICE_PROVIDER_ID, voiceId: profile.id }
}

/** Whether a persisted target refers to the custom-voice provider. */
export function isCustomVoiceTarget(target: LiaVoiceTtsTarget | undefined): boolean {
  return target?.providerId === CUSTOM_VOICE_PROVIDER_ID
}

export interface LiaVoiceEngineInfo {
  extensions: string[]
  id: string
  label: string
  roles: string[]
}

export const useLiaVoiceProfilesStore = defineStore('lia-voice-profiles', () => {
  const listProfiles = useElectronEventaInvoke(electronLiaVoiceProfilesList)
  const listEngines = useElectronEventaInvoke(electronLiaVoiceEnginesList)
  const pickPaths = useElectronEventaInvoke(electronLiaVoiceProfilesPick)
  const sendImport = useElectronEventaInvoke(electronLiaVoiceProfilesImport)
  const sendRemove = useElectronEventaInvoke(electronLiaVoiceProfilesRemove)
  const sendSync = useElectronEventaInvoke(electronLiaAllTalkSync)

  const profiles = ref<LiaCustomVoiceProfile[]>([])
  const engines = ref<LiaVoiceEngineInfo[]>([])
  const isBusy = ref(false)
  const lastError = ref<{ code: string, message: string } | null>(null)
  /**
   * Per-profile publication failures, keyed by id.
   *
   * Kept separate from `lastError` because a profile that cannot be published is
   * still in the library and still selectable later; the row needs its own note
   * rather than a banner that the next action clears.
   */
  const syncErrors = ref<Record<string, string>>({})

  const byId = computed(() => new Map(profiles.value.map(profile => [profile.id, profile])))

  function engineFor(id: string): LiaVoiceEngineInfo | undefined {
    return engines.value.find(engine => engine.id === id)
  }

  async function refresh(): Promise<void> {
    const [list, engineList] = await Promise.all([
      listProfiles(),
      engines.value.length > 0 ? Promise.resolve(engines.value) : listEngines(),
    ])
    profiles.value = list
    engines.value = engineList
  }

  /**
   * Opens the OS picker in the main process.
   *
   * Resolves `null` when the user cancels - and in that case nothing is offered,
   * nothing is imported and no state changes.
   */
  async function pickFiles(engineId: string, roles: string[]): Promise<string[] | null> {
    const engine = engineFor(engineId)
    const paths = await pickPaths({
      extensions: engine?.extensions ?? [],
      multiple: roles.length > 1,
      title: 'Import voice',
    })
    if (!paths)
      return null
    return paths
  }

  async function importProfile(request: LiaVoiceProfileImportRequest): Promise<LiaVoiceProfileResult<LiaCustomVoiceProfile>> {
    isBusy.value = true
    lastError.value = null
    try {
      const result = await sendImport(request)
      if (result.ok) {
        profiles.value = [...profiles.value, result.value]
      }
      else {
        lastError.value = { code: result.error, message: result.message }
      }
      return result
    }
    finally {
      isBusy.value = false
    }
  }

  /**
   * Deletes a profile - and, if `voice.tts` was pointing at it, repairs the
   * target in the same operation.
   *
   * Leaving a dangling reference behind would mean the chat resolves a voice
   * that no longer exists, which is exactly the silent-failure class this codebase
   * has been fighting. The repair goes through `saveTtsConfiguration()`, so there
   * is still exactly one writer.
   */
  async function removeProfile(id: string): Promise<LiaVoiceProfileResult<{ id: string }>> {
    isBusy.value = true
    lastError.value = null
    try {
      const result = await sendRemove({ id })
      if (!result.ok) {
        lastError.value = { code: result.error, message: result.message }
        return result
      }

      profiles.value = profiles.value.filter(profile => profile.id !== id)

      const voiceStore = useLiaVoiceStore()
      const preferred = voiceStore.preferred
      const fallback = voiceStore.fallback ?? []
      const touchedPreferred = isCustomVoiceTarget(preferred) && preferred?.voiceId === id
      const remainingFallback = fallback.filter(target => !isCustomVoiceTarget(target) || target.voiceId !== id)

      if (touchedPreferred || remainingFallback.length !== fallback.length) {
        const next: Parameters<typeof voiceStore.saveTtsConfiguration>[0] = {
          fallback: remainingFallback,
        }
        // Dropping the primary falls back to the next reserve rather than to
        // nothing, so removing a voice never silently mutes the character.
        if (touchedPreferred) {
          const promoted = remainingFallback[0]
          if (promoted)
            next.preferred = promoted
        }
        else if (preferred) {
          next.preferred = preferred
        }

        const saved = await voiceStore.saveTtsConfiguration(next)
        if (!saved.persisted)
          lastError.value = { code: 'persist', message: saved.error ?? 'Could not update the voice selection.' }
      }

      return result
    }
    finally {
      isBusy.value = false
    }
  }

  /**
   * Publishes a profile's reference audio into AllTalk's voices folder.
   *
   * Best-effort by design: an unconfigured or offline server leaves the profile
   * in the library with a note, because losing someone's imported voice over a
   * server that happens to be off would be the worse failure.
   */
  async function syncProfile(id: string): Promise<boolean> {
    const result = await sendSync({ profileId: id })
    if (result.ok) {
      delete syncErrors.value[id]
      return true
    }
    syncErrors.value = { ...syncErrors.value, [id]: result.message }
    return false
  }

  /**
   * Speaks one line in a profile's voice.
   *
   * Goes through the ordinary preview driver, which resolves the provider by id
   * and calls `speechStore.speech()` - the same route the chat uses. Deliberately
   * not a second synthesis path: if the preview had its own, it could sound right
   * while the conversation stayed mute.
   */
  async function previewProfile(id: string, text: string): Promise<void> {
    const driver = createVoicePreviewDriver()
    await driver(targetForProfile({ id }), text, new AbortController().signal, () => {})
  }

  return {
    byId,
    engines,
    isBusy,
    lastError,
    profiles,
    syncErrors,
    engineFor,
    importProfile,
    pickFiles,
    previewProfile,
    refresh,
    removeProfile,
    syncProfile,
  }
})
