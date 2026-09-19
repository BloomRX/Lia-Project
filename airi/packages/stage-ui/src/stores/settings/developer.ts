import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

export const useSettingsDeveloper = defineStore('settings-developer', () => {
  const inspectUpdaterDiagnostics = useLocalStorageManualReset<boolean>('settings/developer/inspect-updater-diagnostics', false)

  // Phase 7.7.1, item C: internal chain-of-thought-class text (provider
  // `reasoning_content`, `<think>` blocks...) must not face a normal Lia
  // user. It stays available for developers, here - one flag, persisted,
  // OFF by default. Standalone AIRI behavior is unchanged: the chat part
  // consults the Lia capability port and only applies this gate when a
  // Lia product installed its capability truth (see response-part.vue).
  const showChatReasoning = useLocalStorageManualReset<boolean>('settings/developer/show-chat-reasoning', false)

  // Phase 7.7.2, item 14-F: logs the content-free SHA-256 + byteLength of
  // every TTS payload the Stage is about to decode. Compared against the
  // main process's wavSha256 (= what AllTalk returned), identical values
  // prove the playback input is byte-identical to the engine output - the
  // GENERATION vs PLAYBACK isolation of item 7. Off by default.
  const inspectAudioPayloadHashes = useLocalStorageManualReset<boolean>('settings/developer/inspect-audio-payload-hashes', false)

  function resetState() {
    inspectAudioPayloadHashes.reset()
    inspectUpdaterDiagnostics.reset()
    showChatReasoning.reset()
  }

  return {
    inspectAudioPayloadHashes,
    inspectUpdaterDiagnostics,
    showChatReasoning,
    resetState,
  }
})
