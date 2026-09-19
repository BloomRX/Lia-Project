/**
 * Phase 7.7.1, item C: whether the faint internal-reasoning strip
 * (`message.categorization.reasoning` - provider `reasoning_content`, native
 * `<think>` content) may be rendered above a final answer.
 *
 * Rules (pinned by the unit tests next to this file):
 *
 * - Under a MANAGED Lia product (a capability truth is installed), a normal
 *   user must never see meta text - it contradicted the persona live in the
 *   QA run ("We have a conflict..." above a spoken answer). It remains
 *   reachable through the developer flag.
 * - Standalone AIRI installs no capability truth and keeps today's behavior
 *   verbatim: reasoning is shown whenever it exists.
 *
 * Speech synthesis is deliberately out of scope here: `filterToSpeech`
 * (core-agent response-categoriser) already strips reasoning from TTS in
 * both modes, and this file changes nothing about it.
 */
export function shouldShowChatReasoning(options: {
  /** Whether a Lia product installed capability truth for this run. */
  liaManaged: boolean
  /** Developer-mode flag (settings store, default false). */
  developerShowChatReasoning: boolean
  /** Whether the message carries non-empty reasoning text at all. */
  hasReasoningText: boolean
}): boolean {
  if (!options.hasReasoningText)
    return false
  if (options.liaManaged && !options.developerShowChatReasoning)
    return false
  return true
}
