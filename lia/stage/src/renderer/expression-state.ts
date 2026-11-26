export type ConversationExpression = 'idle' | 'thinking' | 'responded'
export type ExpressionPhase = ConversationExpression | 'speaking'

export interface ExpressionSnapshot {
  readonly phase: ExpressionPhase
  readonly intensity: number
  readonly since: number
  readonly expiresAt: number | null
}

const responseDuration = 1_800
const intensities: Record<ExpressionPhase, number> = {
  idle: 0,
  thinking: 0.35,
  responded: 0.55,
  speaking: 0.65,
}

/** Local presentation state derived from operation lifecycles. */
export function createExpressionState({ onChange }: { onChange: (state: ExpressionSnapshot) => void }) {
  let conversation: ConversationExpression = 'idle'
  let playing = false
  let disposed = false
  let responseExpiry: number | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let current: ExpressionSnapshot = Object.freeze({
    phase: 'idle', intensity: intensities.idle, since: Date.now(), expiresAt: null,
  })

  function publish() {
    const phase = playing ? 'speaking' : conversation
    const expiresAt = phase === 'responded' ? responseExpiry : null
    if (current.phase === phase && current.expiresAt === expiresAt)
      return
    current = Object.freeze({ phase, intensity: intensities[phase], since: Date.now(), expiresAt })
    onChange(current)
  }

  function stopTimer() {
    if (timer !== undefined)
      clearTimeout(timer)
    timer = undefined
    responseExpiry = null
  }

  return {
    snapshot: () => current,
    setConversation(phase: ConversationExpression) {
      if (disposed)
        return
      stopTimer()
      conversation = phase
      if (phase === 'responded') {
        responseExpiry = Date.now() + responseDuration
        timer = setTimeout(() => {
          stopTimer()
          conversation = 'idle'
          publish()
        }, responseDuration)
      }
      publish()
    },
    setPlayback(active: boolean) {
      if (disposed)
        return
      playing = active
      publish()
    },
    dispose() {
      disposed = true
      stopTimer()
    },
  }
}
