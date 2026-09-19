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

  function resetState() {
    inspectUpdaterDiagnostics.reset()
    showChatReasoning.reset()
  }

  return {
    inspectUpdaterDiagnostics,
    showChatReasoning,
    resetState,
  }
})
