<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{ api: any, status: any }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

const busy = ref(false)
const error = ref<string | undefined>(undefined)

const stageLabel = computed(() => {
  const phase = props.status?.stage?.state?.phase
  if (phase === 'running')
    return 'Conversando…'
  if (phase === 'starting')
    return 'Abrindo o palco…'
  return 'Conversar com Lia'
})

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
    <div class="avatar card">
      <div class="avatar-ring">
        <span class="avatar-letter">L</span>
      </div>
      <h1>Lia</h1>
      <p class="dim">
        sua companhia de desktop
      </p>
    </div>

    <div class="actions card">
      <button class="primary big" :disabled="busy || status?.stage?.state?.phase === 'starting'" @click="conversar">
        {{ stageLabel }}
      </button>
      <p v-if="error" class="error">
        {{ error }}
      </p>
      <p v-if="status && !status.ai.ready" class="hint">
        A Lia ainda precisa da configuração de IA para conversar — veja a aba Configuração.
      </p>
    </div>
  </section>
</template>

<style scoped>
.home { display: flex; flex-direction: column; gap: 18px; }

.avatar { align-items: center; display: flex; flex-direction: column; padding: 40px 20px; text-align: center; }
.avatar-ring {
  align-items: center;
  border: 2px solid var(--lia-magenta);
  border-radius: 50%;
  display: flex;
  height: 120px;
  justify-content: center;
  margin-bottom: 18px;
  width: 120px;
}
.avatar-letter {
  background: linear-gradient(135deg, var(--lia-magenta), var(--lia-magenta-soft));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-size: 56px;
  font-weight: 800;
}
.dim { color: var(--lia-text-dim); }

.actions { align-items: center; display: flex; flex-direction: column; gap: 10px; }
.big { font-size: 16px; padding: 14px 34px; }
.error { color: var(--lia-err); font-size: 13px; }
.hint { color: var(--lia-warn); font-size: 13px; }
</style>
