<script setup lang="ts">
/**
 * Voice section — "How should Lia speak?"
 *
 * A person who has never heard of providerId, modelId or a TTS engine has to be
 * able to configure this. So the tab opens on a single, two-option question and
 * nothing else:
 *
 *   1. Ready-made voice  — pick a voice, hear a sample, done.
 *   2. My own voice      — import a recording; Lia handles the rest.
 *
 * Everything technical still exists, but it lives behind "Advanced settings",
 * which is **closed by default**: the voice provider, the model, the emergency
 * voice, and the local voice server's address and folders.
 *
 * Two invariants this template is careful about:
 *
 * - **One visible choice.** When "My own voice" is active, the ready-made voice
 *   picker is not rendered at all. Showing "Provider: Kokoro / Voice: Heart"
 *   underneath an imported voice reads as "your voice depends on Kokoro", which
 *   is false and confusing.
 * - **`voice.tts` stays the source of truth.** Which of the two modes is active
 *   is *derived* from the persisted selection, never from local component state,
 *   so reopening the tab always shows what is actually in effect.
 */
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import CustomVoicePanel from './CustomVoicePanel.vue'
import RuntimeInstallCard from './RuntimeInstallCard.vue'
import VoiceRuntimeAdvanced from './VoiceRuntimeAdvanced.vue'

import { CUSTOM_VOICE_PROVIDER_ID } from '../../../../shared/lia-voice'
import { useLiaRuntimeStore } from '../../../stores/lia/runtime'
import { useLiaVoiceStore } from '../../../stores/lia/voice'
import { useVoiceEditor } from '../../../stores/lia/voice-editor'
import { createVoicePreviewDriver } from '../../../stores/lia/voice-preview'

const { t } = useI18n()
const tt = (key: string) => t(`tamagotchi.home.config.sections.voice.${key}`)

const voiceStore = useLiaVoiceStore()
const runtime = useLiaRuntimeStore()
const editor = useVoiceEditor({ preview: createVoicePreviewDriver() })

/**
 * Which of the two modes is in effect, derived from the persisted target.
 *
 * This is the whole reason there is no separate "mode" ref: a mode the component
 * remembers could disagree with what is saved, and the tab would then show a
 * choice that is not the one Lia will actually use.
 */
const isCustomVoice = computed(
  () => editor.selectedProviderId.value === CUSTOM_VOICE_PROVIDER_ID,
)

/**
 * Loads the persisted configuration, repairs a card projection left behind by a
 * failed write, and warms the catalogue of whatever is selected. Read-only with
 * respect to `voice.tts`: opening the tab never configures anything.
 */
onMounted(() => {
  void editor.hydrate()
  // The runtime state decides whether the custom-voice path shows an install
  // card or the imported voices, so it is read whenever the tab opens.
  void runtime.refresh()
})

function onChooseReady(): void {
  // Choosing "ready-made voice" means leaving the custom provider. The provider
  // itself is picked in advanced settings; this only has to stop being custom.
  void editor.selectProvider('')
}

function onChooseCustom(): void {
  void editor.selectProvider(CUSTOM_VOICE_PROVIDER_ID)
}

function onVoiceChange(event: Event): void {
  void editor.selectVoice((event.target as HTMLSelectElement).value)
}

function onModelChange(event: Event): void {
  void editor.selectModel((event.target as HTMLSelectElement).value)
}

function onProviderChange(event: Event): void {
  void editor.selectProvider((event.target as HTMLSelectElement).value)
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
    <!-- The one question. No provider, model or engine vocabulary at this level. -->
    <section class="flex flex-col gap-3" data-testid="lia-config-voice-choose">
      <h3 class="text-sm text-neutral-900 font-semibold dark:text-neutral-50">
        {{ tt('choose.title') }}
      </h3>
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        {{ tt('choose.hint') }}
      </p>

      <div class="flex flex-col gap-2">
        <button
          type="button"
          class="flex flex-col gap-0.5 border rounded-lg p-3 text-left transition-colors"
          :class="isCustomVoice
            ? 'border-neutral-200 dark:border-neutral-700'
            : 'border-neutral-900 bg-neutral-50 dark:border-neutral-100 dark:bg-neutral-800'"
          data-testid="lia-config-voice-mode-ready"
          @click="onChooseReady"
        >
          <span class="text-sm text-neutral-900 font-medium dark:text-neutral-50">
            {{ tt('choose.ready') }}
          </span>
          <span class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ tt('choose.readyHint') }}
          </span>
        </button>

        <button
          type="button"
          class="flex flex-col gap-0.5 border rounded-lg p-3 text-left transition-colors"
          :class="isCustomVoice
            ? 'border-neutral-900 bg-neutral-50 dark:border-neutral-100 dark:bg-neutral-800'
            : 'border-neutral-200 dark:border-neutral-700'"
          data-testid="lia-config-voice-mode-custom"
          @click="onChooseCustom"
        >
          <span class="text-sm text-neutral-900 font-medium dark:text-neutral-50">
            {{ tt('choose.custom') }}
          </span>
          <span class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ tt('choose.customHint') }}
          </span>
        </button>
      </div>
    </section>

    <!--
      Mode 1: a ready-made voice.

      Only a friendly voice list and a "hear a sample" button. The provider that
      supplies those voices is deliberately not shown here - it is an advanced
      detail, and naming it invites the user to think they have to configure it.
    -->
    <section
      v-if="!isCustomVoice"
      class="flex flex-col gap-3"
      data-testid="lia-config-voice-primary"
    >
      <h3 class="text-sm text-neutral-900 font-semibold dark:text-neutral-50">
        {{ tt('primary.title') }}
      </h3>

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
        v-else-if="editor.voiceCatalogState.value === 'needsConfiguration'"
        class="text-xs text-amber-600 dark:text-amber-400"
        data-testid="lia-config-voice-needs-config"
      >
        {{ tt('catalog.needsConfiguration') }}
      </p>

      <p
        v-else-if="editor.voiceCatalogState.value === 'error'"
        class="text-xs text-red-500 dark:text-red-400"
        data-testid="lia-config-voice-catalog-error"
      >
        {{ tt('catalog.error') }}
      </p>

      <p
        v-else-if="editor.voiceCatalogState.value === 'empty'"
        class="text-xs text-neutral-500 dark:text-neutral-400"
        data-testid="lia-config-voice-no-catalog"
      >
        {{ tt('catalog.empty') }}
        <template v-if="editor.voiceCatalogComesFromProviderSettings.value">
          {{ tt('catalog.fromProviderSettings') }}
        </template>
      </p>

      <p
        v-else-if="editor.voiceCatalogState.value === 'loading'"
        class="text-xs text-neutral-400 dark:text-neutral-500"
        data-testid="lia-config-voice-catalog-loading"
      >
        {{ tt('catalog.loading') }}
      </p>

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

    <!--
      Mode 2: my own voice.

      The install card replaces the voice list when the local runtime is missing,
      so the user is never shown an import button that cannot work.
    -->
    <section
      v-else
      class="flex flex-col gap-4"
      data-testid="lia-config-voice-custom-mode"
    >
      <!-- The card is an either/or with the voice panel only before anything
           exists. After a run, both show: the card carries the outcome (the
           "pronto" the user earned, or the failure with its retry) and the
           panel carries on with the voices. A session that never ran the
           bootstrap shows only the panel.
           Round-7 addendum: a runtime state the probe cannot classify
           ('error') still mounts the card. The runtime is then by definition
           not working, and a panel with zero paths to repair was the exact
           regression that hid the Install button. -->
      <RuntimeInstallCard v-if="runtime.needsInstall || runtime.bootstrapOutcome || runtime.state.state === 'error'" />
      <CustomVoicePanel v-if="!runtime.needsInstall" />
    </section>

    <!--
      Advanced settings.

      Closed by default, and the only place the technical surface appears: the
      voice provider, the model, the emergency voice, and the local server. A
      `<details>` element gives real disclosure semantics for free - the browser
      keeps it closed, and nothing here has to remember whether it was open.
    -->
    <details
      class="flex flex-col gap-4 border border-neutral-200 rounded-lg p-3 dark:border-neutral-700"
      data-testid="lia-config-voice-advanced"
    >
      <summary class="cursor-pointer text-sm text-neutral-900 font-semibold dark:text-neutral-50">
        {{ tt('advanced.title') }}
      </summary>
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        {{ tt('advanced.hint') }}
      </p>

      <!-- Voice provider -->
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

      <!-- Model, only when the selected provider actually has a catalogue -->
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

      <!--
        Emergency voice.

        Renamed from "backup voice" and moved in here on purpose: a second voice
        picker on the main screen reads as a second decision the user has to
        make, when in fact the fallback keeps working whether or not they ever
        open this panel.
      -->
      <section class="flex flex-col gap-3" data-testid="lia-config-voice-reserve">
        <h4 class="text-sm text-neutral-900 font-semibold dark:text-neutral-50">
          {{ tt('reserve.title') }}
        </h4>
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
          v-else-if="editor.fallbackVoiceCatalogState.value === 'needsConfiguration'"
          class="text-xs text-amber-600 dark:text-amber-400"
          data-testid="lia-config-voice-reserve-needs-config"
        >
          {{ tt('catalog.needsConfiguration') }}
        </p>

        <p
          v-else-if="editor.fallbackVoiceCatalogState.value === 'error'"
          class="text-xs text-red-500 dark:text-red-400"
          data-testid="lia-config-voice-reserve-catalog-error"
        >
          {{ tt('catalog.error') }}
        </p>

        <p
          v-else-if="editor.fallbackVoiceCatalogState.value === 'empty'"
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

      <!-- The local voice server: address, folders and manual start/stop. -->
      <VoiceRuntimeAdvanced />
    </details>

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
