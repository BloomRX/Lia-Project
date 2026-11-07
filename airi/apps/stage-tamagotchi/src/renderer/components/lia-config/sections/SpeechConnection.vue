<script setup lang="ts">
import type { LiaSpeechConfig } from '../../../../shared/eventa/lia-speech-config'
import type { VoicePreviewDriver } from '../../../stores/lia/voice-preview'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { electronLiaSpeechConfigGet, electronLiaSpeechConfigSave } from '../../../../shared/eventa/lia-speech-config'
import { LIA_VOICE_PREVIEW_TEXT } from '../../../stores/lia/voice-editor'

const props = defineProps<{ providerId: string, modelId: string, voiceId: string, preview: VoicePreviewDriver, previewBusy: boolean }>()
const emit = defineEmits<{ testing: [value: boolean], configured: [value: boolean] }>()
const { t } = useI18n()
const tt = (key: string) => t(`tamagotchi.home.config.sections.voice.connection.${key}`)
const config = shallowRef<LiaSpeechConfig>()
const endpoint = ref('')
const key = ref('')
const state = ref<'loading' | 'saving' | 'testing' | 'idle'>('loading')
const message = ref('')
let controller: AbortController | undefined
const dirty = computed(() => endpoint.value.trim() !== config.value?.baseUrl || Boolean(key.value))
const ready = computed(() => Boolean(config.value?.baseUrl && config.value.hasKey))

function apply(value: LiaSpeechConfig) {
  config.value = value
  endpoint.value = value.baseUrl
  emit('configured', ready.value)
}

async function load() {
  state.value = 'loading'
  message.value = ''
  try {
    const result = await useElectronEventaInvoke(electronLiaSpeechConfigGet)({ providerId: props.providerId })
    if (result.ok)
      apply(result.config)
    else
      message.value = result.code
  }
  catch {
    message.value = 'storage'
  }
  finally {
    state.value = 'idle'
  }
}

async function save() {
  if (state.value !== 'idle' || !config.value)
    return
  state.value = 'saving'
  const apiKey = key.value.trim()
  key.value = ''
  try {
    const result = await useElectronEventaInvoke(electronLiaSpeechConfigSave)({
      providerId: props.providerId,
      baseUrl: endpoint.value.trim(),
      revision: config.value.revision,
      ...(apiKey ? { apiKey } : {}),
    })
    if (result.ok)
      apply(result.config)
    else if (result.code === 'conflict')
      await load()
    message.value = result.ok ? 'saved' : result.code
  }
  catch {
    message.value = 'storage'
  }
  finally {
    state.value = 'idle'
  }
}

async function testConnection() {
  if (state.value !== 'idle' || props.previewBusy || dirty.value || !ready.value || !props.modelId || !props.voiceId)
    return
  const attempt = new AbortController()
  controller = attempt
  state.value = 'testing'
  emit('testing', true)
  message.value = ''
  let played = false
  try {
    await props.preview({ providerId: props.providerId, modelId: props.modelId, voiceId: props.voiceId }, LIA_VOICE_PREVIEW_TEXT, attempt.signal, () => {
      played = true
    })
    message.value = attempt.signal.aborted ? 'cancelled' : played ? 'connected' : 'testError'
  }
  catch (error) {
    message.value = attempt.signal.aborted ? 'cancelled' : (error as { code?: string })?.code === 'timeout' ? 'timeout' : 'testError'
  }
  finally {
    controller = undefined
    state.value = 'idle'
    emit('testing', false)
  }
}

onMounted(load)
watch(() => [props.modelId, props.voiceId], () => controller?.abort())
onScopeDispose(() => {
  key.value = ''
  controller?.abort()
})
</script>

<template>
  <form class="my-3 flex flex-col gap-2" data-testid="voice-connection" @submit.prevent="save">
    <label class="flex flex-col gap-1 text-sm">
      {{ tt('endpoint') }}
      <input v-model="endpoint" type="url" required data-testid="voice-connection-endpoint" :disabled="state !== 'idle'" class="w-full border border-neutral-200 rounded bg-transparent px-2 py-1 dark:border-neutral-700">
    </label>
    <label class="flex flex-col gap-1 text-sm">
      {{ tt('key') }}
      <input v-model="key" type="password" autocomplete="new-password" data-testid="voice-connection-key" :disabled="state !== 'idle'" class="w-full border border-neutral-200 rounded bg-transparent px-2 py-1 dark:border-neutral-700">
    </label>
    <p class="text-xs text-neutral-600 dark:text-neutral-300">
      {{ tt(config?.hasKey ? 'keepKey' : 'incomplete') }}
    </p>
    <div class="flex flex-wrap gap-2">
      <button type="submit" class="border rounded px-3 py-1 text-sm disabled:opacity-50" :disabled="state !== 'idle' || !config || !dirty">
        {{ tt('save') }}
      </button>
      <button type="button" class="border rounded px-3 py-1 text-sm disabled:opacity-50" :disabled="state !== 'idle' || previewBusy || dirty || !ready || !modelId || !voiceId" @click="testConnection">
        {{ tt('test') }}
      </button>
      <button v-if="state === 'testing'" type="button" class="border rounded px-3 py-1 text-sm" @click="controller?.abort()">
        {{ tt('cancel') }}
      </button>
      <button v-if="state === 'idle' && !config" type="button" class="border rounded px-3 py-1 text-sm" @click="load">
        {{ tt('retry') }}
      </button>
    </div>
    <p role="status" class="min-h-4 text-xs text-neutral-600 dark:text-neutral-300">
      {{ state !== 'idle' ? tt(state) : message ? tt(message) : '' }}
    </p>
  </form>
</template>
