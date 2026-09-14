<script setup lang="ts">
import type { MainWindowSizeRecord, MainWindowSizeSnapshot } from '../../../../shared/eventa'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { Button } from '@proj-airi/ui'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { electronMainWindowSizeGet, electronMainWindowSizeSet } from '../../../../shared/eventa'

interface WindowPreset {
  id: 'small' | 'medium' | 'large'
  width: number
  height: number
}

/** Per-mode presets. "medium" equals the built-in default size, which is preserved. */
const PRESETS: Record<'home' | 'stage', WindowPreset[]> = {
  home: [
    { id: 'small', width: 400, height: 560 },
    { id: 'medium', width: 460, height: 640 },
    { id: 'large', width: 560, height: 780 },
  ],
  stage: [
    { id: 'small', width: 640, height: 820 },
    { id: 'medium', width: 800, height: 1000 },
    { id: 'large', width: 1020, height: 1260 },
  ],
}

const DEFAULT_PRESET: Record<'home' | 'stage', WindowPreset> = {
  home: PRESETS.home[1]!,
  stage: PRESETS.stage[1]!,
}

const getSize = useElectronEventaInvoke(electronMainWindowSizeGet)
const setSize = useElectronEventaInvoke(electronMainWindowSizeSet)
const { t } = useI18n()
const tt = (key: string) => t(`tamagotchi.settings.pages.system.window.${key}`)

const snapshot = ref<MainWindowSizeSnapshot>()
const saving = ref(false)

type Mode = 'home' | 'stage'

/** Effective requested size for a mode: the persisted override, else the built-in preset. */
function effectiveRecord(mode: Mode): MainWindowSizeRecord {
  const override = snapshot.value?.[mode]
  const preset = DEFAULT_PRESET[mode]
  return override ?? { width: preset.width, height: preset.height }
}

/** Which preset (if any) matches the current effective size; otherwise null = custom. */
function activePresetId(mode: Mode): WindowPreset['id'] | null {
  const rec = effectiveRecord(mode)
  if (typeof rec.width !== 'number' || typeof rec.height !== 'number')
    return null
  return PRESETS[mode].find(p => p.width === rec.width && p.height === rec.height)?.id ?? null
}

function isActiveMode(mode: Mode): boolean {
  return snapshot.value?.activeMode === mode
}

async function refresh() {
  try {
    snapshot.value = await getSize()
  }
  catch {
    toast.error(tt('errors.load'))
  }
}

async function apply(mode: Mode, size: { width: number, height: number } | null) {
  if (saving.value)
    return
  saving.value = true
  try {
    await setSize({ mode, size })
    await refresh()
  }
  catch {
    toast.error(tt('errors.save'))
  }
  finally {
    saving.value = false
  }
}

onMounted(refresh)
</script>

<template>
  <div flex="~ col gap-4">
    <p text-xs text="neutral-500 dark:neutral-400">
      {{ tt('note') }}
    </p>

    <section
      v-for="mode in (['home', 'stage'] as Mode[])"
      :key="mode"
      flex="~ col gap-3"
      rounded-lg bg="neutral-50 dark:neutral-800"
      p-4
    >
      <div flex items-center justify-between gap-3>
        <div>
          <h2 text-sm text="neutral-900 dark:neutral-50" font-medium>
            {{ tt(mode === 'home' ? 'home.title' : 'stage.title') }}
          </h2>
          <p v-if="isActiveMode(mode)" mt-0.5 text-xs text="primary-600 dark:primary-400">
            {{ tt('applies-now') }}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          color="neutral"
          :label="tt('actions.restore-default')"
          :disabled="saving || activePresetId(mode) === 'medium'"
          @click="apply(mode, null)"
        />
      </div>

      <div v-if="activePresetId(mode) === null" mt-0.5 text-xs text="neutral-500 dark:neutral-400">
        {{ tt('custom-note') }}
      </div>

      <div grid grid-cols-3 gap-2>
        <button
          v-for="preset in PRESETS[mode]"
          :key="preset.id"
          type="button"
          :class="[
            'flex flex-col items-center rounded-lg border-2 border-solid px-2 py-2 text-center transition-colors',
            activePresetId(mode) === preset.id
              ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300'
              : 'border-neutral-100 bg-neutral-50 text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200 dark:hover:bg-neutral-900 dark:active:bg-neutral-800',
          ]"
          :disabled="saving"
          @click="apply(mode, { width: preset.width, height: preset.height })"
        >
          <span text-sm font-medium>{{ tt(`presets.${preset.id}`) }}</span>
          <span text-xs text="neutral-500 dark:neutral-400">
            {{ t('tamagotchi.settings.pages.system.window.pixels', { width: preset.width, height: preset.height }) }}
          </span>
        </button>
      </div>
    </section>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: tamagotchi.settings.pages.system.window.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
