<script setup lang="ts">
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
/**
 * Personality section.
 *
 * Reads the structured persona that is already the source of truth
 * (`extensions.airi.persona`) - it does not read and must never edit the
 * projected prose (`description`/`personality`/`scenario`), which stays derived
 * from the persona object.
 *
 * Phase 4E-1 shows current values and defines the contract. The full rule
 * editor is a later phase; nothing here writes to the card.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const tt = (key: string) => t(`tamagotchi.home.config.sections.personality.${key}`)

const cardStore = useAiriCardStore()
const persona = computed(() => cardStore.activeCard?.extensions?.airi?.persona)

const intensityLabel = computed(() => {
  const contexts = persona.value?.intensity?.contexts ?? []
  const current = contexts.find(context => context.id === persona.value?.intensity?.defaultContextId)
  return current?.label ?? null
})

const rows = computed(() => [
  { key: 'name', value: persona.value?.identity?.name ?? null },
  { key: 'style', value: persona.value?.preset ?? null },
  { key: 'language', value: persona.value?.language?.character ?? null },
  { key: 'mood', value: intensityLabel.value },
])
</script>

<template>
  <div class="flex flex-col gap-3">
    <dl class="flex flex-col gap-2">
      <div
        v-for="row in rows"
        :key="row.key"
        class="flex items-baseline justify-between gap-4 border-b border-neutral-100 pb-2 last:border-0 dark:border-neutral-800"
        :data-testid="`lia-config-personality-${row.key}`"
      >
        <dt class="text-sm text-neutral-600 dark:text-neutral-300">
          {{ tt(`fields.${row.key}`) }}
        </dt>
        <dd class="text-sm text-neutral-900 font-medium dark:text-neutral-50">
          {{ row.value ?? tt('fields.unset') }}
        </dd>
      </div>
    </dl>

    <p v-if="!persona" class="text-xs text-neutral-400 dark:text-neutral-500" data-testid="lia-config-personality-missing">
      {{ tt('missing') }}
    </p>
    <p v-else class="text-xs text-neutral-400 dark:text-neutral-500">
      {{ tt('readOnlyNote') }}
    </p>
  </div>
</template>
