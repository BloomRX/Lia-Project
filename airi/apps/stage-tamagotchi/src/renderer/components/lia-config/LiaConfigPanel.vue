<script setup lang="ts">
import type { LiaConfigSectionId } from './sections-contract'

import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import LiaConfigAiSection from './sections/AiSection.vue'
import LiaConfigAppearanceSection from './sections/AppearanceSection.vue'
import LiaConfigMemorySection from './sections/MemorySection.vue'
import LiaConfigPersonalitySection from './sections/PersonalitySection.vue'
import LiaConfigPresenceSection from './sections/PresenceSection.vue'
import LiaConfigVoiceSection from './sections/VoiceSection.vue'

/**
 * Unified "Configurar Lia" panel.
 *
 * One coherent surface for everything a user can change about their Lia,
 * grouped the way a person thinks about it - how she thinks, how she speaks,
 * how she looks, and the AI behind her - instead of the way AIRI's
 * infrastructure is layered. Nothing here duplicates AIRI: the AI section
 * reuses the existing provider configuration, Voice reads the existing voice
 * store, and Personality reads the persona that is already the source of truth.
 *
 * Phase 4E-1 delivers structure and navigation. Individual sections grow later.
 */
import { LIA_CONFIG_DEFAULT_SECTION, LIA_CONFIG_SECTIONS } from './sections-contract'

const emit = defineEmits<{
  back: []
}>()

const { t, locale } = useI18n()
function tt(key: string) {
  const english = locale.value.startsWith('en')
  const added: Record<string, string> = {
    'sections.memory.title': english ? 'Memory' : 'Memória',
    'sections.memory.summary': english ? 'Choose what Lia remembers and manage saved information.' : 'Escolha o que a Lia lembra e gerencie as informações salvas.',
    'sections.presence.title': english ? 'Desktop presence' : 'Presença no desktop',
    'sections.presence.summary': english ? 'Choose how Lia occupies your desktop.' : 'Escolha como a Lia ocupa sua área de trabalho.',
  }
  return added[key] ?? t(`tamagotchi.home.config.${key}`)
}

const SECTIONS = LIA_CONFIG_SECTIONS

const activeSection = ref<LiaConfigSectionId>(LIA_CONFIG_DEFAULT_SECTION)
const panelId = useId()
const tabId = (section: LiaConfigSectionId) => `${panelId}-tab-${section}`

// Manual activation: arrows move focus only; Enter/Space selects a tab.
// This preserves a user's place while they explore a long configuration list.
function onTabKeydown(event: KeyboardEvent, section: LiaConfigSectionId) {
  const index = SECTIONS.findIndex(item => item.id === section)
  let next: number
  switch (event.key) {
    case 'ArrowRight':
      next = (index + 1) % SECTIONS.length
      break
    case 'ArrowLeft':
      next = (index - 1 + SECTIONS.length) % SECTIONS.length
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = SECTIONS.length - 1
      break
    default: return
  }
  event.preventDefault()
  const tab = document.getElementById(tabId(SECTIONS[next].id))
  if (tab)
    tab.focus()
}

const sectionLabels = computed(() => SECTIONS.map(section => ({
  id: section.id,
  label: tt(`sections.${section.id}.title`),
  summary: tt(section.summaryKey),
})))
</script>

<template>
  <div class="max-w-2xl w-full flex flex-col gap-5">
    <header class="flex flex-col gap-1">
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="border border-neutral-300 rounded-lg px-3 py-1.5 text-sm text-neutral-700 font-medium transition dark:border-neutral-600 hover:bg-neutral-100 dark:text-neutral-200 focus-visible:outline-2 focus-visible:outline-primary-600 focus-visible:outline-offset-2 dark:hover:bg-neutral-700 dark:focus-visible:outline-primary-300"
          data-testid="lia-config-back"
          @click="emit('back')"
        >
          {{ tt('actions.back') }}
        </button>
        <h1 class="text-lg text-neutral-900 font-semibold dark:text-neutral-50">
          {{ tt('title') }}
        </h1>
      </div>
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        {{ tt('subtitle') }}
      </p>
    </header>

    <div
      class="flex flex-wrap gap-2"
      role="tablist"
      :aria-label="tt('navigation.label')"
    >
      <button
        v-for="section in sectionLabels"
        :id="tabId(section.id)"
        :key="section.id"
        type="button"
        role="tab"
        :aria-selected="activeSection === section.id"
        :aria-controls="panelId"
        :tabindex="activeSection === section.id ? 0 : -1"
        :data-testid="`lia-config-tab-${section.id}`"
        class="border rounded-lg px-3.5 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-primary-600 focus-visible:outline-offset-2 dark:focus-visible:outline-primary-300"
        :class="activeSection === section.id
          ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
          : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700'"
        @click="activeSection = section.id"
        @keydown="onTabKeydown($event, section.id)"
      >
        {{ section.label }}
      </button>
    </div>

    <section
      :id="panelId"
      role="tabpanel"
      :aria-labelledby="tabId(activeSection)"
      :tabindex="0"
      class="border border-neutral-200 rounded-xl p-5 dark:border-neutral-700 focus-visible:outline-2 focus-visible:outline-primary-600 focus-visible:outline-offset-2 dark:focus-visible:outline-primary-300"
    >
      <h2 class="text-base text-neutral-900 font-semibold dark:text-neutral-50">
        {{ tt(`sections.${activeSection}.title`) }}
      </h2>
      <p class="mb-4 mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        {{ tt(`sections.${activeSection}.summary`) }}
      </p>

      <LiaConfigAiSection v-if="activeSection === 'ai'" />
      <LiaConfigPersonalitySection v-else-if="activeSection === 'personality'" />
      <LiaConfigVoiceSection v-else-if="activeSection === 'voice'" />
      <LiaConfigAppearanceSection v-else-if="activeSection === 'appearance'" />
      <LiaConfigPresenceSection v-else-if="activeSection === 'presence'" />
      <LiaConfigMemorySection v-else-if="activeSection === 'memory'" />
    </section>
  </div>
</template>
