<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { voiceEngineText } from '../voice-engine-strings'
import {
  LIA_VOICE_ENGINE_EVENT,
  voiceEngineCardVm,
  voiceEngineSelectionPayload,
  voiceEngineStateLabel,
} from './voice-engine-card.vm'

/**
 * Voice Engine card (Phase 7.9G): the product-facing surface for the
 * local Voice of Lia - engine name, install state, ONE install action and
 * selection. All truth comes from the main process (7.9F selection model,
 * 7.9E.2 real install proof); the only persistence call EVER made here is
 * the existing `lia:config:update` writer. No files, no engines, no paths.
 */
const props = defineProps<{ api: any }>()

const emit = defineEmits<{ (e: 'changed'): void }>()
const surface = ref<any>(undefined)
const language = ref<string | undefined>(undefined)
const busy = ref(false)
const feedback = ref('')

let unsubscribe: (() => void) | undefined

async function reload() {
  surface.value = await props.api?.voiceEngineState?.() ?? undefined
}

const vm = computed(() => voiceEngineCardVm(surface.value ?? { engines: [], phase: 'idle' }, language.value))

onMounted(async () => {
  const config = await (props.api?.productConfig?.() ?? Promise.resolve(undefined)).catch(() => undefined)
  language.value = config?.snapshot?.preferences?.language
  await reload()
  // Engine progress/completion rides the bounded lia:event rail.
  unsubscribe = props.api?.onLiaEvent?.(({ event, detail }: { detail?: string, event: string }) => {
    if (event !== LIA_VOICE_ENGINE_EVENT)
      return
    if (detail?.startsWith('phase=installing')) {
      void reload()
      return
    }
    if (detail?.startsWith('result=')) {
      busy.value = false
      if (detail.startsWith('result=failed'))
        feedback.value = voiceEngineText(vm.value.locale, 'lia.voice.engines.install.failed')
      void reload()
      emit('changed')
    }
  })
})

onBeforeUnmount(() => {
  unsubscribe?.()
})

async function install() {
  busy.value = true
  feedback.value = ''
  try {
    const result = await props.api.installVoiceEngine()
    if (result?.status === 'failed')
      feedback.value = voiceEngineText(vm.value.locale, 'lia.voice.engines.install.failed')
    // Completion (and its event) triggers the refresh; a direct refresh
    // also catches the flip for mocked/quiet channels.
    await reload()
    emit('changed')
  }
  finally {
    if (surface.value?.phase !== 'installing')
      busy.value = false
  }
}

async function select(engineId: string) {
  busy.value = true
  feedback.value = ''
  try {
    await props.api.updateConfig(voiceEngineSelectionPayload(engineId))
    await reload()
    emit('changed')
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="card voice-engine">
    <h3>{{ vm.title }}</h3>
    <p v-if="vm.hintKey" class="dim">
      {{ voiceEngineText(vm.locale, vm.hintKey) }}
    </p>

    <ul class="engines">
      <li v-for="row in vm.rows" :key="row.id" class="engine-row">
        <span class="engine-name">{{ row.userFacingName }}</span>
        <span class="badge state">{{ voiceEngineStateLabel(row, vm.locale) }}</span>
        <span v-if="row.selected" class="badge selected">{{ voiceEngineText(vm.locale, 'lia.voice.engines.selected') }}</span>
        <button
          v-if="row.canInstall"
          class="install"
          :disabled="busy"
          @click="install"
        >
          {{ busy ? '…' : voiceEngineText(vm.locale, 'lia.voice.engines.install.action') }}
        </button>
        <button
          v-if="row.canSelect"
          class="inline"
          :disabled="busy"
          @click="select(row.id)"
        >
          {{ voiceEngineText(vm.locale, 'lia.voice.engines.select.action') }}
        </button>
      </li>
    </ul>

    <p v-if="feedback" class="feedback">
      {{ feedback }}
    </p>
  </section>
</template>

<style scoped>
h3 { margin: 0 0 10px; }
.dim { color: var(--lia-text-dim); font-size: 13px; }
.engines { list-style: none; margin: 0; padding: 0; }
.engine-row { align-items: center; display: flex; gap: 10px; margin: 8px 0; }
.engine-name { font-weight: 600; }
.badge.state {
  background: var(--lia-border);
  border-radius: 999px;
  font-size: 11px;
  padding: 2px 8px;
}
.badge.selected {
  background: var(--lia-magenta);
  border-radius: 999px;
  color: var(--lia-bg, #0d0a12);
  font-size: 11px;
  padding: 2px 8px;
}
.install { margin-left: auto; }
.inline { font-size: 12px; margin-left: auto; }
.feedback { font-size: 13px; margin: 10px 0 0; }
</style>
