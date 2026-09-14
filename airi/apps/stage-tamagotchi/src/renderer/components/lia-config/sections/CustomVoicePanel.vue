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
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLiaAllTalkStore } from '../../../stores/lia/alltalk'
import { useLiaRuntimeStore } from '../../../stores/lia/runtime'
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
const runtimeStore = useLiaRuntimeStore()
const profilesStore = useLiaVoiceProfilesStore()
const voiceStore = useLiaVoiceStore()

const previewText = 'Olá! Eu sou a Lia.'
/** Which profile is currently being tested, so only its button shows "playing". */
const testingId = ref<string | null>(null)

const activeProfileId = computed(() => {
  const preferred = voiceStore.preferred
  return isCustomVoiceTarget(preferred) ? preferred?.voiceId : undefined
})

/* ------------------------------------------------------------------------
 * Custom voice preparation (Phase 6, item H).
 *
 * "The system is installed" and "it can clone YOUR voice" are different
 * states. The second one is true only when the runtime's own config says so
 * (engine loaded = the cloning engine, its model files complete) - and
 * preparing is an explicit download the user consents to, with the model's
 * license told in plain language before they click.
 * ------------------------------------------------------------------------ */

const engine = computed(() => runtimeStore.customVoiceEngine)
const engineConfirmedNotReady = computed(() => engine.value !== undefined && !engine.value.ready)
/** The card appears only over an installed runtime: no runtime, nothing to prepare. */
const showPrepareCard = computed(() => runtimeStore.isReady && engineConfirmedNotReady.value)

onMounted(async () => {
  await profilesStore.refresh()
  if (runtimeStore.isReady)
    await runtimeStore.refreshCustomVoiceEngine()
})

watch(() => runtimeStore.isReady, async (ready) => {
  if (ready)
    await runtimeStore.refreshCustomVoiceEngine()
})

async function onPrepare(): Promise<void> {
  await runtimeStore.prepareCustomVoiceModel()
}

async function onCancelPrepare(): Promise<void> {
  await runtimeStore.cancelCustomVoicePrepare()
}

/** The i18n key of the prepare's current phase - a modelled word, not stdout. */
const preparePhaseKey = computed(() => {
  const phase = runtimeStore.customVoicePrepare?.phase
  return phase ? `prepare.phase.${phase}` : undefined
})

/** Language for a new profile. `pt-BR` is the character's language, not the UI's. */
const PROFILE_LANGUAGE = 'pt-BR'

/**
 * Import is two steps, in the panel rather than in a browser dialog:
 * pick the file, then name it. `window.prompt`/`confirm` are off the table here
 * (blocked by lint, and modal-blocking besides), so both are plain state.
 */
const pendingPath = ref<string | null>(null)
const pendingName = ref('')
const confirmingRemoveId = ref<string | null>(null)
/**
 * The picker opens in the main process and on Windows it sits on top of a
 * full-screen overlay window: while it is open this button is the only thing
 * the user sees, so it must say *something* happened (item B). `pickError`
 * carries what the pick itself could not; `isPicking` gives the click an
 * immediate effect instead of a dead-press.
 */
const isPicking = ref(false)
const pickError = ref(false)

async function onPickFile(): Promise<void> {
  isPicking.value = true
  pickError.value = false
  try {
    const paths = await profilesStore.pickFiles('alltalk', ['referenceAudio'])
    // A cancelled picker resolves to null and must change nothing.
    if (!paths || paths.length === 0)
      return

    pendingPath.value = paths[0]
    pendingName.value = tt('import.nameDefault')
  }
  catch {
    // The channel is broken or main could not open the dialog: say so instead
    // of leaving an unhandled rejection looking like a no-op.
    pickError.value = true
  }
  finally {
    isPicking.value = false
  }
}

/** Only the file's bare name - the full path is nobody's business here. */
const pendingFileName = computed(() => {
  const path = pendingPath.value
  if (!path)
    return ''
  return path.split(/[\\/]/).pop() ?? ''
})

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
  // A confirmed-not-ready engine comes first: with the wrong engine loaded the
  // server is up but cannot clone, and nothing should read "ready" through it.
  if (engineConfirmedNotReady.value && runtimeStore.isReady)
    return 'profiles.status.notPrepared'
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

    <!--
      Prepare the custom voice (item H). Only shown when the voice system is
      installed AND its own config says the cloning engine is not ready - and
      preparing always starts from an informed click, never from startup code.
    -->
    <section
      v-if="showPrepareCard"
      class="flex flex-col gap-2 border border-neutral-200 rounded-lg p-3 dark:border-neutral-700"
      data-testid="lia-custom-voice-prepare"
    >
      <span class="text-sm text-neutral-900 font-medium dark:text-neutral-50">
        {{ tt('prepare.title') }}
      </span>
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        {{ tt('prepare.license') }}
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          v-if="!runtimeStore.isPreparing"
          type="button"
          class="rounded bg-neutral-900 px-2 py-1 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
          data-testid="lia-custom-voice-prepare-button"
          @click="onPrepare"
        >
          {{ runtimeStore.customVoicePrepare?.phase === 'error' || runtimeStore.customVoicePrepare?.phase === 'cancelled' ? tt('prepare.retry') : tt('prepare.button') }}
        </button>
        <button
          v-else
          type="button"
          class="rounded px-2 py-1 text-sm text-neutral-500 dark:text-neutral-400"
          data-testid="lia-custom-voice-prepare-cancel"
          @click="onCancelPrepare"
        >
          {{ tt('prepare.cancel') }}
        </button>
      </div>
      <p
        v-if="runtimeStore.isPreparing && preparePhaseKey"
        class="text-xs text-neutral-500 dark:text-neutral-400"
        data-testid="lia-custom-voice-prepare-phase"
      >
        {{ tt(preparePhaseKey) }}
      </p>
      <p
        v-if="runtimeStore.customVoicePrepare?.phase === 'error'"
        class="text-xs text-red-600 dark:text-red-400"
        data-testid="lia-custom-voice-prepare-error"
      >
        {{ tt('prepare.phase.error') }}
      </p>
      <p
        v-if="runtimeStore.customVoicePrepare?.phase === 'cancelled'"
        class="text-xs text-neutral-500 dark:text-neutral-400"
        data-testid="lia-custom-voice-prepare-cancelled"
      >
        {{ tt('prepare.phase.cancelled') }}
      </p>
    </section>

    <!-- Import: pick the file, then name it -->
    <div v-if="!pendingPath" class="flex flex-col gap-1">
      <button
        type="button"
        class="border border-neutral-200 rounded px-2 py-1 text-sm dark:border-neutral-700"
        :disabled="profilesStore.isBusy || isPicking"
        data-testid="lia-custom-voice-import"
        @click="onPickFile"
      >
        {{ isPicking ? tt('import.opening') : tt('import.button') }}
      </button>
      <p v-if="pickError" class="text-xs text-red-600 dark:text-red-400" data-testid="lia-custom-voice-pick-error">
        {{ tt('import.pickFailed') }}
      </p>
    </div>
    <div v-else class="flex flex-col gap-2" data-testid="lia-custom-voice-naming">
      <p class="text-xs text-neutral-500 dark:text-neutral-400" data-testid="lia-custom-voice-chosen-file">
        {{ tt('import.chosenFile') }} {{ pendingFileName }}
      </p>
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

    <!--
      Create my voice (item L).

      There is no validated training notebook for Lia yet, so this is an honest
      "coming soon" rather than a button that opens a link which does not exist.
      When a notebook is published and checked, this block becomes a real link -
      the shape is ready, the fabrication is not.
    -->
    <section
      class="flex flex-col gap-1 border border-neutral-200 rounded-lg p-3 dark:border-neutral-700"
      data-testid="lia-custom-voice-create"
    >
      <span class="text-sm text-neutral-900 font-medium dark:text-neutral-50">
        {{ tt('create.title') }}
      </span>
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        {{ tt('create.hint') }}
      </p>
      <span
        class="w-fit border border-neutral-200 rounded px-2 py-1 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
        data-testid="lia-custom-voice-create-soon"
      >
        {{ tt('create.soon') }}
      </span>
    </section>

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
