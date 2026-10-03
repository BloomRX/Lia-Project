import { describe, expect, it } from 'vitest'

import { shouldShowChatReasoning } from './reasoning-visibility'

/**
 * Phase 7.7.1, item C: the persona's internal reasoning ("We have a
 * conflict: the system instructions (developer) say...") was rendered as
 * faint English text above the final answer IN A NORMAL RUN. Managed Lia
 * must render only final, user-facing content; dev diagnostics stay one
 * flag away.
 */
describe('shouldShowChatReasoning', () => {
  it('c1: managed Lia hides reasoning by default', () => {
    expect(shouldShowChatReasoning({
      developerShowChatReasoning: false,
      hasReasoningText: true,
      liaManaged: true,
    })).toBe(false)
  })

  it('c2: managed Lia + developer flag shows reasoning (diagnostics preserved)', () => {
    expect(shouldShowChatReasoning({
      developerShowChatReasoning: true,
      hasReasoningText: true,
      liaManaged: true,
    })).toBe(true)
  })

  it('c3: standalone AIRI keeps showing reasoning, with or without the flag', () => {
    expect(shouldShowChatReasoning({
      developerShowChatReasoning: false,
      hasReasoningText: true,
      liaManaged: false,
    })).toBe(true)
    expect(shouldShowChatReasoning({
      developerShowChatReasoning: true,
      hasReasoningText: true,
      liaManaged: false,
    })).toBe(true)
  })

  it('c4: no reasoning text renders nothing, in every mode', () => {
    for (const liaManaged of [true, false]) {
      for (const developerShowChatReasoning of [true, false]) {
        expect(shouldShowChatReasoning({ developerShowChatReasoning, hasReasoningText: false, liaManaged })).toBe(false)
      }
    }
  })
})
