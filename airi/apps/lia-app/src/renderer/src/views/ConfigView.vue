<script setup lang="ts">
import { onMounted, ref } from 'vue'

/**
 * Configuration (Phase 7, architecture item 8): the four product domains -
 * IA, Personalidade, Voz e Aparência - presented read-only from the
 * CANONICAL product document in this slice. Editing keeps the same shape
 * and location in a later slice (no second writer today).
 */
const props = defineProps<{ api: any, status: any }>()

const config = ref<{ filePath: string, snapshot: any, status: string } | undefined>(undefined)

onMounted(async () => {
  config.value = await props.api?.productConfig?.()
})
</script>

<template>
  <section class="config">
    <h2>Configuração</h2>
    <p class="dim">
      Documento canônico: <code>{{ config?.filePath }}</code>
      <span class="badge">{{ config?.status }}</span>
    </p>

    <div class="card">
      <h3>IA</h3>
      <p>
        Provedor preferido:
        <strong>{{ config?.snapshot?.provider?.chat?.preferred?.providerId ?? 'não configurado' }}</strong>
      </p>
      <p>
        Modelo:
        <strong>{{ config?.snapshot?.provider?.chat?.preferred?.modelId ?? '—' }}</strong>
      </p>
      <p>
        Chave de API:
        <strong>{{ status?.ai?.ready ? 'presente' : 'ausente' }}</strong>
      </p>
    </div>

    <div class="card">
      <h3>Personalidade</h3>
      <p>
        Cartão ativo:
        <strong>{{ config?.snapshot?.persona?.activeCardId ?? 'Lia (padrão)' }}</strong>
      </p>
    </div>

    <div class="card">
      <h3>Voz</h3>
      <p>
        Voz preferida:
        <strong>
          <template v-if="config?.snapshot?.voice?.tts?.preferred">
            {{ config.snapshot.voice.tts.preferred.providerId }}<template v-if="config.snapshot.voice.tts.preferred.voiceId">
              / {{ config.snapshot.voice.tts.preferred.voiceId }}
            </template>
          </template>
          <template v-else>não configurada</template>
        </strong>
      </p>
    </div>

    <div class="card">
      <h3>Aparência</h3>
      <p>
        Idioma do produto:
        <strong>{{ config?.snapshot?.preferences?.language || 'herdar do sistema' }}</strong>
      </p>
    </div>

    <p class="hint">
      A edição destes campos pelo launcher chega na próxima etapa — nesta versão eles são lidos do arquivo canônico, sem criar cópias.
    </p>
  </section>
</template>

<style scoped>
.config { display: flex; flex-direction: column; gap: 14px; }
h2 { margin: 0 0 6px; }
h3 { margin: 0 0 10px; }
.card p { margin: 4px 0; }
.dim { color: var(--lia-text-dim); }
code { color: var(--lia-magenta); font-size: 12px; word-break: break-all; }
.badge { border: 1px solid var(--lia-border); border-radius: 6px; font-size: 11px; margin-left: 8px; padding: 2px 8px; }
.hint { color: var(--lia-warn); font-size: 13px; }
</style>
