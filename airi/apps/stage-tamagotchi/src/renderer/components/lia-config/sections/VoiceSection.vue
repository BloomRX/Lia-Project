<script setup lang="ts">
/**
 * Voice section.
 *
 * Reflects the configuration the existing 4D voice runtime already owns. It
 * reads `useLiaVoiceStore` and nothing else: no provider registry, no TTS
 * runtime, no fallback runtime and no speech store is reimplemented or
 * re-registered here, so the validated runtime is untouched.
 *
 * Phase 4E-1 shows current values; editing lands in a later phase.
 */
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLiaVoiceStore } from '../../../stores/lia/voice'

const { t } = useI18n()
const tt = (key: string) => t(`tamagotchi.home.config.sections.voice.${key}`)

const voiceStore = useLiaVoiceStore()

/**
 * Loads the persisted `voice.tts` through the store's single existing IPC read.
 *
 * The store's refs start empty and only `refreshConfig()` fills them, so without
 * this the section would report "not configured" for a Lia that is configured.
 * `home.vue` installs the voice runtime extensions on mount but never loaded the
 * config, because before this panel nothing displayed it.
 *
 * Read-only by construction: `refreshConfig()` only invokes the *get* channel,
 * so opening the section cannot change what is persisted.
 */
async function loadPersistedVoiceConfig(): Promise<void> {
  try {
    await voiceStore.refreshConfig()
  }
  catch (error) {
    // refreshConfig rethrows after recording loadError, which the template
    // renders below. The failure is surfaced, never swallowed, and the rest of
    // the panel keeps working.
    console.warn('[Lia Config] could not load the persisted voice configuration', error)
  }
}

onMounted(() => {
  void loadPersistedVoiceConfig()
})

const rows = computed(() => [
  { key: 'provider', value: voiceStore.preferred?.providerId ?? null },
  { key: 'model', value: voiceStore.preferred?.modelId ?? null },
  { key: 'voice', value: voiceStore.preferred?.voiceId ?? null },
  { key: 'fallback', value: voiceStore.fallback.length > 0 ? String(voiceStore.fallback.length) : null },
])
</script>

<template>
  <div class="flex flex-col gap-3">
    <dl class="flex flex-col gap-2">
      <div
        v-for="row in rows"
        :key="row.key"
        class="flex items-baseline justify-between gap-4 border-b border-neutral-100 pb-2 last:border-0 dark:border-neutral-800"
        :data-testid="`lia-config-voice-${row.key}`"
      >
        <dt class="text-sm text-neutral-600 dark:text-neutral-300">
          {{ tt(`fields.${row.key}`) }}
        </dt>
        <dd class="text-sm text-neutral-900 font-medium dark:text-neutral-50">
          {{ row.value ?? tt('fields.unset') }}
        </dd>
      </div>
    </dl>

    <p
      class="text-xs"
      :class="voiceStore.loadError
        ? 'text-red-500 dark:text-red-400'
        : 'text-neutral-400 dark:text-neutral-500'"
      data-testid="lia-config-voice-note"
    >
      {{
        voiceStore.loadError
          ? tt('loadError')
          : voiceStore.isLoading
            ? tt('loading')
            : voiceStore.hasConfiguration ? tt('configured') : tt('notConfigured')
      }}
    </p>
  </div>
</template>
