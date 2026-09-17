<script setup lang="ts">
import { onMounted, ref } from 'vue'

/**
 * Diagnostics / Advanced (Phase 7, architecture item 8): runtime health,
 * install state, stage availability, boot timings (the measured evidence
 * of item 15) and the stage log tail. Non-technical phrasing on the
 * surface; paths and logs one click deeper.
 */
const props = defineProps<{ api: any, status: any }>()

const timings = ref<{ ms: number, name: string }[]>([])
const bridge = ref<any>(undefined)
const runtime = ref<any>(undefined)

onMounted(async () => {
  timings.value = await props.api?.timings?.() ?? []
  bridge.value = await props.api?.bridge?.()
  runtime.value = await props.api?.runtimeState?.()
})

function row(label: string, value: unknown): { label: string, value: string } {
  return { label, value: String(value ?? '—') }
}
</script>

<template>
  <section class="diag">
    <h2>Diagnósticos</h2>

    <div class="card">
      <h3>Resumo</h3>
      <table>
        <tbody>
          <tr
            v-for="r in [
              row('Sistema de voz instalado', status?.alltalk?.installed ? 'sim' : 'não'),
              row('Estado do sistema de voz', status?.alltalk?.phase),
              row('Stage (companhia) disponível', status?.stage?.available ? 'sim' : 'não'),
              row('Estado do stage', status?.stage?.state?.phase),
              row('Vozes importadas', status?.voices?.count),
              row('Documento de configuração', status?.config?.status),
            ]" :key="r.label"
          >
            <td class="dim">
              {{ r.label }}
            </td>
            <td>{{ r.value }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h3>Evidência de inicialização</h3>
      <p v-if="!timings.length" class="dim">
        nenhuma marca registrada ainda
      </p>
      <table v-else>
        <tbody>
          <tr v-for="t in timings" :key="t.name">
            <td class="dim">
              {{ t.name }}
            </td>
            <td>{{ t.ms }} ms</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h3>Contrato com o stage (somente leitura)</h3>
      <pre>{{ bridge }}</pre>
    </div>

    <div class="card">
      <h3>Caminhos canônicos</h3>
      <p class="dim">
        Dados do usuário: <code>{{ status?.paths?.userDataDir }}</code> ({{ status?.paths?.source }})
      </p>
      <p class="dim">
        Biblioteca de vozes: <code>{{ status?.paths?.voicesRoot }}</code>
      </p>
    </div>
  </section>
</template>

<style scoped>
.diag { display: flex; flex-direction: column; gap: 14px; }
h2 { margin: 0 0 6px; }
h3 { margin: 0 0 10px; }
table { border-collapse: collapse; width: 100%; }
td { border-bottom: 1px solid var(--lia-border); font-size: 13px; padding: 6px 4px; }
.dim { color: var(--lia-text-dim); }
code { color: var(--lia-magenta); font-size: 12px; word-break: break-all; }
pre { background: var(--lia-panel-2); border-radius: 10px; font-size: 11px; overflow: auto; padding: 12px; }
</style>
