<script setup lang="ts">
/**
 * Voice section — the editable Voz tab (M1 Phase 4E-2, commit 2).
 *
 * A person who has never heard of providerId, modelId or voiceId has to be able
 * to configure how Lia speaks here. So this template only ever renders friendly
 * names taken from the real catalogues, and it hides a field whenever the
 * runtime has nothing real to offer: no model selector without a usable model
 * catalogue, no invented voice list for a provider that ships none.
 *
 * All logic lives in `useVoiceEditor`, which derives every selection from
 * `voice.tts` and writes through the single writer from commit 1. This file
 * binds and translates; it holds no state of its own, so what is on screen
 * cannot drift from what is persisted.
 */
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLiaVoiceStore } from '../../../stores/lia/voice'
import { useVoiceEditor } from '../../../stores/lia/voice-editor'
import { createVoicePreviewDriver } from '../../../stores/lia/voice-preview'

const { t } = useI18n()
const tt = (key: string) => t(`tamagotchi.home.config.sections.voice.${key}`)

const voiceStore = useLiaVoiceStore()
const editor = useVoiceEditor({ preview: createVoicePreviewDriver() })

/**
 * Loads the persisted configuration, repairs a card projection left behind by a
 * failed write, and warms the catalogue of whatever is selected. Read-only with
 * respect to `voice.tts`: opening the tab never configures anything.
 */
onMounted(() => {
  void editor.hydrate()
})

function onProviderChange(event: Event): void {
  void editor.selectProvider((event.target as HTMLSelectElement).value)
}

function onVoiceChange(event: Event): void {
  void editor.selectVoice((event.target as HTMLSelectElement).value)
}

function onModelChange(event: Event): void {
  void editor.selectModel((event.target as HTMLSelectElement).value)
}

function onReserveProviderChange(event: Event): void {
  void editor.selectFallbackProvider((event.target as HTMLSelectElement).value)
}

function onReserveVoiceChange(event: Event): void {
  void editor.selectFallbackVoice((event.target as HTMLSelectElement).value)
}

function onReserveModelChange(event: Event): void {
  void editor.selectFallbackModel((event.target as HTMLSelectElement).value)
}

function onPreview(): void {
  void editor.playPreview()
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Voz principal -->
    <section class="flex flex-col gap-3" data-testid="lia-config-voice-primary">
      <h3 class="text-sm text-neutral-900 font-semibold dark:text-neutral-50">
        {{ tt('primary.title') }}
      </h3>

      <label class="flex flex-col gap-1">
        <span class="text-sm text-neutral-600 dark:text-neutral-300">{{ tt('fields.provider') }}</span>
        <select
          class="w-full border border-neutral-200 rounded bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          :value="editor.selectedProviderId.value"
          :disabled="editor.isSaving.value"
          data-testid="lia-config-voice-provider"
          @change="onProviderChange"
        >
          <option value="">
            {{ tt('primary.none') }}
          </option>
          <option v-for="option in editor.providerOptions.value" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </select>
      </label>

      <label v-if="editor.voiceOptions.value.length > 0" class="flex flex-col gap-1">
        <span class="text-sm text-neutral-600 dark:text-neutral-300">{{ tt('fields.voice') }}</span>
        <select
          class="w-full border border-neutral-200 rounded bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          :value="editor.selectedVoiceId.value"
          :disabled="editor.isSaving.value"
          data-testid="lia-config-voice-voice"
          @change="onVoiceChange"
        >
          <option value="">
            {{ tt('fields.unset') }}
          </option>
          <option v-for="option in editor.voiceOptions.value" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </select>
      </label>

      <!--
        A provider with no voice catalogue of its own. Nothing is invented here:
        the message says where that provider's voice is chosen instead.
      -->
      <p
        v-else-if="editor.hasNoVoiceCatalog.value"
        class="text-xs text-neutral-500 dark:text-neutral-400"
        data-testid="lia-config-voice-no-catalog"
      >
        {{ tt('catalog.empty') }}
        <template v-if="editor.voiceCatalogComesFromProviderSettings.value">
          {{ tt('catalog.fromProviderSettings') }}
        </template>
      </p>

      <p
        v-else-if="editor.isLoadingVoices.value"
        class="text-xs text-neutral-400 dark:text-neutral-500"
      >
        {{ tt('catalog.loading') }}
      </p>

      <label v-if="editor.showModelSelector.value" class="flex flex-col gap-1">
        <span class="text-sm text-neutral-600 dark:text-neutral-300">{{ tt('fields.model') }}</span>
        <select
          class="w-full border border-neutral-200 rounded bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          :value="editor.selectedModelId.value"
          :disabled="editor.isSaving.value"
          data-testid="lia-config-voice-model"
          @change="onModelChange"
        >
          <option value="">
            {{ tt('fields.unset') }}
          </option>
          <option v-for="option in editor.modelOptions.value" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </select>
      </label>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="border border-neutral-200 rounded px-3 py-1 text-sm dark:border-neutral-700"
          :disabled="editor.previewState.value === 'loading' || editor.previewState.value === 'playing'"
          data-testid="lia-config-voice-preview"
          @click="onPreview"
        >
          {{ tt('preview.play') }}
        </button>
        <button
          v-if="editor.previewState.value === 'loading' || editor.previewState.value === 'playing'"
          type="button"
          class="border border-neutral-200 rounded px-3 py-1 text-sm dark:border-neutral-700"
          data-testid="lia-config-voice-preview-cancel"
          @click="editor.cancelPreview()"
        >
          {{ tt('preview.cancel') }}
        </button>
        <span
          v-if="editor.previewState.value === 'loading'"
          class="text-xs text-neutral-500"
          data-testid="lia-config-voice-preview-state"
        >{{ tt('preview.loading') }}</span>
        <span
          v-else-if="editor.previewState.value === 'playing'"
          class="text-xs text-neutral-500"
          data-testid="lia-config-voice-preview-state"
        >{{ tt('preview.playing') }}</span>
        <span
          v-else-if="editor.previewState.value === 'cancelled'"
          class="text-xs text-neutral-500"
          data-testid="lia-config-voice-preview-state"
        >{{ tt('preview.cancelled') }}</span>
        <span
          v-else-if="editor.previewState.value === 'error'"
          class="text-xs text-red-500"
          data-testid="lia-config-voice-preview-state"
        >{{ tt('preview.error') }}</span>
      </div>
    </section>

    <!-- Voz de reserva -->
    <section class="flex flex-col gap-3" data-testid="lia-config-voice-reserve">
      <h3 class="text-sm text-neutral-900 font-semibold dark:text-neutral-50">
        {{ tt('reserve.title') }}
      </h3>
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        {{ tt('reserve.hint') }}
      </p>

      <label class="flex flex-col gap-1">
        <span class="text-sm text-neutral-600 dark:text-neutral-300">{{ tt('fields.provider') }}</span>
        <select
          class="w-full border border-neutral-200 rounded bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          :value="editor.selectedFallbackProviderId.value"
          :disabled="editor.isSaving.value"
          data-testid="lia-config-voice-reserve-provider"
          @change="onReserveProviderChange"
        >
          <option value="">
            {{ tt('reserve.none') }}
          </option>
          <option v-for="option in editor.providerOptions.value" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </select>
      </label>

      <label v-if="editor.fallbackVoiceOptions.value.length > 0" class="flex flex-col gap-1">
        <span class="text-sm text-neutral-600 dark:text-neutral-300">{{ tt('fields.voice') }}</span>
        <select
          class="w-full border border-neutral-200 rounded bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          :value="editor.selectedFallbackVoiceId.value"
          :disabled="editor.isSaving.value"
          data-testid="lia-config-voice-reserve-voice"
          @change="onReserveVoiceChange"
        >
          <option value="">
            {{ tt('fields.unset') }}
          </option>
          <option v-for="option in editor.fallbackVoiceOptions.value" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </select>
      </label>

      <p
        v-else-if="editor.fallbackHasNoVoiceCatalog.value"
        class="text-xs text-neutral-500 dark:text-neutral-400"
        data-testid="lia-config-voice-reserve-no-catalog"
      >
        {{ tt('catalog.empty') }}
      </p>

      <label v-if="editor.showFallbackModelSelector.value" class="flex flex-col gap-1">
        <span class="text-sm text-neutral-600 dark:text-neutral-300">{{ tt('fields.model') }}</span>
        <select
          class="w-full border border-neutral-200 rounded bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          :value="editor.selectedFallbackModelId.value"
          :disabled="editor.isSaving.value"
          data-testid="lia-config-voice-reserve-model"
          @change="onReserveModelChange"
        >
          <option value="">
            {{ tt('fields.unset') }}
          </option>
          <option v-for="option in editor.fallbackModelOptions.value" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </select>
      </label>

      <p
        v-if="editor.fallbackDuplicatesPreferred.value"
        class="text-xs text-amber-600 dark:text-amber-400"
        data-testid="lia-config-voice-reserve-duplicate"
      >
        {{ tt('reserve.duplicate') }}
      </p>
    </section>

    <!-- Erros: sempre visíveis, nunca escondidos -->
    <p
      v-if="editor.saveError.value === 'persist'"
      class="text-xs text-red-500 dark:text-red-400"
      data-testid="lia-config-voice-save-error"
    >
      {{ tt('errors.persist') }}
    </p>
    <p
      v-else-if="editor.saveError.value === 'projection'"
      class="text-xs text-red-500 dark:text-red-400"
      data-testid="lia-config-voice-save-error"
    >
      {{ tt('errors.projection') }}
    </p>
    <p
      v-else-if="editor.saveError.value === 'fallbackIdentical'"
      class="text-xs text-red-500 dark:text-red-400"
      data-testid="lia-config-voice-save-error"
    >
      {{ tt('errors.fallbackIdentical') }}
    </p>

    <p
      class="text-xs"
      :class="voiceStore.loadError
        ? 'text-red-500 dark:text-red-400'
        : 'text-neutral-400 dark:text-neutral-500'"
      data-testid="lia-config-voice-note"
    >
      {{
        voiceStore.loadError
          ? tt('loadError')
          : voiceStore.isLoading
            ? tt('loading')
            : voiceStore.hasConfiguration ? tt('configured') : tt('notConfigured')
      }}
    </p>
  </div>
</template>
