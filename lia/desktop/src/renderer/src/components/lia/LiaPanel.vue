<script setup lang="ts">
/**
 * LiaPanel (Phase 8.0A-1): the standard Lia surface primitive.
 *
 * Presentation ONLY: tokens supply the surface background, subtle border,
 * shared radius and padding; content rides the default slot. No product
 * logic, no page-specific props.
 */
</script>

<template>
  <section class="lia-panel">
    <slot />
  </section>
</template>

<style scoped>
.lia-panel {
  background: var(--lia-bg-surface);
  border: 1px solid var(--lia-border-subtle);
  border-radius: var(--lia-radius-lg);
  padding: var(--lia-space-4) var(--lia-space-6);
}
</style>
