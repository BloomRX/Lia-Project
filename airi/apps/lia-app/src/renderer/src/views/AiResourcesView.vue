<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

import LiaButton from '../components/lia/LiaButton.vue'
import LiaPanel from '../components/lia/LiaPanel.vue'

const props = defineProps<{ api: any, status?: any, language?: string }>()
const english = computed(() => props.language?.toLowerCase().startsWith('en') === true)
const text = computed(() => english.value
  ? {
      title: 'AI service',
      intro: 'Connect Lia, choose a model and check that it can chat and use tools.',
      loading: 'Loading settings…',
      address: 'Service address',
      addressHelp: 'Use the connection address provided by your service, including the API path when needed.',
      key: 'Access key',
      keySaved: '(already stored)',
      keyOptional: '(optional, if required by the service)',
      keyHelp: 'Your key is stored securely on this computer. This field clears after saving.',
      withoutKey: 'This service does not require an access key',
      saving: 'Saving…',
      save: 'Save service and selection',
      finding: 'Finding models…',
      find: 'Find models',
      model: 'Conversation model',
      choose: 'Find and choose a model',
      selected: '(saved selection)',
      modelHelp: 'After choosing a model, save your selection before testing.',
      testing: 'Checking conversation and tools…',
      test: 'Test complete connection',
      testHelp: 'This test uses a sample message without sending your conversations. It can take up to 30 seconds.',
      details: 'Connection details',
      detailHelp: 'The address must support model discovery and conversation with tools. The check uses only a test tool with no computer access.',
      saved: 'Service saved. Find the available models to continue.',
      found: 'Choose a model and save your selection.',
      empty: 'The service offered no models. Check its settings and try again.',
      verified: 'Connection verified: the model requested a tool, received its result and replied correctly.',
      fallback: 'Could not complete this action. Please try again.',
      stop: 'End conversation to configure',
      stopping: 'Ending conversation…',
      stopped: 'Conversation ended. You can save your settings now.',
      stopFailed: 'Could not end the conversation. Please try again.',
    }
  : {
      title: 'Serviço de IA',
      intro: 'Conecte a Lia, escolha um modelo e confira se ele está pronto para conversar e usar ferramentas.',
      loading: 'Carregando configuração…',
      address: 'Endereço do serviço',
      addressHelp: 'Use o endereço de conexão fornecido pelo serviço, incluindo o caminho da API quando necessário.',
      key: 'Chave de acesso',
      keySaved: '(já guardada)',
      keyOptional: '(opcional, se o serviço exigir)',
      keyHelp: 'A chave é guardada com proteção neste computador. O campo fica vazio depois de salvar.',
      withoutKey: 'Este serviço não exige chave de acesso',
      saving: 'Salvando…',
      save: 'Salvar serviço e seleção',
      finding: 'Buscando modelos…',
      find: 'Buscar modelos',
      model: 'Modelo para conversar',
      choose: 'Busque e escolha um modelo',
      selected: '(seleção salva)',
      modelHelp: 'Depois de escolher, salve a seleção para testar.',
      testing: 'Verificando conversa e ferramentas…',
      test: 'Testar conexão completa',
      testHelp: 'O teste usa uma mensagem de exemplo, sem enviar suas conversas. Pode levar até 30 segundos.',
      details: 'Detalhes da conexão',
      detailHelp: 'O endereço deve oferecer descoberta de modelos e conversa compatível com ferramentas. A verificação usa apenas uma ferramenta de teste sem acesso ao computador.',
      saved: 'Serviço salvo. Busque os modelos disponíveis para continuar.',
      found: 'Escolha um modelo e salve a seleção.',
      empty: 'O serviço não ofereceu modelos. Confira a configuração do serviço e tente novamente.',
      verified: 'Conexão verificada: o modelo pediu uma ferramenta, recebeu o resultado e respondeu corretamente.',
      fallback: 'Não foi possível concluir. Tente novamente.',
      stop: 'Encerrar conversa para configurar',
      stopping: 'Encerrando conversa…',
      stopped: 'Conversa encerrada. Você já pode salvar a configuração.',
      stopFailed: 'Não foi possível encerrar a conversa. Tente novamente.',
    })
const form = reactive({ baseUrl: '', apiKey: '', modelId: '' })
const revision = ref(0)
const hasKey = ref(false)
const withoutKey = ref(false)
const loading = ref(true)
const busy = ref('')
const feedback = ref('')
const failed = ref(false)
const stageRunning = ref(false)
const saved = ref(false)
const models = ref<{ id: string, label: string }[]>([])
const canTest = computed(() => saved.value && !!form.modelId && !busy.value && !loading.value)
let active = true
const errors = computed<Record<string, string>>(() => english.value
  ? {
      'invalid': 'Check the address and fields before saving.',
      'conflict': 'Settings changed in another window. Reopen this page and try again.',
      'credentials': 'Enter the key again when changing the address. Check that it can be stored on this computer.',
      'timeout': 'The service took too long to respond. Please try again.',
      'protocol': 'The service did not complete the conversation with tools. Choose another model or check the service settings.',
      'http': 'The service refused the connection. Check the address, key and model.',
      'network': 'Could not reach the AI service. Check your connection and try again.',
      'unconfigured': 'Save the service and select a model first.',
      'storage': 'Could not save the settings safely. Reopen this page and save the service address and key again.',
      'stage-running': 'End the conversation before changing the service or key.',
    }
  : {
      'invalid': 'Confira o endereço e os campos antes de salvar.',
      'conflict': 'A configuração mudou em outra janela. Reabra esta página e tente novamente.',
      'credentials': 'Informe a chave novamente ao trocar o endereço. Confira se ela pode ser guardada neste computador.',
      'timeout': 'O serviço demorou para responder. Tente novamente.',
      'protocol': 'O serviço não completou a conversa com ferramentas. Escolha outro modelo ou confira as opções do serviço.',
      'http': 'O serviço recusou a conexão. Confira o endereço, a chave e o modelo.',
      'network': 'Não foi possível alcançar o serviço de IA. Confira a conexão e tente novamente.',
      'unconfigured': 'Salve o serviço e selecione um modelo primeiro.',
      'storage': 'Não foi possível guardar a configuração com segurança. Reabra esta página e salve novamente o endereço e a chave do serviço.',
      'stage-running': 'Encerre a conversa antes de alterar o serviço ou a chave.',
    })
function showError(code?: string) {
  stageRunning.value = code === 'stage-running'
  failed.value = true
  feedback.value = errors.value[code ?? ''] ?? text.value.fallback
}
function edited() {
  saved.value = false
  feedback.value = ''
}
async function load() {
  try {
    const state = await props.api.aiConnectionGet()
    if (!active)
      return
    if (!state || typeof state.baseUrl !== 'string')
      throw new Error('state')
    form.baseUrl = state.baseUrl
    form.modelId = state.modelId ?? ''
    revision.value = state.revision
    hasKey.value = state.hasKey
    saved.value = !!state.baseUrl
  }
  catch {
    if (active)
      showError('storage')
  }
  finally {
    if (active)
      loading.value = false
  }
}
async function save() {
  busy.value = 'save'
  feedback.value = ''
  failed.value = false
  // Keep the draft only for the duration of this explicit save action.
  const input = { baseUrl: form.baseUrl.trim(), revision: revision.value, ...(withoutKey.value ? { apiKey: '' } : form.apiKey ? { apiKey: form.apiKey } : {}), ...(form.modelId ? { modelId: form.modelId } : {}) }
  form.apiKey = ''
  try {
    const result = await props.api.aiConnectionSave(input)
    if (!active)
      return
    if (!result?.ok) {
      showError(result?.code)
      return
    }
    revision.value = result.state.revision
    hasKey.value = result.state.hasKey
    saved.value = true
    feedback.value = text.value.saved
  }
  catch {
    if (active)
      showError('storage')
  }
  finally {
    if (active)
      busy.value = ''
  }
}
async function discover() {
  busy.value = 'models'
  feedback.value = ''
  failed.value = false
  models.value = []
  try {
    const result = await props.api.aiConnectionModels()
    if (!active)
      return
    if (!result?.ok) {
      showError(result?.code)
      return
    }
    models.value = result.models
    feedback.value = result.models.length ? text.value.found : text.value.empty
  }
  catch {
    if (active)
      showError('network')
  }
  finally {
    if (active)
      busy.value = ''
  }
}
async function test() {
  busy.value = 'test'
  feedback.value = ''
  failed.value = false
  try {
    const result = await props.api.aiConnectionTest()
    if (!active)
      return
    if (!result?.ok) {
      showError(result?.code)
      return
    }
    feedback.value = text.value.verified
  }
  catch {
    if (active)
      showError('network')
  }
  finally {
    if (active)
      busy.value = ''
  }
}
async function stopConversation() {
  busy.value = 'stop'
  try {
    const result = await props.api.stopStage()
    if (!active)
      return
    if (result?.phase !== 'stopped') {
      feedback.value = text.value.stopFailed
      failed.value = true
      return
    }
    stageRunning.value = false
    failed.value = false
    feedback.value = text.value.stopped
  }
  catch {
    if (active) {
      feedback.value = text.value.stopFailed
      failed.value = true
    }
  }
  finally {
    if (active)
      busy.value = ''
  }
}
onMounted(load)
onBeforeUnmount(() => {
  active = false
  form.apiKey = ''
})
</script>

<template>
  <section class="ai-resources" :aria-busy="loading || !!busy">
    <header><h2>{{ text.title }}</h2><p>{{ text.intro }}</p></header>
    <p v-if="loading" role="status">
      {{ text.loading }}
    </p>
    <LiaPanel v-else>
      <form class="ai-form" @submit.prevent="save">
        <label for="ai-address">{{ text.address }}</label>
        <input id="ai-address" v-model="form.baseUrl" type="url" required autocomplete="url" spellcheck="false" :disabled="!!busy" aria-describedby="ai-address-help" @input="edited">
        <p id="ai-address-help" class="hint">
          {{ text.addressHelp }}
        </p>
        <label for="ai-key">{{ text.key }} <span class="hint">{{ hasKey ? text.keySaved : text.keyOptional }}</span></label>
        <input id="ai-key" v-model="form.apiKey" type="password" autocomplete="new-password" spellcheck="false" :disabled="!!busy || withoutKey" @input="edited">
        <p class="hint">
          {{ text.keyHelp }}
        </p>
        <label class="key-option"><input v-model="withoutKey" type="checkbox" :disabled="!!busy" @change="form.apiKey = ''; edited()"> {{ text.withoutKey }}</label>
        <div class="actions">
          <LiaButton type="submit" variant="primary" :disabled="!!busy || !form.baseUrl">
            {{ busy === 'save' ? text.saving : text.save }}
          </LiaButton>
          <LiaButton type="button" :disabled="!!busy || !saved" @click="discover">
            {{ busy === 'models' ? text.finding : text.find }}
          </LiaButton>
        </div>
        <label for="ai-model">{{ text.model }}</label>
        <select id="ai-model" v-model="form.modelId" :disabled="!!busy || !models.length" @change="edited">
          <option value="" disabled>
            {{ text.choose }}
          </option>
          <option v-if="form.modelId && !models.some(row => row.id === form.modelId)" :value="form.modelId">
            {{ form.modelId }} {{ text.selected }}
          </option>
          <option v-for="model in models" :key="model.id" :value="model.id">
            {{ model.label }}
          </option>
        </select>
        <p class="hint">
          {{ text.modelHelp }}
        </p>
        <LiaButton type="button" :disabled="!canTest" @click="test">
          {{ busy === 'test' ? text.testing : text.test }}
        </LiaButton>
      </form>
      <p v-if="feedback" :role="failed ? 'alert' : 'status'" class="feedback">
        {{ feedback }}
      </p>
      <LiaButton v-if="stageRunning" type="button" :disabled="!!busy" @click="stopConversation">
        {{ busy === 'stop' ? text.stopping : text.stop }}
      </LiaButton>
      <p v-if="busy === 'test'" class="hint" role="status">
        {{ text.testHelp }}
      </p>
      <details class="advanced">
        <summary>{{ text.details }}</summary><p>{{ text.detailHelp }}</p>
      </details>
    </LiaPanel>
  </section>
</template>

<style scoped>
.ai-resources { max-width: 800px; color: var(--lia-text-primary); }
.ai-resources header { margin-bottom: var(--lia-space-6); }
.ai-resources header p, .hint, .advanced { color: var(--lia-text-secondary); }
.ai-form { display: grid; gap: var(--lia-space-3); }
.ai-form input, .ai-form select { width: 100%; box-sizing: border-box; color: var(--lia-text-primary); background: var(--lia-bg-surface-raised); border: 1px solid var(--lia-border-subtle); border-radius: var(--lia-radius-md); padding: var(--lia-space-3); font: inherit; }
.ai-form input:focus-visible, .ai-form select:focus-visible, summary:focus-visible { outline: none; box-shadow: var(--lia-focus-ring); }
.hint { margin: 0; font-size: var(--lia-text-sm); }
.key-option { display: flex; align-items: center; gap: var(--lia-space-2); }
.key-option input { width: auto; }
.actions { display: flex; flex-wrap: wrap; gap: var(--lia-space-3); margin-block: var(--lia-space-3); }
.feedback { padding-block: var(--lia-space-3); }
.advanced { margin-top: var(--lia-space-6); }
summary { cursor: pointer; }
</style>
