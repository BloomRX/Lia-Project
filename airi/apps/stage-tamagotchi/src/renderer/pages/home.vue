<script setup lang="ts">
import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { Button, GhostButton } from '@proj-airi/ui'
import { useSettingsStageModel } from '@proj-airi/stage-ui/stores/settings/stage-model'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import type { MainProcessLogLine } from '../../shared/eventa'

import {
  electronGetMainWindowLogs,
  electronMainWindowLogEntry,
  electronOpenSettings,
  electronSetMainWindowContext,
} from '../../shared/eventa'

import WindowTitleBar from '../components/Window/TitleBar.vue'
import LiaConfigPanel from '../components/lia-config/LiaConfigPanel.vue'
import LiaProviderConfig from '../components/LiaProviderConfig.vue'
import liaFallbackAsset from '../assets/lia/lia-home.png'
import { useLiaProviderStore } from '../stores/lia/provider'
import { useLiaVoiceStore } from '../stores/lia/voice'

const { t } = useI18n()
const router = useRouter()
const eventaContext = useElectronEventaContext()

// The active stage model is already initialized by App.vue (main window), so this
// store is ready here. We only READ it — no second runtime, no preview system.
const { stageModelSelectedDisplayModel } = storeToRefs(useSettingsStageModel())

const setMainWindowContext = useElectronEventaInvoke(electronSetMainWindowContext)
const getMainWindowLogs = useElectronEventaInvoke(electronGetMainWindowLogs)
const openSettings = useElectronEventaInvoke(electronOpenSettings)

const liaProviderStore = useLiaProviderStore()
const liaVoiceStore = useLiaVoiceStore()

type HomeView = 'loading' | 'onboarding' | 'launcher' | 'settings'

const view = ref<HomeView>('loading')
const previewError = ref(false)
const logsOpen = ref(false)
const logsLoading = ref(false)

// Recent main-process logs (already sanitized main-side). Kept newest-last.
const logs = ref<MainProcessLogLine[]>([])
const logPanelEl = ref<HTMLElement | null>(null)
let disposeLogListener: (() => void) | undefined
const MAX_VIEW_LOGS = 300

// Presence asset: prefer the active model's previewImage (AIRI preview infra),
// fall back to the Lia static asset, then the placeholder icon.
const presenceSrc = computed<string>(() => {
  const preview = stageModelSelectedDisplayModel.value?.previewImage
  if (preview && !previewError.value)
    return preview
  return liaFallbackAsset
})

type LedState = 'on' | 'off' | 'pending'

interface HomeLed {
  key: string
  label: string
  state: LedState
  title: string
}

const leds = ref<HomeLed[]>([])

function ledClass(state: LedState) {
  if (state === 'on')
    return 'bg-green-500 dark:bg-green-400'
  if (state === 'pending')
    return 'bg-amber-400 dark:bg-amber-400'
  return 'bg-neutral-300 dark:bg-neutral-600'
}

async function computeSummary() {
  const config = await liaProviderStore.refreshConfig()
  const aiReady = await liaProviderStore.isReadyToChat()
  const fallback = config.fallback?.[0]
  const fallbackConfigured = await liaProviderStore.isFallbackConfigured()
  const fallbackEnabled = config.fallbackEnabled !== false

  const statusTitle = (state: LedState, on: string, off: string, pending: string) => {
    if (state === 'on')
      return t(on)
    if (state === 'pending')
      return t(pending)
    return t(off)
  }

  leds.value = [
    {
      key: 'ai',
      label: t('tamagotchi.home.leds.ai'),
      state: aiReady ? 'on' : 'pending',
      title: aiReady
        ? t('tamagotchi.home.status.ai')
        : t('tamagotchi.home.leds.pending'),
    },
    {
      key: 'voice',
      label: t('tamagotchi.home.leds.voice'),
      state: 'off',
      title: t('tamagotchi.home.leds.off'),
    },
    {
      key: 'avatar',
      label: t('tamagotchi.home.leds.avatar'),
      state: previewError.value || stageModelSelectedDisplayModel.value === undefined ? 'off' : 'on',
      title: stageModelSelectedDisplayModel.value === undefined
        ? t('tamagotchi.home.leds.off')
        : t('tamagotchi.home.status.ready'),
    },
    {
      key: 'fallback',
      label: t('tamagotchi.home.leds.fallback'),
      state: fallbackEnabled ? (fallbackConfigured ? 'on' : 'pending') : 'off',
      title: statusTitle(
        fallbackEnabled ? (fallbackConfigured ? 'on' : 'pending') : 'off',
        'tamagotchi.home.leds.on',
        'tamagotchi.home.leds.off',
        'tamagotchi.home.leds.pending',
      ),
    },
  ]
}

function appendLogLines(lines: MainProcessLogLine[]) {
  const seen = new Set(logs.value.map(line => line.id))
  const fresh = lines.filter(line => !seen.has(line.id))
  if (fresh.length === 0)
    return
  logs.value = [...logs.value, ...fresh].slice(-MAX_VIEW_LOGS)
}

async function refreshLogsFromMain() {
  logsLoading.value = true
  try {
    appendLogLines(await getMainWindowLogs() ?? [])
  }
  catch {
    // Keep whatever logs we already have if the snapshot call fails.
  }
  finally {
    logsLoading.value = false
  }
}

function subscribeToLogStream() {
  if (disposeLogListener)
    return
  disposeLogListener = eventaContext.value.on(electronMainWindowLogEntry, (event) => {
    if (event?.body)
      appendLogLines([event.body])
  })
}

// Auto-scroll the panel to the newest entry while it is open.
watch([() => logs.value.length, logsOpen], async () => {
  if (logsOpen.value && logPanelEl.value) {
    await nextTick()
    logPanelEl.value.scrollTop = logPanelEl.value.scrollHeight
  }
})

async function goConversar() {
  // Activate the user's configured Lia chat provider/model before entering the
  // Stage, so the existing AIRI chat streams with the secure (vault-resolved) key.
  // Validated variant: an incomplete config is never pushed into the runtime.
  await liaProviderStore.activateConfiguredProvider()
  // Primary destination: the existing Stage (character experience) at '/'.
  // Resize the window to the Stage preset BEFORE navigating so the Stage mounts
  // at its intended size (contextual window sizing, M1 Phase 2).
  await setMainWindowContext({ mode: 'stage' })
  await router.push('/')
}

function openConfigure() {
  view.value = 'settings'
}

async function openCharacterSettings() {
  await openSettings({ route: '/settings/models' })
}

/**
 * Decides launcher-vs-onboarding from the REAL persisted config (fresh read from
 * main), never from a stale local flag. Both first-run and completion funnel
 * through here, so onboarding can never outlive a config that has actually
 * become ready (preferred provider + model + onboarded marker + the credential
 * it needs) — which is exactly the state "Concluir configuração" persists before
 * the launcher is shown. While in the manual settings editor we don't yank the
 * user out of it.
 */
async function syncHomeView(options: { force?: boolean } = {}) {
  const ready = await liaProviderStore.isReadyToChat()
  await computeSummary()
  // A config that just became ready is applied to the shared runtime right away,
  // so finishing onboarding leaves the chat usable without another click and
  // without opening any settings screen. Idempotent: re-activating the same
  // target only rebuilds its provider instance.
  if (ready) {
    await liaProviderStore.activateConfiguredProvider()
  }
  if (options.force || view.value !== 'settings') {
    view.value = ready ? 'launcher' : 'onboarding'
  }
}

async function onOnboardingComplete() {
  await syncHomeView()
}

async function onSettingsBack() {
  // Leave the editor explicitly (force) — recompute from persisted truth.
  await syncHomeView({ force: true })
}

// React to the shared store's config whenever the meaningful fields change. This
// is what turns a successful "Concluir configuração" (which mutates loadedConfig
// → onboarded: true) into an immediate, in-place switch to the launcher on the
// same mount — independent of the child <LiaProviderConfig> emit handshake. We
// watch a stable signature (not the object identity) so recomputes that produce
// an equal config don't re-trigger, and we only act while still on onboarding so
// routine config writes elsewhere never disturb the view.
const liaConfigSignature = computed(() => {
  const c = liaProviderStore.loadedConfig ?? {}
  const p = c.preferred
  const fb = c.fallback?.[0]
  return [p?.providerId, p?.modelId, c.onboarded, c.fallbackEnabled, fb?.providerId, fb?.modelId].join('|')
})

watch(liaConfigSignature, async () => {
  if (view.value !== 'onboarding')
    return
  await syncHomeView()
})

function toggleLogs() {
  logsOpen.value = !logsOpen.value
  if (logsOpen.value)
    void refreshLogsFromMain()
}

onMounted(async () => {
  void refreshLogsFromMain()
  subscribeToLogStream()
  // Install the (inert-by-default) chat runtime extensions so the shared AIRI
  // chat can use the secure vault key and fail over on recoverable errors.
  liaProviderStore.registerRuntimeExtensions()
  // Same idea for voice: install the inert-by-default TTS fallback policy so a
  // failing preferred voice provider can fail over to a configured fallback.
  liaVoiceStore.registerRuntimeExtensions()

  // First-run gating: derive readiness from the REAL persisted config (preferred
  // provider + model + onboarded marker + the credential it needs). Onboarding
  // is shown until the user completes a valid setup; afterwards the launcher
  // opens directly on the same route/mount.
  await syncHomeView()
})

onUnmounted(() => {
  disposeLogListener?.()
  disposeLogListener = undefined
})
</script>

<template>
  <div class="relative flex h-full w-full flex-col overflow-hidden bg-[var(--bg-color)] text-neutral-800 dark:text-neutral-100">
    <!-- window chrome / drag region (reuses AIRI TitleBar: drag-region + no-drag on controls) -->
    <WindowTitleBar
      :title="t('tamagotchi.home.presence.name')"
      icon="i-solar:home-angle-bold-duotone"
    />

    <div class="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary-500/10 via-transparent to-pink-500/10 dark:from-primary-500/15 dark:to-pink-500/15" />

    <!-- Scrollable content below the fixed TitleBar: centers when it fits, scrolls when it overflows -->
    <div class="absolute inset-x-0 bottom-0 top-11 z-10 overflow-y-auto">
      <!-- Loading -->
      <div v-if="view === 'loading'" class="flex min-h-full w-full items-center justify-center px-6 py-8 text-sm text-neutral-400 dark:text-neutral-500">
        {{ t('tamagotchi.home.states.loading') }}
      </div>

      <!-- First-run setup (reuses the Lia provider editor). -->
      <div v-else-if="view === 'onboarding'" class="flex min-h-full w-full items-center justify-center px-6 py-10">
        <LiaProviderConfig mode="onboarding" @complete="onOnboardingComplete" />
      </div>

      <!-- Later configuration (same editor). -->
      <div v-else-if="view === 'settings'" class="flex min-h-full w-full items-center justify-center px-6 py-10">
        <LiaConfigPanel @back="onSettingsBack" />
      </div>

      <!-- Clean launcher / companion home -->
      <div v-else class="flex min-h-full w-full flex-col">
        <div class="my-auto flex w-full flex-col items-center justify-center gap-4 px-6 py-8 text-center">
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

          <h1 class="text-2xl font-semibold tracking-wide text-neutral-900 dark:text-white">
            {{ t('tamagotchi.home.presence.name') }}
          </h1>
          <p class="max-w-xs text-sm leading-relaxed text-neutral-500 dark:text-neutral-300">
            {{ t('tamagotchi.home.greeting') }}
          </p>

          <!-- Discrete status LEDs -->
          <div class="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
            <span
              v-for="led in leds"
              :key="led.key"
              class="inline-flex items-center gap-1.5"
              :title="led.title"
            >
              <span :class="ledClass(led.state)" class="size-2 rounded-full" />
              {{ led.label }}
            </span>
          </div>

          <div class="mt-1 flex w-full max-w-xs flex-col gap-2">
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
              icon="i-solar:settings-minimalistic-bold-duotone"
              :label="t('tamagotchi.home.actions.configure')"
              @click="openConfigure"
            />
            <GhostButton
              size="sm"
              icon="i-solar:user-circle-bold-duotone"
              :label="t('tamagotchi.home.actions.character')"
              @click="openCharacterSettings"
            />
          </div>

          <div class="w-full max-w-xs">
            <button
              class="flex w-full items-center justify-center gap-1.5 py-1 text-xs text-neutral-500 transition hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
              type="button"
              :aria-expanded="logsOpen"
              @click="toggleLogs"
            >
              <span class="i-solar:list-check-bold-duotone size-3.5" />
              {{ logsOpen ? t('tamagotchi.home.logs.close') : t('tamagotchi.home.logs.label') }}
            </button>
            <div
              v-if="logsOpen"
              ref="logPanelEl"
              class="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-neutral-200/70 bg-neutral-500/5 px-3 py-2 text-left text-xs leading-relaxed text-neutral-600 dark:border-neutral-700 dark:bg-black/20 dark:text-neutral-400"
            >
              <template v-if="logsLoading && logs.length === 0">
                <p class="text-neutral-400 dark:text-neutral-500">{{ t('tamagotchi.home.logs.loading') }}</p>
              </template>
              <template v-else-if="logs.length === 0">
                <p>{{ t('tamagotchi.home.logs.empty') }}</p>
                <p class="mt-1 text-neutral-400 dark:text-neutral-500">{{ t('tamagotchi.home.logs.technicalNote') }}</p>
              </template>
              <template v-else>
                <p v-for="line in logs" :key="line.id" class="py-0.5">
                  {{ line.text }}
                </p>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
