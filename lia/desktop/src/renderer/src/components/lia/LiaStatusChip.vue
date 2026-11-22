<script setup lang="ts">
/**
 * LiaStatusChip (Phase 8.0A-1): the compact Lia status primitive.
 *
 * Presentation ONLY: five semantic variants (neutral/ready/warning/error/
 * disabled) colored by the status tokens, with a dot + text pairing so the
 * state never relies on color alone (LIA-UI-DESIGN-SYSTEM §27). Label
 * content rides the default slot; no product logic, no page props.
 */
withDefaults(defineProps<{
  variant?: 'disabled' | 'error' | 'neutral' | 'ready' | 'warning'
}>(), { variant: 'neutral' })
</script>

<template>
  <span class="lia-status-chip" :class="`lia-status-chip--${variant}`">
    <span class="lia-status-chip__dot" aria-hidden="true" />
    <span class="lia-status-chip__label"><slot /></span>
  </span>
</template>

<style scoped>
.lia-status-chip {
  align-items: center;
  border: 1px solid var(--lia-border-subtle);
  border-radius: var(--lia-radius-pill);
  display: inline-flex;
  font-size: var(--lia-text-xs);
  gap: var(--lia-space-2);
  padding: var(--lia-space-1) var(--lia-space-3);
}

.lia-status-chip__dot {
  border-radius: 50%;
  height: 8px;
  width: 8px;
}

.lia-status-chip__label {
  color: var(--lia-text-primary);
}

.lia-status-chip--neutral .lia-status-chip__dot {
  background: var(--lia-text-secondary);
}

.lia-status-chip--ready {
  border-color: var(--lia-status-ready);
}
.lia-status-chip--ready .lia-status-chip__dot {
  background: var(--lia-status-ready);
}

.lia-status-chip--warning {
  border-color: var(--lia-status-warning);
}
.lia-status-chip--warning .lia-status-chip__dot {
  background: var(--lia-status-warning);
}

.lia-status-chip--error {
  border-color: var(--lia-status-error);
}
.lia-status-chip--error .lia-status-chip__dot {
  background: var(--lia-status-error);
}

.lia-status-chip--disabled {
  opacity: 0.6;
}
.lia-status-chip--disabled .lia-status-chip__dot {
  background: var(--lia-status-disabled);
}
.lia-status-chip--disabled .lia-status-chip__label {
  color: var(--lia-text-secondary);
}
</style>
