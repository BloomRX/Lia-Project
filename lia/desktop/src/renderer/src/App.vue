<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'

import LiaStatusChip from './components/lia/LiaStatusChip.vue'
import AiResourcesView from './views/AiResourcesView.vue'
import ConfigView from './views/ConfigView.vue'
import DiagnosticsView from './views/DiagnosticsView.vue'
import HomeView from './views/HomeView.vue'
import VoiceView from './views/VoiceView.vue'

import { LIA_VOICE_READINESS_EVENT, voiceStatusChipVariant, voiceStatusChipVm } from './components/voice-engine-card.vm'
import { pickVoiceEngineLocale } from './voice-engine-strings'

type Page = 'config' | 'diagnostics' | 'home' | 'voice' | 'ai'

const page = ref<Page>('home')
const main = ref<HTMLElement | null>(null)
const status = ref<any>(undefined)
const statusError = ref(false)
// Phase 7.9H-B2: the voice chip reads the SAME provisioning readiness
// state the Voice page shows (7.9H source of truth - one state model).
const readiness = ref<any>(undefined)
const language = ref<string | undefined>(undefined)
// Phase 8.0A-5: the canonical first-run marker, read from the SAME product
// config snapshot the shell already fetches (no second source, no direct
// file reads). Home decides what to show with it; nothing is gated by it.
const setup = ref<{ completed?: boolean } | undefined>(undefined)
const logLines = reactive<string[]>([])

const api = computed(() => (window as any).liaApi)
const text = computed(() => pickVoiceEngineLocale(language.value) === 'en-US'
  ? { home: 'Home', ai: 'AI & Resources', voice: 'Voice', diagnostics: 'Diagnostics', config: 'Settings', nav: 'Launcher navigation', voicePrefix: 'voice', log: 'Log', emptyLog: 'quiet here', statusFailed: 'Could not refresh the status.' }
  : { home: 'Início', ai: 'IA & Recursos', voice: 'Voz', diagnostics: 'Diagnósticos', config: 'Configuração', nav: 'Navegação do Launcher', voicePrefix: 'voz', log: 'Log', emptyLog: 'silêncio por aqui', statusFailed: 'Não foi possível atualizar o estado.' })
let unsubscribe: (() => void) | undefined
let configRequest = 0
let statusRequest = 0

async function refreshConfig() {
  const request = ++configRequest
  try {
    const config = await api.value?.productConfig?.()
    if (request !== configRequest || config?.status !== 'ok')
      return
    language.value = config?.snapshot?.preferences?.language
    setup.value = config?.snapshot?.setup
  }
  catch {
    // Preserve the last saved locale if the document cannot be read.
  }
}

async function refresh() {
  if (!api.value)
    return
  const request = ++statusRequest
  try {
    const nextStatus = await api.value.homeStatus()
    if (request === statusRequest) {
      status.value = nextStatus
      statusError.value = false
    }
  }
  catch {
    if (request === statusRequest) {
      statusError.value = true
      push(text.value.statusFailed)
    }
  }
}

async function refreshVoiceReadiness() {
  if (!api.value)
    return
  try {
    readiness.value = await api.value.voiceProvisioningState?.()
  }
  catch {
    // The chip degrades to its honest unknown face; the next rail event
    // or refresh retries.
  }
}

function push(line: string) {
  logLines.push(`[${new Date().toLocaleTimeString(pickVoiceEngineLocale(language.value))}] ${line}`)
  if (logLines.length > 200)
    logLines.splice(0, logLines.length - 200)
}

const voiceChip = computed(() => voiceStatusChipVm(readiness.value, language.value))

/** Chip tone -> the LiaStatusChip semantic variant (the shared mapping). */
const voiceVariant = computed(() => voiceStatusChipVariant(voiceChip.value.tone))

const navGroups: Page[][] = [
  ['home', 'ai', 'voice'],
  ['config', 'diagnostics'],
]

const icons: Record<Page, string> = {
  home: 'M5 10.5 12 5l7 5.5V20h-5v-6h-4v6H5z',
  ai: 'M6 6h12v12H6zM9 9h6v6H9zM9 3v3m6-3v3m-6 12v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3',
  voice: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3ZM6 10v1a6 6 0 0 0 12 0v-1m-6 7v4m-3 0h6',
  config: 'M10 3h4l.6 2.2 2 .9 2-.9 2 3.5-1.5 1.6v3.4l1.5 1.6-2 3.5-2-.9-2 .9L14 21h-4l-.6-2.2-2-.9-2 .9-2-3.5 1.5-1.6v-3.4L3.4 8.7l2-3.5 2 .9 2-.9zM15 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0z',
  diagnostics: 'm3 12 4-5 3 3 6-6 2 2 3-3m-5 17a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm3-1 2 2',
}

async function openFromHome(destination: 'ai' | 'diagnostics') {
  page.value = destination
  await nextTick()
  main.value?.focus({ preventScroll: true })
}

watch(page, () => main.value?.scrollTo({ top: 0, left: 0 }), { flush: 'post' })

const current = computed(() => {
  switch (page.value) {
    case 'ai': return AiResourcesView
    case 'config': return ConfigView
    case 'diagnostics': return DiagnosticsView
    case 'voice': return VoiceView
    default: return HomeView
  }
})

onMounted(() => {
  void refresh()
  void refreshVoiceReadiness()
  unsubscribe = api.value?.onLiaEvent?.((payload: { detail?: string, event: string }) => {
    push(`${payload.event}${payload.detail ? ` ${payload.detail}` : ''}`)
    // A log line changes the diagnostic feed, not product state. Avoid a
    // product-document read for every chunk of Stage stdout.
    if (payload.event === LIA_VOICE_READINESS_EVENT)
      void refreshVoiceReadiness()
    if (payload.event === 'lia-app.config-updated')
      void refreshConfig()
    if (payload.event !== 'lia-app.stage-log')
      void refresh()
  })
  void refreshConfig()
})

onUnmounted(() => unsubscribe?.())
</script>

<template>
  <div class="shell">
    <nav class="sidebar" :aria-label="text.nav">
      <div
        v-for="group in navGroups"
        :key="group[0]"
        class="sidebar-nav"
        :class="{ 'sidebar-footer': group[0] === 'config' }"
      >
        <button
          v-for="destination in group"
          :key="destination"
          type="button"
          class="nav-item"
          :class="{ settings: destination === 'config' }"
          :aria-label="text[destination]"
          :aria-current="page === destination ? 'page' : undefined"
          :title="text[destination]"
          @click="page = destination"
        >
          <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path :d="icons[destination]" />
          </svg>
          <span class="nav-label">{{ text[destination] }}</span>
        </button>
      </div>
    </nav>

    <div class="main">
      <header v-if="page !== 'home'" class="contextbar">
        <LiaStatusChip :variant="voiceVariant">
          {{ text.voicePrefix }}: {{ voiceChip.label }}
        </LiaStatusChip>
      </header>

      <main ref="main" class="stage" :class="{ 'stage-home': page === 'home' }" tabindex="-1">
        <component
          :is="current"
          :status="status"
          :api="api"
          :language="language"
          v-bind="page === 'home' ? { readiness, setup, statusError } : {}"
          @refresh="refresh"
          @open-ai="openFromHome('ai')"
          @open-diagnostics="openFromHome('diagnostics')"
        />
      </main>

      <footer v-if="page === 'diagnostics'" class="logbar">
        <div class="log-title">
          {{ text.log }}
        </div>
        <div class="log-lines">
          <div v-for="(line, i) in logLines.slice(-6)" :key="i">
            {{ line }}
          </div>
          <div v-if="!logLines.length" class="log-empty">
            {{ text.emptyLog }}
          </div>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.shell {
  background: var(--lia-bg-app);
  color: var(--lia-text-primary);
  display: flex;
  height: 100vh;
}

.sidebar {
  align-items: center;
  background: var(--r04-canvas);
  border-right: 1px solid var(--r04-rule, var(--lia-border-subtle));
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  font-family: var(--r04-font, var(--lia-foundation-font));
  gap: 12px;
  overflow-y: auto;
  padding: 29px 0 24px;
  scrollbar-width: none;
  width: 88px;
}

.sidebar-nav {
  display: grid;
  gap: 12px;
  justify-items: center;
}

.sidebar-footer {
  margin-top: auto;
}

.sidebar-footer .nav-item {
  width: 80px;
  padding-inline: 1px;
}

.nav-item {
  align-items: center;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--r04-muted);
  display: flex;
  flex-direction: column;
  font: inherit;
  font-size: 11px;
  font-weight: 650;
  gap: 5px;
  justify-content: center;
  line-height: 1.13;
  min-height: 56px;
  padding: 6px 3px;
  position: relative;
  text-align: center;
  width: 68px;
}

.nav-item:hover {
  box-shadow: inset 0 0 0 1px var(--r04-outline);
}

.nav-item[aria-current='page'] {
  background: var(--r04-selection);
  color: var(--r04-selection-text);
}

.nav-item[aria-current='page']::before {
  background: currentColor;
  border-radius: 2px;
  content: '';
  inset: 15px auto 15px 0;
  position: absolute;
  width: 2px;
}

.nav-item:focus-visible {
  outline-color: var(--r04-focus);
}

.nav-icon {
  flex: none;
  height: 21px;
  width: 21px;
}

.nav-label {
  max-width: 100%;
  overflow-wrap: anywhere;
}

@media (forced-colors: active) {
  .nav-item:focus-visible {
    outline-color: Highlight;
  }
}

/* ---- Main column ------------------------------------------------------- */
.main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

/* Context bar: status-oriented, minimal by design (§8). */
.contextbar {
  align-items: center;
  background: var(--lia-bg-surface);
  border-bottom: 1px solid var(--lia-border-subtle);
  display: flex;
  justify-content: flex-end;
  padding: var(--lia-space-2) var(--lia-space-6);
}

/* Content stage: consistent token spacing, independent scroll. */
.stage {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  padding: var(--lia-space-6);
}

.stage:focus-visible {
  outline-offset: -2px;
}

.stage-home {
  background: var(--r04-lowest);
  color-scheme: dark;
  padding: 0;
}

/* Functional footer: the bounded never-secret event log strip. */
.logbar {
  background: var(--lia-bg-surface);
  border-top: 1px solid var(--lia-border-subtle);
  display: flex;
  gap: var(--lia-space-4);
  max-height: 120px;
  padding: var(--lia-space-2) var(--lia-space-6);
}
.log-title {
  color: var(--lia-text-secondary);
  font-size: var(--lia-text-xs);
  text-transform: uppercase;
}
.log-lines {
  color: var(--lia-text-secondary);
  font-family: 'Consolas', monospace;
  font-size: var(--lia-text-xs);
  overflow-y: auto;
}
.log-empty {
  font-style: italic;
}

@media (max-width: 1040px) {
  .sidebar {
    width: 76px;
  }

  .nav-item {
    font-size: 10px;
    letter-spacing: -0.025em;
    min-height: 54px;
    padding-inline: 2px;
    width: 66px;
  }

  .sidebar-footer .nav-item {
    width: 70px;
  }
}

@media (max-width: 720px), (max-height: 620px) {
  .sidebar {
    padding-block: 18px;
  }
}

@media (max-height: 400px) {
  .sidebar {
    padding-block: 12px;
  }

  .sidebar,
  .sidebar-nav {
    gap: 6px;
  }
}

@media (max-width: 480px) {
  .sidebar {
    width: 64px;
  }

  .nav-item {
    font-size: 9px;
    width: 56px;
  }

  .sidebar-footer .nav-item {
    width: 60px;
  }
}
</style>
