<script setup lang="ts">
import type { ChatAssistantMessage } from '../../../../types/chat'

import { Truncatable } from '@proj-airi/ui'
import { computed } from 'vue'

import { getLiaCapabilitySnapshot } from '../../../../libs/capabilities/lia-capability-port'
import { shouldShowChatReasoning } from '../../../../stores/chat/reasoning-visibility'
import { useSettingsDeveloper } from '../../../../stores/settings/developer'
import { MarkdownRenderer } from '../../../markdown'

const props = withDefaults(defineProps<{
  message: ChatAssistantMessage
  reasoningVisibility?: 'auto' | 'visible' | 'hidden'
  variant?: 'desktop' | 'mobile'
}>(), {
  reasoningVisibility: 'auto',
})

const developer = useSettingsDeveloper()

const reasoningContent = computed(() => props.message.categorization?.reasoning?.trim() ?? '')

// Phase 7.7.1, item C: "Managed Lia must render and speak only final,
// user-facing assistant content." The faint internal reasoning strip is a
// raw provider diagnostic (`reasoning_content` / <think>), perfect for dev,
// harmful for a normal persona run - it even contradicted the answer above
// it ("We have a conflict..." while she was speaking). The pure rule lives
// in stores/chat/reasoning-visibility.ts (unit-pinned there); standalone
// AIRI (no capability truth installed) keeps today's behavior verbatim.
// Secondary Chat windows can apply their host policy without bootstrapping
// runtime capabilities. Auto preserves the existing standalone/managed rule.
const hasReasoning = computed(() => {
  if (!reasoningContent.value || props.reasoningVisibility === 'hidden')
    return false
  if (props.reasoningVisibility === 'visible')
    return true
  return shouldShowChatReasoning({
    developerShowChatReasoning: developer.showChatReasoning,
    hasReasoningText: true,
    liaManaged: getLiaCapabilitySnapshot() !== undefined,
  })
})

const containerClasses = computed(() => [
  props.variant === 'mobile' ? 'text-xs' : 'text-sm',
])
</script>

<template>
  <div v-if="hasReasoning" :class="containerClasses" flex="~ col" gap-1>
    <Truncatable :line-clamp="1">
      <MarkdownRenderer
        :content="reasoningContent"
        :class="['break-words']"
        text="sm neutral-700/50 dark:neutral-300/50"
      />
    </Truncatable>
  </div>
</template>
