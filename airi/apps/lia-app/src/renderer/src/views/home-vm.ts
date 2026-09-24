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
