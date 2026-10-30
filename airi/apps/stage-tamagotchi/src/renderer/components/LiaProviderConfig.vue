<script setup lang="ts">
import type { LiaProviderChatConfig, LiaProviderChatTarget } from '../../shared/eventa'

import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { useLiaModelDiscovery } from '../stores/lia/model-discovery'
import { curatedModelsFor, LIA_CHAT_PROVIDER_OPTIONS, useLiaProviderStore } from '../stores/lia/provider'

const props = withDefaults(defineProps<{
  /** 'onboarding' (first run: must test + conclude) or 'manage' (later edits). */
  mode?: 'onboarding' | 'manage'
  /**
   * Rendered inside the unified "Configurar Lia" panel, which owns navigation.
   * Suppresses this component's own back button so there is a single way back.
   */
  embedded?: boolean
}>(), {
  mode: 'onboarding',
  embedded: false,
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

const primaryDiscovery = useLiaModelDiscovery(computed(() => ({
  providerId: providerId.value,
  baseUrl: baseUrl.value || undefined,
  apiKey: apiKey.value || undefined,
})), args => store.discoverModels(args))
const fallbackDiscovery = useLiaModelDiscovery(computed(() => ({
  providerId: fallbackEnabled.value ? fallbackProviderId.value : '',
  baseUrl: fallbackProviderId.value === providerId.value ? baseUrl.value || undefined : undefined,
  apiKey: fallbackProviderId.value === providerId.value ? apiKey.value || undefined : fallbackApiKey.value || undefined,
})), args => store.discoverModels(args))
function suggestions(pid: string, discovered: Array<{ id: string, label: string }>) {
  return [...new Map([...curatedModelsFor(pid), ...discovered].map(model => [model.id, model])).values()]
}
const primaryModelOptions = computed(() => suggestions(providerId.value, primaryDiscovery.models.value))
const fallbackModelOptions = computed(() => suggestions(fallbackProviderId.value, fallbackDiscovery.models.value))
const testFailure = ref('')

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
function fallbackNeedsOwnKey() {
  return fallbackEnabled.value
    && Boolean(fallbackProviderId.value)
    && fallbackProviderId.value !== providerId.value
    && store.providerNeedsKey(fallbackProviderId.value)
}

const canTest = () => Boolean(providerId.value) && Boolean(modelId.value.trim())
const canConclude = () => Boolean(lastTestOk.value) && canTest()

async function refreshKeyState() {
  if (!providerId.value) {
    keySaved.value = false
    return
  }
  const id = providerId.value
  const saved = store.providerNeedsKey(id) && await store.hasApiKey(id)
  if (id === providerId.value)
    keySaved.value = saved
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
    return
  }
  const id = fallbackProviderId.value
  const saved = await store.hasApiKey(id)
  if (id === fallbackProviderId.value)
    fallbackKeySaved.value = saved
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
  testFailure.value = ''
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
      modelId: fallbackModelId.value || undefined,
    })
  }
  const preferred: LiaProviderChatTarget = {
    providerId: providerId.value,
    modelId: modelId.value,
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
  if (fallbackEnabled.value && fallbackProviderId.value && !fallbackModelId.value.trim()) {
    toast.error(tt('errors.modelRequired'))
    return false
  }
  busy.value = true
  try {
    if (!await storeKeys())
      return false
    await store.persistConfig(buildConfig())
    await store.ensureProviderRecord(providerId.value, baseUrl.value.trim() || undefined)
    await store.activatePreferred()
    apiKey.value = ''
    fallbackApiKey.value = ''
    primaryDiscovery.refresh()
    fallbackDiscovery.refresh()
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
  testFailure.value = result.ok ? '' : tt(`connection.${result.failure ?? 'request'}`)
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
      modelId: modelId.value,
      apiKey: apiKey.value.trim() || undefined,
      baseUrl: baseUrl.value.trim() || undefined,
    })
    if (!allOk) {
      toast.error(testFailure.value)
    }

    // A distinct, key-requiring fallback is validated separately with its own key.
    if (allOk && fallbackEnabled.value && fallbackProviderId.value && fallbackProviderId.value !== providerId.value) {
      const fbOk = await testOne({
        providerId: fallbackProviderId.value,
        modelId: fallbackModelId.value || undefined,
        apiKey: fallbackApiKey.value.trim() || undefined,
      })
      if (!fbOk) {
        allOk = false
        toast.error(testFailure.value)
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
    // Mark the setup complete so future launches open Home directly. After this
    // the store re-reads the persisted config, which also flips the reactive
    // state Home watches — the launcher appears on the same mount.
    await store.markOnboarded()
    emit('complete')
  }
  catch {
    // Surface any failure instead of leaving the onboarding screen silently
    // stuck (the launcher transition only happens once this completes).
    toast.error(tt('errors.concludeFailed'))
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

watch(providerId, (id) => {
  baseUrl.value = store.providerBaseUrl(id) ?? ''
  apiKey.value = ''
  keySaved.value = false
  // A provider change never rewrites a model ID, even if it is absent from its suggestions.
  void refreshKeyState()
  void refreshFallbackKeyState()
  invalidateTest()
})

watch([fallbackEnabled, fallbackProviderId], () => {
  fallbackApiKey.value = ''
  void refreshFallbackKeyState()
  invalidateTest()
})

watch([modelId, fallbackModelId, apiKey, fallbackApiKey, baseUrl], invalidateTest)

onMounted(() => {
  void loadExisting()
})
</script>

<template>
  <div class="max-w-md w-full flex flex-col gap-4 border border-neutral-200/70 rounded-2xl bg-white/70 p-5 text-left shadow-lg backdrop-blur dark:border-neutral-700/70 dark:bg-black/25">
    <div>
      <h2 class="text-lg text-neutral-900 font-semibold dark:text-white">
        {{ isOnboarding() ? tt('onboarding.title') : tt('title') }}
      </h2>
      <p class="mt-0.5 text-xs text-neutral-500 leading-relaxed dark:text-neutral-400">
        {{ isOnboarding() ? tt('onboarding.subtitle') : tt('subtitle') }}
      </p>
    </div>

    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <label class="text-xs text-neutral-600 font-medium dark:text-neutral-300">
          {{ tt('fields.provider.label') }}
        </label>
        <select
          v-model="providerId"
          :disabled="busy"
          class="w-full border border-neutral-300 rounded-lg bg-white px-2.5 py-2 text-sm text-neutral-800 outline-none dark:border-neutral-600 focus:border-primary-400 dark:bg-neutral-800 dark:text-neutral-100"
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
        <label class="text-xs text-neutral-600 font-medium dark:text-neutral-300">
          {{ tt('fields.model.label') }}
        </label>
        <input
          id="lia-model"
          v-model="modelId"
          list="lia-model-suggestions"
          :disabled="!providerId || busy"
          :placeholder="tt('fields.model.placeholder')"
          :aria-label="tt('fields.model.label')"
          aria-describedby="lia-model-help"
          class="w-full border border-neutral-300 rounded-lg bg-white px-2.5 py-2 text-sm text-neutral-800 outline-none dark:border-neutral-600 focus:border-primary-400 dark:bg-neutral-800 dark:text-neutral-100 disabled:opacity-60"
        >
        <datalist id="lia-model-suggestions">
          <option v-for="option in primaryModelOptions" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </datalist>
        <p id="lia-model-help" class="text-xs text-neutral-500 dark:text-neutral-400">
          {{ tt('discovery.manual') }}
        </p>
        <p role="status" class="text-xs text-neutral-500 dark:text-neutral-400">
          {{ tt(`discovery.${primaryDiscovery.state.value === 'ready' && primaryDiscovery.models.value.length === 0 ? 'empty' : primaryDiscovery.state.value}`) }}
        </p>
        <button type="button" class="self-start text-xs text-primary-600 dark:text-primary-400" :disabled="!providerId || primaryDiscovery.state.value === 'loading' || busy" @click="primaryDiscovery.refresh">
          {{ tt('discovery.refresh') }}
        </button>
      </div>

      <div v-if="needsBaseUrl()" class="flex flex-col gap-1">
        <label class="text-xs text-neutral-600 font-medium dark:text-neutral-300">
          {{ tt('fields.endpoint.label') }}
        </label>
        <input
          v-model="baseUrl"
          :disabled="busy"
          type="text"
          :placeholder="tt('fields.endpoint.placeholder')"
          class="w-full border border-neutral-300 rounded-lg bg-white px-2.5 py-2 text-sm text-neutral-800 outline-none dark:border-neutral-600 focus:border-primary-400 dark:bg-neutral-800 dark:text-neutral-100"
        >
      </div>

      <div v-if="primaryNeedsKey() || keySaved" class="flex flex-col gap-1">
        <label class="text-xs text-neutral-600 font-medium dark:text-neutral-300">
          {{ tt('fields.key.label') }}
        </label>
        <div class="relative">
          <input
            v-model="apiKey"
            :disabled="busy"
            type="password"
            autocomplete="off"
            :placeholder="keySaved ? tt('fields.key.replace') : tt('fields.key.placeholder')"
            class="w-full border border-neutral-300 rounded-lg bg-white px-2.5 py-2 pr-8 text-sm text-neutral-800 outline-none dark:border-neutral-600 focus:border-primary-400 dark:bg-neutral-800 dark:text-neutral-100"
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
          class="self-start text-[11px] text-primary-600 font-medium transition dark:text-primary-400 hover:text-primary-700 hover:underline"
        >
          {{ tt('actions.getKey') }} ↗
        </a>
      </div>

      <div class="flex items-center justify-between gap-2 rounded-lg bg-neutral-100/60 px-3 py-2 dark:bg-white/5">
        <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
          <input v-model="fallbackEnabled" :disabled="busy" type="checkbox" class="size-4 accent-primary-500">
          {{ tt('fallback.label') }}
        </label>
        <span class="text-[10px] text-neutral-400 dark:text-neutral-500">{{ tt('fallback.hint') }}</span>
      </div>

      <div v-if="fallbackEnabled" class="flex flex-col gap-1">
        <label class="text-xs text-neutral-600 font-medium dark:text-neutral-300">
          {{ tt('fields.fallbackProvider.label') }}
        </label>
        <select
          v-model="fallbackProviderId"
          :disabled="busy"
          class="w-full border border-neutral-300 rounded-lg bg-white px-2.5 py-2 text-sm text-neutral-800 outline-none dark:border-neutral-600 focus:border-primary-400 dark:bg-neutral-800 dark:text-neutral-100"
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
        <label class="text-xs text-neutral-600 font-medium dark:text-neutral-300">
          {{ tt('fields.fallbackModel.label') }}
        </label>
        <input
          id="lia-fallback-model"
          v-model="fallbackModelId"
          list="lia-fallback-model-suggestions"
          :disabled="busy"
          :aria-label="tt('fields.fallbackModel.label')"
          :placeholder="tt('fields.model.placeholder')"
          class="w-full border border-neutral-300 rounded-lg bg-white px-2.5 py-2 text-sm text-neutral-800 outline-none dark:border-neutral-600 focus:border-primary-400 dark:bg-neutral-800 dark:text-neutral-100 disabled:opacity-60"
        >
        <datalist id="lia-fallback-model-suggestions">
          <option v-for="option in fallbackModelOptions" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </datalist>
        <p role="status" class="text-xs text-neutral-500 dark:text-neutral-400">
          {{ tt(`discovery.${fallbackDiscovery.state.value === 'ready' && fallbackDiscovery.models.value.length === 0 ? 'empty' : fallbackDiscovery.state.value}`) }}
        </p>
      </div>

      <!-- Separate key field ONLY when the fallback is a DIFFERENT key-requiring provider. -->
      <div v-if="fallbackNeedsOwnKey()" class="flex flex-col gap-1">
        <label class="text-xs text-neutral-600 font-medium dark:text-neutral-300">
          {{ tt('fields.fallbackKey.label') }}
        </label>
        <div class="relative">
          <input
            v-model="fallbackApiKey"
            :disabled="busy"
            type="password"
            autocomplete="off"
            :placeholder="fallbackKeySaved ? tt('fields.key.replace') : tt('fields.key.placeholder')"
            class="w-full border border-neutral-300 rounded-lg bg-white px-2.5 py-2 pr-8 text-sm text-neutral-800 outline-none dark:border-neutral-600 focus:border-primary-400 dark:bg-neutral-800 dark:text-neutral-100"
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
          class="self-start text-[11px] text-primary-600 font-medium transition dark:text-primary-400 hover:text-primary-700 hover:underline"
        >
          {{ tt('actions.getKey') }} ↗
        </a>
      </div>

      <p class="text-[10px] text-neutral-500 leading-relaxed dark:text-neutral-400">
        {{ tt('securityNote') }}
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-2 border-t border-neutral-200/70 pt-3 dark:border-neutral-700/70">
      <p v-if="testFailure" role="alert" class="w-full text-xs text-red-600 dark:text-red-400">
        {{ testFailure }}
      </p>
      <p v-if="lastTestOk && !isOnboarding()" role="status" class="w-full text-xs text-green-600 dark:text-green-400">
        {{ tt('connection.ok') }}
      </p>
      <template v-if="isOnboarding()">
        <button
          type="button"
          class="border border-neutral-300 rounded-lg px-3.5 py-2 text-sm text-neutral-700 font-medium transition dark:border-neutral-600 hover:bg-neutral-100 dark:text-neutral-200 disabled:opacity-50 dark:hover:bg-neutral-700"
          :disabled="busy || !canTest()"
          @click="testConnection"
        >
          {{ tt('actions.test') }}
        </button>
        <button
          type="button"
          class="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white font-semibold transition hover:bg-primary-700 disabled:opacity-50"
          :disabled="busy || !canConclude()"
          @click="conclude"
        >
          {{ tt('actions.conclude') }}
        </button>
        <!-- Persistent test result: success stays visible (and Concluir stays
             enabled) until the user edits the provider/model/key or clicks
             Concluir. Testing never clears the chosen provider/model/key. -->
        <span
          v-if="lastTestOk"
          class="inline-flex items-center gap-1 text-[11px] text-green-600 font-medium dark:text-green-400"
        >
          <span class="i-solar:check-circle-bold-duotone size-3.5" />
          {{ tt('connection.ok') }}
        </span>
        <span v-else class="text-[10px] text-neutral-400 dark:text-neutral-500">
          {{ tt('errors.testFirst') }}
        </span>
      </template>

      <template v-else>
        <button
          type="button"
          class="rounded-lg bg-primary-600 px-3.5 py-2 text-sm text-white font-semibold transition hover:bg-primary-700 disabled:opacity-50"
          :disabled="busy"
          @click="save"
        >
          {{ tt('actions.save') }}
        </button>
        <button
          type="button"
          class="border border-neutral-300 rounded-lg px-3.5 py-2 text-sm text-neutral-700 font-medium transition dark:border-neutral-600 hover:bg-neutral-100 dark:text-neutral-200 disabled:opacity-50 dark:hover:bg-neutral-700"
          :disabled="busy || !canTest()"
          @click="testConnection"
        >
          {{ tt('actions.test') }}
        </button>
        <button
          type="button"
          class="rounded-lg px-3.5 py-2 text-sm text-neutral-400 font-medium transition dark:text-neutral-500 hover:text-red-600 disabled:opacity-50"
          :disabled="busy || !providerId"
          @click="removeProvider"
        >
          {{ tt('actions.remove') }}
        </button>
        <button
          v-if="!props.embedded"
          type="button"
          class="ml-auto border border-neutral-300 rounded-lg px-3.5 py-2 text-sm text-neutral-700 font-medium transition dark:border-neutral-600 hover:bg-neutral-100 dark:text-neutral-200 disabled:opacity-50 dark:hover:bg-neutral-700"
          :disabled="busy"
          @click="emit('back')"
        >
          {{ tt('actions.back') }}
        </button>
      </template>
    </div>
  </div>
</template>
