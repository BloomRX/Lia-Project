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
  variant: 'ready' | 'warning' | 'unknown'
}

/** IA/conversation readiness, in product words (never infrastructure detail). */
export function homeAiChipVm(status: unknown, language?: string): HomeAiChipVm {
  const ready = (status as Record<string, any> | undefined)?.ai?.ready
  const english = language?.startsWith('en')
  if (ready === true)
    return { label: english ? 'Ready to talk' : 'Pronta para conversar', variant: 'ready' }
  if (ready === false)
    return { label: english ? 'AI setup needed' : 'IA a configurar', variant: 'warning' }
  return { label: english ? 'Checking readiness…' : 'Verificando prontidão…', variant: 'unknown' }
}

/**
 * The honest blocker shown when conversation cannot start (existing
 * behavior, same words) - undefined once IA is configured.
 */
export function homeBlockerHintVm(status: unknown, language?: string): string | undefined {
  const s = status as Record<string, any> | undefined
  if (s?.ai?.ready !== false)
    return undefined
  return language?.startsWith('en')
    ? 'Set up an AI connection in AI & Resources to start a conversation.'
    : 'Configure uma conexão em IA & Recursos para conversar com a Lia.'
}

/** The primary action label follows the Stage phase (existing contract). */
export function homeConversationLabelVm(status: unknown, language?: string): string {
  const s = status as Record<string, any> | undefined
  const phase = s?.stage?.state?.phase
  const english = language?.startsWith('en')
  if (phase === 'running')
    return english ? 'Conversation open' : 'Conversando…'
  if (phase === 'starting')
    return english ? 'Opening the Stage…' : 'Abrindo o palco…'
  if (s?.ai?.ready === false)
    return english ? 'Set up AI' : 'Configurar IA'
  if (s?.ai?.ready !== true)
    return english ? 'Checking readiness…' : 'Verificando prontidão…'
  return english ? 'Talk to Lia' : 'Conversar com Lia'
}

/** The action blocks while the Stage is starting (existing contract). */
export function homeConversationStartingVm(status: unknown): boolean {
  return (status as Record<string, any> | undefined)?.stage?.state?.phase === 'starting'
}

export function homeConversationStoppingVm(status: unknown): boolean {
  return (status as Record<string, any> | undefined)?.stage?.state?.phase === 'stopping'
}

export function homeConversationStopRetryVm(status: unknown): boolean {
  const state = (status as Record<string, any> | undefined)?.stage?.state
  return state?.phase === 'error' && typeof state.pid === 'number' && state.pid > 0
}

export function homeConversationStopVisibleVm(status: unknown): boolean {
  const phase = (status as Record<string, any> | undefined)?.stage?.state?.phase
  return phase === 'running' || phase === 'stopping' || homeConversationStopRetryVm(status)
}

export function homeConversationStopMessagesVm(language?: string) {
  return language?.startsWith('en')
    ? { label: 'End conversation', stopping: 'Ending…', success: 'Conversation ended.', error: 'Could not end the conversation. Try again.' }
    : { label: 'Encerrar conversa', stopping: 'Encerrando…', success: 'Conversa encerrada.', error: 'Não foi possível encerrar a conversa. Tente novamente.' }
}

// ---------------------------------------------------------------------------
// Phase 8.0A-5: the minimal first-run choice. The marker is the canonical
// product-config `setup.completed` flag (7.9H-B3): absent or false means the
// initial choice has not happened yet; only an explicit `true` marks it
// done. The panel is NON-BLOCKING - it never gates any other Home surface.
// ---------------------------------------------------------------------------

/** The choice panel shows until the canonical marker is explicitly true. */
export function firstRunPanelVisible(setup: { completed?: boolean } | undefined): boolean {
  return setup?.completed !== true
}

export type FirstRunChoice = 'complete' | 'textOnly'

/**
 * THE first-run write contract: ONE canonical config update per choice,
 * through the SAME seam every other product preference rides. "Completa"
 * leaves voice on (the automatic preparation flow proceeds on its own);
 * "Somente texto" switches voice off. Both mark the setup as done.
 */
export function firstRunChoicePayload(choice: FirstRunChoice): {
  update: { setup: { completed: true }, voice: { enabled: boolean } }
} {
  return {
    update: {
      setup: { completed: true },
      voice: { enabled: choice === 'complete' },
    },
  }
}
