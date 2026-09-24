<script setup lang="ts">
/**
 * The Lia app shell (Phase 8.0A-2, over the Phase 7 launcher): a stable
 * persistent frame built on the 8.0A-1 design tokens + primitives.
 *
 *   sidebar (brand once / nav / settings footer) │ context bar
 *                                                │ content stage
 *                                                │ functional log footer
 *
 * Shell/layout ONLY: view switching, provisioning, voice readiness, Stage
 * launch and every product behavior are carried over untouched. Pages are
 * NOT redesigned in this phase; the brand appears exactly ONCE (top-left),
 * global settings live in the sidebar footer (LIA-UI-DESIGN-SYSTEM §6-7),
 * and the top area keeps ONE useful global status - the voice readiness,
 * rendered with LiaStatusChip from the SAME provisioning source of truth
 * the Voice page uses (§8 contextual priority, no technical-chip rows).
 */
import { computed, onMounted, reactive, ref } from 'vue'

import LiaStatusChip from './components/lia/LiaStatusChip.vue'
import ConfigView from './views/ConfigView.vue'
import DiagnosticsView from './views/DiagnosticsView.vue'
import HomeView from './views/HomeView.vue'
import VoiceView from './views/VoiceView.vue'

import { LIA_VOICE_READINESS_EVENT, voiceStatusChipVariant, voiceStatusChipVm } from './components/voice-engine-card.vm'

type Page = 'config' | 'diagnostics' | 'home' | 'voice'

const page = ref<Page>('home')
const status = ref<any>(undefined)
// Phase 7.9H-B2: the voice chip reads the SAME provisioning readiness
// state the Voice page shows (7.9H source of truth - one state model).
const readiness = ref<any>(undefined)
const language = ref<string | undefined>(undefined)
const logLines = reactive<string[]>([])

const api = computed(() => (window as any).liaApi)

async function refresh() {
  if (!api.value)
    return
  try {
    status.value = await api.value.homeStatus()
  }
  catch (error) {
    push(`home status failed: ${String(error)}`)
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
  logLines.push(`[${new Date().toLocaleTimeString()}] ${line}`)
  if (logLines.length > 200)
    logLines.splice(0, logLines.length - 200)
}

const voiceChip = computed(() => voiceStatusChipVm(readiness.value, language.value))

/** Chip tone -> the LiaStatusChip semantic variant (the shared mapping). */
const voiceVariant = computed(() => voiceStatusChipVariant(voiceChip.value.tone))

/**
 * The persistent middle navigation. Global settings intentionally live in
 * the sidebar FOOTER gear (§7) - every destination stays reachable.
 */
const nav: { icon: string, id: Page, label: string }[] = [
  { icon: '●', id: 'home', label: 'Início' },
  { icon: '🎙', id: 'voice', label: 'Voz' },
  { icon: '◧', id: 'diagnostics', label: 'Diagnósticos' },
]

const current = computed(() => {
  switch (page.value) {
    case 'config': return ConfigView
    case 'diagnostics': return DiagnosticsView
    case 'voice': return VoiceView
    default: return HomeView
  }
})

onMounted(async () => {
  void refresh()
  void refreshVoiceReadiness()
  try {
    const config = await api.value?.productConfig?.()
    language.value = config?.snapshot?.preferences?.language
  }
  catch {
    // Language stays the pt-BR product default - never fatal.
  }
  api.value?.onLiaEvent?.((payload: { detail?: string, event: string }) => {
    push(`${payload.event}${payload.detail ? ` ${payload.detail}` : ''}`)
    // Readiness transitions refresh the chip from the source of truth;
    // everything else keeps the legacy whole-status refresh.
    if (payload.event === LIA_VOICE_READINESS_EVENT)
      void refreshVoiceReadiness()
    void refresh()
  })
})
</script>

<template>
  <div class="shell">
    <!-- Persistent sidebar: brand ONCE (top), nav (middle), settings (footer). -->
    <aside class="sidebar">
      <div class="sidebar-brand">
        <span class="brand-mark" aria-hidden="true">L</span>
        <span class="brand-name">Lia</span>
      </div>

      <nav class="sidebar-nav">
        <button
          v-for="item in nav"
          :key="item.id"
          class="nav-item"
          :class="{ active: page === item.id }"
          :aria-label="item.label"
          @click="page = item.id"
        >
          <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
          <span class="nav-label">{{ item.label }}</span>
        </button>
      </nav>

      <!-- Functional footer: global settings belong here (§7), never in the
           top status area. No duplicated branding, no version invention. -->
      <div class="sidebar-footer">
        <button
          class="nav-item settings"
          :class="{ active: page === 'config' }"
          aria-label="Configuração"
          @click="page = 'config'"
        >
          <span class="nav-icon" aria-hidden="true">⚙</span>
          <span class="nav-label">Configuração</span>
        </button>
      </div>
    </aside>

    <div class="main">
      <!-- Minimal context bar: ONE useful global status (voice readiness,
           from the provisioning source of truth). No technical-chip rows. -->
      <header class="contextbar">
        <LiaStatusChip :variant="voiceVariant">
          voz: {{ voiceChip.label }}
        </LiaStatusChip>
      </header>

      <main class="stage">
        <!-- Home additionally consumes the shell's readiness facts (same
             source of truth - never a second state model); other views are
             untouched and receive nothing extra. -->
        <component
          :is="current"
          :status="status"
          :api="api"
          v-bind="page === 'home' ? { language, readiness } : {}"
          @refresh="refresh"
        />
      </main>

      <footer class="logbar">
        <div class="log-title">
          Log
        </div>
        <div class="log-lines">
          <div v-for="(line, i) in logLines.slice(-6)" :key="i">
            {{ line }}
          </div>
          <div v-if="!logLines.length" class="log-empty">
            silêncio por aqui
          </div>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* The persistent frame: a fixed sidebar column + a fluid main column.
   Everything below consumes 8.0A-1 semantic tokens - no raw colors. */
.shell {
  background: var(--lia-bg-app);
  color: var(--lia-text-primary);
  display: flex;
  height: 100vh;
}

/* ---- Sidebar ---------------------------------------------------------- */
.sidebar {
  background: var(--lia-bg-surface);
  border-right: 1px solid var(--lia-border-subtle);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  padding: var(--lia-space-4) var(--lia-space-3);
  width: 180px;
}

/* The ONE brand surface (§6): compact mark + name, top-left, never repeated. */
.sidebar-brand {
  align-items: center;
  display: flex;
  gap: var(--lia-space-3);
  padding: var(--lia-space-1) var(--lia-space-2) var(--lia-space-4);
}
.brand-mark {
  align-items: center;
  background: linear-gradient(135deg, var(--lia-accent), var(--lia-accent-soft));
  border-radius: var(--lia-radius-md);
  color: var(--lia-accent-contrast);
  display: inline-flex;
  font-size: var(--lia-text-xl);
  font-weight: var(--lia-font-bold);
  height: 36px;
  justify-content: center;
  width: 36px;
}
.brand-name {
  font-size: var(--lia-text-xl);
  font-weight: var(--lia-font-bold);
  letter-spacing: 0.5px;
}

.sidebar-nav {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--lia-space-1);
}

.sidebar-footer {
  border-top: 1px solid var(--lia-border-subtle);
  padding-top: var(--lia-space-3);
}

.nav-item {
  align-items: center;
  background: transparent;
  border: none;
  border-radius: var(--lia-radius-md);
  color: var(--lia-text-primary);
  display: flex;
  font-size: var(--lia-text-md);
  gap: var(--lia-space-3);
  padding: var(--lia-space-2) var(--lia-space-3);
  text-align: left;
  transition: background var(--lia-transition-fast) ease, border-color var(--lia-transition-fast) ease;
}
.nav-item:hover {
  background: var(--lia-bg-surface-raised);
}
.nav-item.active {
  background: var(--lia-bg-surface-raised);
  border: 1px solid var(--lia-border-accent);
}
.nav-item:focus-visible {
  box-shadow: var(--lia-focus-ring);
  outline: none;
}
.nav-icon {
  width: 18px;
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
  min-width: 0;
  overflow-y: auto;
  padding: var(--lia-space-6);
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

/* ---- Window safety ------------------------------------------------------
   Narrower launcher widths collapse the sidebar to an icon rail (labels
   stay reachable through aria-labels). This is layout tolerance only -
   NOT a mobile navigation system. */
@media (max-width: 640px) {
  .sidebar {
    padding: var(--lia-space-3) var(--lia-space-2);
    width: 56px;
  }
  .brand-name,
  .nav-label {
    display: none;
  }
  .sidebar-brand {
    justify-content: center;
    padding-left: 0;
    padding-right: 0;
  }
  .nav-item {
    justify-content: center;
    padding-left: var(--lia-space-2);
    padding-right: var(--lia-space-2);
  }
}
</style>
