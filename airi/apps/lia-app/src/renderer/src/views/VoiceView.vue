<script setup lang="ts">
import { onMounted, ref } from 'vue'

/**
 * Voice (Phase 7, architecture item 8): the existing Lia voice UX concepts -
 * ready-made voice vs. own voice, custom voice system status, import,
 * create, collapsed advanced - reading from the canonical voice library.
 * Import/create flows reuse the Lia Core behaviors in a later slice; this
 * version is the honest status + library view.
 */
const props = defineProps<{ api: any, status: any }>()

const profiles = ref<any[]>([])
const advanced = ref(false)
const kind = ref<'custom' | 'ready'>('ready')

onMounted(async () => {
  profiles.value = await props.api?.listVoices?.() ?? []
})

const engines = (p: any) => (p.engine || 'desconhecido')
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
          <strong>{{ status?.alltalk?.installed ? status.alltalk.phase : (status?.alltalk?.installDir ? 'instalação não encontrada' : 'não instalado') }}</strong>
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
            {{ p.name }} <span class="dim">({{ engines(p) }}, {{ p.files?.length ?? 0 }} arquivo(s))</span>
          </li>
        </ul>
        <div class="row">
          <button disabled>
            Importar voz
          </button>
          <button disabled>
            Criar minha voz
          </button>
        </div>
        <p class="hint">
          Importação e criação pelo launcher habilitam na próxima etapa, reutilizando os comportamentos já existentes no Lia Core.
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
        A voz pronta usa o provedor configurado na aba Configuração. A seleção fina chega com a edição de configuração.
      </p>
    </div>
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
.row { display: flex; gap: 10px; margin-top: 12px; }
.hint { color: var(--lia-warn); font-size: 13px; }
.link { background: none; border: none; color: var(--lia-magenta); padding: 0; }
.advanced { margin-top: 10px; }
ul { margin: 0; padding-left: 18px; }
</style>
