export type ConversationExpression = 'idle' | 'thinking' | 'responded'
export type ExpressionPhase = ConversationExpression | 'speaking'

export function isExpressionPhase(value: unknown): value is ExpressionPhase {
  return value === 'idle' || value === 'thinking' || value === 'responded' || value === 'speaking'
}
