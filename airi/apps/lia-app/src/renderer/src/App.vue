<script setup lang="ts">
/**
 * The Lia launcher shell (Phase 7, architecture item 16): dark/magenta
 * identity, top product bar with status chips, left-side navigation,
 * content stage, and a lower log strip fed by never-secret host events.
 * Architecture + working features first - the concept art chamber stays
 * for a later pass (item 19).
 */
import { computed, onMounted, reactive, ref } from 'vue'

import ConfigView from './views/ConfigView.vue'
import DiagnosticsView from './views/DiagnosticsView.vue'
import HomeView from './views/HomeView.vue'
import VoiceView from './views/VoiceView.vue'

type Page = 'config' | 'diagnostics' | 'home' | 'voice'

const page = ref<Page>('home')
const status = ref<any>(undefined)
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

function push(line: string) {
  logLines.push(`[${new Date().toLocaleTimeString()}] ${line}`)
  if (logLines.length > 200)
    logLines.splice(0, logLines.length - 200)
}

const chips = computed(() => {
  const s = status.value
  if (!s)
    return [{ label: 'iniciando…', tone: 'dim' }]
  return [
    {
      label: s.ai.ready ? 'IA pronta' : 'IA a configurar',
      tone: s.ai.ready ? 'ok' : 'warn',
    },
    {
      label: s.alltalk.installed
        ? `voz: ${s.alltalk.phase}`
        : (s.alltalk.installDir ? 'voz: instalação não encontrada' : 'voz: não configurada'),
      tone: s.alltalk.installed ? (s.alltalk.phase === 'ready' ? 'ok' : 'warn') : 'dim',
    },
    {
      label: s.stage.available ? `stage: ${s.stage.state.phase}` : 'stage: indisponível',
      tone: s.stage.available ? (s.stage.state.phase === 'running' ? 'ok' : 'dim') : 'err',
    },
  ]
})

const nav: { icon: string, id: Page, label: string }[] = [
  { icon: '●', id: 'home', label: 'Início' },
  { icon: '⚙', id: 'config', label: 'Configuração' },
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

onMounted(() => {
  void refresh()
  api.value?.onLiaEvent?.((payload: { detail?: string, event: string }) => {
    push(`${payload.event}${payload.detail ? ` ${payload.detail}` : ''}`)
    void refresh()
  })
})
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">L</span>
        <span class="brand-name">Lia</span>
      </div>
      <div class="chips">
        <span v-for="chip in chips" :key="chip.label" class="chip">
          <span class="dot" :class="chip.tone" />
          {{ chip.label }}
        </span>
      </div>
    </header>

    <div class="body">
      <nav class="nav">
        <button
          v-for="item in nav"
          :key="item.id"
          class="nav-item"
          :class="{ active: page === item.id }"
          @click="page = item.id"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <main class="stage">
        <component :is="current" :status="status" :api="api" @refresh="refresh" />
      </main>
    </div>

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
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.topbar {
  align-items: center;
  background: var(--lia-panel);
  border-bottom: 1px solid var(--lia-border);
  display: flex;
  justify-content: space-between;
  padding: 12px 20px;
}

.brand { align-items: center; display: flex; gap: 12px; }
.brand-mark {
  align-items: center;
  background: linear-gradient(135deg, var(--lia-magenta), var(--lia-magenta-soft));
  border-radius: 10px;
  color: #fff;
  display: inline-flex;
  font-size: 20px;
  font-weight: 800;
  height: 36px;
  justify-content: center;
  width: 36px;
}
.brand-name { font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }

.chips { display: flex; gap: 10px; }

.body { display: flex; flex: 1; min-height: 0; }

.nav {
  background: var(--lia-panel);
  border-right: 1px solid var(--lia-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 10px;
  width: 180px;
}

.nav-item {
  align-items: center;
  background: transparent;
  border: none;
  border-radius: 10px;
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  text-align: left;
}

.nav-item:hover { background: var(--lia-panel-2); }
.nav-item.active { background: var(--lia-panel-2); border: 1px solid var(--lia-magenta); }
.nav-icon { width: 18px; }

.stage { flex: 1; overflow-y: auto; padding: 22px 26px; }

.logbar {
  background: var(--lia-panel);
  border-top: 1px solid var(--lia-border);
  display: flex;
  gap: 14px;
  max-height: 120px;
  padding: 8px 20px;
}
.log-title { color: var(--lia-text-dim); font-size: 11px; text-transform: uppercase; }
.log-lines { color: var(--lia-text-dim); font-family: 'Consolas', monospace; font-size: 11px; overflow-y: auto; }
.log-empty { font-style: italic; }
</style>
