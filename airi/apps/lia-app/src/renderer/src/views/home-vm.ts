/**
 * Phase 8.0A-3: the Home page view-model - small, PURE and metadata-only.
 *
 * The view stays declarative: every fact below derives from state the
 * launcher already owns (home status, voice readiness). No preparation
 * logic, no runtime knowledge, no invented capabilities - Home consumes,
 * it never decides.
 */

export interface HomeAiChipVm {
  label: string
  variant: 'ready' | 'warning'
}

/** IA/conversation readiness, in product words (never infrastructure detail). */
export function homeAiChipVm(status: unknown): HomeAiChipVm {
  const ready = Boolean((status as Record<string, any> | undefined)?.ai?.ready)
  return ready
    ? { label: 'IA pronta', variant: 'ready' }
    : { label: 'IA a configurar', variant: 'warning' }
}

/**
 * The honest blocker shown when conversation cannot start (existing
 * behavior, same words) - undefined once IA is configured.
 */
export function homeBlockerHintVm(status: unknown): string | undefined {
  const s = status as Record<string, any> | undefined
  if (!s)
    return undefined
  return s.ai?.ready
    ? undefined
    : 'A Lia ainda precisa da configuração de IA para conversar — veja a aba Configuração.'
}

/** The primary action label follows the Stage phase (existing contract). */
export function homeConversationLabelVm(status: unknown): string {
  const phase = (status as Record<string, any> | undefined)?.stage?.state?.phase
  if (phase === 'running')
    return 'Conversando…'
  if (phase === 'starting')
    return 'Abrindo o palco…'
  return 'Conversar com Lia'
}

/** The action blocks while the Stage is starting (existing contract). */
export function homeConversationStartingVm(status: unknown): boolean {
  return (status as Record<string, any> | undefined)?.stage?.state?.phase === 'starting'
}
