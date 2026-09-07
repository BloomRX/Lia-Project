<script setup lang="ts">
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { Button, GhostButton } from '@proj-airi/ui'
import { useSettingsStageModel } from '@proj-airi/stage-ui/stores/settings/stage-model'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { electronOpenSettings } from '../../shared/eventa'

import liaFallbackAsset from '../assets/lia/lia-home.png'

const { t } = useI18n()
const router = useRouter()

// The active stage model is already initialized by App.vue (main window), so this
// store is ready here. We only READ it — no second runtime, no preview system.
const { stageModelSelectedDisplayModel } = storeToRefs(useSettingsStageModel())

const openSettings = useElectronEventaInvoke(electronOpenSettings)

const previewError = ref(false)
const logsOpen = ref(false)

type HomeState = 'loading' | 'ready' | 'disabled'

const homeState = computed<HomeState>(() => {
  if (previewError.value)
    return 'disabled'
  if (stageModelSelectedDisplayModel.value === undefined)
    return 'loading'
  return 'ready'
})

// Presence asset: prefer the active model's previewImage (AIRI preview infra),
// fall back to the Lia static asset, then the placeholder icon.
const presenceSrc = computed<string>(() => {
  const preview = stageModelSelectedDisplayModel.value?.previewImage
  if (preview && !previewError.value)
    return preview
  return liaFallbackAsset
})

async function goConversar() {
  // Primary destination: the existing Stage (character experience) at '/'.
  // NOT the textual chat window (electronOpenChat stays a secondary AIRI capability).
  await router.push('/')
}

async function openCharacterSettings() {
  await openSettings({ route: '/settings/models' })
}

async function openDiagnostics() {
  // Stand-in until the Phase 7 Advanced/Diagnostics screen exists.
  await openSettings({ route: '/settings/system/developer' })
}

async function openSettingsGeneric() {
  await openSettings()
}

function toggleLogs() {
  logsOpen.value = !logsOpen.value
}
</script>

<template>
  <div class="relative flex h-full w-full flex-col overflow-hidden">
    <div
      class="pointer-events-none absolute inset-0 -z-1 bg-gradient-to-br from-primary-900/20 via-transparent to-pink-500/10 dark:from-primary-900/40 dark:to-pink-500/20"
    />

    <div class="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-8 text-center">
      <div class="relative">
        <div class="size-32 overflow-hidden rounded-2xl shadow-lg ring-1 ring-white/10">
          <img
            :src="presenceSrc"
            :alt="t('tamagotchi.home.presence.name')"
            class="size-full object-cover"
            @error="previewError = true"
          >
        </div>
      </div>

      <h1 class="text-2xl font-semibold tracking-wide text-neutral-100 dark:text-white">
        {{ t('tamagotchi.home.presence.name') }}
      </h1>
      <p class="max-w-xs text-sm leading-relaxed text-neutral-300/90 dark:text-neutral-300/80">
        {{ t('tamagotchi.home.greeting') }}
      </p>

      <div class="flex items-center gap-2">
        <span
          :class="[
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm',
            homeState === 'ready'
              ? 'bg-green-500/10 text-green-300 ring-1 ring-green-400/20'
              : homeState === 'loading'
                ? 'bg-amber-500/10 text-amber-300 ring-1 ring-amber-400/20'
                : 'bg-neutral-500/10 text-neutral-300 ring-1 ring-neutral-400/20',
          ]"
        >
          <span
            :class="[
              'size-2 rounded-full',
              homeState === 'ready' ? 'bg-green-400' : homeState === 'loading' ? 'animate-pulse bg-amber-400' : 'bg-neutral-400',
            ]"
          />
          <span v-if="homeState === 'ready'">{{ t('tamagotchi.home.status.ready') }}</span>
          <span v-else-if="homeState === 'loading'">{{ t('tamagotchi.home.status.preparing') }}</span>
          <span v-else>{{ t('tamagotchi.home.status.unavailable') }}</span>
        </span>
      </div>

      <div class="mt-2 flex w-full max-w-xs flex-col gap-2">
        <Button
          color="primary"
          variant="primary"
          size="lg"
          block
          :label="t('tamagotchi.home.actions.converse')"
          @click="goConversar"
        />
      </div>

      <div class="mt-1 flex flex-wrap items-center justify-center gap-2">
        <GhostButton
          size="sm"
          icon="i-solar:user-circle-bold-duotone"
          :label="t('tamagotchi.home.actions.character')"
          @click="openCharacterSettings"
        />
        <GhostButton
          size="sm"
          icon="i-solar:microphone-3-line-duotone"
          :label="t('tamagotchi.home.actions.voice')"
          @click="openSettingsGeneric"
        />
        <GhostButton
          size="sm"
          icon="i-solar:settings-minimalistic-bold-duotone"
          :label="t('tamagotchi.home.actions.settings')"
          @click="openSettingsGeneric"
        />
        <GhostButton
          size="sm"
          icon="i-solar:chart-2-bold-duotone"
          :label="t('tamagotchi.home.actions.diagnostics')"
          @click="openDiagnostics"
        />
      </div>

      <div class="w-full max-w-xs">
        <button
          class="flex w-full items-center justify-center gap-1.5 py-1 text-xs text-neutral-400 transition hover:text-neutral-200"
          type="button"
          :aria-expanded="logsOpen"
          @click="toggleLogs"
        >
          <span class="i-solar:list-check-bold-duotone size-3.5" />
          {{ logsOpen ? t('tamagotchi.home.logs.close') : t('tamagotchi.home.logs.label') }}
        </button>
        <div
          v-if="logsOpen"
          class="mt-1 rounded-lg bg-black/20 px-3 py-2 text-left text-xs leading-relaxed text-neutral-400 dark:bg-black/30"
        >
          <p>{{ t('tamagotchi.home.logs.empty') }}</p>
          <p class="mt-1 text-neutral-500">{{ t('tamagotchi.home.logs.technicalNote') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
