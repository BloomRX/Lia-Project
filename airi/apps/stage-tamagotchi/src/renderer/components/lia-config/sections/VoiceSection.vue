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
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLiaVoiceStore } from '../../../stores/lia/voice'

const { t } = useI18n()
const tt = (key: string) => t(`tamagotchi.home.config.sections.voice.${key}`)

const voiceStore = useLiaVoiceStore()

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

    <p class="text-xs text-neutral-400 dark:text-neutral-500" data-testid="lia-config-voice-note">
      {{ voiceStore.hasConfiguration ? tt('configured') : tt('notConfigured') }}
    </p>
  </div>
</template>
