<script setup lang="ts">
import { OverlayButton } from '@proj-airi/ui'

const props = defineProps<{ buttonStyle?: string }>()
</script>

<template>
  <OverlayButton
    size="sm"
    :class="[
      'p-2!',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 dark:focus-visible:outline-primary-300',
      props.buttonStyle,
    ]"
  >
    <slot />
  </OverlayButton>
</template>
