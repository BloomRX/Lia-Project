<script setup lang="ts">
import type { LiaProviderChatConfig, LiaProviderChatTarget } from '../../shared/eventa'

import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { LIA_CHAT_PROVIDER_OPTIONS, useLiaProviderStore } from '../stores/lia/provider'

const props = withDefaults(defineProps<{
  /** 'onboarding' (first run: must test + conclude) or 'manage' (later edits). */
  mode?: 'onboarding' | 'manage'
}>(), {
  mode: 'onboarding',
})

const emit = defineEmits<{
  complete: []
  back: []
}>()

const { t } = useI18n()
const tt = (key: string) => t(`tamagotchi.home.provider.${key}`)

const store = useLiaProviderStore()

// Provider options usable as a fallback (they are key-based and need no custom
// endpoint, so the single-endpoint primary model stays coherent). Each distinct
// provider keeps its OWN API key in the vault.
const FALLBACK_PROVIDER_OPTIONS = LIA_CHAT_PROVIDER_OPTIONS.filter(option => option.requiresBaseUrl !== true)

const providerId = ref('')
const modelId = ref('')
const baseUrl = ref('')
const apiKey = ref('')
const keySaved = ref(false)

const fallbackEnabled = ref(true)
const fallbackProviderId = ref('')
const fallbackModelId = ref('')
const fallbackApiKey = ref('')
const fallbackKeySaved = ref(false)

const busy = ref(false)
const lastTestOk = ref(false)

const isOnboarding = () => props.mode === 'onboarding'

const primaryOption = () => LIA_CHAT_PROVIDER_OPTIONS.find(option => option.id === providerId.value)
const needsBaseUrl = () => primaryOption()?.requiresBaseUrl === true
const primaryNeedsKey = () => store.providerNeedsKey(providerId.value)

// Official API-key pages for the currently selected primary/fallback providers
// (external links; the main window routes target=_blank to the system browser).
const getKeyUrl = computed(() => store.providerApiKeyUrl(providerId.value))
const getFallbackKeyUrl = computed(() => store.providerApiKeyUrl(fallbackProviderId.value))

/**
 * Whether the fallback needs its OWN key field: it is a DIFFERENT provider than
 * the primary AND that provider requires a credential. Same-provider fallbacks
 * reuse the primary's secret (no duplicate); key-less providers need none.
 */
const fallbackNeedsOwnKey = () => fallbackEnabled.value
  && Boolean(fallbackProviderId.value)
  && fallbackProviderId.value !== providerId.value
  && store.providerNeedsKey(fallbackProviderId.value)

const canTest = () => Boolean(providerId.value) && Boolean(modelId.value.trim())
const canConclude = () => Boolean(lastTestOk.value) && canTest()

async function refreshKeyState() {
  if (!providerId.value) {
    keySaved.value = false
    return
  }
  keySaved.value = store.providerNeedsKey(providerId.value) && await store.hasApiKey(providerId.value)
  if (keySaved.value) {
    apiKey.value = ''
  }
}

async function refreshFallbackKeyState() {
  if (!fallbackEnabled.value || !fallbackProviderId.value) {
    fallbackKeySaved.value = false
    fallbackApiKey.value = ''
    return
  }
  // Same provider as primary → shares the primary secret. Key-less → nothing.
  if (fallbackProviderId.value === providerId.value || !store.providerNeedsKey(fallbackProviderId.value)) {
    fallbackKeySaved.value = fallbackProviderId.value === providerId.value
      ? await store.hasApiKey(providerId.value)
      : true
    fallbackApiKey.value = ''
    return
  }
  fallbackKeySaved.value = await store.hasApiKey(fallbackProviderId.value)
  if (fallbackKeySaved.value) {
    fallbackApiKey.value = ''
  }
}

async function loadExisting() {
  const config = await store.refreshConfig()
  const preferred = config.preferred
  if (preferred?.providerId) {
    providerId.value = preferred.providerId
    modelId.value = preferred.modelId ?? ''
  }
  if (config.fallbackEnabled !== undefined) {
    fallbackEnabled.value = config.fallbackEnabled
  }
  else {
    fallbackEnabled.value = true
  }
  const fb = config.fallback?.[0]
  if (fb?.providerId) {
    fallbackProviderId.value = fb.providerId
    fallbackModelId.value = fb.modelId ?? ''
  }
  else if (fb?.modelId) {
    fallbackModelId.value = fb.modelId
  }
  await refreshKeyState()
  await refreshFallbackKeyState()
}

function invalidateTest() {
  lastTestOk.value = false
}

/** Persists each provider's own key when one was entered for it. */
async function storeKeys(): Promise<boolean> {
  const pk = apiKey.value.trim()
  if (pk) {
    const ok = await store.setApiKey(providerId.value, pk)
    if (!ok) {
      toast.error(tt('errors.keyStoreUnavailable'))
      return false
    }
  }
  if (fallbackNeedsOwnKey()) {
    const fk = fallbackApiKey.value.trim()
    if (fk) {
      const ok = await store.setApiKey(fallbackProviderId.value, fk)
      if (!ok) {
        toast.error(tt('errors.keyStoreUnavailable'))
        return false
      }
    }
  }
  return true
}

function buildConfig(): LiaProviderChatConfig {
  const current = store.loadedConfig ?? {}
  const fallback: LiaProviderChatTarget[] = []
  if (fallbackEnabled.value && fallbackProviderId.value) {
    fallback.push({
      providerId: fallbackProviderId.value,
      modelId: fallbackModelId.value.trim() || undefined,
    })
  }
  const preferred: LiaProviderChatTarget = {
    providerId: providerId.value,
    modelId: modelId.value.trim(),
  }
  return {
    ...current,
    strategy: 'manual',
    preferred,
    fallback,
    fallbackEnabled: fallbackEnabled.value,
  }
}

async function save() {
  if (!providerId.value) {
    toast.error(tt('errors.providerRequired'))
    return false
  }
  if (!modelId.value.trim()) {
    toast.error(tt('errors.modelRequired'))
    return false
  }
  busy.value = true
  try {
    if (!await storeKeys())
      return false
    await store.persistConfig(buildConfig())
    await store.ensureProviderRecord(providerId.value, baseUrl.value.trim() || undefined)
    apiKey.value = ''
    fallbackApiKey.value = ''
    keySaved.value = await store.hasApiKey(providerId.value)
    if (fallbackEnabled.value && fallbackProviderId.value) {
      await refreshFallbackKeyState()
    }
    toast.success(tt('saved'))
    return true
  }
  catch {
    toast.error(tt('errors.save'))
    return false
  }
  finally {
    busy.value = false
  }
}

async function testOne(args: {
  providerId: string
  modelId?: string
  apiKey?: string
  baseUrl?: string
}): Promise<boolean> {
  const result = await store.testConnection(args)
  return result.ok
}

async function testConnection() {
  if (!canTest()) {
    toast.error(tt('errors.fillFirst'))
    return
  }
  busy.value = true
  try {
    let allOk = await testOne({
      providerId: providerId.value,
      modelId: modelId.value.trim(),
      apiKey: apiKey.value.trim() || undefined,
      baseUrl: baseUrl.value.trim() || undefined,
    })
    if (!allOk) {
      toast.error(tt('connection.failed'))
    }

    // A distinct, key-requiring fallback is validated separately with its own key.
    if (allOk && fallbackEnabled.value && fallbackProviderId.value && fallbackProviderId.value !== providerId.value) {
      const fbOk = await testOne({
        providerId: fallbackProviderId.value,
        modelId: fallbackModelId.value.trim() || undefined,
        apiKey: fallbackApiKey.value.trim() || undefined,
      })
      if (!fbOk) {
        allOk = false
        toast.error(tt('connection.fallbackFailed'))
      }
    }

    lastTestOk.value = allOk
    if (allOk) {
      toast.success(tt('connection.ok'))
    }
  }
  finally {
    busy.value = false
  }
}

async function conclude() {
  if (!canConclude())
    return
  busy.value = true
  try {
    const ok = await save()
    if (!ok)
      return
    // Mark the setup complete so future launches open Home directly.
    await store.markOnboarded()
    emit('complete')
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
    // Also drop a distinct fallback's own key (explicit removal of this setup).
    if (fallbackProviderId.value && fallbackProviderId.value !== providerId.value) {
      await store.deleteApiKey(fallbackProviderId.value)
    }
    const config = store.loadedConfig ?? {}
    await store.persistConfig({
      ...config,
      preferred: undefined,
      fallback: [],
      fallbackEnabled: fallbackEnabled.value,
    })
    providerId.value = ''
    modelId.value = ''
    baseUrl.value = ''
    apiKey.value = ''
    fallbackProviderId.value = ''
    fallbackModelId.value = ''
    fallbackApiKey.value = ''
    fallbackKeySaved.value = false
    keySaved.value = false
    lastTestOk.value = false
    toast.success(tt('removed'))
  }
  finally {
    busy.value = false
  }
}

watch(providerId, () => {
  if (!needsBaseUrl()) {
    baseUrl.value = ''
  }
  void refreshKeyState()
  void refreshFallbackKeyState()
  invalidateTest()
})

watch([fallbackEnabled, fallbackProviderId], () => {
  void refreshFallbackKeyState()
  invalidateTest()
})

watch([modelId, fallbackModelId, apiKey, fallbackApiKey], () => {
  invalidateTest()
})

onMounted(() => {
  void loadExisting()
})
</script>

<template>
  <div class="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-neutral-200/70 bg-white/70 p-5 text-left shadow-lg backdrop-blur dark:border-neutral-700/70 dark:bg-black/25">
    <div>
      <h2 class="text-lg font-semibold text-neutral-900 dark:text-white">
        {{ isOnboarding() ? tt('onboarding.title') : tt('title') }}
      </h2>
      <p class="mt-0.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
        {{ isOnboarding() ? tt('onboarding.subtitle') : tt('subtitle') }}
      </p>
    </div>

    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          {{ tt('fields.provider.label') }}
        </label>
        <select
          v-model="providerId"
          class="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-sm text-neutral-800 outline-none focus:border-primary-400 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
        >
          <option value="" disabled>
            {{ tt('fields.provider.placeholder') }}
          </option>
          <option v-for="option in LIA_CHAT_PROVIDER_OPTIONS" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </select>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          {{ tt('fields.model.label') }}
        </label>
        <input
          v-model="modelId"
          type="text"
          :placeholder="tt('fields.model.placeholder')"
          class="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-sm text-neutral-800 outline-none focus:border-primary-400 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
        >
      </div>

      <div v-if="needsBaseUrl()" class="flex flex-col gap-1">
        <label class="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          {{ tt('fields.endpoint.label') }}
        </label>
        <input
          v-model="baseUrl"
          type="text"
          :placeholder="tt('fields.endpoint.placeholder')"
          class="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-sm text-neutral-800 outline-none focus:border-primary-400 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
        >
      </div>

      <div v-if="primaryNeedsKey() || keySaved" class="flex flex-col gap-1">
        <label class="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          {{ tt('fields.key.label') }}
        </label>
        <div class="relative">
          <input
            v-model="apiKey"
            type="password"
            autocomplete="off"
            :placeholder="keySaved ? tt('fields.key.replace') : tt('fields.key.placeholder')"
            class="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 pr-8 text-sm text-neutral-800 outline-none focus:border-primary-400 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
          >
          <span
            :title="keySaved ? tt('key.saved') : tt('key.missing')"
            class="absolute right-2.5 top-1/2 -translate-y-1/2"
          >
            <span :class="keySaved ? 'bg-green-500' : 'bg-neutral-300 dark:bg-neutral-600'" class="block size-2 rounded-full" />
          </span>
        </div>
        <a
          v-if="getKeyUrl"
          :href="getKeyUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="self-start text-[11px] font-medium text-primary-600 transition hover:text-primary-700 hover:underline dark:text-primary-400"
        >
          {{ tt('actions.getKey') }} ↗
        </a>
      </div>

      <div class="flex items-center justify-between gap-2 rounded-lg bg-neutral-100/60 px-3 py-2 dark:bg-white/5">
        <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
          <input v-model="fallbackEnabled" type="checkbox" class="size-4 accent-primary-500">
          {{ tt('fallback.label') }}
        </label>
        <span class="text-[10px] text-neutral-400 dark:text-neutral-500">{{ tt('fallback.hint') }}</span>
      </div>

      <div v-if="fallbackEnabled" class="flex flex-col gap-1">
        <label class="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          {{ tt('fields.fallbackProvider.label') }}
        </label>
        <select
          v-model="fallbackProviderId"
          class="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-sm text-neutral-800 outline-none focus:border-primary-400 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
        >
          <option value="" disabled>
            {{ tt('fields.fallbackProvider.placeholder') }}
          </option>
          <option v-for="option in FALLBACK_PROVIDER_OPTIONS" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </select>
      </div>

      <div v-if="fallbackEnabled && fallbackProviderId" class="flex flex-col gap-1">
        <label class="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          {{ tt('fields.fallbackModel.label') }}
        </label>
        <input
          v-model="fallbackModelId"
          type="text"
          :placeholder="tt('fields.model.placeholder')"
          class="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-sm text-neutral-800 outline-none focus:border-primary-400 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
        >
      </div>

      <!-- Separate key field ONLY when the fallback is a DIFFERENT key-requiring provider. -->
      <div v-if="fallbackNeedsOwnKey()" class="flex flex-col gap-1">
        <label class="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          {{ tt('fields.fallbackKey.label') }}
        </label>
        <div class="relative">
          <input
            v-model="fallbackApiKey"
            type="password"
            autocomplete="off"
            :placeholder="fallbackKeySaved ? tt('fields.key.replace') : tt('fields.key.placeholder')"
            class="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 pr-8 text-sm text-neutral-800 outline-none focus:border-primary-400 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
          >
          <span
            :title="fallbackKeySaved ? tt('key.saved') : tt('key.missing')"
            class="absolute right-2.5 top-1/2 -translate-y-1/2"
          >
            <span :class="fallbackKeySaved ? 'bg-green-500' : 'bg-neutral-300 dark:bg-neutral-600'" class="block size-2 rounded-full" />
          </span>
        </div>
        <a
          v-if="getFallbackKeyUrl"
          :href="getFallbackKeyUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="self-start text-[11px] font-medium text-primary-600 transition hover:text-primary-700 hover:underline dark:text-primary-400"
        >
          {{ tt('actions.getKey') }} ↗
        </a>
      </div>

      <p class="text-[10px] leading-relaxed text-neutral-500 dark:text-neutral-400">
        {{ tt('securityNote') }}
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-2 border-t border-neutral-200/70 pt-3 dark:border-neutral-700/70">
      <template v-if="isOnboarding()">
        <button
          type="button"
          class="rounded-lg border border-neutral-300 px-3.5 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
          :disabled="busy || !canTest()"
          @click="testConnection"
        >
          {{ tt('actions.test') }}
        </button>
        <button
          type="button"
          class="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
          :disabled="busy || !canConclude()"
          @click="conclude"
        >
          {{ tt('actions.conclude') }}
        </button>
        <span v-if="!lastTestOk" class="text-[10px] text-neutral-400 dark:text-neutral-500">
          {{ tt('errors.testFirst') }}
        </span>
      </template>

      <template v-else>
        <button
          type="button"
          class="rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
          :disabled="busy"
          @click="save"
        >
          {{ tt('actions.save') }}
        </button>
        <button
          type="button"
          class="rounded-lg border border-neutral-300 px-3.5 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
          :disabled="busy || !canTest()"
          @click="testConnection"
        >
          {{ tt('actions.test') }}
        </button>
        <button
          type="button"
          class="rounded-lg px-3.5 py-2 text-sm font-medium text-neutral-400 transition hover:text-red-600 disabled:opacity-50 dark:text-neutral-500"
          :disabled="busy || !providerId"
          @click="removeProvider"
        >
          {{ tt('actions.remove') }}
        </button>
        <button
          type="button"
          class="ml-auto rounded-lg border border-neutral-300 px-3.5 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
          :disabled="busy"
          @click="emit('back')"
        >
          {{ tt('actions.back') }}
        </button>
      </template>
    </div>
  </div>
</template>
