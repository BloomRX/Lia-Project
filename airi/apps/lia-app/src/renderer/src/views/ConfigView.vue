<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'

/**
 * Configuration (Phase 7.1, item 5): the four product domains - IA,
 * Personalidade, Voz e Aparência - EDITABLE, persisting into the ONE
 * canonical product document through the Lia Core writer. Secrets ride a
 * separate rail: the typed key goes to the encrypted vault and never to
 * the JSON (item L), and no AIRI-private file is ever touched.
 */
const props = defineProps<{ api: any, status: any }>()

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
const feedback = ref('')

async function reload() {
  config.value = await props.api?.productConfig?.()
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

onMounted(reload)

async function save() {
  saving.value = true
  feedback.value = ''
  try {
    const secrets = form.apiKey && form.providerId
      ? [{ key: 'apiKey', scope: form.providerId, value: form.apiKey }]
      : []
    const result = await props.api.updateConfig({
      secrets,
      update: {
        persona: form.activeCardId ? { activeCardId: form.activeCardId } : undefined,
        preferences: form.language ? { language: form.language } : undefined,
        provider: form.providerId
          ? { chat: { preferred: { modelId: form.modelId || undefined, providerId: form.providerId } } }
          : undefined,
        voice: form.voiceProviderId
          ? { tts: { preferred: { providerId: form.voiceProviderId, voiceId: form.voiceId || undefined } } }
          : undefined,
      },
    })
    if (result?.status === 'ok') {
      feedback.value = 'Configuração salva. O stage usa estes valores na próxima vez que abrir.'
      await reload()
      // The key field empties after saving: it lives in the vault now.
      form.apiKey = ''
    }
    else {
      feedback.value = `Não foi possível salvar: ${result?.message ?? result?.status ?? 'erro desconhecido'}`
    }
  }
  catch (error) {
    feedback.value = `Não foi possível salvar: ${String(error)}`
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="config">
    <h2>Configuração</h2>
    <p class="dim">
      Documento canônico: <code>{{ config?.filePath }}</code>
      <span class="badge">{{ config?.status }}</span>
    </p>

    <form class="cards" @submit.prevent="save">
      <div class="card">
        <h3>IA</h3>
        <label class="field">
          Provedor preferido
          <input v-model="form.providerId" placeholder="openrouter" spellcheck="false">
        </label>
        <label class="field">
          Modelo
          <input v-model="form.modelId" placeholder="ex.: anthropic/claude-sonnet-4" spellcheck="false">
        </label>
        <label class="field">
          Chave de API <span class="dim">({{ status?.ai?.ready ? 'uma chave já está guardada' : 'nenhuma guardada ainda' }})</span>
          <input v-model="form.apiKey" autocomplete="off" placeholder="digite para trocar; fica só no cofre" type="password">
        </label>
        <p class="dim field-note">
          A chave nunca vai para o arquivo — ela fica criptografada no cofre do sistema.
        </p>
      </div>

      <div class="card">
        <h3>Personalidade</h3>
        <label class="field">
          Cartão ativo
          <input v-model="form.activeCardId" placeholder="lia-default" spellcheck="false">
        </label>
      </div>

      <div class="card">
        <h3>Voz</h3>
        <label class="field">
          Provedor de voz preferido
          <input v-model="form.voiceProviderId" placeholder="cloud-voice-provider ou custom-local-voice" spellcheck="false">
        </label>
        <label class="field">
          Identificador da voz
          <input v-model="form.voiceId" placeholder="ex.: nova ou o id da voz importada" spellcheck="false">
        </label>
      </div>

      <div class="card">
        <h3>Aparência</h3>
        <label class="field">
          Idioma do produto
          <select v-model="form.language">
            <option value="">
              herdar do sistema
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
          O tema visual da Lia segue o documento canônico — hoje o schema guarda apenas o idioma;
          campos visuais do AIRI não são copiados para cá.
        </p>
      </div>

      <div class="actions">
        <button :disabled="saving" type="submit">
          {{ saving ? 'Salvando…' : 'Salvar configuração' }}
        </button>
        <span v-if="feedback" class="feedback">{{ feedback }}</span>
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
