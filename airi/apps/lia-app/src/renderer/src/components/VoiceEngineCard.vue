<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { voiceEngineText } from '../voice-engine-strings'
import {
  LIA_VOICE_ENGINE_EVENT,
  LIA_VOICE_READINESS_EVENT,
  voiceEnabledPayload,
  voiceEngineCardVm,
  voiceEngineSelectionPayload,
  voiceEngineStateLabel,
  voiceProvisioningVm,
} from './voice-engine-card.vm'

/**
 * Voice Engine card (Phase 7.9G, extended 7.9H): the product-facing
 * surface for the local Voice of Lia - readiness of the automatic
 * first-run provisioning, the voice on/off switch, engine name, install
 * state, ONE install action and selection. All truth comes from the main
 * process (7.9H readiness model, 7.9F selection model, 7.9E.2 real
 * install proof); the only persistence call EVER made here is the
 * existing `lia:config:update` writer. No files, no engines, no paths,
 * no invented progress numbers.
 */
const props = defineProps<{ api: any }>()

const emit = defineEmits<{ (e: 'changed'): void }>()
const surface = ref<any>(undefined)
const readiness = ref<any>(undefined)
const language = ref<string | undefined>(undefined)
const busy = ref(false)
const busySwitch = ref(false)
const feedback = ref('')

let unsubscribe: (() => void) | undefined

async function reload() {
  surface.value = await props.api?.voiceEngineState?.() ?? undefined
}

async function reloadProvisioning() {
  readiness.value = await props.api?.voiceProvisioningState?.() ?? undefined
}

const vm = computed(() => voiceEngineCardVm(surface.value ?? { engines: [], phase: 'idle' }, language.value))
const provVm = computed(() => voiceProvisioningVm(readiness.value, language.value))

onMounted(async () => {
  const config = await (props.api?.productConfig?.() ?? Promise.resolve(undefined)).catch(() => undefined)
  language.value = config?.snapshot?.preferences?.language
  await reload()
  await reloadProvisioning()
  // Engine progress/completion AND provisioning readiness transitions ride
  // the bounded lia:event rail.
  unsubscribe = props.api?.onLiaEvent?.(({ event, detail }: { detail?: string, event: string }) => {
    if (event === LIA_VOICE_READINESS_EVENT) {
      void reloadProvisioning()
      return
    }
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
      void reloadProvisioning()
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

/** Phase 7.9H: honest retry/recovery - one NEW attempt via the same seam. */
async function retryProvisioning() {
  busy.value = true
  feedback.value = ''
  try {
    await props.api?.retryVoiceProvisioning?.()
    await reloadProvisioning()
    await reload()
    emit('changed')
  }
  finally {
    if (readiness.value?.state !== 'preparing')
      busy.value = false
  }
}

/** Phase 7.9H: the voice on/off switch rides the canonical config writer. */
async function toggleVoiceEnabled() {
  busySwitch.value = true
  feedback.value = ''
  try {
    await props.api.updateConfig(voiceEnabledPayload(!provVm.value.enabled))
    await reloadProvisioning()
    emit('changed')
  }
  finally {
    busySwitch.value = false
  }
}
</script>

<template>
  <section class="card voice-engine">
    <h3>{{ vm.title }}</h3>

    <!-- Phase 7.9H: automatic first-run readiness. Product words only -
         no jargon, no invented percentages, voice-off is "Desativada". -->
    <div class="readiness">
      <span class="badge state">{{ provVm.stateLabel }}</span>
      <span v-if="provVm.progressLabel" class="dim progress">{{ provVm.progressLabel }}</span>
      <button
        v-if="provVm.canRetry"
        class="retry"
        :disabled="busy"
        @click="retryProvisioning"
      >
        {{ busy ? '…' : voiceEngineText(vm.locale, 'lia.voice.provisioning.retry.action') }}
      </button>
      <button
        class="toggle inline"
        :disabled="busySwitch"
        @click="toggleVoiceEnabled"
      >
        {{ provVm.toggleLabel }}
      </button>
    </div>

    <p v-if="vm.hintKey" class="dim">
      {{ voiceEngineText(vm.locale, vm.hintKey) }}
    </p>

    <ul class="engines">
      <li v-for="row in vm.rows" :key="row.id" class="engine-row">
        <span class="engine-name">{{ row.userFacingName }}</span>
        <span class="badge state">{{ voiceEngineStateLabel(row, vm.locale) }}</span>
        <span v-if="row.selected" class="badge selected">{{ voiceEngineText(vm.locale, 'lia.voice.engines.selected') }}</span>
        <button
          v-if="row.canInstall && !provVm.busy"
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
.readiness { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 8px; }
.readiness .progress { font-size: 12px; }
.readiness .toggle { margin-left: auto; }
.retry { font-size: 12px; }
.install { margin-left: auto; }
.inline { font-size: 12px; margin-left: auto; }
.feedback { font-size: 13px; margin: 10px 0 0; }
</style>
