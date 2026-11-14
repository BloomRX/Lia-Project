<script setup lang="ts">
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui'
import { useI18n } from 'vue-i18n'

defineProps<{ open: boolean }>()
const emit = defineEmits<{
  'update:open': [open: boolean]
  'confirm': []
  'cancel': []
}>()
const { t } = useI18n()
</script>

<template>
  <AlertDialogRoot :open="open" @update:open="emit('update:open', $event)">
    <AlertDialogPortal>
      <AlertDialogOverlay :class="['fixed inset-0 z-10000 bg-black/35']" />
      <AlertDialogContent
        :class="[
          'fixed left-1/2 top-1/2 z-10001 w-[min(28rem,calc(100vw-2rem))]',
          'flex flex-col gap-4 rounded-xl p-5 shadow-xl -translate-x-1/2 -translate-y-1/2',
          'bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100',
        ]"
        @escape-key-down="emit('cancel')"
      >
        <AlertDialogTitle class="text-base font-semibold">
          {{ t('stage.chat.actions.delete') }}
        </AlertDialogTitle>
        <AlertDialogDescription class="text-sm leading-relaxed">
          {{ t('stage.chat.actions.delete-description') }}
        </AlertDialogDescription>
        <div class="flex flex-wrap justify-end gap-2">
          <AlertDialogCancel
            :class="[
              'min-h-10 rounded-lg px-4 py-2 text-sm font-medium',
              'bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 dark:focus-visible:outline-primary-300',
            ]"
            @click="emit('cancel')"
          >
            {{ t('stage.chat.actions.cancel') }}
          </AlertDialogCancel>
          <AlertDialogAction
            :class="[
              'min-h-10 rounded-lg px-4 py-2 text-sm font-semibold',
              'bg-red-700 text-white hover:bg-red-800 dark:bg-red-700 dark:hover:bg-red-800',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 dark:focus-visible:outline-red-300',
            ]"
            @click="emit('confirm')"
          >
            {{ t('stage.chat.actions.delete-confirm') }}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
