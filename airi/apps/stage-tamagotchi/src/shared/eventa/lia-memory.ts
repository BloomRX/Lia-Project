import { defineInvokeEventa } from '@moeru/eventa'

export const LIA_MEMORY_LIMITS = { entries: 100, text: 500, query: 4000, context: 2000, retrieved: 4 } as const
export interface LiaMemoryEntry { id: string, text: string, updatedAt: string }
export interface LiaMemoryState { schemaVersion: 1, enabled: boolean, entries: LiaMemoryEntry[] }
export type LiaMemoryResult<T = LiaMemoryState> = { ok: true, value: T } | { ok: false, code: 'invalid' | 'unavailable' | 'limit' | 'missing' }
export type LiaMemoryMutation
  = | { action: 'enable', enabled: boolean }
    | { action: 'save', id?: string, text: string }
    | { action: 'remove', id: string }
    | { action: 'clear', confirmed: true }

export const electronLiaMemoryGet = defineInvokeEventa<LiaMemoryResult>('eventa:invoke:lia:memory:get')
export const electronLiaMemoryMutate = defineInvokeEventa<LiaMemoryResult, LiaMemoryMutation>('eventa:invoke:lia:memory:mutate')
export const electronLiaMemoryRecall = defineInvokeEventa<LiaMemoryResult<string>, { query: string }>('eventa:invoke:lia:memory:recall')
