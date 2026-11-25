<script setup lang="ts">
import { onMounted, ref } from 'vue'

import LiaButton from '../components/lia/LiaButton.vue'
import LiaPanel from '../components/lia/LiaPanel.vue'
import VoiceEngineCard from '../components/VoiceEngineCard.vue'

/**
 * Voice page (migrated to the Lia design system in 8.0A-4, over the Phase
 * 7.1 behavior): ready-made voice vs. own voice, the local voice system's
 * location, import via the OS picker, and the ACTIVE profile - all reusing
 * the Lia Core voice behaviors. Zero storage duplication: the library
 * registry stays the single source of truth.
 *
 * Phase 7.9G: the Voice Engine card (install state, one install action,
 * selection) sits ABOVE the kind choice - the selected engine is a
 * product-level surface, independent from the ready/custom kind below.
 * Same 7.9F model, rendered engine-neutral.
 *
 * 8.0A-4 is visual only: same actions and state sources, now on LiaPanel /
 * LiaButton + semantic tokens. Implementation detail (raw phase names,
 * folder paths) stays OUT of the normal surface; the one technical
 * leftover (library location) remains collapsed behind the Advanced
 * disclosure, exactly as before.
 */
const props = defineProps<{ api: any, status: any }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

const profiles = ref<any[]>([])
const advanced = ref(false)
const kind = ref<'custom' | 'ready'>('ready')
const busy = ref(false)
const feedback = ref('')
const importName = ref('')
const runtimeLocation = ref<any>(undefined)
const speech = ref({ baseUrl: '', modelId: '', voiceId: '', apiKey: '', hasKey: false })
const speechBusy = ref(false)
const speechFeedback = ref('')
const localSpeech = ref<{ voices: string[], active: boolean, voiceId: string }>({ voices: [], active: false, voiceId: '' })
const voiceLabels: Record<string, string> = { pf_dora: 'Dora', pm_alex: 'Alex', pm_santa: 'Santa' }

async function loadLocalSpeech() {
  try {
    const options = await props.api?.localSpeechOptions?.()
    if (!options)
      throw new Error('local-speech-options')
    localSpeech.value = options
  }
  catch {
    feedback.value = 'Não foi possível carregar as vozes locais.'
  }
}

const transcription = ref({ baseUrl: '', modelId: '', apiKey: '', hasKey: false, local: false })
const transcriptionBusy = ref(false)
const transcriptionFeedback = ref('')

async function loadTranscription(local?: boolean) {
  const connection = await props.api?.transcriptionConnection?.(local)
  if (connection)
    transcription.value = { ...connection, apiKey: '' }
}

async function changeTranscriptionMode() {
  transcriptionBusy.value = true
  transcriptionFeedback.value = ''
  const { local } = transcription.value
  transcription.value = { local, baseUrl: '', modelId: '', apiKey: '', hasKey: false }
  try {
    await loadTranscription(local)
  }
  finally {
    transcriptionBusy.value = false
  }
}

async function saveTranscription() {
  transcriptionBusy.value = true
  transcriptionFeedback.value = ''
  try {
    const { baseUrl, modelId, apiKey, local } = transcription.value
    const saved = await props.api?.transcriptionConnectionSave?.({ baseUrl, modelId, local, ...(!local && apiKey ? { apiKey } : {}) })
    if (!saved)
      throw new Error('transcription-save')
    await loadTranscription()
    transcriptionFeedback.value = 'Reconhecimento de fala selecionado.'
  }
  catch {
    transcriptionFeedback.value = 'Não foi possível salvar o reconhecimento de fala. Confira os campos e encerre a conversa antes de tentar novamente.'
  }
  finally {
    transcription.value.apiKey = ''
    transcriptionBusy.value = false
  }
}

async function loadSpeech() {
  const connection = await props.api?.speechConnection?.()
  if (connection)
    speech.value = { ...connection, apiKey: '' }
}

async function saveSpeech() {
  speechBusy.value = true
  speechFeedback.value = ''
  try {
    const { baseUrl, modelId, voiceId, apiKey } = speech.value
    if (!await props.api?.speechConnectionSave?.({ baseUrl, modelId, voiceId, ...(apiKey ? { apiKey } : {}) }))
      throw new Error('speech-save')
    await Promise.all([loadSpeech(), loadLocalSpeech()])
    speechFeedback.value = 'Síntese compatível selecionada.'
  }
  catch {
    speechFeedback.value = 'Não foi possível salvar a síntese. Confira os campos e encerre a conversa antes de tentar novamente.'
  }
  finally {
    speech.value.apiKey = ''
    speechBusy.value = false
  }
}

async function useLocalSpeech(fromSettings = false) {
  const notice = fromSettings ? speechFeedback : feedback
  speechBusy.value = true
  try {
    const saved = await props.api?.useLocalSpeech?.(localSpeech.value.voiceId || undefined)
    if (saved)
      await loadLocalSpeech()
    notice.value = saved ? 'Motor local selecionado.' : 'Não foi possível selecionar o motor local.'
  }
  catch {
    notice.value = 'Não foi possível selecionar o motor local.'
  }
  finally {
    speechBusy.value = false
  }
}

async function reload() {
  profiles.value = await props.api?.listVoices?.() ?? []
  feedback.value = ''
}

async function reloadLocation() {
  runtimeLocation.value = await props.api?.runtimeLocation?.() ?? undefined
}

onMounted(async () => {
  await Promise.all([loadSpeech(), loadTranscription()])
  await reload()
  await loadLocalSpeech()
  await reloadLocation()
  const preferred = (await props.api?.productConfig?.())?.snapshot?.voice?.tts?.preferred
  kind.value = preferred?.providerId === 'custom-local-voice' ? 'custom' : 'ready'
})

async function changeLocation() {
  busy.value = true
  feedback.value = ''
  try {
    const result = await props.api.pickRuntimeLocation()
    if (result?.status === 'ok') {
      feedback.value = 'Novo local definido. Se o sistema de voz já estava instalado em outra pasta, o novo local valerá para uma futura instalação — nada foi movido.'
      await reloadLocation()
    }
    else if (result?.status === 'rejected') {
      feedback.value = result.message ?? 'Esse local não pôde ser usado.'
    }
    // 'canceled' is a normal outcome: nothing changes.
  }
  finally {
    busy.value = false
  }
}

async function resetLocation() {
  busy.value = true
  feedback.value = ''
  try {
    await props.api.clearRuntimeLocation()
    await reloadLocation()
    feedback.value = 'Local padrão restaurado.'
  }
  finally {
    busy.value = false
  }
}

async function removeVoice(id: string) {
  if (busy.value)
    return
  busy.value = true
  feedback.value = ''
  try {
    const result = await props.api.removeVoice(id)
    if (result === 'removed') {
      await reload()
      feedback.value = 'Voz removida da biblioteca.'
    }
    else if (result !== 'cancelled') {
      feedback.value = 'Não foi possível remover a voz. Encerre a conversa e tente novamente.'
    }
  }
  catch {
    feedback.value = 'Não foi possível remover a voz.'
  }
  finally {
    busy.value = false
  }
}

async function importVoice() {
  busy.value = true
  feedback.value = ''
  try {
    const paths = await props.api.pickVoiceFiles()
    if (!paths?.length) {
      feedback.value = 'Nenhum arquivo escolhido.'
      return
    }
    const name = importName.value.trim() || 'Minha voz'
    const result = await props.api.importVoice({
      // No engine id: the core defers the import cleanly until a modular
      // voice engine is hosted here.
      name,
      // Cloning-style import: the file IS the reference audio.
      sources: paths.map((path: string) => ({ path, role: 'referenceAudio' })),
    })
    if (result?.ok) {
      feedback.value = `"${result.value.name}" importada para a biblioteca.`
      importName.value = ''
      await reload()
    }
    else {
      feedback.value = `Não foi possível importar: ${result?.message ?? result?.error ?? 'erro desconhecido'}`
    }
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="voice">
    <!-- 8.0A-4 page header: product words, no implementation jargon. -->
    <header class="voice-header">
      <h2>Voz</h2>
      <p class="voice-intro">
        Escolha como a Lia fala com você.
      </p>
    </header>

    <!--
      Phase 7.9G finalize: the Voice Engine card IS the product's selected
      voice-engine surface - independent from the ready/custom voice-kind
      choice below. It appears ALWAYS, exactly once, before every
      kind-specific section.
    -->
    <VoiceEngineCard v-if="props.api" :api="props.api" @changed="emit('refresh')" />

    <div class="choices">
      <label class="choice" :class="{ active: kind === 'ready' }" @click="kind = 'ready'">
        <input v-model="kind" type="radio" value="ready">
        <strong>Síntese no Stage</strong>
        <span class="dim">motor local ou serviço HTTPS configurado</span>
      </label>
      <label class="choice" :class="{ active: kind === 'custom' }" @click="kind = 'custom'">
        <input v-model="kind" type="radio" value="custom">
        <strong>Minha própria voz</strong>
        <span class="dim">biblioteca de perfis importados</span>
      </label>
    </div>

    <template v-if="kind === 'custom'">
      <LiaPanel>
        <h3>Sistema de voz</h3>
        <!-- Location preference: the actions are preserved exactly; the
             normal surface names the choice in product words only. -->
        <div class="location-row">
          <span v-if="runtimeLocation?.customActive" class="badge">local personalizado</span>
          <span v-else class="dim">local padrão da Lia</span>
          <span class="location-actions">
            <LiaButton :disabled="busy" @click="changeLocation">
              Alterar local
            </LiaButton>
            <LiaButton v-if="runtimeLocation?.customActive" :disabled="busy" @click="resetLocation">
              Usar o padrão
            </LiaButton>
          </span>
        </div>
        <p class="dim field-note">
          O local vale para o sistema de voz inteiro (programa, ambiente e modelos — vários GB).
          Alterar o local não move uma instalação existente.
        </p>
      </LiaPanel>

      <LiaPanel>
        <h3>Suas vozes importadas</h3>
        <p v-if="!profiles.length" class="dim">
          Nenhuma voz importada ainda.
        </p>
        <ul v-else class="profile-list">
          <li v-for="p in profiles" :key="p.id" class="profile-row">
            <span class="profile-name">{{ p.name }}</span>
            <span class="dim profile-meta">({{ p.engine || 'desconhecido' }}, {{ p.files?.length ?? 0 }} arquivo(s))</span>
            <LiaButton :disabled="busy" :aria-label="`Remover voz ${p.name}`" @click="removeVoice(p.id)">
              Remover voz
            </LiaButton>
          </li>
        </ul>
        <div class="import-row">
          <input v-model="importName" class="name" placeholder="Nome da nova voz (opcional)">
          <LiaButton variant="primary" :disabled="busy" @click="importVoice">
            {{ busy ? 'Aguarde…' : 'Importar voz' }}
          </LiaButton>
        </div>
        <p class="dim field-note">
          Os arquivos são copiados para a biblioteca canônica da Lia — nada é duplicado em outra pasta.
          O Stage atual ainda não usa perfis importados para sintetizar respostas.
        </p>
      </LiaPanel>

      <!-- The ONLY technical detail left on the page stays collapsed
           behind its disclosure, exactly as before 8.0A-4. -->
      <div class="advanced">
        <button class="advanced-toggle" @click="advanced = !advanced">
          Avançado {{ advanced ? '▾' : '▸' }}
        </button>
        <p v-if="advanced" class="dim advanced-body">
          Biblioteca canônica: <code>{{ status?.paths?.voicesRoot }}</code>
        </p>
      </div>
    </template>

    <LiaPanel v-else>
      <h3>Síntese no Stage</h3>
      <p class="dim">
        Use o motor local instalado ou configure um serviço HTTPS na seção de síntese.
      </p>
      <div class="local-speech-field">
        <label for="local-speech-voice">Voz local</label>
        <select id="local-speech-voice" v-model="localSpeech.voiceId" :disabled="speechBusy || !localSpeech.voices.length">
          <option v-for="voiceId in localSpeech.voices" :key="voiceId" :value="voiceId">
            {{ voiceLabels[voiceId] ?? voiceId }}
          </option>
        </select>
      </div>
      <p v-if="localSpeech.active" class="dim">Síntese local ativa.</p>
      <div class="ready-actions">
        <LiaButton variant="primary" :disabled="busy || speechBusy || !localSpeech.voices.includes(localSpeech.voiceId)" @click="useLocalSpeech()">
          Selecionar motor local
        </LiaButton>
      </div>
    </LiaPanel>

    <p v-if="feedback" class="feedback" role="status">
      {{ feedback }}
    </p>
    <details class="speech-settings">
      <summary>Síntese compatível com OpenAI</summary>
      <form @submit.prevent="saveSpeech">
        <fieldset :disabled="speechBusy">
          <label>Endereço da API <input v-model.trim="speech.baseUrl" required type="url" maxlength="4096" placeholder="https://exemplo.com/v1"></label>
          <label>Modelo <input v-model.trim="speech.modelId" required maxlength="256"></label>
          <label>Voz <input v-model.trim="speech.voiceId" required maxlength="256"></label>
          <label>Chave da API <input v-model.trim="speech.apiKey" :required="!speech.hasKey" type="password" maxlength="2048" autocomplete="new-password"></label>
          <div class="speech-actions">
            <button type="submit">Salvar e usar</button>
            <button type="button" @click="useLocalSpeech(true)">Voltar ao motor local</button>
          </div>
        </fieldset>
      </form>
      <p class="feedback" role="status">{{ speechFeedback }}</p>
    </details>
    <details class="speech-settings">
      <summary>Reconhecimento de fala compatível com OpenAI</summary>
      <form @submit.prevent="saveTranscription">
        <fieldset :disabled="transcriptionBusy">
          <label>
            Onde transcrever
            <select v-model="transcription.local" @change="changeTranscriptionMode">
              <option :value="false">Serviço remoto (HTTPS)</option>
              <option :value="true">Servidor neste computador</option>
            </select>
          </label>
          <label>Endereço da API de transcrição <input v-model.trim="transcription.baseUrl" required type="url" maxlength="4096" :placeholder="transcription.local ? 'http://127.0.0.1:8080/v1' : 'https://exemplo.com/v1'"></label>
          <label>Modelo de transcrição <input v-model.trim="transcription.modelId" required maxlength="256"></label>
          <label v-if="!transcription.local">Chave de transcrição <input v-model.trim="transcription.apiKey" :required="!transcription.hasKey" type="password" maxlength="2048" autocomplete="new-password"></label>
          <button type="submit">Salvar reconhecimento</button>
        </fieldset>
      </form>
      <p class="feedback" role="status">{{ transcriptionFeedback }}</p>
    </details>
  </section>
</template>

<style scoped>
/* 8.0A-4: semantic tokens only - no raw colors. Spacious, product-facing,
   never diagnostic. */
.voice {
  display: flex;
  flex-direction: column;
  gap: var(--lia-space-6);
  max-width: 880px;
}

.voice-header h2 { margin: 0; }
.voice-intro {
  color: var(--lia-text-secondary);
  margin: var(--lia-space-2) 0 0;
}

h3 { margin: 0 0 var(--lia-space-3); }
.dim { color: var(--lia-text-secondary); font-size: var(--lia-text-sm); }

/* Kind choice: selectable cards on tokens (no hardcoded palette usage). */
.choices {
  display: grid;
  gap: var(--lia-space-4);
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}
.choice {
  align-items: flex-start;
  background: var(--lia-bg-surface);
  border: 1px solid var(--lia-border-subtle);
  border-radius: var(--lia-radius-lg);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: var(--lia-space-1);
  padding: var(--lia-space-4);
  transition: border-color var(--lia-transition-fast) ease;
}
.choice:hover { border-color: var(--lia-border-accent); }
.choice.active { border-color: var(--lia-accent); }

/* Location preference row wraps cleanly on narrow stages. */
.location-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lia-space-3);
  margin-bottom: var(--lia-space-3);
}
.location-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lia-space-2);
  margin-left: auto;
}
.badge {
  background: var(--lia-accent);
  border-radius: var(--lia-radius-pill);
  color: var(--lia-accent-contrast);
  font-size: var(--lia-text-xs);
  padding: var(--lia-space-1) var(--lia-space-3);
}
.field-note { font-size: var(--lia-text-xs); margin: 0; }

/* Imported voices. */
.profile-list {
  display: flex;
  flex-direction: column;
  gap: var(--lia-space-2);
  list-style: none;
  margin: 0 0 var(--lia-space-3);
  padding: 0;
}
.profile-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lia-space-3);
}
.profile-name { font-weight: var(--lia-font-medium); }

.import-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lia-space-3);
  margin-bottom: var(--lia-space-3);
}
.name {
  background: var(--lia-bg-app);
  border: 1px solid var(--lia-border-subtle);
  border-radius: var(--lia-radius-md);
  color: var(--lia-text-primary);
  flex: 1;
  font-family: var(--lia-font-family);
  min-width: 220px;
  padding: var(--lia-space-2) var(--lia-space-3);
}
.name:focus-visible {
  box-shadow: var(--lia-focus-ring);
  outline: none;
}

/* Advanced disclosure: collapsed by default, internal detail on demand. */
.advanced-toggle {
  background: none;
  border: none;
  color: var(--lia-accent);
  cursor: pointer;
  font-family: var(--lia-font-family);
  font-size: var(--lia-text-sm);
  padding: 0;
}
.advanced-toggle:focus-visible {
  box-shadow: var(--lia-focus-ring);
  outline: none;
}
.advanced-body { margin: var(--lia-space-2) 0 0; }
.advanced-body code {
  color: var(--lia-accent);
  font-size: var(--lia-text-xs);
  word-break: break-all;
}

.local-speech-field { display: grid; gap: var(--lia-space-1); max-width: 18rem; }
.ready-actions { margin-top: var(--lia-space-2); }
.feedback { font-size: var(--lia-text-sm); margin: 0; }
.speech-settings {
  background: var(--lia-bg-panel);
  border: 1px solid var(--lia-border-subtle);
  border-radius: var(--lia-radius-md);
  padding: var(--lia-space-4);
}
.speech-settings summary { cursor: pointer; font-weight: var(--lia-font-medium); }
.speech-settings fieldset {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
  gap: var(--lia-space-3);
  border: 0;
  padding: 0;
  margin: var(--lia-space-3) 0;
}
.speech-settings label { display: grid; gap: var(--lia-space-1); }
.speech-settings input,
.local-speech-field select {
  background: var(--lia-bg-app);
  border: 1px solid var(--lia-border-subtle);
  border-radius: var(--lia-radius-md);
  color: var(--lia-text-primary);
  font: inherit;
  min-width: 0;
  padding: var(--lia-space-2);
}
.speech-actions { display: flex; gap: var(--lia-space-2); flex-wrap: wrap; grid-column: 1 / -1; }
</style>
