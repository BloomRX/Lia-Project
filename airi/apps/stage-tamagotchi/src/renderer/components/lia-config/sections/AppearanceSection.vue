<script setup lang="ts">
/**
 * Appearance section: UX contract only.
 *
 * Phase 4E-1 deliberately does NOT implement outfits, accessories or VRM. The
 * slots are declared so the screen already answers "what can I change about how
 * she looks", and so the Avatar/VRM phase has a place to land without another
 * restructure. Whether an outfit becomes a VRM variant, a separate prefab or
 * something else is still open and is decided there, not here.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { LIA_APPEARANCE_CONTRACT } from '../sections-contract'

const { t } = useI18n()
const tt = (key: string) => t(`tamagotchi.home.config.sections.appearance.${key}`)

const slots = computed(() => [
  { key: 'avatar', value: LIA_APPEARANCE_CONTRACT.avatar },
  { key: 'outfit', value: LIA_APPEARANCE_CONTRACT.outfit },
  { key: 'accessory', value: LIA_APPEARANCE_CONTRACT.accessory },
  { key: 'state', value: LIA_APPEARANCE_CONTRACT.state },
])
</script>

<template>
  <div class="flex flex-col gap-3">
    <dl class="flex flex-col gap-2">
      <div
        v-for="slot in slots"
        :key="slot.key"
        class="flex items-baseline justify-between gap-4 border-b border-neutral-100 pb-2 last:border-0 dark:border-neutral-800"
        :data-testid="`lia-config-appearance-${slot.key}`"
      >
        <dt class="text-sm text-neutral-600 dark:text-neutral-300">
          {{ tt(`slots.${slot.key}`) }}
        </dt>
        <dd class="text-sm text-neutral-400 dark:text-neutral-500">
          {{ tt('slots.pending') }}
        </dd>
      </div>
    </dl>

    <p class="text-xs text-neutral-400 dark:text-neutral-500">
      {{ tt('comingSoon') }}
    </p>
  </div>
</template>
