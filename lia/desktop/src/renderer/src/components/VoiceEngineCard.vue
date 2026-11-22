<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import LiaButton from './lia/LiaButton.vue'
import LiaPanel from './lia/LiaPanel.vue'
import LiaStatusChip from './lia/LiaStatusChip.vue'

import { voiceEngineText } from '../voice-engine-strings'
import {
  LIA_VOICE_ENGINE_EVENT,
  LIA_VOICE_READINESS_EVENT,
  voiceEnabledPayload,
  voiceEngineCardVm,
  voiceEngineRowChipVariant,
  voiceEngineSelectionPayload,
  voiceEngineStateLabel,
  voiceProvisioningVm,
  voiceStatusChipVariant,
  voiceStatusChipVm,
} from './voice-engine-card.vm'

/**
 * Voice Engine card (Phase 7.9G, extended 7.9H, migrated to the Lia design
 * system in 8.0A-4): the product-facing surface for the local Voice of Lia -
 * readiness of the automatic first-run preparation, the voice on/off
 * switch, engine name, install state, ONE install action and selection.
 * All truth comes from the main process (7.9H readiness model, 7.9F
 * selection model, 7.9E.2 real install proof); the only persistence call
 * EVER made here is the existing config writer seam. No files, no engines,
 * no paths, no invented progress numbers.
 *
 * 8.0A-4 is visual only: the same wiring now renders on LiaPanel /
 * LiaButton / LiaStatusChip + semantic tokens. The canonical readiness
 * state stays the 7.9H model - the chip below uses the SAME chip
 * vocabulary the shell and Home already render (`voiceStatusChipVm`), so
 * one state can never drift between surfaces.
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
// Phase 8.0A-4: the canonical chip face - the SAME readiness state as
// provVm, mapped to the compact chip vocabulary (no second state model).
const chipVm = computed(() => voiceStatusChipVm(readiness.value, language.value))

onMounted(async () => {
  const config = await (props.api?.productConfig?.() ?? Promise.resolve(undefined)).catch(() => undefined)
  language.value = config?.snapshot?.preferences?.language
  await reload()
  await reloadProvisioning()
  // Engine progress/completion AND readiness transitions ride
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
  <LiaPanel class="voice-engine">
    <h3>{{ vm.title }}</h3>

    <!-- Phase 7.9H readiness, rendered as the canonical LiaStatusChip:
         product words only, no jargon, no invented percentages,
         voice-off is "Desativada". -->
    <div class="readiness">
      <LiaStatusChip :variant="voiceStatusChipVariant(chipVm.tone)">
        {{ chipVm.label }}
      </LiaStatusChip>
      <span v-if="provVm.progressLabel" class="dim progress">{{ provVm.progressLabel }}</span>
      <LiaButton
        v-if="provVm.canRetry"
        :disabled="busy"
        @click="retryProvisioning"
      >
        {{ busy ? '…' : voiceEngineText(vm.locale, 'lia.voice.provisioning.retry.action') }}
      </LiaButton>
      <LiaButton
        class="toggle"
        :disabled="busySwitch"
        @click="toggleVoiceEnabled"
      >
        {{ provVm.toggleLabel }}
      </LiaButton>
    </div>

    <p v-if="vm.hintKey" class="dim hint">
      {{ voiceEngineText(vm.locale, vm.hintKey) }}
    </p>

    <ul class="engines">
      <li v-for="row in vm.rows" :key="row.id" class="engine-row">
        <span class="engine-name">{{ row.userFacingName }}</span>
        <LiaStatusChip :variant="voiceEngineRowChipVariant(row.stateKey)">
          {{ voiceEngineStateLabel(row, vm.locale) }}
        </LiaStatusChip>
        <span v-if="row.selected" class="selected-mark">{{ voiceEngineText(vm.locale, 'lia.voice.engines.selected') }}</span>
        <LiaButton
          v-if="row.canInstall && !provVm.busy"
          class="install"
          variant="primary"
          :disabled="busy"
          @click="install"
        >
          {{ busy ? '…' : voiceEngineText(vm.locale, 'lia.voice.engines.install.action') }}
        </LiaButton>
        <LiaButton
          v-if="row.canSelect"
          class="select"
          :disabled="busy"
          @click="select(row.id)"
        >
          {{ voiceEngineText(vm.locale, 'lia.voice.engines.select.action') }}
        </LiaButton>
      </li>
    </ul>

    <p v-if="feedback" class="feedback">
      {{ feedback }}
    </p>
  </LiaPanel>
</template>

<style scoped>
/* 8.0A-4: semantic tokens only - no raw colors. */
h3 { margin: 0 0 var(--lia-space-3); }
.dim { color: var(--lia-text-secondary); font-size: var(--lia-text-sm); }
.hint { margin: 0 0 var(--lia-space-3); }

.readiness {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lia-space-3);
  margin: 0 0 var(--lia-space-3);
}
.readiness .progress { font-size: var(--lia-text-xs); }
.readiness .toggle { margin-left: auto; }

.engines {
  display: flex;
  flex-direction: column;
  gap: var(--lia-space-2);
  list-style: none;
  margin: 0;
  padding: 0;
}
.engine-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lia-space-3);
}
.engine-name { font-weight: var(--lia-font-medium); }
.selected-mark {
  background: var(--lia-accent);
  border-radius: var(--lia-radius-pill);
  color: var(--lia-accent-contrast);
  font-size: var(--lia-text-xs);
  padding: var(--lia-space-1) var(--lia-space-3);
}
.engine-row .install { margin-left: auto; }
.engine-row .select { margin-left: auto; }

.feedback { font-size: var(--lia-text-sm); margin: var(--lia-space-3) 0 0; }
</style>
