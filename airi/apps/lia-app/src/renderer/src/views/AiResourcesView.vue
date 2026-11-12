<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

import LiaButton from '../components/lia/LiaButton.vue'
import LiaPanel from '../components/lia/LiaPanel.vue'

/**
 * AI Settings (PROMPT-39). The renderer is a VIEW: it lists the providers the
 * Main catalog exposes, forwards the user's choices and renders typed results.
 * It never validates an endpoint, never stores a key and never decides which
 * provider is available - Main owns all of that.
 */
const props = defineProps<{ api: any, status?: any, language?: string }>()
const english = computed(() => props.language?.toLowerCase().startsWith('en') === true)
const text = computed(() => english.value
  ? {
      title: 'Artificial intelligence',
      intro: 'Choose the AI service Lia uses to chat. The connection is saved on this computer and shared with conversation and tools.',
      onePerProvider: 'One connection per service. To change the key or the model, edit it here.',
      loading: 'Loading providers…',
      providers: 'Available services',
      unavailable: 'Unavailable in this version',
      inUse: 'In use by Lia',
      ready: 'Ready to configure',
      address: 'Service address',
      addressHelp: 'Use the address provided by the service, including the API path when needed.',
      advanced: 'Advanced connection options',
      key: 'API key',
      keySaved: '(already stored)',
      keyMissing: '(required to connect)',
      keyHelp: 'The key is stored with protection on this computer. The field clears after saving and is never shown again.',
      newKeyForHost: 'Changing the address requires a new key. A stored key is never sent to another host.',
      confirmHost: 'I confirm this address belongs to the service and trust it.',
      saving: 'Saving…',
      save: 'Save connection',
      finding: 'Finding models…',
      find: 'Find available models',
      model: 'Conversation model',
      choose: 'Find and choose a model',
      suggestions: 'Suggested models',
      discovered: 'Models offered by the service',
      manualToggle: 'Type the model ID manually',
      manualHelp: 'The ID is sent to the service exactly as typed. Use this when the model is not in the list.',
      selected: '(saved selection)',
      modelHelp: 'After choosing a model, save the connection to apply the selection.',
      testing: 'Checking conversation and tools…',
      test: 'Test connection',
      testHelp: 'This test uses a sample message without sending your conversations. It can take up to 30 seconds.',
      details: 'What the test checks',
      detailHelp: 'The service must offer model discovery and conversation with a test tool that has no access to the computer.',
      saved: 'Connection saved. Lia now uses this selection.',
      found: 'Choose a model and save the connection.',
      empty: 'The service offered no models. Type the model ID manually and try again.',
      verified: 'Connection verified: the model requested the tool, received its result and replied correctly.',
      fallback: 'Could not complete this action. Please try again.',
      stop: 'End conversation to configure',
      stopping: 'Ending conversation…',
      stopped: 'Conversation ended. You can save your settings now.',
      stopFailed: 'Could not end the conversation. Please try again.',
      current: 'Current connection',
      notConfigured: 'No connection saved yet.',
    }
  : {
      title: 'Inteligência artificial',
      intro: 'Escolha o serviço de IA que a Lia usa para conversar. A conexão fica guardada neste computador e é compartilhada com a conversa e as ferramentas.',
      onePerProvider: 'Uma conexão por serviço. Para trocar a chave ou o modelo, edite aqui.',
      loading: 'Carregando provedores…',
      providers: 'Serviços disponíveis',
      unavailable: 'Indisponível nesta versão',
      inUse: 'Em uso pela Lia',
      ready: 'Pronto para configurar',
      address: 'Endereço do serviço',
      addressHelp: 'Use o endereço fornecido pelo serviço, incluindo o caminho da API quando necessário.',
      advanced: 'Opções avançadas de conexão',
      key: 'Chave de API',
      keySaved: '(já guardada)',
      keyMissing: '(obrigatória para conectar)',
      keyHelp: 'A chave é guardada com proteção neste computador. O campo fica vazio depois de salvar e nunca é exibido novamente.',
      newKeyForHost: 'Trocar o endereço exige uma chave nova. Uma chave guardada nunca é enviada para outro servidor.',
      confirmHost: 'Confirmo que este endereço pertence ao serviço e que confio nele.',
      saving: 'Salvando…',
      save: 'Salvar conexão',
      finding: 'Buscando modelos…',
      find: 'Buscar modelos disponíveis',
      model: 'Modelo para conversar',
      choose: 'Busque e escolha um modelo',
      suggestions: 'Modelos sugeridos',
      discovered: 'Modelos oferecidos pelo serviço',
      manualToggle: 'Digitar o ID do modelo manualmente',
      manualHelp: 'O ID é enviado ao serviço exatamente como digitado. Use quando o modelo não aparecer na lista.',
      selected: '(seleção salva)',
      modelHelp: 'Depois de escolher, salve a conexão para aplicar a seleção.',
      testing: 'Verificando conversa e ferramentas…',
      test: 'Testar conexão',
      testHelp: 'O teste usa uma mensagem de exemplo, sem enviar suas conversas. Pode levar até 30 segundos.',
      details: 'O que o teste verifica',
      detailHelp: 'O serviço precisa oferecer descoberta de modelos e conversa com uma ferramenta de teste sem acesso ao computador.',
      saved: 'Conexão salva. A Lia já usa esta seleção.',
      found: 'Escolha um modelo e salve a conexão.',
      empty: 'O serviço não ofereceu modelos. Digite o ID do modelo manualmente e tente novamente.',
      verified: 'Conexão verificada: o modelo pediu a ferramenta, recebeu o resultado e respondeu corretamente.',
      fallback: 'Não foi possível concluir. Tente novamente.',
      stop: 'Encerrar conversa para configurar',
      stopping: 'Encerrando conversa…',
      stopped: 'Conversa encerrada. Você já pode salvar a configuração.',
      stopFailed: 'Não foi possível encerrar a conversa. Tente novamente.',
      current: 'Conexão atual',
      notConfigured: 'Nenhuma conexão salva ainda.',
    })

interface ProviderCard {
  availability: 'ready' | 'unavailable'
  baseUrl: string
  definitionId: string
  description: string
  engineId?: string
  label: string
  models: { id: string, label: string, recommended?: boolean }[]
  requiresApiKey: boolean
  stageProviderId?: string
  unavailableReason?: string
}

const providers = ref<ProviderCard[]>([])
const activeId = ref('')
const loading = ref(true)
const busy = ref('')
const failed = ref(false)
const feedback = ref('')
const stageRunning = ref(false)
const hasKey = ref(false)
const selected = ref(false)
const connectionId = ref('')
const revision = ref(0)
const savedBaseUrl = ref('')
const form = reactive({ baseUrl: '', apiKey: '', modelId: '' })
const discovered = ref<{ id: string, label: string }[]>([])
const manual = ref(false)
const confirmHost = ref(false)
let active = true

const activeProvider = computed(() => providers.value.find(provider => provider.definitionId === activeId.value))
const manageable = computed(() => activeProvider.value?.availability === 'ready')
const hostOf = (value: string) => {
  try { return new URL(value).hostname }
  catch { return undefined }
}
const hostChanged = computed(() => {
  const host = hostOf(form.baseUrl.trim())
  if (!host)
    return false
  const canonical = activeProvider.value?.baseUrl ? hostOf(activeProvider.value.baseUrl) : undefined
  const saved = savedBaseUrl.value ? hostOf(savedBaseUrl.value) : undefined
  return (canonical !== undefined && host !== canonical) || (saved !== undefined && host !== saved)
})
const suggestions = computed(() => activeProvider.value?.models ?? [])
const modelOptions = computed(() => {
  const rows = [...discovered.value]
  for (const suggestion of suggestions.value) {
    if (!rows.some(row => row.id === suggestion.id))
      rows.push({ id: suggestion.id, label: suggestion.label })
  }
  return rows
})
const canTest = computed(() => selected.value && !!form.modelId && !busy.value && !loading.value)
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
      'unconfirmed-host': 'Confirm the new address before saving. Changing the host also requires a new key.',
      'provider-unavailable': 'This service cannot be configured in this version.',
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
      'unconfirmed-host': 'Confirme o novo endereço antes de salvar. Trocar o servidor também exige uma chave nova.',
      'provider-unavailable': 'Este serviço não pode ser configurado nesta versão.',
    })

function showError(code?: string) {
  stageRunning.value = code === 'stage-running'
  failed.value = true
  feedback.value = errors.value[code ?? ''] ?? text.value.fallback
}

function resetFeedback() {
  failed.value = false
  feedback.value = ''
}

function applyState(state: any) {
  if (!state || state.ok === false || typeof state.baseUrl !== 'string')
    throw new Error('state')
  form.baseUrl = state.baseUrl
  form.modelId = state.modelId ?? ''
  form.apiKey = ''
  revision.value = state.revision
  hasKey.value = state.hasKey === true
  selected.value = state.selected === true
  connectionId.value = typeof state.connectionId === 'string' ? state.connectionId : ''
  savedBaseUrl.value = state.connectionId ? state.baseUrl : ''
  confirmHost.value = false
  manual.value = !!state.modelId && !suggestions.value.some(model => model.id === state.modelId)
  discovered.value = state.modelId ? [{ id: state.modelId, label: state.modelId }] : []
}

async function loadProvider(definitionId: string) {
  resetFeedback()
  try {
    applyState(await props.api.aiConnectionGet(definitionId))
  }
  catch {
    if (active)
      showError('storage')
  }
}

async function selectProvider(provider: ProviderCard) {
  if (provider.availability !== 'ready' || busy.value || provider.definitionId === activeId.value)
    return
  activeId.value = provider.definitionId
  form.apiKey = ''
  await loadProvider(provider.definitionId)
}

async function load() {
  try {
    const catalog = await props.api.aiProviders()
    if (!active)
      return
    if (!Array.isArray(catalog))
      throw new Error('catalog')
    providers.value = catalog
    const current = await props.api.aiConnectionGet()
    const preferred = catalog.find((provider: ProviderCard) => provider.definitionId === current?.definitionId && provider.availability === 'ready')
      ?? catalog.find((provider: ProviderCard) => provider.availability === 'ready')
    if (!preferred)
      throw new Error('catalog')
    activeId.value = preferred.definitionId
    applyState(current?.definitionId === preferred.definitionId ? current : await props.api.aiConnectionGet(preferred.definitionId))
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

function edited() {
  resetFeedback()
}

async function save() {
  if (!manageable.value || busy.value)
    return
  busy.value = 'save'
  resetFeedback()
  const modelId = form.modelId.trim()
  // Keep the draft only for the duration of this explicit save action.
  const input = {
    providerId: activeId.value,
    baseUrl: form.baseUrl.trim(),
    revision: revision.value,
    ...(modelId ? { modelId } : {}),
    ...(form.apiKey ? { apiKey: form.apiKey } : {}),
    ...(hostChanged.value && confirmHost.value ? { confirmHostChange: true } : {}),
  }
  form.apiKey = ''
  try {
    const result = await props.api.aiConnectionSave(input)
    if (!active)
      return
    if (!result?.ok) {
      showError(result?.code)
      return
    }
    applyState(result.state)
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
  if (!manageable.value || busy.value)
    return
  busy.value = 'models'
  resetFeedback()
  try {
    const result = await props.api.aiConnectionModels(activeId.value)
    if (!active)
      return
    if (!result?.ok) {
      showError(result?.code)
      return
    }
    discovered.value = Array.isArray(result.models) ? result.models : []
    feedback.value = discovered.value.length ? text.value.found : text.value.empty
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
  if (!manageable.value || busy.value)
    return
  busy.value = 'test'
  resetFeedback()
  try {
    const result = await props.api.aiConnectionTest(activeId.value)
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
    resetFeedback()
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
    <header>
      <h2>{{ text.title }}</h2>
      <p>{{ text.intro }}</p>
    </header>
    <p v-if="loading" role="status">
      {{ text.loading }}
    </p>
    <template v-else>
      <LiaPanel>
        <fieldset class="providers" :disabled="!!busy">
          <legend>{{ text.providers }}</legend>
          <button
            v-for="provider in providers"
            :key="provider.definitionId"
            type="button"
            class="provider-card"
            :class="{ active: provider.definitionId === activeId, unavailable: provider.availability !== 'ready' }"
            :aria-pressed="provider.definitionId === activeId"
            :disabled="provider.availability !== 'ready' || !!busy"
            @click="selectProvider(provider)"
          >
            <span class="provider-name">{{ provider.label }}</span>
            <span class="hint">{{ provider.description }}</span>
            <span v-if="provider.availability !== 'ready'" class="badge">
              {{ text.unavailable }}: {{ provider.unavailableReason }}
            </span>
            <span v-else-if="provider.definitionId === activeId && selected" class="badge badge-ok">{{ text.inUse }}</span>
            <span v-else class="badge">{{ text.ready }}</span>
          </button>
        </fieldset>
        <p class="hint">
          {{ text.onePerProvider }}
        </p>
      </LiaPanel>

      <LiaPanel v-if="activeProvider && manageable">
        <form class="ai-form" @submit.prevent="save">
          <p class="current">
            <strong>{{ text.current }}:</strong> {{ activeProvider.label }}
            <span class="hint">{{ connectionId ? connectionId : text.notConfigured }}</span>
          </p>

          <label for="ai-address">{{ text.address }}</label>
          <input id="ai-address" v-model="form.baseUrl" type="url" required autocomplete="url" spellcheck="false" :disabled="!!busy" aria-describedby="ai-address-help" @input="edited">
          <p id="ai-address-help" class="hint">
            {{ text.addressHelp }}
          </p>
          <label v-if="hostChanged" class="key-option">
            <input v-model="confirmHost" type="checkbox" :disabled="!!busy" @change="edited">
            {{ text.confirmHost }}
          </label>
          <p v-if="hostChanged" class="hint warning">
            {{ text.newKeyForHost }}
          </p>

          <label for="ai-key">{{ text.key }} <span class="hint">{{ hasKey ? text.keySaved : (activeProvider.requiresApiKey ? text.keyMissing : '') }}</span></label>
          <input id="ai-key" v-model="form.apiKey" type="password" autocomplete="new-password" spellcheck="false" :disabled="!!busy" @input="edited">
          <p class="hint">
            {{ text.keyHelp }}
          </p>

          <div class="actions">
            <LiaButton type="submit" variant="primary" :disabled="!!busy || !form.baseUrl || (hostChanged && !confirmHost)">
              {{ busy === 'save' ? text.saving : text.save }}
            </LiaButton>
            <LiaButton type="button" :disabled="!!busy || !savedBaseUrl" @click="discover">
              {{ busy === 'models' ? text.finding : text.find }}
            </LiaButton>
          </div>

          <label for="ai-model">{{ text.model }}</label>
          <label class="key-option">
            <input v-model="manual" type="checkbox" :disabled="!!busy" @change="edited">
            {{ text.manualToggle }}
          </label>
          <input
            v-if="manual"
            id="ai-model"
            v-model="form.modelId"
            type="text"
            spellcheck="false"
            autocomplete="off"
            :placeholder="suggestions.find(model => model.recommended)?.id ?? 'openai/gpt-oss-120b'"
            :disabled="!!busy"
            :aria-describedby="'ai-model-help'"
            @input="edited"
          >
          <select v-else id="ai-model" v-model="form.modelId" :disabled="!!busy || !modelOptions.length" @change="edited">
            <option value="" disabled>
              {{ text.choose }}
            </option>
            <option v-if="form.modelId && !modelOptions.some(row => row.id === form.modelId)" :value="form.modelId">
              {{ form.modelId }} {{ text.selected }}
            </option>
            <option v-for="model in modelOptions" :key="model.id" :value="model.id">
              {{ model.label }}
            </option>
          </select>
          <p id="ai-model-help" class="hint">
            {{ manual ? text.manualHelp : text.modelHelp }}
          </p>
          <p v-if="discovered.length > 1" class="hint">
            {{ text.discovered }}
          </p>
          <p v-else-if="!manual && suggestions.length" class="hint">
            {{ text.suggestions }}
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
      <p v-else-if="feedback" :role="failed ? 'alert' : 'status'" class="feedback">
        {{ feedback }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.ai-resources { max-width: 800px; color: var(--lia-text-primary); }
.ai-resources header { margin-bottom: var(--lia-space-6); }
.ai-resources header p, .hint, .advanced { color: var(--lia-text-secondary); }
.providers { display: grid; gap: var(--lia-space-3); margin: 0; padding: 0; border: 0; }
.providers legend { font-weight: 600; margin-bottom: var(--lia-space-3); padding: 0; }
.provider-card { display: grid; gap: var(--lia-space-1); text-align: start; color: var(--lia-text-primary); background: var(--lia-bg-surface-raised); border: 1px solid var(--lia-border-subtle); border-radius: var(--lia-radius-md); padding: var(--lia-space-3); font: inherit; cursor: pointer; }
.provider-card.active { border-color: var(--lia-border-accent); }
.provider-card.unavailable { cursor: not-allowed; opacity: 0.7; }
.provider-name { font-weight: 600; }
.badge { font-size: var(--lia-text-sm); color: var(--lia-text-secondary); }
.badge-ok { color: var(--lia-accent); }
.ai-form { display: grid; gap: var(--lia-space-3); }
.ai-form input, .ai-form select { width: 100%; box-sizing: border-box; color: var(--lia-text-primary); background: var(--lia-bg-surface-raised); border: 1px solid var(--lia-border-subtle); border-radius: var(--lia-radius-md); padding: var(--lia-space-3); font: inherit; }
.ai-form input:focus-visible, .ai-form select:focus-visible, summary:focus-visible { outline: none; box-shadow: var(--lia-focus-ring); }
.hint { margin: 0; font-size: var(--lia-text-sm); }
.warning { color: var(--lia-accent); }
.key-option { display: flex; align-items: center; gap: var(--lia-space-2); }
.key-option input { width: auto; }
.actions { display: flex; flex-wrap: wrap; gap: var(--lia-space-3); margin-block: var(--lia-space-3); }
.feedback { padding-block: var(--lia-space-3); }
.advanced { margin-top: var(--lia-space-6); }
.current { margin: 0; }
summary { cursor: pointer; }
</style>
