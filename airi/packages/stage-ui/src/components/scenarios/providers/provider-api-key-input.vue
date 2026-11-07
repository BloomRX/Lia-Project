<script setup lang="ts">
import { FieldInput } from '@proj-airi/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { getProviderCredentialConfigPort } from '../../../stores/providers/credential-config-port'

const props = defineProps<{
  providerId?: string
  providerName?: string
  placeholder?: string
  required?: boolean
  label?: string
  description?: string
}>()

const emit = defineEmits<{ configured: [value: boolean] }>()
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'en': { credential: { save: 'Save key', saving: 'Saving key…', configured: 'Key saved', missing: 'No key saved', error: 'Could not save the key. Try again.', checking: 'Checking saved key…', checkError: 'Could not check the saved key. Reopen settings to try again.' } },
    'pt-BR': { credential: { save: 'Salvar chave', saving: 'Salvando chave…', configured: 'Chave salva', missing: 'Nenhuma chave salva', error: 'Não foi possível salvar a chave. Tente novamente.', checking: 'Verificando chave salva…', checkError: 'Não foi possível verificar a chave salva. Abra as configurações novamente para tentar.' } },
  },
})

const modelValue = defineModel<string>({ required: false, default: '' })
const credentialPort = computed(() => props.providerId ? getProviderCredentialConfigPort(props.providerId) : undefined)
const draft = ref('')
const configured = ref(false)
const saving = ref(false)
const checking = ref(false)
const status = ref<'ready' | 'error' | 'checkError'>('ready')
let generation = 0
let disposed = false

watch(() => props.providerId, async (providerId) => {
  const current = ++generation
  draft.value = ''
  saving.value = false
  checking.value = false
  configured.value = false
  status.value = 'ready'
  const port = credentialPort.value
  if (!port || !providerId)
    return
  emit('configured', false)
  checking.value = true
  try {
    const has = await port.has(providerId)
    if (disposed || current !== generation)
      return
    configured.value = has
    emit('configured', has)
  }
  catch {
    if (!disposed && current === generation)
      status.value = 'checkError'
  }
  finally {
    if (!disposed && current === generation)
      checking.value = false
  }
}, { immediate: true })

async function saveCredential() {
  const port = credentialPort.value
  const providerId = props.providerId
  if (!port || !providerId || !draft.value || saving.value)
    return
  const current = ++generation
  saving.value = true
  status.value = 'ready'
  try {
    const result = port.save(providerId, draft.value)
    draft.value = ''
    if (!await result)
      throw new Error('Credential not saved')
    if (disposed || current !== generation)
      return
    configured.value = true
    emit('configured', true)
  }
  catch {
    if (!disposed && current === generation)
      status.value = 'error'
  }
  finally {
    if (!disposed && current === generation) {
      draft.value = ''
      saving.value = false
      checking.value = false
    }
  }
}

onBeforeUnmount(() => {
  disposed = true
  generation++
  draft.value = ''
})

const computedDescription = computed(() => {
  if (props.description)
    return props.description
  if (props.providerName)
    return `API Key for ${props.providerName}`
  return t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description')
})
</script>

<template>
  <div v-if="credentialPort" class="flex flex-col gap-2">
    <FieldInput
      v-model="draft"
      :label="label || t('settings.pages.providers.common.fields.field.api-key.label')"
      :description="computedDescription"
      :placeholder="placeholder"
      :required="required"
      :disabled="saving"
      input-class="min-h-10 w-full rounded-lg border-2 border-solid border-neutral-400 bg-neutral-50 px-3 py-2 text-neutral-900 dark:border-neutral-500 dark:bg-neutral-900 dark:text-neutral-100"
      type="password"
      autocomplete="new-password"
      @keydown.enter.prevent="saveCredential"
    />
    <button
      type="button"
      class="self-start rounded-lg bg-primary-500/20 px-3 py-2 disabled:opacity-50"
      :disabled="saving || checking || !draft"
      @click="saveCredential"
    >
      {{ t(saving ? 'credential.saving' : 'credential.save') }}
    </button>
    <p role="status" aria-live="polite" class="text-sm">
      {{ t(status !== 'ready' ? `credential.${status}` : checking ? 'credential.checking' : configured ? 'credential.configured' : 'credential.missing') }}
    </p>
  </div>
  <FieldInput
    v-else
    v-model="modelValue"
    :label="label || t('settings.pages.providers.common.fields.field.api-key.label')"
    :description="computedDescription"
    :placeholder="placeholder"
    :required="required"
    type="password"
  />
</template>
