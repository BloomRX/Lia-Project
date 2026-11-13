<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { pickVoiceEngineLocale } from '../voice-engine-strings'

/**
 * Configuration (Phase 7.1, item 5): the four product domains - IA,
 * Personalidade, Voz e Aparência - EDITABLE, persisting into the ONE
 * canonical product document through the Lia Core writer. Secrets ride a
 * separate rail: the typed key goes to the encrypted vault and never to
 * the JSON (item L), and no AIRI-private file is ever touched.
 */
const props = defineProps<{ api: any, status: any, language?: string }>()

const config = ref<{ filePath: string, snapshot: any, status: string } | undefined>(undefined)
const form = reactive({
  activeCardId: '',
  apiKey: '',
  language: '',
  modelId: '',
  providerId: '',
  voiceId: '',
  voiceProviderId: '',
})
const saving = ref(false)
const feedback = ref<'saved' | 'failed' | 'loadFailed' | 'managedSelection' | 'staleSelection' | 'selectionReadFailed' | ''>('')
const loading = ref(true)
const readable = computed(() => config.value?.status === 'missing' || (config.value?.status === 'ok' && !!config.value.snapshot && typeof config.value.snapshot === 'object' && !Array.isArray(config.value.snapshot)))
const text = computed(() => pickVoiceEngineLocale(props.language ?? config.value?.snapshot?.preferences?.language) === 'en-US'
  ? {
      title: 'Settings',
      document: 'Configuration file',
      ai: 'AI',
      service: 'AI service',
      servicePlaceholder: 'service identifier',
      model: 'Model',
      modelPlaceholder: 'e.g. a model offered by the service',
      key: 'API key',
      keyStored: 'a key is already stored',
      keyMissing: 'no key stored yet',
      keyPlaceholder: 'enter to replace; stored only in the vault',
      keyNote: 'The key is never written to the file — it stays encrypted in the system vault.',
      personality: 'Personality',
      activeCard: 'Active card',
      voice: 'Voice',
      voiceService: 'Preferred voice service',
      voiceServicePlaceholder: 'voice service identifier',
      voiceId: 'Voice identifier',
      voicePlaceholder: 'e.g. the identifier of an imported voice',
      appearance: 'Appearance',
      language: 'Product language',
      defaultLanguage: 'Default (Portuguese)',
      languageNote: 'Choose the language used by the Launcher. Other screens may still have untranslated content.',
      save: 'Save configuration',
      saving: 'Saving…',
      saved: 'Configuration saved. New conversations will use these settings.',
      failed: 'Could not save the configuration. Try again.',
      managedSelection: 'This AI service is managed by AI Settings. Open AI Settings to change it.',
      staleSelection: 'The AI selection changed while this screen was open. Reload before saving.',
      selectionReadFailed: 'The saved AI selection could not be checked. Reload and try again.',
      loadFailed: 'Could not load the configuration. Try again.',
      loading: 'Loading configuration…',
      retry: 'Try again',
    }
  : {
      title: 'Configuração',
      document: 'Arquivo de configuração',
      ai: 'IA',
      service: 'Serviço de IA',
      servicePlaceholder: 'identificador do serviço',
      model: 'Modelo',
      modelPlaceholder: 'ex.: modelo oferecido pelo serviço',
      key: 'Chave de API',
      keyStored: 'uma chave já está guardada',
      keyMissing: 'nenhuma guardada ainda',
      keyPlaceholder: 'digite para trocar; fica só no cofre',
      keyNote: 'A chave nunca vai para o arquivo — ela fica criptografada no cofre do sistema.',
      personality: 'Personalidade',
      activeCard: 'Cartão ativo',
      voice: 'Voz',
      voiceService: 'Serviço de voz preferido',
      voiceServicePlaceholder: 'identificador do serviço de voz',
      voiceId: 'Identificador da voz',
      voicePlaceholder: 'ex.: identificador da voz importada',
      appearance: 'Aparência',
      language: 'Idioma do produto',
      defaultLanguage: 'Padrão (Português)',
      languageNote: 'Escolha o idioma usado pelo Launcher. Outras telas ainda podem ter conteúdo sem tradução.',
      save: 'Salvar configuração',
      saving: 'Salvando…',
      saved: 'Configuração salva. Novas conversas usarão estes valores.',
      failed: 'Não foi possível salvar a configuração. Tente novamente.',
      managedSelection: 'Este serviço de IA é gerenciado pelas Configurações de IA. Abra essa tela para alterá-lo.',
      staleSelection: 'A seleção de IA mudou enquanto esta tela estava aberta. Recarregue antes de salvar.',
      selectionReadFailed: 'Não foi possível verificar a seleção de IA salva. Recarregue e tente novamente.',
      loadFailed: 'Não foi possível carregar a configuração. Tente novamente.',
      loading: 'Carregando configuração…',
      retry: 'Tentar novamente',
    })

async function reload() {
  config.value = undefined
  const loaded = await props.api?.productConfig?.()
  if (loaded?.status === 'missing') {
    // A new profile may explicitly create its first configuration.
    config.value = { ...loaded, snapshot: {} }
  }
  else {
    if (loaded?.status !== 'ok' || !loaded.snapshot || typeof loaded.snapshot !== 'object' || Array.isArray(loaded.snapshot)) {
      throw new Error('Configuration unavailable')
    }
    config.value = loaded
  }
  const snapshot = config.value?.snapshot ?? {}
  form.providerId = snapshot?.provider?.chat?.preferred?.providerId ?? ''
  form.modelId = snapshot?.provider?.chat?.preferred?.modelId ?? ''
  form.apiKey = ''
  form.activeCardId = snapshot?.persona?.activeCardId ?? ''
  form.voiceProviderId = snapshot?.voice?.tts?.preferred?.providerId ?? ''
  form.voiceId = snapshot?.voice?.tts?.preferred?.voiceId ?? ''
  form.language = snapshot?.preferences?.language ?? ''
  feedback.value = ''
}

async function load() {
  loading.value = true
  try {
    await reload()
  }
  catch {
    feedback.value = 'loadFailed'
  }
  finally {
    loading.value = false
  }
}

onMounted(load)

async function save() {
  if (!readable.value || loading.value || saving.value)
    return
  saving.value = true
  feedback.value = ''
  try {
    const secrets = form.apiKey && form.providerId
      ? [{ key: 'apiKey', scope: form.providerId, value: form.apiKey }]
      : []
    const currentPreferred = config.value?.snapshot?.provider?.chat?.preferred
    const expectedPreferred = currentPreferred?.providerId
      ? {
          providerId: currentPreferred.providerId,
          ...(typeof currentPreferred.modelId === 'string' ? { modelId: currentPreferred.modelId } : {}),
        }
      : null
    const result = await props.api.updateConfig({
      expectedPreferred,
      secrets,
      update: {
        persona: form.activeCardId ? { activeCardId: form.activeCardId } : undefined,
        preferences: { language: form.language || 'pt-BR' },
        provider: form.providerId
          ? { chat: { preferred: { modelId: form.modelId || undefined, providerId: form.providerId } } }
          : undefined,
        voice: form.voiceProviderId
          ? { tts: { preferred: { providerId: form.voiceProviderId, voiceId: form.voiceId || undefined } } }
          : undefined,
      },
    })
    if (result?.status === 'ok') {
      await reload()
      feedback.value = 'saved'
      // The key field empties after saving: it lives in the vault now.
      form.apiKey = ''
    }
    else if (result?.status === 'selection-owned-by-launcher' || result?.status === 'managed-credential-owned-by-ai-settings') {
      feedback.value = 'managedSelection'
    }
    else if (result?.status === 'stale-selection') {
      feedback.value = 'staleSelection'
    }
    else if (result?.status === 'selection-read-failed') {
      feedback.value = 'selectionReadFailed'
    }
    else {
      feedback.value = 'failed'
    }
  }
  catch {
    feedback.value = readable.value ? 'failed' : 'loadFailed'
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="config">
    <h2>{{ text.title }}</h2>
    <p v-if="loading" role="status">
      {{ text.loading }}
    </p>
    <p v-else-if="!readable" role="alert">
      {{ text.loadFailed }} <button type="button" @click="load">
        {{ text.retry }}
      </button>
    </p>
    <p v-if="readable" class="dim">
      {{ text.document }}: <code>{{ config?.filePath }}</code>
    </p>

    <form v-if="!loading && readable" class="cards" @submit.prevent="save">
      <div class="card">
        <h3>{{ text.ai }}</h3>
        <label class="field">
          {{ text.service }}
          <input v-model="form.providerId" :placeholder="text.servicePlaceholder" spellcheck="false">
        </label>
        <label class="field">
          {{ text.model }}
          <input v-model="form.modelId" :placeholder="text.modelPlaceholder" spellcheck="false">
        </label>
        <label class="field">
          {{ text.key }} <span class="dim">({{ status?.ai?.ready ? text.keyStored : text.keyMissing }})</span>
          <input v-model="form.apiKey" autocomplete="off" :placeholder="text.keyPlaceholder" type="password">
        </label>
        <p class="dim field-note">
          {{ text.keyNote }}
        </p>
      </div>

      <div class="card">
        <h3>{{ text.personality }}</h3>
        <label class="field">
          {{ text.activeCard }}
          <input v-model="form.activeCardId" placeholder="lia-default" spellcheck="false">
        </label>
      </div>

      <div class="card">
        <h3>{{ text.voice }}</h3>
        <label class="field">
          {{ text.voiceService }}
          <input v-model="form.voiceProviderId" :placeholder="text.voiceServicePlaceholder" spellcheck="false">
        </label>
        <label class="field">
          {{ text.voiceId }}
          <input v-model="form.voiceId" :placeholder="text.voicePlaceholder" spellcheck="false">
        </label>
      </div>

      <div class="card">
        <h3>{{ text.appearance }}</h3>
        <label class="field">
          {{ text.language }}
          <select v-model="form.language">
            <option value="">
              {{ text.defaultLanguage }}
            </option>
            <option value="pt-BR">
              Português (Brasil)
            </option>
            <option value="en-US">
              English (US)
            </option>
            <option value="es">
              Español
            </option>
          </select>
        </label>
        <p class="dim field-note">
          {{ text.languageNote }}
        </p>
      </div>

      <div class="actions">
        <button :disabled="saving" type="submit">
          {{ saving ? text.saving : text.save }}
        </button>
        <span v-if="feedback" class="feedback" role="status">{{ text[feedback] }}</span>
      </div>
    </form>
  </section>
</template>

<style scoped>
.config { display: flex; flex-direction: column; gap: 14px; }
h2 { margin: 0 0 6px; }
h3 { margin: 0 0 12px; }
.cards { display: flex; flex-direction: column; gap: 14px; }
.dim { color: var(--lia-text-dim); }
code { color: var(--lia-magenta); font-size: 12px; word-break: break-all; }
.badge { border: 1px solid var(--lia-border); border-radius: 6px; font-size: 11px; margin-left: 8px; padding: 2px 8px; }
.field { display: flex; flex-direction: column; font-size: 13px; gap: 6px; margin-bottom: 10px; }
.field input, .field select {
  background: var(--lia-input, #171221);
  border: 1px solid var(--lia-border);
  border-radius: 8px;
  color: inherit;
  padding: 8px 10px;
}
.field-note { font-size: 12px; margin: 0; }
.actions { align-items: center; display: flex; gap: 12px; }
.feedback { font-size: 13px; }
</style>
