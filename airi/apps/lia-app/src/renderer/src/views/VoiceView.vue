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

async function reload() {
  profiles.value = await props.api?.listVoices?.() ?? []
  feedback.value = ''
}

async function reloadLocation() {
  runtimeLocation.value = await props.api?.runtimeLocation?.() ?? undefined
}

onMounted(async () => {
  await reload()
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

async function activateReady() {
  busy.value = true
  feedback.value = ''
  try {
    // "Voz pronta" leaves the cloud TTS configured in Config untouched;
    // it only moves the preference OFF the local custom voice, when set.
    const current = (await props.api?.productConfig?.())?.snapshot?.voice?.tts?.preferred
    const preferred = current && current.providerId !== 'custom-local-voice'
      ? current
      : { providerId: 'cloud-voice-provider', voiceId: 'nova' }
    const result = await props.api.updateConfig({
      update: { voice: { tts: { preferred } } },
    })
    feedback.value = result?.status === 'ok'
      ? 'Voz pronta ativada.'
      : `Não foi possível ativar: ${result?.message ?? 'erro desconhecido'}`
  }
  finally {
    busy.value = false
  }
}

async function activateCustom(profile: any) {
  busy.value = true
  feedback.value = ''
  try {
    const result = await props.api.updateConfig({
      update: { voice: { tts: { preferred: { providerId: 'custom-local-voice', voiceId: profile.id } } } },
    })
    feedback.value = result?.status === 'ok'
      ? `"${profile.name}" agora é a voz ativa da Lia.`
      : `Não foi possível ativar: ${result?.message ?? 'erro desconhecido'}`
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
        <strong>Voz pronta</strong>
        <span class="dim">rápida para começar, roda em provedor de nuvem configurado</span>
      </label>
      <label class="choice" :class="{ active: kind === 'custom' }" @click="kind = 'custom'">
        <input v-model="kind" type="radio" value="custom">
        <strong>Minha própria voz</strong>
        <span class="dim">roda no sistema de voz local da Lia</span>
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
            <LiaButton class="use-profile" :disabled="busy" @click="activateCustom(p)">
              usar esta voz
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
          Criar a voz a partir de amostras guiadas chega numa próxima etapa.
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
      <h3>Voz pronta</h3>
      <p class="dim">
        A voz pronta usa o provedor configurado na aba Configuração.
      </p>
      <div class="ready-actions">
        <LiaButton variant="primary" :disabled="busy" @click="activateReady">
          Ativar voz pronta
        </LiaButton>
      </div>
    </LiaPanel>

    <p v-if="feedback" class="feedback">
      {{ feedback }}
    </p>
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
.profile-row .use-profile { margin-left: auto; }

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

.ready-actions { margin-top: var(--lia-space-2); }
.feedback { font-size: var(--lia-text-sm); margin: 0; }
</style>
