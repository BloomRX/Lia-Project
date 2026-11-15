<script setup lang="ts">
import type { PresenceConfig } from '../../../../shared/eventa/lia-presence'

import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLiaPresenceStore } from '../../../stores/lia/presence'

const store = useLiaPresenceStore()
const { t } = useI18n({ useScope: 'local', messages: {
  'pt-BR': {
    title: 'Presença da Lia',
    intro: 'Escolha como a Lia ocupa sua área de trabalho.',
    tamagotchi: 'Modo Estático · Tamagotchi',
    free: 'Modo Livre',
    staticInfo: 'Mantém a experiência atual da personagem, sem movimentação automática.',
    freeInfo: 'A personagem se move em tamanho reduzido, dentro da área disponível.',
    loading: 'Carregando presença…',
    saving: 'Salvando…',
    error: 'Não foi possível atualizar a presença. Tente novamente.',
    retry: 'Tentar novamente',
    paused: 'Pausar movimento',
    pinned: 'Fixar na posição',
    hover: 'Ocultar ao passar o mouse',
    top: 'Sempre no topo',
    fullscreen: 'Pausar quando a janela da Lia estiver em tela cheia',
    fullscreenInfo: 'Tela cheia de outros aplicativos e jogos ainda não é detectada.',
    monitors: 'Permitir todos os monitores',
    monitor: 'Monitor de preferência',
    automatic: 'Monitor atual',
    scale: 'Tamanho da personagem',
    home: 'Voltar para Home',
    setHome: 'Definir posição atual como Home',
    inactive: 'A presença será aplicada ao abrir a personagem.',
    multi: 'Com todos os monitores permitidos, a Lia troca de monitor sem atravessar espaços vazios.',
  },
  'en': {
    title: 'Lia presence',
    intro: 'Choose how Lia uses your desktop.',
    tamagotchi: 'Static mode · Tamagotchi',
    free: 'Free mode',
    staticInfo: 'Keeps the current character experience without automatic movement.',
    freeInfo: 'The character moves at a smaller size within the available area.',
    loading: 'Loading presence…',
    saving: 'Saving…',
    error: 'Could not update presence. Try again.',
    retry: 'Try again',
    paused: 'Pause movement',
    pinned: 'Pin in place',
    hover: 'Hide on hover',
    top: 'Always on top',
    fullscreen: 'Pause when the Lia window is fullscreen',
    fullscreenInfo: 'Fullscreen in other apps and games is not detected yet.',
    monitors: 'Allow all monitors',
    monitor: 'Preferred monitor',
    automatic: 'Current monitor',
    scale: 'Character size',
    home: 'Return Home',
    setHome: 'Set current position as Home',
    inactive: 'Presence will apply when you open the character.',
    multi: 'When all monitors are allowed, Lia switches monitors without crossing empty gaps.',
  },
} })
const toggles: { key: keyof Pick<PresenceConfig, 'paused' | 'pinned' | 'hideOnHover' | 'alwaysOnTop' | 'pauseOnFullscreen' | 'allMonitors'>, label: string }[] = [
  { key: 'paused', label: 'paused' },
  { key: 'pinned', label: 'pinned' },
  { key: 'hideOnHover', label: 'hover' },
  { key: 'alwaysOnTop', label: 'top' },
  { key: 'pauseOnFullscreen', label: 'fullscreen' },
  { key: 'allMonitors', label: 'monitors' },
]
function toggle(key: typeof toggles[number]['key'], event: Event) {
  void store.update({ [key]: (event.target as HTMLInputElement).checked })
}
function monitor(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  void store.update({ monitorId: value === '' ? null : Number(value) })
}
onMounted(() => store.refresh())
</script>

<template>
  <section class="presence-section" aria-labelledby="presence-title">
    <h3 id="presence-title">
      {{ t('title') }}
    </h3>
    <p>{{ t('intro') }}</p>
    <p v-if="store.error" role="alert">
      {{ t('error') }}
    </p>
    <button v-if="store.error" type="button" :disabled="store.busy" @click="store.refresh()">
      {{ t('retry') }}
    </button>
    <p v-if="store.busy" role="status">
      {{ t(store.state ? 'saving' : 'loading') }}
    </p>
    <fieldset v-if="store.state" :disabled="store.busy">
      <legend>{{ t('title') }}</legend>
      <div class="presence-modes">
        <label v-for="mode in (['tamagotchi', 'free'] as const)" :key="mode" class="presence-mode" :class="{ selected: store.state.config.mode === mode }">
          <input type="radio" name="lia-presence-mode" :value="mode" :checked="store.state.config.mode === mode" @change="store.update({ mode })">
          <strong>{{ t(mode) }}</strong>
          <span>{{ t(mode === 'free' ? 'freeInfo' : 'staticInfo') }}</span>
        </label>
      </div>
      <p v-if="!store.state.active">
        {{ t('inactive') }}
      </p>
      <div v-if="store.state.config.mode === 'free'" class="presence-options">
        <label>{{ t('scale') }} · {{ Math.round(store.state.config.scale * 100) }}%
          <input type="range" min="0.5" max="1.5" step="0.1" :value="store.state.config.scale" @change="store.update({ scale: Number(($event.target as HTMLInputElement).value) })">
        </label>
        <label v-for="item in toggles" :key="item.key">
          <input type="checkbox" :checked="store.state.config[item.key]" @change="toggle(item.key, $event)">
          {{ t(item.label) }}
        </label>
        <p class="presence-note">
          {{ t('fullscreenInfo') }}
        </p>
        <p v-if="store.state.config.allMonitors" class="presence-note">
          {{ t('multi') }}
        </p>
        <label v-else>{{ t('monitor') }}
          <select :value="store.state.config.monitorId ?? ''" @change="monitor">
            <option value="">{{ t('automatic') }}</option>
            <option v-for="(display, index) in store.state.displays" :key="display.id" :value="display.id">{{ index + 1 }} · {{ display.workArea.width }} × {{ display.workArea.height }}</option>
          </select>
        </label>
        <div class="presence-actions">
          <button type="button" :disabled="!store.state.active" @click="store.action('home')">
            {{ t('home') }}
          </button>
          <button type="button" :disabled="!store.state.active" @click="store.action('set-home')">
            {{ t('setHome') }}
          </button>
        </div>
      </div>
    </fieldset>
  </section>
</template>

<style scoped>
.presence-section { display: grid; gap: 1rem; }
h3, p { margin: 0; }
fieldset { border: 0; padding: 0; min-width: 0; }
legend { position: absolute; width: 1px; height: 1px; overflow: hidden; }
.presence-modes { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: .75rem; }
.presence-mode { display: grid; grid-template-columns: auto 1fr; gap: .5rem; padding: 1rem; border: 1px solid #8d659b70; border-radius: 12px; cursor: pointer; }
.presence-mode.selected { border-color: #e879f9; background: #d946ef12; }
.presence-mode span { grid-column: 2; opacity: .75; font-size: .875rem; }
.presence-options { display: grid; gap: 1rem; margin-top: 1.25rem; }
.presence-options label { display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; }
.presence-note { opacity: .7; font-size: .875rem; }
.presence-actions { display: flex; flex-wrap: wrap; gap: .75rem; }
button, select { background: #201529; color: inherit; border: 1px solid #8d659b70; border-radius: 8px; padding: .6rem .8rem; }
button:disabled, fieldset:disabled { opacity: .55; }
input { accent-color: #e879f9; }
:is(button, input, select):focus-visible { outline: 2px solid #e879f9; outline-offset: 3px; }
</style>
