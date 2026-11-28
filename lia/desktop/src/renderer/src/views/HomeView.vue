<script setup lang="ts">
import type { FirstRunChoice } from './home-vm'

import { computed, ref } from 'vue'

import liaHero from '../../../../../assets/character/LiaHeroImage.png'
import LiaButton from '../components/lia/LiaButton.vue'
import LiaPanel from '../components/lia/LiaPanel.vue'

import { voiceStatusChipVm } from '../components/voice-engine-card.vm'
import {
  firstRunChoicePayload,
  firstRunPanelVisible,
  homeAiChipVm,
  homeBlockerHintVm,
  homeConversationLabelVm,
  homeConversationStartingVm,
  homeConversationStopMessagesVm,
  homeConversationStoppingVm,
  homeConversationStopVisibleVm,
} from './home-vm'

const props = defineProps<{
  api: any
  status: any
  statusError?: boolean
  /** Shell-provided voice readiness (7.9H source of truth). */
  readiness?: any
  /** Shell-provided language preference (pt-BR default). */
  language?: string
  /** Shell-provided first-run marker (canonical product config). */
  setup?: { completed?: boolean }
}>()
const emit = defineEmits<{ (e: 'refresh' | 'open-ai' | 'open-diagnostics'): void }>()

const busy = ref(false)
const error = ref<string | undefined>(undefined)
const stopBusy = ref(false)
const startBusy = ref(false)
const stopFeedback = ref<string | undefined>(undefined)
// Phase 8.0A-5: the first-run choice has its OWN busy flag, so choosing
// never touches the Conversar action; success hides the panel locally.
const firstRunBusy = ref(false)
const firstRunDone = ref(false)

const english = computed(() => props.language?.startsWith('en'))
const text = computed(() => english.value
  ? {
      greeting: 'Hi, I’m', tagline: 'Your desktop companion.', configure: 'Set up AI',
      voice: 'Voice', refresh: 'Refresh status', diagnostics: 'Diagnostics',
      statusError: 'Could not check readiness.', stageError: 'The conversation was interrupted. Try again or open Diagnostics.',
      welcome: 'How would you like to start?', complete: 'Full experience',
      completeNote: 'Chat and voice. Lia sets up voice automatically.',
      textOnly: 'Text only', textNote: 'Chat without voice. You can turn it on later.',
    }
  : {
      greeting: 'Oi, eu sou a', tagline: 'Sua companhia de desktop.', configure: 'Configurar IA',
      voice: 'Voz', refresh: 'Atualizar estado', diagnostics: 'Diagnósticos',
      statusError: 'Não foi possível verificar a prontidão.', stageError: 'A conversa foi interrompida. Tente novamente ou abra Diagnósticos.',
      welcome: 'Como você quer começar?', complete: 'Completa',
      completeNote: 'Conversa e voz. A Lia prepara a voz automaticamente.',
      textOnly: 'Somente texto', textNote: 'Conversa sem voz. Você pode ativá-la depois.',
    })

const aiChip = computed(() => homeAiChipVm(props.status, props.language))
const blockerHint = computed(() => homeBlockerHintVm(props.status, props.language))
const conversationStarting = computed(() => homeConversationStartingVm(props.status))
const conversationStopping = computed(() => homeConversationStoppingVm(props.status))
const stopVisible = computed(() => homeConversationStopVisibleVm(props.status))
const stopMessages = computed(() => homeConversationStopMessagesVm(props.language))
const running = computed(() => props.status?.stage?.state?.phase === 'running')
const statusFailed = computed(() => props.statusError || props.status?.config?.status === 'read-error')
const checking = computed(() => !statusFailed.value && typeof props.status?.ai?.ready !== 'boolean')
const needsAi = computed(() => !statusFailed.value && !running.value && !stopVisible.value && props.status?.ai?.ready === false)
const starting = computed(() => startBusy.value || conversationStarting.value)
const stopping = computed(() => stopBusy.value || conversationStopping.value)
const canConverse = computed(() => !busy.value && !starting.value && !stopping.value
  && (running.value || (!statusFailed.value && props.status?.ai?.ready === true)))
const conversationLabel = computed(() => {
  if (starting.value)
    return homeConversationLabelVm({ stage: { state: { phase: 'starting' } } }, props.language)
  if (running.value || checking.value)
    return homeConversationLabelVm(props.status, props.language)
  return homeConversationLabelVm({ ai: { ready: true } }, props.language)
})
const visibleError = computed(() => error.value || (statusFailed.value ? text.value.statusError : undefined)
  || (props.status?.stage?.state?.phase === 'error' && !starting.value && !stopping.value ? text.value.stageError : undefined))

const voiceChip = computed(() => voiceStatusChipVm(props.readiness, props.language))

function refreshStatus() {
  error.value = undefined
  emit('refresh')
}

function startBlockedMessage(code: unknown): string {
  const messages: Record<string, { en: string, pt: string }> = {
    'configuration-unsafe': {
      en: 'The AI service is not ready. Check AI Settings and try again.',
      pt: 'O serviço de IA não está pronto. Confira as Configurações de IA e tente novamente.',
    },
    'connection-disabled': {
      en: 'The AI service is disabled. Review AI Settings before starting a conversation.',
      pt: 'O serviço de IA está desativado. Confira as Configurações de IA antes de conversar.',
    },
    'connection-inconsistent': {
      en: 'The AI connection could not be verified. Reload AI Settings and review the connection.',
      pt: 'Não foi possível verificar a conexão de IA. Recarregue as Configurações de IA e confira a conexão.',
    },
    'connection-missing': {
      en: 'Finish setting up the AI service in AI Settings before starting a conversation.',
      pt: 'Finalize a configuração do serviço de IA nas Configurações de IA antes de conversar.',
    },
    'credential-missing': {
      en: 'The AI service needs a credential. Add it in AI Settings and try again.',
      pt: 'Falta uma credencial do serviço de IA. Adicione-a nas Configurações de IA e tente novamente.',
    },
    'credential-read-failed': {
      en: 'The AI credential could not be checked. Review AI Settings and try again.',
      pt: 'Não foi possível verificar a credencial de IA. Confira as Configurações de IA e tente novamente.',
    },
    'model-missing': {
      en: 'Choose a model in AI Settings before starting a conversation.',
      pt: 'Escolha um modelo nas Configurações de IA antes de conversar.',
    },
    'provider-unavailable': {
      en: 'The selected AI service is unavailable. Choose another service in AI Settings.',
      pt: 'O serviço de IA selecionado está indisponível. Escolha outro nas Configurações de IA.',
    },
    'selection-invalid': {
      en: 'The saved AI selection is invalid. Review AI Settings and try again.',
      pt: 'A seleção de IA salva é inválida. Confira as Configurações de IA e tente novamente.',
    },
    'selection-missing': {
      en: 'Choose an AI service and model in AI Settings to start a conversation.',
      pt: 'Escolha um serviço de IA e um modelo nas Configurações de IA para conversar.',
    },
    'selection-read-failed': {
      en: 'The saved AI selection could not be checked. Reload AI Settings and try again.',
      pt: 'Não foi possível verificar a seleção de IA salva. Recarregue as Configurações de IA e tente novamente.',
    },
    'transport-read-failed': {
      en: 'The AI connection could not be checked. Reload AI Settings and try again.',
      pt: 'Não foi possível verificar a conexão de IA. Recarregue as Configurações de IA e tente novamente.',
    },
  }
  const message = messages[String(code)]
  if (!message)
    return props.language?.startsWith('en') ? 'The AI service is not ready. Open AI Settings and try again.' : 'O serviço de IA não está pronto. Abra as Configurações de IA e tente novamente.'
  return props.language?.startsWith('en') ? message.en : message.pt
}

/**
 * Phase 8.0A-5: the minimal first-run choice shows until the canonical
 * marker says done. NON-BLOCKING: nothing else on Home depends on it.
 */
const firstRunVisible = computed(() => !firstRunDone.value && firstRunPanelVisible(props.setup))

/**
 * ONE canonical config update per choice. The voice-on choice naturally
 * lets the launcher's automatic voice preparation run; the voice-off
 * choice keeps it switched off. Home never starts anything itself and
 * never leaves the page.
 */
async function chooseFirstRun(choice: FirstRunChoice) {
  if (firstRunBusy.value)
    return
  firstRunBusy.value = true
  error.value = undefined
  try {
    const result = await props.api?.updateConfig(firstRunChoicePayload(choice))
    if (result?.status === 'ok') {
      firstRunDone.value = true
      emit('refresh')
    }
    else {
      error.value = props.language?.startsWith('en') ? 'Could not save your choice. Please try again.' : 'Não foi possível salvar sua escolha. Tente novamente.'
    }
  }
  catch {
    error.value = props.language?.startsWith('en') ? 'Could not save your choice. Please try again.' : 'Não foi possível salvar sua escolha. Tente novamente.'
  }
  finally {
    firstRunBusy.value = false
  }
}

async function conversar() {
  if (!canConverse.value)
    return
  busy.value = true
  startBusy.value = true
  error.value = undefined
  stopFeedback.value = undefined
  try {
    const result = await props.api.conversar()
    if (result?.ok === false)
      error.value = startBlockedMessage(result.code)
  }
  catch {
    error.value = props.language?.startsWith('en') ? 'Could not start the conversation. Try again or open Diagnostics.' : 'Não foi possível iniciar a conversa. Tente novamente ou abra Diagnósticos.'
  }
  finally {
    busy.value = false
    startBusy.value = false
    emit('refresh')
  }
}

async function encerrarConversa() {
  if (busy.value || conversationStopping.value || !stopVisible.value)
    return
  busy.value = true
  stopBusy.value = true
  error.value = undefined
  stopFeedback.value = undefined
  try {
    const result = await props.api.stopStage()
    if (result?.phase === 'stopped')
      stopFeedback.value = stopMessages.value.success
    else
      error.value = stopMessages.value.error
  }
  catch {
    error.value = stopMessages.value.error
  }
  finally {
    busy.value = false
    stopBusy.value = false
    emit('refresh')
  }
}
</script>

<template>
  <section class="home" aria-labelledby="home-title">
    <div class="home-hero-visual">
      <img :src="liaHero" alt="" class="home-hero-image">
    </div>
    <div class="home-narrative">
      <div class="home-identity">
        <p class="home-greeting">
          {{ text.greeting }}
        </p>
        <h1 id="home-title" class="home-title">
          Lia
        </h1>
        <p class="home-subtitle">
          {{ text.tagline }}
        </p>
      </div>

      <div class="home-state">
        <div class="home-actions">
          <LiaButton
            class="home-action"
            variant="primary"
            :disabled="!canConverse"
            :aria-busy="checking || starting || stopping"
            :aria-describedby="needsAi ? 'home-readiness-hint' : undefined"
            @click="conversar"
          >
            {{ conversationLabel }}
            <svg v-if="canConverse && !running" aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 12h15m-7-7 7 7-7 7" />
            </svg>
          </LiaButton>
          <LiaButton
            v-if="stopVisible || stopBusy"
            class="home-secondary"
            :disabled="busy || stopping"
            @click="encerrarConversa"
          >
            {{ stopping ? stopMessages.stopping : stopMessages.label }}
          </LiaButton>
        </div>

        <div class="home-status" role="status" aria-atomic="true">
          <p v-if="!statusFailed && !starting && !stopping && !running" class="home-readiness" :class="`home-readiness--${aiChip.variant}`">
            {{ aiChip.label }}
          </p>
          <p class="home-voice">
            {{ text.voice }}: {{ voiceChip.label }}
          </p>
        </div>

        <div
          v-if="checking || starting || stopping"
          class="home-progress"
          role="progressbar"
          :aria-label="stopping ? stopMessages.stopping : conversationLabel"
        />

        <div v-if="needsAi" class="home-help">
          <p id="home-readiness-hint">
            {{ blockerHint }}
          </p>
          <button class="home-link" type="button" aria-describedby="home-readiness-hint" @click="emit('open-ai')">
            {{ text.configure }}
          </button>
        </div>

        <p v-if="stopFeedback" class="home-feedback" role="status">
          {{ stopFeedback }}
        </p>

        <div v-if="visibleError" class="home-help">
          <p class="home-error" role="alert">
            {{ visibleError }}
          </p>
          <div class="home-recovery">
            <button class="home-link" type="button" @click="refreshStatus">
              {{ text.refresh }}
            </button>
            <button class="home-link" type="button" @click="emit('open-diagnostics')">
              {{ text.diagnostics }}
            </button>
          </div>
        </div>

        <LiaPanel v-if="firstRunVisible" class="home-first-run">
          <h2 class="home-first-run-title">
            {{ text.welcome }}
          </h2>
          <div class="home-first-run-choices">
            <div class="home-first-run-choice">
              <LiaButton class="home-secondary" aria-describedby="home-complete-note" :disabled="firstRunBusy" @click="chooseFirstRun('complete')">
                {{ text.complete }}
              </LiaButton>
              <p id="home-complete-note">
                {{ text.completeNote }}
              </p>
            </div>
            <div class="home-first-run-choice">
              <LiaButton class="home-secondary" aria-describedby="home-text-note" :disabled="firstRunBusy" @click="chooseFirstRun('textOnly')">
                {{ text.textOnly }}
              </LiaButton>
              <p id="home-text-note">
                {{ text.textNote }}
              </p>
            </div>
          </div>
        </LiaPanel>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home {
  position: relative;
  isolation: isolate;
  display: grid;
  align-items: center;
  min-block-size: 100%;
  min-width: 0;
  background: var(--r04-wide-glow), var(--r04-lowest);
  color: var(--r04-ink);
  font-family: var(--r04-font);
}

.home-hero-visual {
  position: absolute;
  z-index: -1;
  inset: 0 auto 0 0;
  width: 70%;
  pointer-events: none;
  mask-image: linear-gradient(90deg, black 55%, var(--r04-mask-strong) 64%, var(--r04-mask-medium) 71%, var(--r04-mask-faint) 81%, transparent);
}

.home-hero-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 49% 48%;
}

.home-narrative {
  margin-inline: 50% 7%;
  max-width: 426px;
  min-width: 0;
  padding-block: 24px;
  overflow-wrap: anywhere;
}

.home-identity {
  margin-bottom: 31px;
}

.home-greeting {
  margin: 0 0 4px;
  color: var(--r04-focus);
  font-size: 21px;
  line-height: 1.35;
  font-weight: 600;
  letter-spacing: -.015em;
}

.home-title {
  margin: 0;
  font-size: 94px;
  line-height: .99;
  letter-spacing: -.061em;
  font-weight: 800;
  text-shadow: 0 8px 34px var(--r04-lowest);
}

.home-subtitle {
  margin: 12px 0 0;
  font-size: 19px;
  line-height: 1.45;
  font-weight: 500;
}

.home-subtitle,
.home-status,
.home-help,
.home-feedback,
.home-first-run-choice p {
  color: var(--r04-muted);
  text-shadow: 0 2px 14px var(--r04-lowest);
}

.home-state {
  display: grid;
  align-content: start;
  justify-items: start;
  gap: 12px;
  min-height: 205px;
}

.home-actions,
.home-recovery,
.home-first-run-choices {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  max-width: 100%;
}

.home-actions {
  width: 100%;
}

.home .home-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  min-height: 52px;
  min-width: min(100%, 242px);
  max-width: 100%;
  padding: 12px 18px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--r04-primary);
  color: var(--r04-on-primary);
  font: 800 15px/1.2 var(--r04-font);
}

.home .home-action:hover:not(:disabled) {
  box-shadow: inset 0 0 0 1px var(--r04-on-primary);
}

.home .home-action:disabled {
  background: var(--r04-highest);
  color: var(--r04-muted);
  opacity: 1;
}

.home .home-secondary {
  min-height: 44px;
  max-width: 100%;
  background: var(--r04-high);
  color: var(--r04-ink);
  font: 700 13px/1.3 var(--r04-font);
}

.home .home-secondary:hover:not(:disabled) {
  border-color: var(--r04-outline);
}

.home .home-link {
  min-height: 44px;
  padding: 4px 2px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--r04-ink);
  font: 700 13px/1.3 var(--r04-font);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.home .home-link:hover {
  color: var(--r04-focus);
}

.home .home-action:focus-visible,
.home .home-secondary:focus-visible,
.home .home-link:focus-visible {
  outline: 2px solid var(--r04-focus);
  outline-offset: 2px;
}

.home-status {
  display: grid;
  gap: 4px;
  font-size: 13px;
  line-height: 1.4;
  font-weight: 600;
}

.home-status p,
.home-help p,
.home-feedback,
.home-first-run-choice p {
  margin: 0;
}

.home-readiness {
  display: flex;
  align-items: center;
  gap: 8px;
}

.home-readiness::before {
  content: '';
  flex: 0 0 7px;
  block-size: 7px;
  border-radius: 50%;
  background: var(--r04-muted);
}

.home-readiness--ready::before {
  background: var(--r04-mint);
}

.home-readiness--warning::before {
  background: var(--r04-lavender);
}

.home-voice {
  font-size: 12px;
}

.home-progress {
  width: min(184px, 100%);
  height: 4px;
  overflow: hidden;
  border-radius: 4px;
  background: var(--r04-highest);
}

.home-progress::before {
  content: '';
  display: block;
  width: 34%;
  height: 100%;
  background: var(--r04-focus);
  animation: home-progress 1.5s ease-in-out infinite alternate;
}

@keyframes home-progress {
  to { transform: translateX(194%); }
}

.home-help,
.home-feedback,
.home-first-run-choice p {
  font-size: 14px;
  line-height: 1.5;
}

.home-help .home-error {
  padding-inline-start: 12px;
  border-inline-start: 2px solid var(--r04-error);
  color: var(--r04-error);
}

.home .home-first-run {
  width: 100%;
  padding: 16px;
  border: 1px solid var(--r04-rule);
  background: var(--r04-surface);
}

.home-first-run-title {
  margin: 0 0 12px;
  font-size: 18px;
  line-height: 24px;
  font-weight: 600;
}

.home-first-run-choice {
  display: grid;
  align-content: start;
  justify-items: start;
  flex: 1 1 130px;
  gap: 6px;
}

@media (max-width: 1040px) {
  .home {
    background: var(--r04-compact-glow), var(--r04-lowest);
  }

  .home-hero-visual {
    inset: 0 0 0 auto;
    width: 69%;
    mask-image: linear-gradient(90deg, transparent, var(--r04-mask-soft) 15%, black 40%),
      linear-gradient(180deg, black 73%, transparent);
    mask-composite: intersect;
  }

  .home-hero-image {
    object-position: 48% 44%;
  }

  .home-narrative {
    margin-inline: clamp(32px, 8.5%, 74px) 10%;
    max-width: 350px;
  }

  .home-identity {
    margin-bottom: 26px;
  }

  .home-greeting,
  .home-subtitle {
    font-size: 17px;
  }

  .home-title {
    font-size: 75px;
  }

  .home-subtitle {
    margin-top: 9px;
  }
}

@media (max-width: 720px) {
  .home {
    align-items: start;
  }

  .home-hero-visual {
    inset: 0 0 auto;
    width: 100%;
    height: 290px;
    mask-image: linear-gradient(black 70%, transparent);
  }

  .home-hero-image {
    object-position: 47% 28%;
  }

  .home-narrative {
    margin: 0;
    max-width: none;
    padding: 253px clamp(16px, 5vw, 42px) 30px;
  }

  .home-title {
    font-size: 65px;
  }

  .home-state {
    min-height: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-progress::before {
    animation: none;
  }
}

@media (forced-colors: active) {
  .home .home-action:focus-visible,
  .home .home-secondary:focus-visible,
  .home .home-link:focus-visible {
    outline-color: Highlight;
  }
}
</style>
