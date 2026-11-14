<script setup lang="ts">
/**
 * LiaButton (Phase 8.0A-1): the Lia button primitive.
 *
 * Presentation ONLY, native semantics BY CONSTRUCTION: the root element IS
 * a real `<button>` and the component declares nothing but the visual
 * `variant` prop - so `disabled`, `type`, click handlers, ARIA attributes
 * and keyboard behavior all fall through to the native element untouched.
 * Disabled is therefore the REAL disabled state; keyboard focus shows the
 * shared focus ring (`:focus-visible` only, so pointer clicks stay clean).
 */
withDefaults(defineProps<{
  /** Visual style only - never behavior. */
  variant?: 'primary' | 'secondary'
}>(), { variant: 'secondary' })
</script>

<template>
  <button class="lia-button" :class="`lia-button--${variant}`">
    <slot />
  </button>
</template>

<style scoped>
.lia-button {
  border-radius: var(--lia-radius-md);
  cursor: pointer;
  font-family: var(--lia-font-family);
  font-size: var(--lia-text-md);
  font-weight: var(--lia-font-medium);
  padding: var(--lia-space-2) var(--lia-space-4);
  min-height: 40px;
  transition: border-color var(--lia-transition-fast) ease, background var(--lia-transition-fast) ease;
}

/* Visible keyboard focus via the shared ring token; pointer stays clean. */
.lia-button:focus-visible {
  box-shadow: var(--lia-focus-ring);
  outline: 2px solid transparent;
  outline-offset: 3px;
}

/* The REAL disabled state (native attribute fall-through). */
.lia-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.lia-button--secondary {
  background: var(--lia-bg-surface-raised);
  border: 1px solid var(--lia-border-subtle);
  color: var(--lia-text-primary);
}
.lia-button--secondary:hover:not(:disabled) {
  border-color: var(--lia-border-accent);
}

.lia-button--primary {
  background: var(--lia-accent-action);
  border: 1px solid var(--lia-accent-action);
  color: var(--lia-accent-contrast);
  font-weight: var(--lia-font-bold);
}
.lia-button--primary:hover:not(:disabled) {
  background: var(--lia-accent-action-hover);
  border-color: var(--lia-accent-action-hover);
}

/* Native focus remains visible in Windows forced-color mode. */
@media (forced-colors: active) {
  .lia-button:focus-visible {
    outline-color: Highlight;
  }
}
</style>
