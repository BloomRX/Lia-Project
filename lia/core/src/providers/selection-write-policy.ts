import { findLiaAiProviderByStageProviderId } from './catalog'

export interface LiaSelectionTarget {
  providerId: string
  modelId?: string
}

export type LiaSelectionWriteCode = 'selection-owned-by-launcher' | 'stale-selection'

export type LiaSelectionWriteDecision = { ok: true } | { ok: false, code: LiaSelectionWriteCode }

export interface LiaSelectionWriteInput {
  persisted?: LiaSelectionTarget
  incoming?: LiaSelectionTarget
  expected?: LiaSelectionTarget | null
  managed?: (providerId: string) => boolean
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && value.trim() === value && !/[\u0000-\u001F\u007F]/.test(value)
}

export function isLiaSelectionTarget(value: unknown): value is LiaSelectionTarget {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false
  try {
    const target = value as Record<string, unknown>
    return (Object.getPrototypeOf(target) === Object.prototype || Object.getPrototypeOf(target) === null)
      && Object.keys(target).every(key => key === 'providerId' || key === 'modelId')
      && validId(target.providerId)
      && (target.modelId === undefined || validId(target.modelId))
  }
  catch {
    return false
  }
}

export function isLauncherManagedProvider(providerId: string): boolean {
  return findLiaAiProviderByStageProviderId(providerId)?.availability === 'ready'
}

function sameTarget(left: LiaSelectionTarget | undefined, right: LiaSelectionTarget | undefined): boolean {
  if (!left || !right)
    return left === right
  return left.providerId === right.providerId && (left.modelId ?? '') === (right.modelId ?? '')
}

export function decideSelectionWrite(input: LiaSelectionWriteInput): LiaSelectionWriteDecision {
  const { persisted, incoming } = input
  const managed = input.managed ?? isLauncherManagedProvider

  if (!incoming) {
    if (input.expected !== undefined && !sameTarget(input.expected ?? undefined, persisted))
      return { ok: false, code: 'stale-selection' }
    return { ok: true }
  }

  if (sameTarget(incoming, persisted))
    return { ok: true }

  if (managed(incoming.providerId) || (persisted && managed(persisted.providerId)))
    return { ok: false, code: 'selection-owned-by-launcher' }

  if (input.expected !== undefined && !sameTarget(input.expected ?? undefined, persisted))
    return { ok: false, code: 'stale-selection' }

  return { ok: true }
}
