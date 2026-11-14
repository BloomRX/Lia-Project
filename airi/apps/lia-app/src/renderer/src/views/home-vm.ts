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
  variant: 'neutral' | 'ready' | 'warning'
}

/** IA readiness comes only from the existing home-status snapshot. */
export function homeAiChipVm(status: unknown, language?: string): HomeAiChipVm {
  const english = language?.toLowerCase().startsWith('en') === true
  if (status == null)
    return { label: english ? 'Checking AI' : 'Verificando IA', variant: 'neutral' }
  const ready = Boolean((status as Record<string, any>).ai?.ready)
  return ready
    ? { label: english ? 'AI ready' : 'IA pronta', variant: 'ready' }
    : { label: english ? 'AI needs setup' : 'IA a configurar', variant: 'warning' }
}

/** Explain the next step without exposing a transport or credential detail. */
export function homeBlockerHintVm(status: unknown, language?: string): string | undefined {
  const english = language?.toLowerCase().startsWith('en') === true
  if (status == null)
    return english ? 'Checking whether AI is ready for conversation.' : 'Verificando se a IA está pronta para conversar.'
  return (status as Record<string, any>).ai?.ready
    ? undefined
    : english
      ? 'Set up an AI service and model in AI & Resources before you chat.'
      : 'Configure um serviço e um modelo de IA em IA & Recursos antes de conversar.'
}

/** The primary action follows lifecycle first, then actual AI readiness. */
export function homeConversationLabelVm(status: unknown, language?: string): string {
  const english = language?.toLowerCase().startsWith('en') === true
  if (status == null)
    return english ? 'Checking readiness…' : 'Verificando prontidão…'
  const snapshot = status as Record<string, any>
  const phase = snapshot.stage?.state?.phase
  if (phase === 'running')
    return english ? 'Conversation open' : 'Conversando…'
  if (phase === 'starting')
    return english ? 'Opening conversation…' : 'Abrindo o palco…'
  if (phase === 'stopping')
    return english ? 'Ending conversation…' : 'Encerrando conversa…'
  if (!snapshot.ai?.ready)
    return english ? 'Set up AI to chat' : 'Configurar IA para conversar'
  return english ? 'Chat with Lia' : 'Conversar com Lia'
}

/** Operational state is separate from configuration readiness. */
export function homeStageChipVm(status: unknown, language?: string): HomeAiChipVm {
  const english = language?.toLowerCase().startsWith('en') === true
  const phase = (status as Record<string, any> | undefined)?.stage?.state?.phase
  const states: Record<string, HomeAiChipVm> = {
    stopped: { label: english ? 'Conversation stopped' : 'Conversa parada', variant: 'neutral' },
    starting: { label: english ? 'Starting conversation' : 'Iniciando conversa', variant: 'warning' },
    running: { label: english ? 'Conversation active' : 'Conversa ativa', variant: 'ready' },
    stopping: { label: english ? 'Ending conversation' : 'Encerrando conversa', variant: 'warning' },
    error: { label: english ? 'Conversation error' : 'Erro na conversa', variant: 'warning' },
  }
  return states[String(phase)] ?? { label: english ? 'Checking conversation' : 'Verificando conversa', variant: 'neutral' }
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
