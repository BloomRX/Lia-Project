<script setup lang="ts">
import type { FirstRunChoice } from './home-vm'

/**
 * The Lia Home page (Phase 8.0A-3): character-first, simple, built on the
 * 8.0A-1 tokens + primitives inside the 8.0A-2 shell.
 *
 * The VIEW is declarative only: readiness facts come from the launcher's
 * existing sources (home status prop + the shell's voice readiness,
 * handed down by App.vue - never a second state model), labels from the
 * pure `home-vm`, and the ONE action still rides `api.conversar()` exactly
 * as before. No preparation logic, no runtime knowledge, no invented data.
 */
import { computed, ref } from 'vue'

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
// Phase 8.0A-5: the first-run choice has its OWN busy flag, so choosing
// never touches the Conversar action; success hides the panel locally.
const firstRunBusy = ref(false)
const firstRunDone = ref(false)

const aiChip = computed(() => homeAiChipVm(props.status))
const blockerHint = computed(() => homeBlockerHintVm(props.status))
const conversationLabel = computed(() => homeConversationLabelVm(props.status))
const conversationStarting = computed(() => homeConversationStartingVm(props.status))

const voiceChip = computed(() => voiceStatusChipVm(props.readiness, props.language))
const voiceVariant = computed(() => voiceStatusChipVariant(voiceChip.value.tone))

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
  try {
    const result = await props.api?.updateConfig(firstRunChoicePayload(choice))
    if (result?.status === 'ok') {
      firstRunDone.value = true
      emit('refresh')
    }
  }
  finally {
    firstRunBusy.value = false
  }
}

async function conversar() {
  busy.value = true
  error.value = undefined
  try {
    await props.api.conversar()
  }
  catch (err) {
    if (err instanceof Error)
      error.value = err.message
    else
      error.value = String(err)
  }
  finally {
    busy.value = false
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
        <div class="home-hero-ring">
          <span class="home-hero-letter">L</span>
        </div>
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
        :disabled="busy || conversationStarting"
        @click="conversar"
      >
        {{ conversationLabel }}
      </LiaButton>
      <p v-if="error" class="home-error">
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
  align-items: center;
  display: flex;
  flex-direction: column;
  padding: var(--lia-space-8) var(--lia-space-6);
  text-align: center;
}

/* The hero visual SLOT: sized for the canonical Lia image (a later
   production asset); the wired brand mark occupies it until then. */
.home-hero-visual {
  align-items: center;
  display: flex;
  justify-content: center;
  min-height: 140px;
}
.home-hero-ring {
  align-items: center;
  border: 2px solid var(--lia-border-accent);
  border-radius: 50%;
  display: flex;
  height: 120px;
  justify-content: center;
  width: 120px;
}
.home-hero-letter {
  background: linear-gradient(135deg, var(--lia-accent), var(--lia-accent-soft));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-size: 56px;
  font-weight: var(--lia-font-bold);
}

.home-title {
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
