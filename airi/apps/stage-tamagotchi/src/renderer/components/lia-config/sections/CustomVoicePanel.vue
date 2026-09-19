<script setup lang="ts">
/**
 * Voz personalizada — the imported-voice library, honestly (Phase 7.8E).
 *
 * Product truth today: there is NO runnable voice engine yet. The panel says
 * exactly that in neutral words, keeps the already-imported voices readable
 * and selectable/removable (their files stay safe), and no longer exposes an
 * import/measure/test path the machine cannot serve yet. It never names an
 * engine: no AllTalk, no XTTS, no F5, no Edge.
 *
 * One invariant stays absolute: this component never writes `voice.tts`
 * directly - selecting a profile still goes through
 * `saveTtsConfiguration()`, the single writer the whole Voz tab uses.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLiaVoiceStore } from '../../../stores/lia/voice'
import {
  isCustomVoiceTarget,
  targetForProfile,
  useLiaVoiceProfilesStore,
} from '../../../stores/lia/voice-profiles'

const { t } = useI18n()
const tt = (key: string) => t(`tamagotchi.home.config.sections.voice.custom.${key}`)

const profilesStore = useLiaVoiceProfilesStore()
const voiceStore = useLiaVoiceStore()

const activeProfileId = computed(() => {
  const preferred = voiceStore.preferred
  return isCustomVoiceTarget(preferred) ? preferred?.voiceId : undefined
})

const confirmingRemoveId = ref<string | null>(null)

/**
 * Loads the library when the panel mounts. Reading never configures anything -
 * this is the same read-only rule the whole tab keeps.
 */
onMounted(() => {
  void profilesStore.refresh()
})

/** Selecting a voice still writes through the single writer. */
async function onSelect(profileId: string): Promise<void> {
  const fallback = (voiceStore.fallback ?? []).filter(
    target => !isCustomVoiceTarget(target) || target.voiceId !== profileId,
  )
  await voiceStore.saveTtsConfiguration({
    preferred: targetForProfile({ id: profileId }),
    fallback,
  })
}

/** Asks in the row instead of a modal, so the question is visibly about *this* voice. */
function onAskRemove(profileId: string): void {
  confirmingRemoveId.value = confirmingRemoveId.value === profileId ? null : profileId
}

async function onConfirmRemove(profileId: string): Promise<void> {
  confirmingRemoveId.value = null
  await profilesStore.removeProfile(profileId)
}

/** Only two truths per row: selected (= in use) or saved-but-idle. */
function profileStatusKey(profileId: string): string {
  if (!voiceStore.preferred)
    return 'profiles.status.idle'
  return activeProfileId.value === profileId
    ? 'profiles.status.inUse'
    : 'profiles.status.idle'
}
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="lia-config-voice-custom">
    <h3 class="text-sm text-neutral-900 font-semibold dark:text-neutral-50">
      {{ tt('title') }}
    </h3>
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      {{ tt('subtitle') }}
    </p>

    <!--
      The neutral empty-engine state (Phase 7.8E): no runnable voice engine
      exists yet, so importing/using a custom voice is not available - said in
      plain words, never with an engine's name. Imported voices below stay
      safe, readable and selectable for when the engine arrives.
    -->
    <section
      class="flex flex-col gap-1 border border-dashed border-neutral-200 rounded-lg p-3 dark:border-neutral-700"
      data-testid="lia-custom-voice-engine-missing"
    >
      <span class="text-sm text-neutral-900 font-medium dark:text-neutral-50">
        {{ tt('engine.missing.title') }}
      </span>
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        {{ tt('engine.missing.hint') }}
      </p>
    </section>

    <p v-if="profilesStore.lastError" class="text-xs text-red-600 dark:text-red-400">
      {{ profilesStore.lastError.message }}
    </p>

    <!--
      The imported voice library. Old profiles keep loading and stay safe;
      each row only states one of two plain truths - in use, or saved idle -
      never server/engine vocabulary.
    -->
    <ul v-if="profilesStore.profiles.length > 0" class="flex flex-col gap-2" data-testid="lia-custom-voice-library">
      <li
        v-for="profile in profilesStore.profiles"
        :key="profile.id"
        class="flex flex-col gap-1 border border-neutral-200 rounded p-2 dark:border-neutral-700"
        :data-testid="`lia-custom-voice-profile-${profile.id}`"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm text-neutral-900 font-medium dark:text-neutral-50">
            {{ profile.name }}
          </span>
          <span class="text-xs text-neutral-500 dark:text-neutral-400" :data-testid="`lia-custom-voice-status-${profile.id}`">
            {{ tt(profileStatusKey(profile.id)) }}
          </span>
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded bg-neutral-900 px-2 py-1 text-xs text-white dark:bg-neutral-100 dark:text-neutral-900"
            :disabled="profilesStore.isBusy"
            :data-testid="`lia-custom-voice-use-${profile.id}`"
            @click="onSelect(profile.id)"
          >
            {{ tt('profiles.use') }}
          </button>
          <button
            type="button"
            class="rounded px-2 py-1 text-xs text-red-600 dark:text-red-400"
            :disabled="profilesStore.isBusy"
            :data-testid="`lia-custom-voice-remove-${profile.id}`"
            @click="onAskRemove(profile.id)"
          >
            {{ tt('profiles.remove') }}
          </button>
        </div>
        <div
          v-if="confirmingRemoveId === profile.id"
          class="flex flex-col gap-1"
          :data-testid="`lia-custom-voice-confirm-remove-${profile.id}`"
        >
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ tt('profiles.removeConfirm') }}
          </p>
          <div class="flex gap-2">
            <button
              type="button"
              class="rounded bg-red-600 px-2 py-1 text-xs text-white"
              :disabled="profilesStore.isBusy"
              @click="onConfirmRemove(profile.id)"
            >
              {{ tt('profiles.removeYes') }}
            </button>
            <button
              type="button"
              class="rounded px-2 py-1 text-xs text-neutral-500 dark:text-neutral-400"
              @click="confirmingRemoveId = null"
            >
              {{ tt('profiles.cancel') }}
            </button>
          </div>
        </div>
      </li>
    </ul>
    <p v-else class="text-xs text-neutral-500 dark:text-neutral-400">
      {{ tt('profiles.empty') }}
    </p>
  </section>
</template>
