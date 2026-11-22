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
  transition: border-color var(--lia-transition-fast) ease, background var(--lia-transition-fast) ease, filter var(--lia-transition-fast) ease;
}

/* Visible keyboard focus via the shared ring token; pointer stays clean. */
.lia-button:focus-visible {
  box-shadow: var(--lia-focus-ring);
  outline: none;
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
  background: linear-gradient(135deg, var(--lia-accent), var(--lia-accent-soft));
  border: none;
  color: var(--lia-accent-contrast);
  font-weight: var(--lia-font-bold);
}
.lia-button--primary:hover:not(:disabled) {
  filter: brightness(1.08);
}
</style>
