<script setup lang="ts">
import { onMounted, ref } from 'vue'

/**
 * Voice (Phase 7.1, item 6): ready-made voice vs. own voice, the local
 * voice system's status, import via the OS picker, and the ACTIVE profile
 * - all reusing the Lia Core voice behaviors. Zero storage duplication:
 * the library registry stays the single source of truth.
 */
const props = defineProps<{ api: any, status: any }>()

const profiles = ref<any[]>([])
const advanced = ref(false)
const kind = ref<'custom' | 'ready'>('ready')
const busy = ref(false)
const feedback = ref('')
const importName = ref('')

async function reload() {
  profiles.value = await props.api?.listVoices?.() ?? []
  feedback.value = ''
}

onMounted(async () => {
  await reload()
  const preferred = (await props.api?.productConfig?.())?.snapshot?.voice?.tts?.preferred
  kind.value = preferred?.providerId === 'custom-local-voice' ? 'custom' : 'ready'
})

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
      engine: 'alltalk',
      name,
      // AllTalk voice cloning: the file IS the reference audio.
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
    <h2>Como a Lia vai falar?</h2>

    <div class="choices">
      <label class="choice card" :class="{ active: kind === 'ready' }" @click="kind = 'ready'">
        <input v-model="kind" type="radio" value="ready">
        <strong>Voz pronta</strong>
        <span class="dim">rápida para começar, roda em provedor de nuvem configurado</span>
      </label>
      <label class="choice card" :class="{ active: kind === 'custom' }" @click="kind = 'custom'">
        <input v-model="kind" type="radio" value="custom">
        <strong>Minha própria voz</strong>
        <span class="dim">roda no sistema de voz local da Lia</span>
      </label>
    </div>

    <template v-if="kind === 'custom'">
      <div class="card">
        <h3>Sistema de voz</h3>
        <p>
          Estado:
          <strong>{{ status?.alltalk?.installed === undefined ? 'estado desconhecido' : (status.alltalk.installed ? status.alltalk.phase : (status.alltalk.installDir ? 'instalação não encontrada' : 'não instalado')) }}</strong>
        </p>
        <p v-if="status?.alltalk?.installDir" class="dim">
          Pasta: <code>{{ status.alltalk.installDir }}</code>
        </p>
      </div>

      <div class="card">
        <h3>Suas vozes importadas</h3>
        <p v-if="!profiles.length" class="dim">
          Nenhuma voz importada ainda.
        </p>
        <ul v-else>
          <li v-for="p in profiles" :key="p.id">
            {{ p.name }}
            <span class="dim">({{ p.engine || 'desconhecido' }}, {{ p.files?.length ?? 0 }} arquivo(s))</span>
            <button class="inline" :disabled="busy" @click="activateCustom(p)">
              usar esta voz
            </button>
          </li>
        </ul>
        <div class="row">
          <input v-model="importName" class="name" placeholder="Nome da nova voz (opcional)">
          <button :disabled="busy" @click="importVoice">
            {{ busy ? 'Aguarde…' : 'Importar voz' }}
          </button>
        </div>
        <p class="dim field-note">
          Os arquivos são copiados para a biblioteca canônica da Lia — nada é duplicado em outra pasta.
          Criar a voz a partir de amostras guiadas chega numa próxima etapa.
        </p>
      </div>

      <div class="card">
        <button class="link" @click="advanced = !advanced">
          Avançado {{ advanced ? '▾' : '▸' }}
        </button>
        <div v-if="advanced" class="advanced">
          <p class="dim">
            Biblioteca canônica: <code>{{ status?.paths?.voicesRoot }}</code>
          </p>
        </div>
      </div>
    </template>

    <div v-else class="card">
      <h3>Voz pronta</h3>
      <p class="dim">
        A voz pronta usa o provedor configurado na aba Configuração.
      </p>
      <button :disabled="busy" @click="activateReady">
        Ativar voz pronta
      </button>
    </div>

    <p v-if="feedback" class="feedback">
      {{ feedback }}
    </p>
  </section>
</template>

<style scoped>
.voice { display: flex; flex-direction: column; gap: 14px; }
h2 { margin: 0 0 6px; }
h3 { margin: 0 0 10px; }
.choices { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
.choice { align-items: flex-start; display: flex; flex-direction: column; gap: 4px; }
.choice.active { border-color: var(--lia-magenta); }
.dim { color: var(--lia-text-dim); font-size: 13px; }
code { color: var(--lia-magenta); font-size: 12px; word-break: break-all; }
.row { align-items: center; display: flex; gap: 10px; margin-top: 12px; }
.name {
  background: var(--lia-input, #171221);
  border: 1px solid var(--lia-border);
  border-radius: 8px;
  color: inherit;
  padding: 8px 10px;
}
.field-note { font-size: 12px; }
.link { background: none; border: none; color: var(--lia-magenta); padding: 0; }
.advanced { margin-top: 10px; }
ul { margin: 0; padding-left: 18px; }
li { margin: 6px 0; }
.inline { font-size: 12px; margin-left: 8px; }
.feedback { font-size: 13px; margin: 0; }
</style>
