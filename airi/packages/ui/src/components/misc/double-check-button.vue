<script setup lang="ts">
import type { ButtonColor, ButtonSize, ButtonVariant } from './button-types'

import { computed, nextTick, ref, useId, watch } from 'vue'

import Button from './button.vue'

const props = withDefaults(defineProps<{
  color?: ButtonColor
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  disabled?: boolean
  loading?: boolean
  /** Accessible name for an icon-only initial action. */
  label?: string
  /** Accessible name for the explicit confirmation action. */
  confirmLabel?: string
  /** Localized cancel label. The slot remains available for existing consumers. */
  cancelLabel?: string
  /** Visible scope/consequence text, associated with both confirmation actions. */
  description?: string
}>(), {
  color: 'red',
  variant: 'primary',
  size: 'md',
  block: false,
  disabled: false,
  loading: false,
})

const emit = defineEmits<{
  (event: 'confirm'): void
  (event: 'cancel'): void
}>()

const slots = defineSlots<{
  'default': (props: Record<string, unknown>) => unknown
  'confirm': (props: Record<string, unknown>) => unknown
  'cancel': (props: Record<string, unknown>) => unknown
  'cancel-botton-icon': (props: Record<string, unknown>) => unknown
}>()

const confirming = ref(false)
const primaryButton = ref<InstanceType<typeof Button>>()
const cancelButton = ref<InstanceType<typeof Button>>()
const descriptionId = useId()
const describedBy = computed(() => confirming.value && props.description ? descriptionId : undefined)

const wrapperClasses = computed(() => [
  'inline-flex flex-col gap-2',
  props.block ? 'w-full' : '',
])

watch(() => props.disabled || props.loading, (disabled) => {
  if (disabled)
    confirming.value = false
})

async function handlePrimaryClick() {
  if (props.disabled || props.loading)
    return
  if (!confirming.value) {
    confirming.value = true
    // Cancel is the safe keyboard destination. Enter on the initial action
    // opens the choice; it never performs the destructive operation.
    await nextTick()
    cancelButton.value?.$el?.focus()
    return
  }

  confirming.value = false
  emit('confirm')
}

async function handleCancel() {
  if (!confirming.value)
    return
  confirming.value = false
  emit('cancel')
  await nextTick()
  primaryButton.value?.$el?.focus()
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !confirming.value || props.disabled || props.loading)
    return
  event.preventDefault()
  event.stopPropagation()
  void handleCancel()
}
</script>

<template>
  <div :class="wrapperClasses" @keydown="handleKeydown">
    <p v-if="confirming && description" :id="descriptionId" class="m-0 text-sm text-neutral-700 dark:text-neutral-200">
      {{ description }}
    </p>
    <TransitionGroup
      name="double-check-slide"
      tag="div"
      :class="['relative flex flex-wrap items-center gap-2']"
    >
      <Button
        v-if="confirming"
        ref="cancelButton"
        key="cancel"
        color="neutral"
        variant="secondary"
        :size="size"
        :block="block"
        :disabled="disabled || loading"
        :aria-describedby="describedBy"
        class="whitespace-nowrap"
        @click="handleCancel"
      >
        <div class="flex items-center gap-2">
          <slot
            v-if="slots['cancel-botton-icon']"
            name="cancel-botton-icon"
          />
          <span><slot name="cancel">{{ cancelLabel ?? 'Cancel' }}</slot></span>
        </div>
      </Button>

      <Button
        ref="primaryButton"
        key="primary"
        :color="color"
        :variant="variant"
        :size="size"
        :block="block"
        :disabled="disabled"
        :loading="loading"
        :aria-label="confirming ? confirmLabel : label"
        :aria-describedby="describedBy"
        :aria-expanded="confirming"
        :class="[
          'double-check-primary whitespace-nowrap',
          'transition-width duration-150 ease-in-out',
          confirming ? 'double-check-primary--confirming' : 'double-check-primary--default',
        ]"
        @click="handlePrimaryClick"
      >
        <span v-if="!confirming">
          <slot />
        </span>
        <span v-else>
          <slot name="confirm">
            <slot />
          </slot>
        </span>
      </Button>
    </TransitionGroup>
  </div>
</template>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  .double-check-slide-move,
  .double-check-slide-enter-active,
  .double-check-slide-leave-active,
  .double-check-primary {
    transition: none;
  }

  .double-check-slide-enter-from,
  .double-check-slide-leave-to {
    transform: none;
  }
}

.double-check-slide-move {
  transition: transform 180ms ease;
}

.double-check-slide-enter-active,
.double-check-slide-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

/* Removing the cancel button from flex flow lets TransitionGroup animate the primary button's layout shift. */
.double-check-slide-leave-active {
  position: absolute;
}

.double-check-slide-enter-from,
.double-check-slide-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

.double-check-primary {
  transition: min-width 180ms ease, padding 180ms ease, transform 180ms ease;
}

.double-check-primary--default {
  min-width: 7rem;
}

.double-check-primary--confirming {
  min-width: 9rem;
}
</style>
