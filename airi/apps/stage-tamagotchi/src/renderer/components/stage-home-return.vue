<script setup lang="ts">
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { electronSetMainWindowContext } from '../../shared/eventa'

const { t } = useI18n()
const router = useRouter()
const setMainWindowContext = useElectronEventaInvoke(electronSetMainWindowContext)

/**
 * Always-visible product affordance on the Stage that returns to the Lia Home
 * launcher. It is intentionally placed OUTSIDE the (collapsible, un-discoverable)
 * controls island so a layperson can always see it. Navigation is the exact same
 * two-step action as the removed island shortcut: restore the Home window
 * context/size in the main process, then navigate on the same window. The running
 * Stage runtime stays alive in App.vue and is not recreated.
 */
async function goHome() {
  try {
    await setMainWindowContext({ mode: 'home' })
  }
  catch {
    // Restoring the Home window size/position is best-effort; navigation must
    // still return to the launcher even if the main process call fails.
  }
  await router.push('/home')
}
</script>

<template>
  <button
    type="button"
    fixed left-3 top-3 z-30
    flex cursor-pointer select-none items-center gap-1.5
    rounded-full px-3 py-1.5 text-sm shadow-md backdrop-blur-md
    bg="white/85 dark:neutral-900/85"
    text="neutral-800 dark:neutral-200"
    border="1 solid neutral-200/80 dark:neutral-800"
    transition-colors duration-200
    hover:bg="white dark:neutral-800"
    :aria-label="t('tamagotchi.stage.home-return.aria-label')"
    :title="t('tamagotchi.stage.home-return.tooltip')"
    @click="goHome"
  >
    <div i-solar:home-smile-outline text-sm text="primary-600 dark:primary-400" />
    <span>{{ t('tamagotchi.stage.home-return.label') }}</span>
  </button>
</template>
