<script setup lang="ts">
/**
 * The install experience for the local voice system (item D).
 *
 * This is what a non-technical user sees instead of a terminal. It never says
 * "AllTalk", "Python", "XTTS", a port, a URL or a folder path - those live in
 * advanced settings, because naming them here would imply the user has to know
 * what they are.
 *
 * ## Why it is a wizard and not a button that downloads
 *
 * That was audited, and the answer was no. The upstream project ships no official
 * binary release: its installer is an interactive script, it needs Git, MS C++
 * Build Tools and espeak-ng installed first, and there is no versioned,
 * checksummed artifact to verify. A "download and run it for you" button would
 * mean fetching something we cannot check the integrity of and executing it. So
 * the Lia walks the user through the documented steps and, once they point at the
 * folder, takes over from there - detecting, starting and stopping the server
 * itself, which is the part that actually needed automating.
 */
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLiaRuntimeStore } from '../../../stores/lia/runtime'

const { t } = useI18n()
const tt = (key: string) => t(`tamagotchi.home.config.sections.voice.${key}`)

const runtime = useLiaRuntimeStore()

/**
 * Whether to show the step list or just the folder action.
 *
 * The steps come from the main process. If they cannot be read, showing an empty
 * wizard would be worse than showing the one action that always applies, so the
 * card degrades to that.
 */
const showSteps = computed(() => runtime.steps.length > 0)
const doneCount = computed(() => runtime.steps.filter(step => step.done).length)

onMounted(() => {
  void runtime.loadSteps()
})

function onInstall(): void {
  void runtime.loadSteps()
}

function onChooseFolder(): void {
  void runtime.chooseInstallDir()
}
</script>

<template>
  <section
    class="flex flex-col gap-3 border border-neutral-200 rounded-lg p-4 dark:border-neutral-700"
    data-testid="lia-runtime-install"
  >
    <h4 class="text-sm text-neutral-900 font-semibold dark:text-neutral-50">
      {{ tt('runtime.needed') }}
    </h4>
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      {{ tt('runtime.neededHint') }}
    </p>

    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="rounded bg-neutral-900 px-3 py-1 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
        :disabled="runtime.isBusy"
        data-testid="lia-runtime-install-button"
        @click="onInstall"
      >
        {{ tt('runtime.install') }}
      </button>
      <button
        type="button"
        class="border border-neutral-200 rounded px-3 py-1 text-sm dark:border-neutral-700"
        :disabled="runtime.isBusy"
        data-testid="lia-runtime-choose-folder"
        @click="onChooseFolder"
      >
        {{ tt('runtime.chooseFolder') }}
      </button>
    </div>

    <!-- The guided steps. Data from the main process, not hardcoded here. -->
    <div v-if="showSteps" class="flex flex-col gap-2" data-testid="lia-runtime-steps">
      <p class="text-xs text-neutral-900 font-medium dark:text-neutral-50">
        {{ tt('runtime.wizardTitle') }}
      </p>
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        {{ tt('runtime.wizardHint') }}
      </p>
      <ol class="flex flex-col gap-2">
        <li
          v-for="step in runtime.steps"
          :key="step.id"
          class="flex flex-col gap-0.5"
          :data-testid="`lia-runtime-step-${step.id}`"
        >
          <span class="text-sm text-neutral-800 dark:text-neutral-200">
            <template v-if="step.done">✓ </template>
            {{ doneCount }}/{{ runtime.steps.length }} · {{ step.title }}
          </span>
          <span class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ step.detail }}
          </span>
          <a
            v-if="step.link"
            :href="step.link"
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs text-blue-600 dark:text-blue-400"
          >
            {{ step.link }}
          </a>
        </li>
      </ol>
    </div>
  </section>
</template>
