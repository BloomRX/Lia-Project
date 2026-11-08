<script setup lang="ts">
import { LIA_DEFAULT_PERSONA } from '@proj-airi/stage-ui/constants/lia-persona'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { createPersonalityDraft, PERSONALITY_TRAITS, preparePersonalityCard } from '../../../services/lia/personality-editor'

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      identity: 'Identidade',
      note: 'Ajuste o tom da personagem. A identidade, os limites e suas regras personalizadas são preservados.',
      traits: 'Traços de comportamento',
      context: 'Contexto base',
      save: 'Salvar personalidade',
      saving: 'Salvando…',
      reset: 'Redefinir traços para o padrão',
      cancel: 'Descartar alterações',
      saved: 'Personalidade salva.',
      error: 'Não foi possível salvar. Confira os valores e tente novamente.',
      missing: 'Esta personagem não tem uma personalidade estruturada para editar.',
      changed: 'A personalidade mudou em outra janela. Descarte as alterações para carregar os valores atuais.',
      confidence: 'Confiança',
      affection: 'Carinho',
      shyness: 'Timidez',
      teasing: 'Provocação',
      sarcasm: 'Sarcasmo',
      humor: 'Humor',
      curiosity: 'Curiosidade',
      energy: 'Energia',
      kindness: 'Gentileza',
      proactivity: 'Iniciativa',
    },
    'en': {
      identity: 'Identity',
      note: 'Adjust the character’s tone. Identity, boundaries and your custom rules are preserved.',
      traits: 'Behavior traits',
      context: 'Base context',
      save: 'Save personality',
      saving: 'Saving…',
      reset: 'Reset traits to defaults',
      cancel: 'Discard changes',
      saved: 'Personality saved.',
      error: 'Could not save. Check the values and try again.',
      missing: 'This character has no structured personality to edit.',
      changed: 'Personality changed in another window. Discard changes to load the current values.',
      confidence: 'Confidence',
      affection: 'Affection',
      shyness: 'Shyness',
      teasing: 'Teasing',
      sarcasm: 'Sarcasm',
      humor: 'Humor',
      curiosity: 'Curiosity',
      energy: 'Energy',
      kindness: 'Kindness',
      proactivity: 'Initiative',
    },
  },
})
const cardStore = useAiriCardStore()
const persona = computed(() => cardStore.activeCard?.extensions.airi.persona)
const draft = ref(persona.value ? createPersonalityDraft(persona.value) : undefined)
const baseline = ref(JSON.stringify(persona.value))
const saving = ref(false)
const feedback = ref<'saved' | 'error' | ''>('')
const dirty = computed(() => !!persona.value && JSON.stringify(draft.value) !== JSON.stringify(createPersonalityDraft(persona.value)))
const conflict = computed(() => baseline.value !== JSON.stringify(persona.value))
function reload() {
  draft.value = persona.value ? createPersonalityDraft(persona.value) : undefined
  baseline.value = JSON.stringify(persona.value)
  feedback.value = ''
}
watch(() => cardStore.activeCardId, reload)
watch(persona, () => {
  if (!draft.value)
    reload()
})
function reset() {
  if (!draft.value || !persona.value)
    return
  draft.value.attributes = { ...LIA_DEFAULT_PERSONA.attributes }
  if (persona.value.intensity.contexts.some(context => context.id === LIA_DEFAULT_PERSONA.intensity.defaultContextId))
    draft.value.contextId = LIA_DEFAULT_PERSONA.intensity.defaultContextId
  feedback.value = ''
}
async function save() {
  if (!draft.value || !cardStore.activeCard || conflict.value || saving.value)
    return
  const id = cardStore.activeCardId
  saving.value = true
  feedback.value = ''
  try {
    const card = preparePersonalityCard(cardStore.activeCard, draft.value)
    if (!await cardStore.updateCard(id, card))
      throw new Error('missing-card')
    if (cardStore.activeCardId === id) {
      reload()
      feedback.value = 'saved'
    }
  }
  catch {
    feedback.value = 'error'
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="save">
    <p v-if="!persona || !draft" class="text-sm text-neutral-500" data-testid="lia-config-personality-missing">
      {{ t('missing') }}
    </p>
    <template v-else>
      <div class="border border-pink-300/30 rounded-xl bg-pink-400/5 p-3">
        <p class="font-medium" data-testid="lia-config-personality-name">
          {{ t('identity') }}: {{ persona.identity.name }} · <span data-testid="lia-config-personality-style">{{ persona.preset }}</span>
        </p>
        <p class="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
          {{ t('note') }}
        </p>
      </div>
      <fieldset :disabled="saving" class="flex flex-col gap-3">
        <legend class="mb-3 text-sm font-semibold">
          {{ t('traits') }}
        </legend>
        <label v-for="key in PERSONALITY_TRAITS" :key="key" class="grid grid-cols-[7rem_1fr_3rem] items-center gap-3 text-sm">
          <span>{{ t(key) }}</span>
          <input v-model.number="draft.attributes[key]" :aria-label="t(key)" type="range" min="0" max="1" step="0.01" class="w-full accent-pink-500" @input="feedback = ''">
          <output class="text-right tabular-nums">{{ Math.round(draft.attributes[key] * 100) }}%</output>
        </label>
        <label class="mt-2 flex flex-col gap-2 text-sm">
          <span>{{ t('context') }}</span>
          <select v-model="draft.contextId" class="border border-neutral-300 rounded-lg bg-transparent p-2 dark:border-neutral-700" @change="feedback = ''">
            <option v-for="context in persona.intensity.contexts" :key="context.id" :value="context.id">{{ context.label }}</option>
          </select>
        </label>
        <p class="text-xs text-neutral-500 dark:text-neutral-400">
          {{ persona.intensity.contexts.find(context => context.id === draft?.contextId)?.guidance }}
        </p>
        <div class="flex flex-wrap gap-2">
          <button type="submit" :disabled="!dirty || conflict" class="rounded-lg bg-pink-600 px-3 py-2 text-sm text-white disabled:opacity-50">
            {{ t(saving ? 'saving' : 'save') }}
          </button>
          <button type="button" class="border border-neutral-300 rounded-lg px-3 py-2 text-sm dark:border-neutral-700" @click="reset">
            {{ t('reset') }}
          </button>
          <button type="button" :disabled="!dirty && !conflict" class="rounded-lg px-3 py-2 text-sm disabled:opacity-50" @click="reload">
            {{ t('cancel') }}
          </button>
        </div>
      </fieldset>
      <p v-if="conflict" role="alert" class="text-sm text-amber-600 dark:text-amber-300">
        {{ t('changed') }}
      </p>
      <p v-if="feedback" :role="feedback === 'error' ? 'alert' : 'status'" class="text-sm">
        {{ t(feedback) }}
      </p>
    </template>
  </form>
</template>
