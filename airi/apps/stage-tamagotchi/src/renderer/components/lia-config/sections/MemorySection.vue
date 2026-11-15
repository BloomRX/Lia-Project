<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { LIA_MEMORY_LIMITS } from '../../../../shared/eventa/lia-memory'
import { useLiaMemoryStore } from '../../../stores/lia/memory'

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      enabled: 'Usar minhas lembranças nas conversas',
      privacy: 'Desativado por padrão. Você escolhe o que guardar neste computador. Ao ativar, lembranças relacionadas à conversa podem ser enviadas ao serviço de IA configurado. Não salve senhas ou informações sensíveis.',
      manual: 'Só o que você adicionar aqui é guardado. Desativar interrompe o uso, mas mantém as lembranças para você revisar ou apagar. O histórico de conversas é separado.',
      loading: 'Carregando lembranças…',
      retry: 'Tentar novamente',
      error: 'Não foi possível acessar ou salvar as lembranças. Seus dados anteriores foram preservados.',
      limit: 'O limite de lembranças foi atingido. Apague uma antes de adicionar outra.',
      label: 'O que você quer que a Lia lembre?',
      placeholder: 'Ex.: Gosto de jogos de estratégia.',
      add: 'Guardar lembrança',
      save: 'Salvar alteração',
      saving: 'Salvando…',
      cancel: 'Cancelar',
      edit: 'Editar',
      remove: 'Apagar',
      empty: 'Nenhuma lembrança guardada. Você decide o que adicionar.',
      clear: 'Apagar todas',
      confirm: 'Apagar todas as lembranças deste computador? Essa ação não pode ser desfeita.',
      yes: 'Sim, apagar todas',
      success: 'Lembranças atualizadas.',
      count: '{count} de {max} lembranças',
    },
    'en': {
      enabled: 'Use my memories in conversations',
      privacy: 'Off by default. You choose what to save on this computer. When enabled, memories related to the conversation may be sent to your configured AI service. Do not save passwords or sensitive information.',
      manual: 'Only what you add here is saved. Turning this off stops their use but keeps memories for review or deletion. Chat history is separate.',
      loading: 'Loading memories…',
      retry: 'Try again',
      error: 'Could not access or save memories. Your previous data was preserved.',
      limit: 'Memory limit reached. Delete one before adding another.',
      label: 'What would you like Lia to remember?',
      placeholder: 'E.g. I enjoy strategy games.',
      add: 'Save memory',
      save: 'Save changes',
      saving: 'Saving…',
      cancel: 'Cancel',
      edit: 'Edit',
      remove: 'Delete',
      empty: 'No saved memories. You decide what to add.',
      clear: 'Delete all',
      confirm: 'Delete all memories from this computer? This cannot be undone.',
      yes: 'Yes, delete all',
      success: 'Memories updated.',
      count: '{count} of {max} memories',
    },
  },
})
const memory = useLiaMemoryStore()
const draft = ref('')
const editing = ref<string>()
const confirming = ref(false)
const success = ref(false)
const disabled = computed(() => memory.loading || memory.busy || !memory.loaded)
onMounted(() => memory.load())

async function submit() {
  success.value = false
  if (await memory.saveEntry(draft.value, editing.value)) {
    draft.value = ''
    editing.value = undefined
    success.value = true
  }
}
async function toggle(event: Event) {
  const checkbox = event.target as HTMLInputElement
  success.value = await memory.setEnabled(checkbox.checked)
  checkbox.checked = memory.state.enabled
}
async function remove(id: string) {
  success.value = await memory.removeEntry(id)
  if (success.value && editing.value === id) {
    draft.value = ''
    editing.value = undefined
  }
}
async function clear() {
  success.value = await memory.clear(true)
  if (success.value) {
    confirming.value = false
    draft.value = ''
    editing.value = undefined
  }
}
</script>

<template>
  <div class="flex flex-col gap-4" data-testid="lia-memory-section">
    <p class="text-sm text-neutral-600 dark:text-neutral-300">
      {{ t('privacy') }}
    </p>
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      {{ t('manual') }}
    </p>
    <p v-if="memory.loading" role="status">
      {{ t('loading') }}
    </p>
    <div v-if="memory.error" role="alert" class="text-sm text-red-600 dark:text-red-300">
      {{ t(memory.error === 'limit' ? 'limit' : 'error') }}
      <button type="button" class="ml-2 underline" :disabled="memory.loading || memory.busy" @click="memory.load()">
        {{ t('retry') }}
      </button>
    </div>
    <label class="flex items-center gap-2 text-sm">
      <input type="checkbox" :checked="memory.state.enabled" :disabled="disabled" @change="toggle">
      {{ t('enabled') }}
    </label>
    <form class="flex flex-col gap-2" @submit.prevent="submit">
      <label for="lia-memory-draft" class="text-sm font-medium">{{ t('label') }}</label>
      <textarea id="lia-memory-draft" v-model="draft" :maxlength="LIA_MEMORY_LIMITS.text" :disabled="disabled" :placeholder="t('placeholder')" rows="3" class="w-full border border-neutral-300 rounded-lg bg-transparent p-3 text-sm dark:border-neutral-600" />
      <div class="flex items-center gap-3">
        <button type="submit" :disabled="disabled || !draft.trim() || (!editing && memory.state.entries.length >= LIA_MEMORY_LIMITS.entries)" class="rounded-lg bg-primary-500 px-3 py-2 text-sm text-white disabled:opacity-50">
          {{ t(memory.busy ? 'saving' : editing ? 'save' : 'add') }}
        </button>
        <button v-if="editing" type="button" class="text-sm underline" :disabled="memory.busy" @click="editing = undefined; draft = ''">
          {{ t('cancel') }}
        </button>
      </div>
    </form>
    <p v-if="success && !memory.error" role="status" class="text-sm text-green-700 dark:text-green-300">
      {{ t('success') }}
    </p>
    <p class="text-xs text-neutral-500">
      {{ t('count', { count: memory.state.entries.length, max: LIA_MEMORY_LIMITS.entries }) }}
    </p>
    <p v-if="memory.loaded && !memory.state.entries.length" class="text-sm text-neutral-500">
      {{ t('empty') }}
    </p>
    <ul class="flex flex-col gap-2">
      <li v-for="entry in memory.state.entries" :key="entry.id" class="border border-neutral-200 rounded-lg p-3 dark:border-neutral-700">
        <p class="whitespace-pre-wrap break-words text-sm">
          {{ entry.text }}
        </p>
        <div class="mt-2 flex gap-3 text-xs">
          <button type="button" :disabled="disabled" class="underline" @click="editing = entry.id; draft = entry.text; success = false">
            {{ t('edit') }}
          </button>
          <button type="button" :disabled="disabled" class="text-red-600 underline dark:text-red-300" @click="remove(entry.id)">
            {{ t('remove') }}
          </button>
        </div>
      </li>
    </ul>
    <button v-if="memory.state.entries.length && !confirming" type="button" class="self-start text-sm text-red-600 underline dark:text-red-300" :disabled="disabled" @click="confirming = true">
      {{ t('clear') }}
    </button>
    <div v-if="confirming" role="group" :aria-label="t('confirm')" class="border border-red-300 rounded-lg p-3">
      <p class="mb-3 text-sm">
        {{ t('confirm') }}
      </p>
      <div class="flex gap-3 text-sm">
        <button type="button" class="text-red-600 underline dark:text-red-300" :disabled="disabled" @click="clear">
          {{ t('yes') }}
        </button>
        <button type="button" class="underline" :disabled="memory.busy" @click="confirming = false">
          {{ t('cancel') }}
        </button>
      </div>
    </div>
  </div>
</template>
