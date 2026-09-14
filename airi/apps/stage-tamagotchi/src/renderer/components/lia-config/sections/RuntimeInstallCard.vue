<script setup lang="ts">
/**
 * The install experience for the local voice system.
 *
 * This is what a non-technical user sees instead of a terminal. It never says
 * "AllTalk", "Python", "XTTS", "winget", "Visual C++" or "espeak" - those belong
 * to advanced diagnostics, because naming them here implies the user has to know
 * what they are.
 *
 * ## Why this is one button and not a checklist
 *
 * An earlier revision showed a checklist of things for the user to install by
 * hand, on the reasoning that automated install was not viable. That reasoning
 * was wrong, and re-auditing is what found it: the upstream installer accepts a
 * `-silent` argument that skips its interactive menu entirely, it fetches its own
 * Python into a folder it controls, and it needs no administrator rights. Git,
 * espeak and FFmpeg turned out not to be prerequisites at all - the first two
 * ship inside the tree.
 *
 * So the user now clicks once. The steps below are still shown, because watching
 * *something* happen is what keeps a long download from feeling like a hang - but
 * they are read-only progress, not a to-do list.
 *
 * The progress deliberately has no percentage. The honest granularities available
 * are "which step" and "is it moving", and a number that moves smoothly while
 * nothing measurable is happening would be a lie the user can catch.
 */
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLiaRuntimeStore } from '../../../stores/lia/runtime'

const { t } = useI18n()
const tt = (key: string) => t(`tamagotchi.home.config.sections.voice.${key}`)

const runtime = useLiaRuntimeStore()

/** The steps the main process reports, in the order it runs them. */
const steps = computed(() => runtime.bootstrap?.steps ?? [])

/** Whether an install or repair is currently in flight. */
const isRunning = computed(() => {
  const phase = runtime.bootstrap?.phase
  return phase === 'checking' || phase === 'installing-prerequisites'
    || phase === 'installing-runtime' || phase === 'preparing-model' || phase === 'verifying'
})

/**
 * Whether to present the finished state.
 *
 * Requires the runtime to agree. This card is only mounted when the runtime is
 * missing, so trusting the bootstrap alone would be able to render "Ready" with
 * no button at all - a dead end the user cannot get out of. When the two
 * disagree, fall back to the install prompt instead: the bootstrap is idempotent,
 * so offering it again is always a safe action, whereas claiming success that the
 * runtime contradicts is not.
 */
const isReady = computed(() => runtime.bootstrap?.phase === 'ready' && !runtime.needsInstall)
const isFailed = computed(() => runtime.bootstrap?.phase === 'failed')
const isCancelled = computed(() => runtime.bootstrap?.phase === 'cancelled')
/** A failed health check leaves the files in place; repair is the right action. */
const needsRepair = computed(
  () => runtime.bootstrap?.phase === 'repair-needed'
    || (isFailed.value && runtime.bootstrap?.failureCategory === 'health'),
)

/** Mark per step status: ✓ done, ● running, ○ not started, ✗ failed. */
function markFor(status: string): string {
  switch (status) {
    case 'done':
      return '✓'
    case 'skipped':
      return '✓'
    case 'running':
      return '●'
    case 'failed':
      return '✗'
    default:
      return '○'
  }
}

onMounted(() => {
  // Resuming matters: if the app was closed mid-install, the card should show
  // where it stopped rather than presenting a fresh button.
  void runtime.loadBootstrap()
})

/**
 * One entry point, two meanings.
 *
 * A repair is the same idempotent walk with the intent flag set - the steps
 * re-check what exists and only fix what is missing. Routing both through one
 * handler is what keeps the button's label and its action from drifting apart,
 * which is exactly the bug an unused `onRepair` would have been.
 */
function onPrimaryAction(): void {
  void runtime.runBootstrap(needsRepair.value)
}

function onCancel(): void {
  void runtime.cancelInstall()
}
</script>

<template>
  <section
    class="flex flex-col gap-3 border border-neutral-200 rounded-lg p-4 dark:border-neutral-700"
    data-testid="lia-runtime-install"
  >
    <h4 class="text-sm text-neutral-900 font-semibold dark:text-neutral-50">
      <template v-if="isReady">
        {{ tt('runtime.readyTitle') }}
      </template>
      <template v-else-if="isRunning">
        {{ tt('runtime.runningTitle') }}
      </template>
      <template v-else>
        {{ tt('runtime.needed') }}
      </template>
    </h4>

    <p class="text-xs text-neutral-500 dark:text-neutral-400" data-testid="lia-runtime-install-hint">
      <template v-if="isReady">
        {{ tt('runtime.readyHint') }}
      </template>
      <template v-else-if="isRunning">
        {{ tt('runtime.runningHint') }}
      </template>
      <template v-else>
        {{ tt('runtime.neededHint') }}
      </template>
    </p>

    <!-- Failure and cancellation get their own wording, because "Try again" is
         only useful advice for some kinds of failure. -->
    <p
      v-if="isFailed || isCancelled"
      class="text-xs text-amber-700 dark:text-amber-400"
      data-testid="lia-runtime-install-error"
    >
      {{ runtime.bootstrap?.message }}
    </p>

    <div class="flex flex-wrap gap-2">
      <button
        v-if="!isReady && !isRunning"
        type="button"
        class="rounded bg-neutral-900 px-3 py-1 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
        :disabled="runtime.isBusy"
        data-testid="lia-runtime-install-button"
        @click="onPrimaryAction"
      >
        <template v-if="needsRepair">
          {{ tt('runtime.repair') }}
        </template>
        <template v-else-if="isFailed || isCancelled">
          {{ tt('runtime.retry') }}
        </template>
        <template v-else>
          {{ tt('runtime.install') }}
        </template>
      </button>

      <button
        v-if="isRunning"
        type="button"
        class="border border-neutral-200 rounded px-3 py-1 text-sm dark:border-neutral-700"
        data-testid="lia-runtime-cancel"
        @click="onCancel"
      >
        {{ tt('runtime.cancel') }}
      </button>
    </div>

    <!-- Read-only progress. Data comes from the main process, never hardcoded. -->
    <ol
      v-if="steps.length > 0"
      class="flex flex-col gap-1.5"
      data-testid="lia-runtime-steps"
    >
      <li
        v-for="step in steps"
        :key="step.id"
        class="flex items-center gap-2"
        :data-testid="`lia-runtime-step-${step.id}`"
      >
        <span
          class="w-3 text-xs"
          :class="step.status === 'failed' ? 'text-red-600' : step.status === 'running' ? 'text-blue-600' : 'text-neutral-400'"
        >
          {{ markFor(step.status) }}
        </span>
        <span class="text-xs text-neutral-700 dark:text-neutral-300">
          {{ tt(`runtime.step.${step.id}`) }}
        </span>
      </li>
    </ol>
  </section>
</template>
