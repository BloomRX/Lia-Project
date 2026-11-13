<script setup lang="ts">
import type { FirstRunChoice } from './home-vm'

/**
 * The Lia Home page (Phase 8.0A-3): character-first, simple, built on the
 * 8.0A-1 tokens + primitives inside the 8.0A-2 shell.
 *
 * The VIEW is declarative only: readiness facts come from the launcher's
 * existing sources (home status prop + the shell's voice readiness,
 * handed down by App.vue - never a second state model), labels from the
 * pure `home-vm`; conversation controls use the existing start/stop methods.
 * No preparation logic, no invented data.
 */
import { computed, ref } from 'vue'

import liaHero from '../../../../../../../lia/assets/character/LiaHeroImage.png'
import LiaButton from '../components/lia/LiaButton.vue'
import LiaPanel from '../components/lia/LiaPanel.vue'
import LiaStatusChip from '../components/lia/LiaStatusChip.vue'

import { voiceStatusChipVariant, voiceStatusChipVm } from '../components/voice-engine-card.vm'
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
  /** Shell-provided voice readiness (7.9H source of truth). */
  readiness?: any
  /** Shell-provided language preference (pt-BR default). */
  language?: string
  /** Shell-provided first-run marker (canonical product config). */
  setup?: { completed?: boolean }
}>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

const busy = ref(false)
const error = ref<string | undefined>(undefined)
const stopBusy = ref(false)
const stopFeedback = ref<string | undefined>(undefined)
// Phase 8.0A-5: the first-run choice has its OWN busy flag, so choosing
// never touches the Conversar action; success hides the panel locally.
const firstRunBusy = ref(false)
const firstRunDone = ref(false)

const aiChip = computed(() => homeAiChipVm(props.status))
const blockerHint = computed(() => homeBlockerHintVm(props.status))
const conversationLabel = computed(() => homeConversationLabelVm(props.status))
const conversationStarting = computed(() => homeConversationStartingVm(props.status))
const conversationStopping = computed(() => homeConversationStoppingVm(props.status))
const stopVisible = computed(() => homeConversationStopVisibleVm(props.status))
const stopMessages = computed(() => homeConversationStopMessagesVm(props.language))

const voiceChip = computed(() => voiceStatusChipVm(props.readiness, props.language))
const voiceVariant = computed(() => voiceStatusChipVariant(voiceChip.value.tone))

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
  if (busy.value || conversationStarting.value || conversationStopping.value)
    return
  busy.value = true
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
  <section class="home">
    <!-- A. Hero / Lia presence: she is the protagonist (§11-12). The
         visual slot is structured for the canonical hero image; until it
         ships as a production asset, the EXISTING wired brand mark fills
         it - nothing is generated or faked. -->
    <LiaPanel class="home-hero">
      <div class="home-hero-visual" aria-label="Lia" role="img">
        <img :src="liaHero" alt="" class="home-hero-image">
      </div>
      <h1 class="home-title">
        Lia
      </h1>
      <p class="home-subtitle">
        sua companhia de desktop
      </p>

      <!-- B. Primary action: the SAME launch path, untouched behavior. -->
      <LiaButton
        class="home-action"
        variant="primary"
        :disabled="busy || conversationStarting || conversationStopping"
        @click="conversar"
      >
        {{ conversationLabel }}
      </LiaButton>
      <LiaButton
        v-if="stopVisible || stopBusy"
        class="home-stop-action"
        :disabled="busy || conversationStopping"
        @click="encerrarConversa"
      >
        {{ stopBusy || conversationStopping ? stopMessages.stopping : stopMessages.label }}
      </LiaButton>
      <p v-if="stopFeedback" class="home-feedback" role="status">
        {{ stopFeedback }}
      </p>
      <p v-if="error" class="home-error" role="alert">
        {{ error }}
      </p>
    </LiaPanel>

    <!-- Phase 8.0A-5: minimal first-run choice - one compact panel, shown
         until the canonical setup marker is done. It NEVER blocks the
         hero or the status surfaces, and choosing never leaves Home. -->
    <LiaPanel v-if="firstRunVisible" class="home-first-run">
      <h2 class="home-first-run-title">
        Como você quer começar?
      </h2>
      <div class="home-first-run-choices">
        <div class="home-first-run-choice">
          <LiaButton variant="primary" :disabled="firstRunBusy" @click="chooseFirstRun('complete')">
            Completa
          </LiaButton>
          <p class="home-first-run-note">
            Conversa e voz. A Lia prepara a voz automaticamente.
          </p>
        </div>
        <div class="home-first-run-choice">
          <LiaButton :disabled="firstRunBusy" @click="chooseFirstRun('textOnly')">
            Somente texto
          </LiaButton>
          <p class="home-first-run-note">
            Conversa sem voz. Você pode ativá-la depois.
          </p>
        </div>
      </div>
    </LiaPanel>

    <!-- C. Status summary: concise product-level readiness only - never
         paths or infrastructure internals (§12: no dashboard). -->
    <LiaPanel class="home-status">
      <div class="home-status-row">
        <LiaStatusChip :variant="aiChip.variant">
          {{ aiChip.label }}
        </LiaStatusChip>
        <LiaStatusChip :variant="voiceVariant">
          voz: {{ voiceChip.label }}
        </LiaStatusChip>
      </div>
      <p v-if="blockerHint" class="home-hint">
        {{ blockerHint }}
      </p>
    </LiaPanel>
  </section>
</template>

<style scoped>
/* Spacious, character-first Home on semantic tokens only. */
.home {
  display: flex;
  flex-direction: column;
  gap: var(--lia-space-6);
  margin: 0 auto;
  max-width: 760px;
  min-width: 0;
}

/* A. Hero ------------------------------------------------------------ */
.home-hero {
  border-color: var(--lia-border-accent);
  position: relative;
  overflow: hidden;
  align-items: center;
  display: flex;
  flex-direction: column;
  padding: 340px var(--lia-space-6) var(--lia-space-8);
  text-align: center;
}

/* The hero visual SLOT: sized for the canonical Lia image (a later
   production asset); the wired brand mark occupies it until then. */
.home-hero-visual {
  position: absolute;
  inset: 0 0 auto;
  height: 340px;
  overflow: hidden;
  mask-image: linear-gradient(var(--lia-text-primary) 76%, transparent);
}
.home-hero-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 28%;
}

.home-title {
  text-shadow: 0 0 28px var(--lia-accent);
  font-size: var(--lia-text-2xl);
  font-weight: var(--lia-font-bold);
  letter-spacing: 0.5px;
  margin: var(--lia-space-4) 0 0;
}
.home-subtitle {
  color: var(--lia-text-secondary);
  font-size: var(--lia-text-md);
  margin: var(--lia-space-1) 0 0;
}

/* B. Primary action --------------------------------------------------- */
.home-action {
  font-size: var(--lia-text-lg);
  margin-top: var(--lia-space-6);
  padding: var(--lia-space-3) var(--lia-space-8);
}
.home-error {
  color: var(--lia-status-error);
  font-size: var(--lia-text-sm);
  margin: var(--lia-space-3) 0 0;
}
.home-stop-action {
  margin-top: var(--lia-space-3);
}
.home-feedback {
  color: var(--lia-text-secondary);
  font-size: var(--lia-text-sm);
  margin: var(--lia-space-3) 0 0;
}

/* C. Status summary ----------------------------------------------------- */
.home-status-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lia-space-3);
  justify-content: center;
}
.home-hint {
  color: var(--lia-status-warning);
  font-size: var(--lia-text-sm);
  margin: var(--lia-space-3) 0 0;
  text-align: center;
}

/* 8.0A-5 first-run choice: compact, non-blocking, token-only. */
.home-first-run-title {
  font-size: var(--lia-text-lg);
  font-weight: var(--lia-font-medium);
  margin: 0 0 var(--lia-space-4);
}
.home-first-run-choices {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lia-space-6);
}
.home-first-run-choice {
  align-items: flex-start;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--lia-space-2);
  min-width: 220px;
}
.home-first-run-note {
  color: var(--lia-text-secondary);
  font-size: var(--lia-text-sm);
  margin: 0;
}
</style>
