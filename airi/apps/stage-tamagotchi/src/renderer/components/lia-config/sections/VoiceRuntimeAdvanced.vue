<script setup lang="ts">
/**
 * The technical surface of the local voice runtime (item I).
 *
 * Everything here used to sit on the main Voice screen, which meant a first-time
 * user was asked about a server URL, a voices folder and a connection status
 * before they had even chosen a voice. It is now inside "Advanced settings",
 * which is closed by default.
 *
 * Nothing was removed - a developer or a QA engineer still needs all of it to
 * diagnose a failing install. It is only out of the default path.
 *
 * Two rules carried over unchanged:
 * - **No path is ever sent from the renderer.** Both folder pickers run in the
 *   main process; this component asks for them to open and reads back the result.
 * - **No stack traces.** A failure arrives as a short sentence.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLiaAllTalkStore } from '../../../stores/lia/alltalk'
import { useLiaRuntimeStore } from '../../../stores/lia/runtime'

const { t } = useI18n()
const tt = (key: string) => t(`tamagotchi.home.config.sections.voice.custom.${key}`)
const tr = (key: string) => t(`tamagotchi.home.config.sections.voice.runtime.${key}`)

const alltalk = useLiaAllTalkStore()
const runtime = useLiaRuntimeStore()

const baseUrl = ref('')
const removeError = ref('')
const confirmingRemove = ref(false)

const statusKey = computed(() => `states.${alltalk.status.state}`)
const statusDetail = computed(() =>
  alltalk.status.state === 'error' ? alltalk.status.error : '',
)

onMounted(async () => {
  await Promise.all([alltalk.refresh(), runtime.refresh()])
  baseUrl.value = alltalk.config?.baseUrl ?? ''
})

async function onSaveServer(): Promise<void> {
  await alltalk.saveBaseUrl(baseUrl.value.trim())
}

async function onChooseVoicesFolder(): Promise<void> {
  await alltalk.chooseVoicesDir()
}

async function onChooseInstallDir(): Promise<void> {
  await runtime.chooseInstallDir()
}

function onStart(): void {
  void runtime.start()
}

function onStop(): void {
  void runtime.stop()
}

/**
 * Repair re-runs the same idempotent walk as install.
 *
 * Safe to offer unconditionally: it re-checks what exists and only fixes what is
 * missing, so pressing it on a healthy install costs a verification and nothing
 * else. That is what makes it the right answer to "it stopped working".
 */
function onRepair(): void {
  void runtime.runBootstrap(true)
}

/**
 * Remove, behind an inline confirmation.
 *
 * Two-step rather than `window.confirm`, which the lint config forbids and which
 * is also the worse interaction here: a native modal shows no detail about what
 * is about to be deleted. The first click replaces the button with the scope and
 * a second, differently-worded action, so the destructive step is never one
 * stray click away.
 */
function onRemove(): void {
  removeError.value = ''
  if (!confirmingRemove.value) {
    confirmingRemove.value = true
    return
  }
  confirmingRemove.value = false
  void runtime.removeRuntime()
}
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="lia-runtime-advanced">
    <h4 class="text-sm text-neutral-900 font-semibold dark:text-neutral-50">
      {{ tr('title') }}
    </h4>

    <!-- Managed lifecycle: start/stop, which the main screen never exposes -->
    <div class="flex flex-col gap-1">
      <span class="text-xs text-neutral-500 dark:text-neutral-400">
        {{ tr(runtime.state.state) }}
      </span>
      <p
        v-if="runtime.state.state === 'error' && 'message' in runtime.state"
        class="text-xs text-red-600 dark:text-red-400"
        data-testid="lia-runtime-advanced-error"
      >
        {{ runtime.state.message }}
      </p>
      <div class="flex gap-2">
        <button
          type="button"
          class="border border-neutral-200 rounded px-2 py-1 text-sm dark:border-neutral-700"
          :disabled="runtime.isBusy"
          data-testid="lia-runtime-advanced-start"
          @click="onStart"
        >
          {{ tr('retry') }}
        </button>
        <button
          type="button"
          class="border border-neutral-200 rounded px-2 py-1 text-sm dark:border-neutral-700"
          :disabled="runtime.isBusy || runtime.state.state !== 'ready'"
          data-testid="lia-runtime-advanced-stop"
          @click="onStop"
        >
          {{ tr('stop') }}
        </button>
      </div>
    </div>

    <!-- Where it is installed. Chosen by the OS picker, never typed. -->
    <div class="flex flex-col gap-1">
      <span class="text-sm text-neutral-600 dark:text-neutral-300">{{ tr('folderChosen') }}</span>
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        {{ alltalk.config?.installDir || tt('folder.none') }}
      </p>
      <button
        type="button"
        class="w-fit border border-neutral-200 rounded px-2 py-1 text-sm dark:border-neutral-700"
        :disabled="alltalk.isBusy || runtime.isBusy"
        data-testid="lia-runtime-advanced-install-dir"
        @click="onChooseInstallDir"
      >
        {{ tr('chooseFolder') }}
      </button>
    </div>

    <!-- Repair and remove. See onRepair and onRemove for why each is safe. -->
    <div class="flex flex-col gap-2">
      <span class="text-sm text-neutral-600 dark:text-neutral-300">{{ tr('maintenance') }}</span>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="border border-neutral-200 rounded px-2 py-1 text-sm dark:border-neutral-700"
          :disabled="runtime.isBusy"
          data-testid="lia-runtime-advanced-repair"
          @click="onRepair"
        >
          {{ tr('repair') }}
        </button>
        <button
          type="button"
          class="border border-red-200 rounded px-2 py-1 text-sm text-red-700 dark:border-red-900 dark:text-red-400"
          :disabled="runtime.isBusy"
          data-testid="lia-runtime-advanced-remove"
          @click="onRemove"
        >
          <template v-if="confirmingRemove">{{ tr('removeConfirm') }}</template>
          <template v-else>{{ tr('remove') }}</template>
        </button>
      </div>
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        {{ tr('removeHint') }}
      </p>
      <p
        v-if="removeError"
        class="text-xs text-red-600 dark:text-red-400"
        data-testid="lia-runtime-advanced-remove-error"
      >
        {{ removeError }}
      </p>
    </div>

    <!-- Speech server address -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-sm text-neutral-600 dark:text-neutral-300">{{ tt('server.label') }}</span>
        <span
          class="text-xs font-medium"
          :data-testid="`lia-alltalk-status-${alltalk.status.state}`"
          :class="{
            'text-emerald-600 dark:text-emerald-400': alltalk.status.state === 'connected',
            'text-amber-600 dark:text-amber-400': alltalk.status.state === 'checking',
            'text-neutral-500 dark:text-neutral-400': alltalk.status.state === 'notConfigured',
            'text-red-600 dark:text-red-400': alltalk.status.state === 'error' || alltalk.status.state === 'offline',
          }"
        >
          {{ tt(statusKey) }}
        </span>
      </div>
      <p v-if="statusDetail" class="text-xs text-red-600 dark:text-red-400">
        {{ statusDetail }}
      </p>

      <div class="flex gap-2">
        <input
          v-model="baseUrl"
          type="text"
          class="w-full border border-neutral-200 rounded bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          :placeholder="tt('server.placeholder')"
          :disabled="alltalk.isBusy"
          data-testid="lia-alltalk-base-url"
        >
        <button
          type="button"
          class="border border-neutral-200 rounded px-2 py-1 text-sm dark:border-neutral-700"
          :disabled="alltalk.isBusy"
          data-testid="lia-alltalk-save-server"
          @click="onSaveServer"
        >
          {{ tt('server.save') }}
        </button>
      </div>
    </div>

    <!-- The server's own voices folder -->
    <div class="flex flex-col gap-1">
      <span class="text-sm text-neutral-600 dark:text-neutral-300">{{ tt('folder.label') }}</span>
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        {{ alltalk.config?.voicesDir || tt('folder.none') }}
      </p>
      <div class="flex gap-2">
        <button
          type="button"
          class="border border-neutral-200 rounded px-2 py-1 text-sm dark:border-neutral-700"
          :disabled="alltalk.isBusy"
          data-testid="lia-alltalk-choose-folder"
          @click="onChooseVoicesFolder"
        >
          {{ tt('folder.choose') }}
        </button>
        <button
          v-if="alltalk.isConfigured"
          type="button"
          class="rounded px-2 py-1 text-sm text-neutral-500 dark:text-neutral-400"
          :disabled="alltalk.isBusy"
          data-testid="lia-alltalk-clear-folder"
          @click="alltalk.clearVoicesDir()"
        >
          {{ tt('folder.clear') }}
        </button>
      </div>
    </div>
  </section>
</template>
