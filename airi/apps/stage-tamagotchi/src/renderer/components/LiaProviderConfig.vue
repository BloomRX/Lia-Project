<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { LIA_CHAT_PROVIDER_OPTIONS, useLiaProviderStore } from '../stores/lia/provider'

const { t } = useI18n()
const tt = (key: string) => t(`tamagotchi.home.provider.${key}`)

const store = useLiaProviderStore()

const providerId = ref('')
const modelId = ref('')
const baseUrl = ref('')
const apiKey = ref('')
const keySaved = ref(false)
const busy = ref(false)
const fallbackEnabled = ref(true)

const selectedOption = () => LIA_CHAT_PROVIDER_OPTIONS.find(option => option.id === providerId.value)
const needsBaseUrl = () => selectedOption()?.requiresBaseUrl === true

async function refreshKeyState() {
  if (!providerId.value)
    return
  keySaved.value = await store.hasApiKey(providerId.value)
  if (keySaved.value) {
    apiKey.value = ''
  }
}

async function loadExisting() {
  const config = await store.refreshConfig()
  const preferred = config.preferred
  if (preferred?.providerId) {
    providerId.value = preferred.providerId
    modelId.value = preferred.modelId ?? ''
    fallbackEnabled.value = config.fallbackEnabled !== false
  }
  await refreshKeyState()
}

async function save() {
  if (!providerId.value) {
    toast.error(tt('errors.providerRequired'))
    return
  }
  if (!modelId.value.trim()) {
    toast.error(tt('errors.modelRequired'))
    return
  }
  busy.value = true
  try {
    if (apiKey.value.trim()) {
      const stored = await store.setApiKey(providerId.value, apiKey.value.trim())
      if (!stored) {
        toast.error(tt('errors.keyStoreUnavailable'))
        return
      }
    }
    const target = { providerId: providerId.value, modelId: modelId.value.trim() }
    await store.persistConfig({
      strategy: 'manual',
      preferred: target,
      fallback: [],
      fallbackEnabled: fallbackEnabled.value,
    })
    await store.ensureProviderRecord(providerId.value, baseUrl.value.trim() || undefined)
    apiKey.value = ''
    keySaved.value = await store.hasApiKey(providerId.value)
    toast.success(tt('saved'))
  }
  catch {
    toast.error(tt('errors.save'))
  }
  finally {
    busy.value = false
  }
}

async function testConnection() {
  if (!providerId.value || !modelId.value.trim()) {
    toast.error(tt('errors.fillFirst'))
    return
  }
  busy.value = true
  try {
    const result = await store.testConnection({
      providerId: providerId.value,
      modelId: modelId.value.trim(),
      apiKey: apiKey.value.trim() || undefined,
      baseUrl: baseUrl.value.trim() || undefined,
    })
    if (result.ok) {
      toast.success(tt('connection.ok'))
    }
    else {
      toast.error(tt('connection.failed'))
    }
  }
  finally {
    busy.value = false
  }
}

async function removeProvider() {
  if (!providerId.value)
    return
  busy.value = true
  try {
    await store.deleteApiKey(providerId.value)
    await store.persistConfig({ strategy: 'manual', preferred: undefined, fallback: [], fallbackEnabled: fallbackEnabled.value })
    providerId.value = ''
    modelId.value = ''
    baseUrl.value = ''
    apiKey.value = ''
    keySaved.value = false
    toast.success(tt('removed'))
  }
  finally {
    busy.value = false
  }
}

watch(providerId, () => {
  // Reset baseUrl hint when provider changes (only OpenAI-compatible/LM Studio/Ollama need one).
  if (!needsBaseUrl()) {
    baseUrl.value = ''
  }
  void refreshKeyState()
})

onMounted(() => {
  void loadExisting()
})
</script>

<template>
  <div class="w-full max-w-xs rounded-xl border border-neutral-200/70 bg-white/60 p-3 text-left shadow-sm dark:border-neutral-700/70 dark:bg-black/20">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
        {{ tt('title') }}
      </h3>
      <span class="inline-flex items-center gap-1 text-[10px] text-neutral-500 dark:text-neutral-400">
        <span :class="keySaved ? 'bg-green-500' : 'bg-neutral-400'" class="size-1.5 rounded-full" />
        {{ keySaved ? tt('key.saved') : tt('key.missing') }}
      </span>
    </div>

    <div class="mt-2 flex flex-col gap-2">
      <select
        v-model="providerId"
        class="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-800 outline-none focus:border-primary-400 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
      >
        <option value="" disabled>
          {{ tt('fields.provider.placeholder') }}
        </option>
        <option v-for="option in LIA_CHAT_PROVIDER_OPTIONS" :key="option.id" :value="option.id">
          {{ option.label }}
        </option>
      </select>

      <input
        v-model="modelId"
        type="text"
        :placeholder="tt('fields.model.placeholder')"
        class="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-800 outline-none focus:border-primary-400 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
      >

      <input
        v-if="needsBaseUrl()"
        v-model="baseUrl"
        type="text"
        :placeholder="tt('fields.endpoint.placeholder')"
        class="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-800 outline-none focus:border-primary-400 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
      >

      <input
        v-model="apiKey"
        type="password"
        autocomplete="off"
        :placeholder="keySaved ? tt('fields.key.replace') : tt('fields.key.placeholder')"
        class="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-800 outline-none focus:border-primary-400 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
      >

      <label class="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
        <input v-model="fallbackEnabled" type="checkbox" class="size-3.5 accent-primary-500">
        {{ tt('fallback.label') }}
      </label>

      <p class="text-[10px] leading-relaxed text-neutral-500 dark:text-neutral-400">
        {{ tt('securityNote') }}
      </p>

      <div class="flex flex-wrap items-center gap-2">
        <button
          class="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
          type="button"
          :disabled="busy"
          @click="save"
        >
          {{ tt('actions.save') }}
        </button>
        <button
          class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
          type="button"
          :disabled="busy || !providerId"
          @click="testConnection"
        >
          {{ tt('actions.test') }}
        </button>
        <button
          class="rounded-md px-3 py-1.5 text-xs font-medium text-neutral-400 transition hover:text-red-600 disabled:opacity-50 dark:text-neutral-500"
          type="button"
          :disabled="busy || !providerId"
          @click="removeProvider"
        >
          {{ tt('actions.remove') }}
        </button>
      </div>
    </div>
  </div>
</template>
