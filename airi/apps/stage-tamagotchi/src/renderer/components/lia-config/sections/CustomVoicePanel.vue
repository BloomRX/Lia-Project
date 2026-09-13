<script setup lang="ts">
/**
 * Voz personalizada — import, publish and select a voice of the user's own.
 *
 * Written for someone who has never heard of AllTalk, XTTS or a voices folder.
 * The screen therefore talks about "your voice" and "the speech server", shows a
 * plain status word instead of a connection error, and never prints a stack
 * trace: every failure arrives as a short sentence the user can act on.
 *
 * Two invariants this component is careful to keep:
 *
 * - It never writes `voice.tts` itself. Selecting a profile goes through the
 *   voice store's `saveTtsConfiguration()`, the same single writer the rest of
 *   the Voz tab uses.
 * - It never sends a path. The folder picker runs in the main process; this
 *   component only asks for it to open.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLiaAllTalkStore } from '../../../stores/lia/alltalk'
import { useLiaVoiceStore } from '../../../stores/lia/voice'
import {
  CUSTOM_VOICE_PROVIDER_ID,
  isCustomVoiceTarget,
  targetForProfile,
  useLiaVoiceProfilesStore,
} from '../../../stores/lia/voice-profiles'

const { t } = useI18n()
const tt = (key: string) => t(`tamagotchi.home.config.sections.voice.custom.${key}`)

const alltalk = useLiaAllTalkStore()
const profilesStore = useLiaVoiceProfilesStore()
const voiceStore = useLiaVoiceStore()

const baseUrl = ref('')
const previewText = 'Olá! Eu sou a Lia.'
/** Which profile is currently being tested, so only its button shows "playing". */
const testingId = ref<string | null>(null)

const statusKey = computed(() => `states.${alltalk.status.state}`)
const statusDetail = computed(() =>
  alltalk.status.state === 'error' ? alltalk.status.error : '',
)

const activeProfileId = computed(() => {
  const preferred = voiceStore.preferred
  return isCustomVoiceTarget(preferred) ? preferred?.voiceId : undefined
})

onMounted(async () => {
  await Promise.all([alltalk.refresh(), profilesStore.refresh()])
  baseUrl.value = alltalk.config?.baseUrl ?? ''
})

/** Language for a new profile. `pt-BR` is the character's language, not the UI's. */
const PROFILE_LANGUAGE = 'pt-BR'

async function onChooseFolder(): Promise<void> {
  await alltalk.chooseVoicesDir()
}

async function onSaveServer(): Promise<void> {
  await alltalk.saveBaseUrl(baseUrl.value.trim())
}

/**
 * Import is two steps, in the panel rather than in a browser dialog:
 * pick the file, then name it. `window.prompt`/`confirm` are off the table here
 * (blocked by lint, and modal-blocking besides), so both are plain state.
 */
const pendingPath = ref<string | null>(null)
const pendingName = ref('')
const confirmingRemoveId = ref<string | null>(null)

async function onPickFile(): Promise<void> {
  const paths = await profilesStore.pickFiles('alltalk', ['referenceAudio'])
  // A cancelled picker resolves to null and must change nothing.
  if (!paths || paths.length === 0)
    return

  pendingPath.value = paths[0]
  pendingName.value = tt('import.nameDefault')
}

function onCancelImport(): void {
  pendingPath.value = null
  pendingName.value = ''
}

async function onConfirmImport(): Promise<void> {
  const path = pendingPath.value
  const name = pendingName.value.trim()
  if (!path || !name)
    return

  const result = await profilesStore.importProfile({
    name,
    engine: 'alltalk',
    sources: [{ role: 'referenceAudio', path }],
    metadata: { language: PROFILE_LANGUAGE, backend: 'XTTS-v2' },
  })

  if (!result.ok)
    return

  onCancelImport()
  // Publishing is best-effort: if AllTalk is not configured the profile still
  // belongs to the user's library and can be published later.
  if (alltalk.isConfigured)
    await profilesStore.syncProfile(result.value.id)
}

/** Selecting a voice writes through the single writer, then previews it. */
async function onSelect(profileId: string): Promise<void> {
  const fallback = (voiceStore.fallback ?? []).filter(
    target => !isCustomVoiceTarget(target) || target.voiceId !== profileId,
  )
  const saved = await voiceStore.saveTtsConfiguration({
    preferred: targetForProfile({ id: profileId }),
    fallback,
  })
  if (!saved.persisted)
    return
  await onTest(profileId)
}

async function onTest(profileId: string): Promise<void> {
  testingId.value = profileId
  try {
    await profilesStore.previewProfile(profileId, previewText)
  }
  finally {
    testingId.value = null
  }
}

/** Asks in the row instead of a modal, so the question is visibly about *this* voice. */
function onAskRemove(profileId: string): void {
  confirmingRemoveId.value = confirmingRemoveId.value === profileId ? null : profileId
}

async function onConfirmRemove(profileId: string): Promise<void> {
  confirmingRemoveId.value = null
  await profilesStore.removeProfile(profileId)
}

function languageOf(metadata: Record<string, string> | undefined): string {
  return metadata?.language ?? ''
}

function backendOf(metadata: Record<string, string> | undefined): string {
  return metadata?.backend ?? ''
}

/** A short, actionable sentence for a profile that cannot be used yet. */
function profileStatusKey(profileId: string): string {
  if (profilesStore.syncErrors[profileId])
    return 'profiles.status.syncFailed'
  if (!alltalk.isConfigured)
    return 'profiles.status.notConfigured'
  if (!alltalk.isConnected)
    return 'profiles.status.serverOffline'
  return activeProfileId.value === profileId
    ? 'profiles.status.inUse'
    : 'profiles.status.ready'
}

void CUSTOM_VOICE_PROVIDER_ID
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="lia-config-voice-custom">
    <h3 class="text-sm text-neutral-900 font-semibold dark:text-neutral-50">
      {{ tt('title') }}
    </h3>
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      {{ tt('subtitle') }}
    </p>

    <!-- Speech server -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-sm text-neutral-600 dark:text-neutral-300">{{ tt('server.label') }}</span>
        <span
          class="text-xs font-medium"
          :data-testid="`lia-alltalk-status-${alltalk.status.state}`"
          :class="{
            'text-emerald-600 dark:text-emerald-400': alltalk.status.state === 'connected',
            'text-amber-600 dark:text-amber-400': alltalk.status.state === 'checking',
            'text-neutral-500 dark:text-neutral-400': alltalk.status.state === 'notConfigured',
            'text-red-600 dark:text-red-400': alltalk.status.state === 'error' || alltalk.status.state === 'offline',
          }"
        >
          {{ tt(statusKey) }}
        </span>
      </div>
      <p v-if="statusDetail" class="text-xs text-red-600 dark:text-red-400">
        {{ statusDetail }}
      </p>

      <div class="flex gap-2">
        <input
          v-model="baseUrl"
          type="text"
          class="w-full border border-neutral-200 rounded bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          :placeholder="tt('server.placeholder')"
          :disabled="alltalk.isBusy"
          data-testid="lia-alltalk-base-url"
        >
        <button
          type="button"
          class="border border-neutral-200 rounded px-2 py-1 text-sm dark:border-neutral-700"
          :disabled="alltalk.isBusy"
          data-testid="lia-alltalk-save-server"
          @click="onSaveServer"
        >
          {{ tt('server.save') }}
        </button>
      </div>
    </div>

    <!-- Voices folder -->
    <div class="flex flex-col gap-1">
      <span class="text-sm text-neutral-600 dark:text-neutral-300">{{ tt('folder.label') }}</span>
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        {{ alltalk.config?.voicesDir || tt('folder.none') }}
      </p>
      <div class="flex gap-2">
        <button
          type="button"
          class="border border-neutral-200 rounded px-2 py-1 text-sm dark:border-neutral-700"
          :disabled="alltalk.isBusy"
          data-testid="lia-alltalk-choose-folder"
          @click="onChooseFolder"
        >
          {{ tt('folder.choose') }}
        </button>
        <button
          v-if="alltalk.isConfigured"
          type="button"
          class="rounded px-2 py-1 text-sm text-neutral-500 dark:text-neutral-400"
          :disabled="alltalk.isBusy"
          data-testid="lia-alltalk-clear-folder"
          @click="alltalk.clearVoicesDir()"
        >
          {{ tt('folder.clear') }}
        </button>
      </div>
    </div>

    <!-- Import: pick the file, then name it -->
    <div v-if="!pendingPath" class="flex flex-col gap-1">
      <button
        type="button"
        class="border border-neutral-200 rounded px-2 py-1 text-sm dark:border-neutral-700"
        :disabled="profilesStore.isBusy"
        data-testid="lia-custom-voice-import"
        @click="onPickFile"
      >
        {{ tt('import.button') }}
      </button>
    </div>
    <div v-else class="flex flex-col gap-2" data-testid="lia-custom-voice-naming">
      <label class="flex flex-col gap-1">
        <span class="text-sm text-neutral-600 dark:text-neutral-300">{{ tt('import.namePrompt') }}</span>
        <input
          v-model="pendingName"
          type="text"
          class="w-full border border-neutral-200 rounded bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          data-testid="lia-custom-voice-name"
        >
      </label>
      <div class="flex gap-2">
        <button
          type="button"
          class="rounded bg-neutral-900 px-2 py-1 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
          :disabled="profilesStore.isBusy || !pendingName.trim()"
          data-testid="lia-custom-voice-confirm-import"
          @click="onConfirmImport"
        >
          {{ tt('import.confirm') }}
        </button>
        <button
          type="button"
          class="rounded px-2 py-1 text-sm text-neutral-500 dark:text-neutral-400"
          data-testid="lia-custom-voice-cancel-import"
          @click="onCancelImport"
        >
          {{ tt('import.cancel') }}
        </button>
      </div>
    </div>

    <p v-if="profilesStore.lastError" class="text-xs text-red-600 dark:text-red-400">
      {{ profilesStore.lastError.message }}
    </p>

    <!-- Library -->
    <ul v-if="profilesStore.profiles.length > 0" class="flex flex-col gap-2">
      <li
        v-for="profile in profilesStore.profiles"
        :key="profile.id"
        class="flex flex-col gap-1 border border-neutral-200 rounded p-2 dark:border-neutral-700"
        :data-testid="`lia-custom-voice-${profile.id}`"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm text-neutral-900 font-medium dark:text-neutral-50">
            {{ profile.name }}
          </span>
          <span class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ tt(profileStatusKey(profile.id)) }}
          </span>
        </div>
        <p class="text-xs text-neutral-500 dark:text-neutral-400">
          {{ [languageOf(profile.metadata), backendOf(profile.metadata)].filter(Boolean).join(' · ') }}
        </p>
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded bg-neutral-900 px-2 py-1 text-xs text-white dark:bg-neutral-100 dark:text-neutral-900"
            :disabled="profilesStore.isBusy"
            :data-testid="`lia-custom-voice-select-${profile.id}`"
            @click="onSelect(profile.id)"
          >
            {{ tt('profiles.use') }}
          </button>
          <button
            type="button"
            class="border border-neutral-200 rounded px-2 py-1 text-xs dark:border-neutral-700"
            :disabled="testingId === profile.id"
            :data-testid="`lia-custom-voice-test-${profile.id}`"
            @click="onTest(profile.id)"
          >
            {{ testingId === profile.id ? tt('profiles.testing') : tt('profiles.test') }}
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
              {{ tt('import.cancel') }}
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
