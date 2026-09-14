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
 * ## What progress means here
 *
 * Every pixel of progress is the main process's state machine, received over
 * IPC and rendered as-is. The progress deliberately has no percentage and no
 * timer: the honest granularities available are "which step", "which sub-state
 * of the download step" and "is it moving", and a number that moves smoothly
 * while nothing measurable is happening would be a lie the user can catch.
 */
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import { isLiaBootstrapActivePhase } from '../../../../shared/lia-voice'
import { useLiaRuntimeStore } from '../../../stores/lia/runtime'

const { t } = useI18n()
const tt = (key: string, named?: Record<string, string>) => t(`tamagotchi.home.config.sections.voice.${key}`, named)

const runtime = useLiaRuntimeStore()

/** The steps the main process reports, in the order it runs them. */
const steps = computed(() => runtime.bootstrap?.steps ?? [])

/** Whether an install or repair is currently in flight. */
const isRunning = computed(() => isLiaBootstrapActivePhase(runtime.bootstrap?.phase))

/**
 * Whether to present the finished state.
 *
 * Requires the bootstrap to have reached 'ready'; the card is only shown at
 * that point because the section keeps it mounted for the outcome, so a state
 * the runtime manager contradicts cannot present a dead end with no button.
 */
const isReady = computed(() => runtime.bootstrap?.phase === 'ready')
const isFailed = computed(() => runtime.bootstrap?.phase === 'failed')
const isCancelled = computed(() => runtime.bootstrap?.phase === 'cancelled')
/** A failed health check leaves the files in place; repair is the right action. */
const needsRepair = computed(
  () => runtime.bootstrap?.phase === 'repair-needed'
    || (isFailed.value && runtime.bootstrap?.failureCategory === 'health'),
)

/**
 * The one running step's sub-state line, when it has one worth reporting.
 *
 * The download step takes minutes on a slow link, then the extraction takes
 * seconds with no byte counter at all - telling the user which of the two is
 * happening is the difference between "slow" and "stuck". Same for the setup
 * step, which is the longest of all: an environment build, then the component
 * sequence with its real counter. The vocabulary is the bootstrapper's own
 * step detail - tokens, never command names - rendered through i18n so nothing
 * technical reaches the panel; nothing is invented here.
 */
function subStateFor(step: { detail?: string, id: string, status: string }): string {
  if (step.status !== 'running')
    return ''
  if (step.id === 'fetch-source') {
    if (step.detail === 'downloading')
      return tt('runtime.downloading')
    if (step.detail === 'extracting')
      return tt('runtime.extracting')
  }
  if (step.id === 'run-setup') {
    if (step.detail === 'environment')
      return tt('runtime.environment')
    const match = /^components:(\d+)\/(\d+)$/.exec(step.detail ?? '')
    if (match)
      return tt('runtime.components', { done: match[1], total: match[2] })
  }
  return ''
}

/** Mark per step status: ✓ done, spinner running, ○ not started, ✗ failed. */
function markFor(status: string): string {
  switch (status) {
    case 'done':
      return '✓'
    case 'skipped':
      return '✓'
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
      {{ tt('runtime.title') }}
    </h4>

    <p class="text-xs text-neutral-700 font-medium dark:text-neutral-200" data-testid="lia-runtime-install-status">
      <template v-if="isReady">
        {{ tt('runtime.readyTitle') }}
      </template>
      <template v-else-if="isRunning">
        {{ tt('runtime.runningTitle') }}
      </template>
      <template v-else-if="isFailed">
        {{ tt('runtime.failedTitle') }}
      </template>
      <template v-else-if="isCancelled">
        {{ tt('runtime.cancelledTitle') }}
      </template>
      <template v-else>
        {{ tt('runtime.needed') }}
      </template>
    </p>

    <p class="text-xs text-neutral-500 dark:text-neutral-400" data-testid="lia-runtime-install-hint">
      <template v-if="isReady">
        {{ tt('runtime.readyHint') }}
      </template>
      <template v-else-if="isRunning">
        {{ tt('runtime.runningHint') }}
      </template>
      <template v-else-if="!isFailed && !isCancelled">
        {{ tt('runtime.neededHint') }}
      </template>
    </p>

    <!-- The diagnosis sentence the main process produced: one line, never a
         stack trace, and only while failed (cancelled already says everything
         in its title). -->
    <p
      v-if="isFailed"
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

    <!-- Read-only progress, mirroring the state machine as published by the
         main process. The spinner carries the "moving" signal: it is CSS
         animation, not a counter, so nothing on screen can drift ahead of the
         machine it describes. -->
    <ol
      v-if="steps.length > 0"
      class="flex flex-col gap-1.5"
      data-testid="lia-runtime-steps"
      role="status"
    >
      <li
        v-for="step in steps"
        :key="step.id"
        class="flex items-center gap-2"
        :data-testid="`lia-runtime-step-${step.id}`"
      >
        <span
          v-if="step.status === 'running'"
          class="h-3 w-3 text-blue-600"
          :class="['i-svg-spinners:ring-resize']"
          data-testid="lia-runtime-step-spinner"
        />
        <span
          v-else
          class="w-3 text-xs"
          :class="step.status === 'failed' ? 'text-red-600' : 'text-neutral-400'"
        >
          {{ markFor(step.status) }}
        </span>
        <span class="text-xs text-neutral-700 dark:text-neutral-300">
          {{ tt(`runtime.step.${step.id}`) }}
        </span>
        <span
          v-if="subStateFor(step)"
          class="text-xs text-neutral-500 dark:text-neutral-400"
          :data-testid="`lia-runtime-step-substate-${step.id}`"
        >
          {{ subStateFor(step) }}
        </span>
      </li>
    </ol>
  </section>
</template>
